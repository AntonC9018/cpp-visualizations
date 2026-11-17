// PROTOTYPE, throwaway: the byte-tape struct layout view (variant B, chosen).
// Current question: how should padding rows look in the field list? Switched by ?pad=.
import type { LayoutTrace } from '../core/trace_format.ts';
import { FIELD_COLOURS, themeName } from './constants.ts';
import { esc } from './svg.ts';
import two from '../../player/prototype/layout-two.json';
import padded from '../../player/prototype/layout-padded.json';
import ptr from '../../player/prototype/layout-ptr.json';
import mixed from '../../player/prototype/layout-mixed.json';

type Rec = LayoutTrace['records'][number];
type Field = Rec['fields'][number];

const ru = (): boolean => document.documentElement.lang.startsWith('ru');
const t = (en: string, r: string): string => (ru() ? r : en);
const colour = (fi: number): string => `cv-field-${fi % FIELD_COLOURS}`;

// --- Lesson-like context ----------------------------------------------------------------------

const EXAMPLES: { title: string; code: string; text: string; trace: LayoutTrace }[] = [
  {
    title: '22. Structure size (1)',
    code: 'struct A\n{\n    int f1;\n    int f2;\n};',
    text: 'The result is 8 because each structure has 2 <code>int</code>s, each of which occupies 4 bytes.',
    trace: two as LayoutTrace,
  },
  {
    title: '24. (advanced level): Structure size (3)',
    code: 'struct A\n{\n    uint8_t f1;\n    int f2;\n    uint8_t f3;\n};',
    text: 'This is where alignment comes into play. Alignment leaves empty spaces between fields.',
    trace: padded as LayoutTrace,
  },
  {
    title: '7. Field address relative to a structure address',
    code: 'struct A\n{\n    int a;\n    int* p;\n};',
    text: 'The first field of this structure and the structure itself are located at the same address.',
    trace: ptr as LayoutTrace,
  },
  {
    title: 'Made up: a wider struct with every kind of gap',
    code: 'struct Node\n{\n    uint8_t tag;\n    uint64_t id;\n    uint8_t flags;\n    int count;\n    Node* next;\n};',
    text: 'Not in a lesson; stresses 8-byte slots, interior and trailing padding, and a pointer.',
    trace: mixed as LayoutTrace,
  },
];

// --- Shared prototype plumbing: hover/focus/click linking by data-k ---------------------------

// Elements carry data-k = field index, "pad" or "all"; linking dims what is not related.
function link(root: HTMLElement): void {
  let locked: string | null = null;
  const apply = (k: string | null): void => {
    root.classList.toggle('pl-active', k !== null);
    for (const el of root.querySelectorAll<HTMLElement>('[data-k]')) {
      // data-also lists the groups an element belongs to: "pad" (any padding), "w" (widest).
      const also = (el.dataset.also || '').split(' ');
      const on = k !== null && (k === 'all' || el.dataset.k === k || also.includes(k));
      el.classList.toggle('pl-on', on);
      el.setAttribute('aria-pressed', String(locked !== null && el.dataset.k === locked));
    }
  };
  const key = (e: Event): string | null =>
    ((e.target as Element).closest('[data-k]') as HTMLElement | null)?.dataset.k ?? null;
  root.addEventListener('pointerover', e => apply(key(e) ?? locked));
  root.addEventListener('pointerleave', () => apply(locked));
  root.addEventListener('focusin', e => apply(key(e)));
  root.addEventListener('click', e => {
    const k = key(e);
    if (k === null) return;
    locked = locked === k ? null : k;
    apply(locked);
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') apply((locked = null));
  });
}

interface Span {
  kind: 'field' | 'pad';
  fi: number;
  offset: number;
  size: number;
  field?: Field;
}

// Fields and the padding between and after them, in byte order.
function spans(r: Rec): Span[] {
  const out: Span[] = [];
  let at = 0;
  r.fields.forEach((f, fi) => {
    if (f.offset > at) out.push({ kind: 'pad', fi: -1, offset: at, size: f.offset - at });
    out.push({ kind: 'field', fi, offset: f.offset, size: f.size, field: f });
    at = f.offset + f.size;
  });
  if (r.size > at) out.push({ kind: 'pad', fi: -1, offset: at, size: r.size - at });
  return out;
}

