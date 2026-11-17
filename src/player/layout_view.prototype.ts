// PROTOTYPE, throwaway: five variants of the static struct layout view, switched by ?variant=.
// Question: what should the layout view look like? A is the implemented view, as a baseline.
import type { LayoutTrace } from '../core/trace_format.ts';
import { FIELD_COLOURS, themeName } from './constants.ts';
import { Layout } from './layout_view.ts';
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
      const on = k !== null && (k === 'all' || el.dataset.k === k);
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

// --- A: the implemented view ------------------------------------------------------------------

function variantA(host: HTMLElement, trace: LayoutTrace): void {
  new Layout(host, trace);
}

// --- B: one horizontal tape of bytes, fields bracketed above, offsets below ------------------

function variantB(host: HTMLElement, trace: LayoutTrace): void {
  const r = trace.records[0];
  const ss = spans(r);
  // Alignment is only worth showing when it changed something.
  const padded = padBytes(r) > 0;
  const col = (s: Span): string => `grid-column:${s.offset + 1} / span ${s.size}`;
  const fields = r.fields
    .map(
      (f, fi) =>
        `<button type="button" data-k="${fi}" class="plb-field ${colour(fi)}">` +
        `<i></i><span>${esc(f.type)} <b>${esc(f.name)}</b>;</span></button>`
    )
    .join('');
  const labels = ss
    .map((s, i) => {
      if (s.kind === 'pad')
        return `<button type="button" data-k="pad" class="plb-label plb-r3" style="${col(s)}">${s.size} B</button>`;
      const row = s.size < 3 && i % 2 ? 2 : 1;
      return `<button type="button" data-k="${k(s)}" class="plb-label plb-r${row} ${colour(s.fi)}" style="${col(s)}"><b>${esc(s.field!.name)}</b></button>`;
    })
    .join('');
  const cells = Array.from({ length: r.size }, (_, o) => {
    const s = ss.find(x => o >= x.offset && o < x.offset + x.size)!;
    const edge = padded && o % r.alignment === 0 ? ' plb-slot' : '';
    const start = s.offset === o ? ' plb-start' : '';
    return `<span data-k="${k(s)}" class="plb-byte${edge}${start} ${s.kind === 'pad' ? 'pl-hatch' : colour(s.fi)}" style="grid-column:${o + 1}"></span>`;
  }).join('');
  // Offsets: at slot edges when alignment matters, otherwise where each field starts.
  const marks = padded
    ? Array.from({ length: r.size / r.alignment + 1 }, (_, i) => i * r.alignment)
    : [...r.fields.map(f => f.offset), r.size];
  const ticks = marks
    .map(
      o =>
        `<span class="plb-tick" style="grid-column:${Math.min(o + 1, r.size)};${o === r.size ? 'justify-self:end;transform:translateX(30%)' : ''}">${o}</span>`
    )
    .join('');
  const facts = padded
    ? `<span>alignof ${r.alignment}</span><button type="button" data-k="pad" class="plb-pad"><i class="pl-hatch"></i> ${t('padding', 'выравнивание')} ${padBytes(r)} B</button>`
    : '';
  shell(
    host,
    'plb',
    `<div class="plb-fields"><button type="button" data-k="all" class="plb-struct">struct <b>${esc(r.name)}</b> {</button>${fields}<span class="plb-close">};</span></div>` +
      `<div class="plb-head"><button type="button" data-k="all">sizeof ${r.size}</button>${facts}</div>` +
      `<div class="plb-tape" style="--n:${r.size}">${labels}${cells}${ticks}</div>`
  );
  link(host.lastElementChild as HTMLElement);
}

// --- C: the source itself, annotated with offsets, padding lines and a minimap ---------------