const padBytes = (r: Rec): number => r.size - r.fields.reduce((s, f) => s + f.size, 0);
const k = (s: Span): string => (s.kind === 'pad' ? 'pad' : String(s.fi));

function shell(host: HTMLElement, cls: string, html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.className = `cv-player not-content pl ${cls}`;
  root.dataset.cvTheme = themeName();
  root.innerHTML = html;
  host.append(root);
  return root;
}

// --- B: one horizontal tape of bytes, fields bracketed above, offsets below ------------------

// alignof ideas, switched by ?align= from the header.
const ALIGN_IDEAS: Record<string, string> = {
  '1': 'max() formula',
  '2': '= sizeof(widest)',
  '3': 'size column + marker',
  '4': 'slot brace under tape',
};
const alignIdea = (): string => {
  const a = new URLSearchParams(location.search).get('align') ?? '1';
  return a in ALIGN_IDEAS ? a : '1';
};

function variantB(host: HTMLElement, trace: LayoutTrace): void {
  const r = trace.records[0];
  const ss = spans(r);
  const idea = alignIdea();
  // Alignment is only worth showing when it changed something.
  const padded = padBytes(r) > 0;
  const widest = Math.max(...r.fields.map(f => f.size));
  const isWide = (fi: number): boolean => padded && r.fields[fi].size === widest;
  const wideFields = r.fields.filter((_, fi) => isWide(fi));
  const groups = (s: Span): string =>
    s.kind === 'pad' ? ' data-also="pad"' : isWide(s.fi) ? ' data-also="w"' : '';
  const key = (s: Span): string => (s.kind === 'pad' ? `pad:${s.offset}` : String(s.fi));
  const col = (s: Span): string => `grid-column:${s.offset + 1} / span ${s.size}`;

  // Padding rows in the field list, one look per ?pad= idea.
  const pi = padIdea();
  const hatch = (n: number): string =>
    `<span class="plb-squares">${'<i class="pl-hatch"></i>'.repeat(n)}</span>`;
  const padRow = (s: Span): string => {
    const attrs = `type="button" data-k="${key(s)}"${groups(s)}`;
    const n = s.size;
    const w = t('padding', 'выравнивание');
    const row = (cls: string, body: string): string =>
      `<button ${attrs} class="plb-field plb-phantom ${cls}"><i class="pl-hatch"></i>${body}</button>`;
    if (pi === 'italic') return row('', `<span>${w} ×${n}</span>`);
    if (pi === 'plain') return row('plb-x-plain', `<span>${w} ×${n}</span>`);
    if (pi === 'pill') return row('plb-x-plain', `<span>${w}</span><span class="plb-pill">×${n}</span>`);
    if (pi === 'small') return row('plb-x-plain', `<span>${w}<small class="plb-times">×${n}</small></span>`);
    return '';
  };
  const fieldRow = (s: Span): string => {
    const f = s.field!;
    const marker =
      idea === '3' ? `<em>${f.size} B${isWide(s.fi) ? ` <strong>◂ alignof</strong>` : ''}</em>` : '';
    return (
      `<button type="button" data-k="${key(s)}"${groups(s)} class="plb-field ${colour(s.fi)}">` +
      `<i></i><span>${esc(f.type)} <b>${esc(f.name)}</b>;</span>${marker}</button>`
    );
  };
  let rows = '';
  if (false) {
    // The padding that follows a field trails it on the same line.
    ss.forEach((s, i) => {
      if (s.kind === 'pad') return;
      const next = ss[i + 1];
      const pad =
        next?.kind === 'pad'
          ? `<button type="button" data-k="${key(next)}"${groups(next)} class="plb-trail">${hatch(next.size)}</button>`
          : '';
      rows += `<div class="plb-line">${fieldRow(s)}${pad}</div>`;
    });
    // A struct cannot start with padding, so nothing is lost.
  } else {
    rows = ss.map(s => (s.kind === 'pad' ? padRow(s) : fieldRow(s))).join('');
  }
  const labels = ss
    .map((s, i) => {
      // One hatched block per padding run, under its byte cells, so the stripes tile.
      if (s.kind === 'pad')
        return `<span data-k="${key(s)}"${groups(s)} class="plb-padblock pl-hatch" style="${col(s)}"></span>`;
      const row = s.size < 3 && i % 2 ? 2 : 1;
      return `<button type="button" data-k="${key(s)}"${groups(s)} class="plb-label plb-r${row} ${colour(s.fi)}" style="${col(s)}"><b>${esc(s.field!.name)}</b></button>`;
    })
    .join('');
  const cells = Array.from({ length: r.size }, (_, o) => {
    const s = ss.find(x => o >= x.offset && o < x.offset + x.size)!;
    const edge = padded && o % r.alignment === 0 ? ' plb-slot' : '';
    const start = s.offset === o ? ' plb-start' : '';
    return `<span data-k="${key(s)}"${groups(s)} class="plb-byte${edge}${start} ${s.kind === 'pad' ? 'plb-padbyte' : colour(s.fi)}" style="grid-column:${o + 1}"></span>`;
  }).join('');
  // Offsets: at slot edges when alignment matters, otherwise where each field starts.
  const marks = padded
    ? Array.from({ length: r.size / r.alignment + 1 }, (_, i) => i * r.alignment)
    : [...r.fields.map(f => f.offset), r.size];
  const ticks = marks
    .map(
      o =>
        o === r.size
          ? `<span class="plb-tick plb-tick-end" style="grid-column:${r.size}">${o}</span>`
          : `<span class="plb-tick" style="grid-column:${o + 1}">${o}</span>`
    )
    .join('');

  // The alignof fact, one way per idea. data-k="w" links it to the widest field(s).
  const wideName = wideFields
    .map(f => `<b class="${colour(r.fields.indexOf(f))}">${esc(f.name)}</b>`)
    .join(', ');
  const wideType = esc(wideFields[0]?.type ?? '');
  let alignFact = '';
  let brace = '';
  if (padded) {
    if (idea === '1') {
      const args = r.fields
        .map((f, fi) => `<b class="${colour(fi)}${isWide(fi) ? ' plb-max' : ''}">${f.size}</b>`)
        .join(', ');
      alignFact = `<button type="button" data-k="w" class="plb-align">alignof = max(${args}) = <b>${r.alignment}</b></button>`;
    } else if (idea === '2') {
      alignFact = `<button type="button" data-k="w" class="plb-align">alignof <b>${r.alignment}</b> = sizeof(${wideType}) ← ${wideName}</button>`;
    } else if (idea === '3') {
      alignFact = `<button type="button" data-k="w" class="plb-align">alignof <b>${r.alignment}</b></button>`;
    } else {
      alignFact = `<button type="button" data-k="w" class="plb-align">alignof <b>${r.alignment}</b></button>`;
      const fi = r.fields.indexOf(wideFields[0]);
      brace =
        `<button type="button" data-k="w" class="plb-brace ${colour(fi)}" style="grid-column:1 / span ${r.alignment}">` +
        `<span>${t('slot', 'слот')} = alignof = sizeof(${wideType}) = ${r.alignment}</span></button>`;
    }
  }
  const padFact = padded
    ? `<button type="button" data-k="pad" class="plb-pad"><i class="pl-hatch"></i> ${t('padding', 'выравнивание')} ${padBytes(r)} B</button>`
    : '';
  shell(
    host,
    'plb',
    `<div class="plb-fields${idea === '3' ? ' plb-sizes' : ''}"><button type="button" data-k="all" class="plb-struct">struct <b>${esc(r.name)}</b> {</button>${rows}<span class="plb-close">};</span></div>` +
      `<div class="plb-head"><button type="button" data-k="all">sizeof ${r.size}</button>${alignFact}${padFact}</div>` +
      `<div class="plb-tape" style="--n:${r.size}">${labels}${cells}${ticks}${brace}</div>`
  );
  link(host.lastElementChild as HTMLElement);
}

// --- Page and switcher -----------------------------------------------------------------------

const PAD_IDEAS: Record<string, string> = {
  italic: 'padding ×3, dim italic',
  plain: 'padding ×3, upright, muted',
  pill: 'padding with a ×3 badge',
  small: 'padding with a small ×3',
};
const KEYS = Object.keys(PAD_IDEAS);

function padIdea(): string {
  const v = new URLSearchParams(location.search).get('pad') ?? KEYS[0];
  return KEYS.includes(v) ? v : KEYS[0];
}

function render(): void {
  const box = document.getElementById('proto-sections')!;
  box.innerHTML = EXAMPLES.map(
    (ex, i) =>
      `<h2>${esc(ex.title)}</h2><pre><code>${esc(ex.code)}</code></pre>` +
      `<details open><summary>${t('Answer:', 'Ответ:')}</summary><p>${ex.text}</p>` +
      `<div class="course-visualization" data-ex="${i}"></div></details>`
  ).join('');
  for (const host of box.querySelectorAll<HTMLElement>('[data-ex]')) {
    variantB(host, EXAMPLES[Number(host.dataset.ex)].trace);
  }
  document.getElementById('pl-switch-label')!.textContent =
    `padding ${KEYS.indexOf(padIdea()) + 1}/${KEYS.length}: ${PAD_IDEAS[padIdea()]}`;
}