function variantC(host: HTMLElement, trace: LayoutTrace): void {
  const r = trace.records[0];
  const width = Math.max(...r.fields.map(f => `${f.type} ${f.name};`.length), 14);
  const mini = (s: Span): string =>
    `<span class="plc-mini" style="--n:${r.size}"><i style="grid-column:${s.offset + 1} / span ${s.size}"></i></span>`;
  const line = (cls: string, kk: string, code: string, off: string, size: string, m = ''): string =>
    `<button type="button" data-k="${kk}" class="plc-line ${cls}"><code style="min-width:${width + 5}ch">${code}</code>` +
    `<span class="plc-num">${off}</span><span class="plc-num">${size}</span>${m}</button>`;
  const body = spans(r)
    .map(s =>
      s.kind === 'pad'
        ? line('pl-hatch plc-pad', 'pad', `    /* ${s.size} ${t('bytes of padding', 'байт выравнивания')} */`, String(s.offset), String(s.size), mini(s))
        : line(colour(s.fi), k(s), `    ${esc(s.field!.type)} <b>${esc(s.field!.name)}</b>;`, String(s.offset), String(s.size), mini(s))
    )
    .join('');
  shell(
    host,
    'plc',
    `<div class="plc-line plc-headrow"><code style="min-width:${width + 5}ch"></code><span class="plc-num">offset</span><span class="plc-num">size</span><span class="plc-mini-h">0 → ${r.size}</span></div>` +
      line('', 'all', `struct <b>${esc(r.name)}</b> {`, '', '') +
      body +
      line('', 'all', '};', '', '') +
      `<p class="plc-foot">sizeof(${esc(r.name)}) = <b>${r.size}</b> · alignof = <b>${r.alignment}</b> · ${t('padding', 'выравнивание')} ${padBytes(r)} / ${r.size} B</p>`
  );
  link(host.lastElementChild as HTMLElement);
}

// --- D: one row per alignment slot, fields as solid blocks (no per-byte cells) ---------------

function variantD(host: HTMLElement, trace: LayoutTrace): void {
  const r = trace.records[0];
  const rows: string[] = [];
  for (let start = 0; start < r.size; start += r.alignment) {
    const blocks = spans(r)
      .filter(s => s.offset < start + r.alignment && s.offset + s.size > start)
      .map(s => {
        const from = Math.max(s.offset, start);
        const to = Math.min(s.offset + s.size, start + r.alignment);
        const label =
          s.kind === 'pad'
            ? `<small>${to - from} B</small>`
            : `<b>${esc(s.field!.name)}</b><small>${esc(s.field!.type)}</small>`;
        return `<button type="button" data-k="${k(s)}" class="pld-block ${s.kind === 'pad' ? 'pl-hatch' : colour(s.fi)}" style="grid-column:${from - start + 1} / span ${to - from}">${label}</button>`;
      })
      .join('');
    rows.push(`<span class="pld-off">+${start}</span><div class="pld-row" style="--n:${r.alignment}">${blocks}</div>`);
  }
  const bytes = Array.from({ length: r.alignment }, (_, i) => `<span>${i}</span>`).join('');
  shell(
    host,
    'pld',
    `<div class="pld-grid"><span></span><div class="pld-row pld-bytes" style="--n:${r.alignment}">${bytes}</div>${rows.join('')}</div>` +
      `<p class="pld-foot"><button type="button" data-k="all">sizeof(${esc(r.name)}) = ${r.size}</button> = ` +
      `${r.size / r.alignment} ${t('slots of', 'слота по')} ${r.alignment} B` +
      ` · ${t('padding', 'выравнивание')} ${padBytes(r)} B</p>`
  );
  link(host.lastElementChild as HTMLElement);
}

// --- E: place the fields one at a time, with the rule spelled out for each step --------------