function go(delta: number): void {
  const i = (KEYS.indexOf(padIdea()) + delta + KEYS.length) % KEYS.length;
  const url = new URL(location.href);
  url.searchParams.set('pad', KEYS[i]);
  history.replaceState(null, '', url);
  render();
}

function setParam(name: string, value: string): void {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(null, '', url);
}

const ideas = document.createElement('span');
ideas.className = 'pl-ideas';
const drawIdeas = (): void => {
  ideas.innerHTML =
    'alignof idea: ' +
    Object.entries(ALIGN_IDEAS)
      .map(([a, name]) => `<button type="button" data-align="${a}" title="${name}" aria-pressed="${a === alignIdea()}">${a}</button>`)
      .join('') +
    ` <small>${ALIGN_IDEAS[alignIdea()]}</small>`;
};
ideas.addEventListener('click', e => {
  const a = ((e.target as Element).closest('[data-align]') as HTMLElement | null)?.dataset.align;
  if (!a) return;
  setParam('align', a);
  drawIdeas();
  render();
});
drawIdeas();
document.querySelector('header strong')!.after(ideas);

const bar = document.createElement('div');
bar.className = 'pl-switch';
bar.innerHTML = '<button type="button" data-go="-1">←</button><span id="pl-switch-label"></span><button type="button" data-go="1">→</button>';
bar.addEventListener('click', e => {
  const d = ((e.target as Element).closest('[data-go]') as HTMLElement | null)?.dataset.go;
  if (d) go(Number(d));
});
document.body.append(bar);
document.addEventListener('keydown', e => {
  const el = document.activeElement as HTMLElement | null;
  if (el?.matches('input, textarea, [contenteditable]')) return;
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'ArrowRight') go(1);
});
document.getElementById('theme')!.onclick = () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setParam('theme', root.dataset.theme);
  render();
};
document.getElementById('lang')!.onclick = () => {
  const root = document.documentElement;
  root.lang = root.lang === 'ru' ? 'en' : 'ru';
  setParam('lang', root.lang);
  render();
};