function variantE(host: HTMLElement, trace: LayoutTrace): void {
  const r = trace.records[0];
  const steps = r.fields.length + 2; // slots chosen, each field, trailing padding
  let step = 0;
  const root = shell(host, 'ple', '');
  const explain = (i: number): string => {
    if (i === 0)
      return t(
        `The widest field takes ${r.alignment} B, so memory is split into ${r.alignment}-byte slots.`,
        `Самое широкое поле занимает ${r.alignment} Б, поэтому память делится на слоты по ${r.alignment} байт.`
      );
    if (i <= r.fields.length) {
      const f = r.fields[i - 1];
      const prev = i > 1 ? r.fields[i - 2].offset + r.fields[i - 2].size : 0;
      const gap = f.offset - prev;
      const where = `<code>${esc(f.type)} ${esc(f.name)}</code>`;
      return gap
        ? t(
            `${where} needs a multiple of ${f.size}; +${prev} is not, so ${gap} B are skipped and it goes at +${f.offset}.`,
            `${where} должно начинаться с кратного ${f.size}; +${prev} не подходит, ${gap} Б пропускаются, поле встаёт на +${f.offset}.`
          )
        : t(`${where} fits right at +${f.offset}.`, `${where} помещается сразу на +${f.offset}.`);
    }
    const end = r.fields.at(-1)!;
    const tail = r.size - end.offset - end.size;
    return tail
      ? t(
          `The last slot is filled with ${tail} B of padding: sizeof(${r.name}) = ${r.size}, a multiple of ${r.alignment}.`,
          `Последний слот добивается ${tail} Б выравнивания: sizeof(${r.name}) = ${r.size}, кратно ${r.alignment}.`
        )
      : t(`No trailing padding: sizeof(${r.name}) = ${r.size}.`, `Хвостового выравнивания нет: sizeof(${r.name}) = ${r.size}.`);
  };
  const render = (): void => {
    const placed = step - 1;
    const end = step >= steps - 1 ? r.size : placed > 0 ? r.fields[placed - 1].offset + r.fields[placed - 1].size : 0;
    const cells = Array.from({ length: r.size }, (_, o) => {
      const fi = r.fields.findIndex(f => o >= f.offset && o < f.offset + f.size);
      const shown = fi >= 0 && fi < placed;
      const current = fi === placed - 1 && step <= r.fields.length;
      const pad = fi < 0 && o < end;
      const cls = shown ? colour(fi) : pad ? 'pl-hatch' : 'ple-empty';
      return `<span class="ple-byte ${cls}${current ? ' ple-current' : ''}">${shown && o === r.fields[fi].offset ? esc(r.fields[fi].name) : ''}</span>`;
    }).join('');
    const code = r.fields
      .map((f, fi) => `<div class="${fi < placed ? colour(fi) : 'ple-todo'}${fi === placed - 1 && step <= r.fields.length ? ' ple-now' : ''}">    ${esc(f.type)} ${esc(f.name)};</div>`)
      .join('');
    root.innerHTML =
      `<div class="ple-body"><pre class="ple-code"><div>struct ${esc(r.name)} {</div>${code}<div>};</div></pre>` +
      `<div><div class="ple-mem" style="--n:${r.alignment}">${step === 0 ? cells.replace(/ple-byte ple-empty/g, 'ple-byte ple-empty ple-flash') : cells}</div>` +
      `<p class="ple-say">${explain(step)}</p></div></div>` +
      `<div class="cv-controls ple-controls"><button type="button" class="cv-button" data-d="-1" ${step === 0 ? 'disabled' : ''}>◀ ${t('Back', 'Назад')}</button>` +
      `<span>${step + 1} / ${steps}</span>` +
      `<button type="button" class="cv-button cv-primary" data-d="1" ${step === steps - 1 ? 'disabled' : ''}>${t('Next', 'Далее')} ▶</button></div>`;
  };
  root.addEventListener('click', e => {
    const d = ((e.target as Element).closest('[data-d]') as HTMLElement | null)?.dataset.d;
    if (!d) return;
    step = Math.max(0, Math.min(steps - 1, step + Number(d)));
    render();
    root.querySelector<HTMLElement>(`[data-d="${d}"]:not([disabled])`)?.focus();
  });
  render();
}

// --- Page and switcher -----------------------------------------------------------------------

const VARIANTS: Record<string, [string, (h: HTMLElement, t: LayoutTrace) => void]> = {
  A: ['Implemented: code rows + byte grid', variantA],
  B: ['Byte tape with brackets', variantB],
  C: ['Annotated source (pahole-style)', variantC],
  D: ['Slot rows with field blocks', variantD],
  E: ['Step-by-step placement', variantE],
};
const KEYS = Object.keys(VARIANTS);

function current(): string {
  const v = new URLSearchParams(location.search).get('variant') ?? 'A';
  return KEYS.includes(v) ? v : 'A';
}

function render(): void {
  const [, draw] = VARIANTS[current()];
  const box = document.getElementById('proto-sections')!;
  box.innerHTML = EXAMPLES.map(
    (ex, i) =>
      `<h2>${esc(ex.title)}</h2><pre><code>${esc(ex.code)}</code></pre>` +
      `<details open><summary>${t('Answer:', 'Ответ:')}</summary><p>${ex.text}</p>` +
      `<div class="course-visualization" data-ex="${i}"></div></details>`
  ).join('');
  for (const host of box.querySelectorAll<HTMLElement>('[data-ex]')) {
    draw(host, EXAMPLES[Number(host.dataset.ex)].trace);
  }
  const [name] = VARIANTS[current()];
  document.getElementById('pl-switch-label')!.textContent = `${current()} (${name})`;
}