const style = document.createElement('style');
style.textContent = `
.pl-switch {position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 10;
  display: flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 999px;
  background: #ff3e9a; color: #fff; font: 600 14px system-ui; box-shadow: 0 4px 18px #0008;
  max-width: calc(100vw - 32px); white-space: nowrap}
.pl-switch button {all: unset; cursor: pointer; padding: 2px 10px; border-radius: 999px;
  background: #fff3}
.pl-switch span {overflow: hidden; text-overflow: ellipsis}
.pl-ideas {font-size: 13px; color: var(--muted); margin-right: auto}
.pl-ideas button {font: inherit; color: inherit; background: var(--code); margin-left: 3px;
  border: 1px solid var(--line); border-radius: 4px; padding: 0 7px; cursor: pointer}
.pl-ideas button[aria-pressed=true] {background: #ff3e9a; color: #fff; border-color: #ff3e9a}

.course-visualization .pl {background: var(--cv-bg); color: var(--cv-fg); padding: 1rem;
  font-family: ui-monospace, monospace}
:where(.course-visualization .pl button[data-k]) {font: inherit; color: var(--cv-fg);
  background: none; border: 0; margin: 0; padding: 0; cursor: pointer; text-align: left}
.course-visualization .pl.pl-active [data-k]:not(.pl-on) {opacity: .35}
.course-visualization .pl [data-k].pl-on {background-color: var(--cv-highlight)}
.course-visualization .pl [aria-pressed=true] {outline: 2px solid var(--cv-read); outline-offset: 1px}
.course-visualization .pl :focus-visible {outline: 3px solid var(--cv-read); outline-offset: 2px}
.course-visualization .pl .pl-hatch {color: var(--cv-muted);
  background: repeating-linear-gradient(135deg, var(--cv-panel) 0 4px, var(--cv-border) 4px 6px)}
.course-visualization .pl .pl-hatch.pl-on {background: repeating-linear-gradient(135deg,
  var(--cv-highlight) 0 4px, var(--cv-border) 4px 6px)}

/* B */
.plb-fields {display: flex; flex-direction: column; align-items: flex-start; font-size: .85rem;
  margin-bottom: .9rem}
.course-visualization .pl .plb-field {display: flex; align-items: center; gap: .5rem;
  padding: 1px .5rem 1px 1.6rem; border-radius: 3px}
.plb-field i {width: .7rem; height: .7rem; border-radius: 2px; background: currentColor}
.plb-field span {color: var(--cv-fg)}
.plb-field b {color: inherit}
.course-visualization .pl .plb-struct {padding: 1px .5rem 1px 0; border-radius: 3px}
.plb-close {color: var(--cv-fg)}
.plb-head {display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; align-items: baseline;
  margin-bottom: .6rem; color: var(--cv-muted); font-size: .8rem}
.course-visualization .pl .plb-head button {color: var(--cv-fg); font-weight: 700; padding: 0 .3rem;
  border-radius: 3px}
.course-visualization .pl .plb-head .plb-pad {color: var(--cv-muted); font-weight: 400}
.plb-pad i {display: inline-block; width: .7rem; height: .7rem; vertical-align: -1px}
.plb-tape {display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr));
  grid-template-rows: auto auto 2.2rem auto auto; column-gap: 0; row-gap: 2px}
.course-visualization .pl .plb-label {grid-row: 1; font-size: .78rem; line-height: 1.2;
  padding: 2px 4px 4px; border-bottom: 2px solid currentColor; white-space: nowrap;
  overflow: visible; min-width: 0}
.course-visualization .pl .plb-r2 {grid-row: 2}
.course-visualization .pl .plb-r3 {grid-row: 4; border: 0; font-size: .7rem; text-align: center;
  color: var(--cv-muted)}
/* Bytes keep their field fill when linked and draw separators in the stage colour,
 * so one byte stays distinguishable inside a highlighted int. */
.plb-byte {grid-row: 3; border-block: 1px solid var(--cv-border);
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--cv-bg) 70%, transparent);
  background-color: color-mix(in srgb, currentColor 32%, var(--cv-bg))}
.course-visualization .pl .plb-byte.pl-on {
  background-color: color-mix(in srgb, currentColor 70%, var(--cv-bg));
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--cv-bg) 55%, transparent)}
.course-visualization .pl .plb-byte.pl-hatch {background-color: transparent}
.plb-byte.plb-start {box-shadow: inset 2px 0 0 var(--cv-bg)}
.course-visualization .pl .plb-byte.plb-start.pl-on {box-shadow: inset 2px 0 0 var(--cv-bg)}
.course-visualization .pl .plb-byte.plb-slot {box-shadow: inset 2px 0 0 var(--cv-fg)}
.plb-byte:last-of-type {border-right: 1px solid var(--cv-border)}
.plb-tick {grid-row: 5; font-size: .7rem; color: var(--cv-muted); transform: translateX(-30%)}

/* Padding rows */
.course-visualization .pl .plb-phantom.plb-x-plain {font-style: normal; opacity: .7}
.plb-pill {margin-left: .45rem; padding: 0 .35rem; border: 1px solid var(--cv-border);
  border-radius: 999px; font-size: .72rem; line-height: 1.3}
.plb-times {margin-left: .2rem; font-size: .72rem}
.plb-squares {display: inline-flex; gap: 2px; vertical-align: middle}
.plb-squares i {display: block; width: .62rem; height: .62rem; border: 1px solid var(--cv-border)}
.plb-none {background: none !important}
.plb-p-squares small {color: var(--cv-muted); font-size: .7rem; margin-left: .4rem; font-style: normal}
.plb-p-array b {color: var(--cv-muted)}
.course-visualization .pl .plb-seam {display: flex; align-items: center; gap: .4rem; width: 14rem;
  margin: 1px 0 1px 1.6rem; color: var(--cv-muted); font-size: .68rem; opacity: .75}
.plb-seam::before, .plb-seam::after {content: ''; flex: 1; border-top: 1px dashed var(--cv-border)}
.course-visualization .pl.pl-active .plb-seam.pl-on {opacity: 1}
.plb-line {display: flex; align-items: center; gap: .6rem}
.course-visualization .pl .plb-trail {padding: 2px 3px; border-radius: 3px; line-height: 0}

/* B, round 4 */
.plb-padblock {grid-row: 3}
.course-visualization .pl .plb-byte.plb-padbyte {background-color: transparent; color: var(--cv-muted)}
.course-visualization .pl .plb-tick {transform: none; justify-self: start; padding: 1px 0 0 3px;
  border-left: 1px solid var(--cv-muted); line-height: 1.1; white-space: nowrap}
.course-visualization .pl .plb-tick-end {justify-self: end; padding: 1px 3px 0 0; border-left: 0;
  border-right: 1px solid var(--cv-muted)}

/* B, round 3 */
.course-visualization .pl .plb-phantom {opacity: .55; font-style: italic}
.course-visualization .pl.pl-active .plb-phantom.pl-on {opacity: 1}
.course-visualization .pl .plb-phantom span {color: var(--cv-muted)}
.plb-phantom i {background-color: transparent; border: 1px dashed var(--cv-border)}
.plb-sizes {display: grid !important; grid-template-columns: max-content}
.plb-field em {margin-left: auto; padding-left: 1.5rem; font-style: normal; font-size: .75rem;
  color: var(--cv-muted)}
.plb-field em strong {color: var(--cv-fg); font-weight: 700}
.course-visualization .pl .plb-align {font-weight: 400 !important; color: var(--cv-muted) !important}
.plb-align b {color: var(--cv-fg)}
.plb-align b[class*=cv-field] {color: currentColor}
.course-visualization .plb-align .cv-field-0 {color: var(--cv-field-0)}
.course-visualization .plb-align .cv-field-1 {color: var(--cv-field-1)}
.course-visualization .plb-align .cv-field-2 {color: var(--cv-field-2)}
.course-visualization .plb-align .cv-field-3 {color: var(--cv-field-3)}
.plb-max {text-decoration: underline; text-underline-offset: 3px}
.plb-tape {grid-template-rows: auto auto 2.2rem auto auto auto}
.course-visualization .pl .plb-brace {grid-row: 6; margin-top: .3rem; padding-top: .35rem;
  border: 2px solid currentColor; border-bottom: 0; border-radius: 6px 6px 0 0; height: 1.6rem;
  font-size: .72rem; white-space: nowrap; overflow: visible; text-align: left; padding-left: .3rem}
.plb-brace span {color: var(--cv-fg)}

`;
document.head.append(style);

render();