function go(delta: number): void {
  const i = (KEYS.indexOf(current()) + delta + KEYS.length) % KEYS.length;
  const url = new URL(location.href);
  url.searchParams.set('variant', KEYS[i]);
  history.replaceState(null, '', url);
  render();
}

function setParam(name: string, value: string): void {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState(null, '', url);
}

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

/* C */
.plc-line {display: flex; align-items: center; width: 100%; gap: 1rem; padding: 1px .4rem;
  white-space: pre; font-size: .85rem}
.plc-line code {font: inherit; flex: 1 0 auto}
.plc-line b {color: inherit}
.plc-line:not(.plc-pad):not(.plc-headrow) code {color: var(--cv-fg)}
.plc-line b, .plc-line .plc-mini i {color: inherit}
.plc-num {width: 3.2rem; text-align: right; color: var(--cv-muted); font-variant-numeric: tabular-nums}
.plc-headrow {color: var(--cv-muted); font-size: .72rem}
.plc-mini, .plc-mini-h {flex: 0 0 8rem; width: 8rem}
.plc-mini {display: grid; grid-template-columns: repeat(var(--n), 1fr); height: .7rem;
  border: 1px solid var(--cv-border); background: var(--cv-panel)}
.plc-mini i {background: currentColor}
.plc-pad .plc-mini i {background: var(--cv-muted)}
.plc-foot {margin: .8rem .4rem 0; color: var(--cv-muted); font-size: .8rem}
.plc-foot b {color: var(--cv-fg)}
.course-visualization .plc {overflow-x: auto}

/* D */
.pld-grid {display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px .6rem;
  align-items: stretch; max-width: 34rem}
.pld-row {display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 0}
.pld-bytes span {font-size: .68rem; color: var(--cv-muted); text-align: center}
.pld-off {font-size: .78rem; color: var(--cv-muted); align-self: center; text-align: right}
.course-visualization .pl .pld-block {border: 2px solid currentColor; border-radius: 4px;
  margin: 0 1px; padding: .35rem .4rem; min-height: 3rem; min-width: 0; overflow: hidden;
  background-color: color-mix(in srgb, currentColor 14%, var(--cv-panel))}
.course-visualization .pl .pld-block.pl-hatch {border: 1px dashed var(--cv-border); text-align: center}
.pld-block b, .pld-block small {display: block; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis}
.pld-block small {font-size: .7rem; color: var(--cv-muted)}
.pld-foot {margin: .8rem 0 0; color: var(--cv-muted); font-size: .82rem}
.course-visualization .pl .pld-foot button {color: var(--cv-fg); font-weight: 700}

/* E */
.course-visualization .ple {padding: 0}
.ple-body {display: flex; flex-wrap: wrap; gap: 1rem 2rem; padding: 1rem}
.ple-code {margin: 0; padding: 0; border: 0; background: none; font-size: .85rem; color: var(--cv-fg)}
.ple-todo {color: var(--cv-grey)}
.ple-now {font-weight: 700; text-decoration: underline}
.ple-mem {display: grid; grid-template-columns: repeat(var(--n), 2.1rem); gap: 3px}
.ple-byte {height: 2.1rem; border: 1.5px solid currentColor; border-radius: 3px; font-size: .62rem;
  display: flex; align-items: end; padding: 1px 2px; overflow: visible; white-space: nowrap;
  background: color-mix(in srgb, currentColor 22%, transparent)}
.ple-byte.pl-hatch {border-color: var(--cv-border)}
.ple-empty {color: var(--cv-border); background: none; border-style: dashed}
.ple-current {box-shadow: 0 0 0 2px var(--cv-write)}
.ple-flash {border-color: var(--cv-muted)}
.ple-say {max-width: 26rem; margin: .8rem 0 0; color: var(--cv-fg); font-family: system-ui;
  font-size: .9rem}
.course-visualization .cv-player .ple-controls {display: flex !important; flex-direction: row !important; gap: 1rem; align-items: center; justify-content: center;
  border-top: 1px solid var(--cv-border); padding: .5rem}
.ple-controls span {color: var(--cv-muted); font-size: .8rem}
`;
document.head.append(style);

render();
