// SVG scene rendering for code, tether, pointer arcs, memory cells, evaluation pane, and stdout.
import { arrayType } from '../core/arrays.ts';
import { displayNumber } from '../core/floats.ts';
import type { Span, TraceStep } from '../core/trace_format.ts';
import {
  CELL,
  CHAR,
  CODE_CHAR,
  CODE_GUTTER,
  CODE_SIZE,
  DIM,
  EASE,
  FRAME,
  KEYWORDS,
  LABEL,
  type Palette,
  type PlayerStrings,
  T,
} from './constants.ts';
import {
  type Geometry,
  type PlacedBox,
  type PointerLink,
  frameOf,
  labelCentre,
  labelWidth,
  links,
  type PaneLabel,
  paneLabels,
  typeLabelWidth,
  valueCentre,
} from './geometry.ts';
import { chainOf, memoryWalk, paneLevels, walkWindows } from './storage_path.ts';
import { type Focus, type PreparedModel, arrival, copies, copyBegin, departure, stores } from './model.ts';
import {
  animateAttr,
  animated,
  esc,
  fade,
  format,
  glide,
  glyphs,
  hide,
  markBox,
  pulse,
  rect,
  round,
  scaleAbout,
  settle,
  show,
  text,
} from './svg.ts';


export interface SceneContext {
  m: PreparedModel;
  g: Geometry;
  P: Palette;
  S: PlayerStrings;
  index: number;
  step: TraceStep;
  prev: TraceStep | null;
  animate: boolean;
  op: TraceStep['op'];
  focus: Focus;
  littleEndian: boolean;
}

export function colored(
  c: SceneContext,
  x: number,
  y: number,
  value: string,
  size = c.g.paneSize,
  mute = true,
  member = false
): string {
  let out = '';
  let cx = x;
  let isMember = member;
  for (const token of value.split(/(\b[A-Za-z_]\w*\b)/)) {
    if (!token) continue;
    const owner = !isMember ? c.g.owner(token) : undefined;
    const field = !owner ? c.g.field(token) : undefined;
    const color = owner
      ? owner.color
      : field
        ? (field.fieldColor ?? c.P.fg)
        : mute && KEYWORDS.has(token)
          ? c.P.context
          : c.P.fg;
    out += text(cx, y, token, size, color);
    isMember = /(\.|->)$/.test(token);
    cx += token.length * size * CHAR;
  }
  return out;
}

function paneText(
  c: SceneContext,
  x: number,
  y: number,
  pane: string,
  a: number,
  b: number,
  expr: Span | null | undefined
): string {
  const member = /(\.|->)$/.test(pane.slice(0, a));
  if (!expr) return colored(c, x, y, pane.slice(a, b), c.g.paneSize, true, member);
  const cuts = [a, Math.min(b, Math.max(a, expr[0])), Math.min(b, Math.max(a, expr[1])), b];
  let out = '';
  for (let i = 0; i < 3; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    if (from >= to) continue;
    const px = x + (from - a) * c.g.paneChar;
    const part = pane.slice(from, to);
    out +=
      i === 1
        ? colored(c, px, y, part, c.g.paneSize, true, /(\.|->)$/.test(pane.slice(0, from)))
        : text(px, y, part, c.g.paneSize, c.P.context);
  }
  return out;
}

function exprBackground(
  c: SceneContext,
  x: number,
  y: number,
  expr: Span | null | undefined,
  from: Span | null | undefined = null,
  begin = 0
): string {
  if (!expr || expr[0] === expr[1]) return '';
  const box = (e: Span): [number, number] => [
    x + e[0] * c.g.paneChar - 4,
    (e[1] - e[0]) * c.g.paneChar + 8,
  ];
  const [bx, bw] = box(expr);
  if (from && from[1] > from[0] && (from[0] !== expr[0] || from[1] !== expr[1])) {
    const [fx, fw] = box(from);
    const anims =
      animateAttr('x', fx, bx, 0.3, begin) + animateAttr('width', fw, bw, 0.3, begin);
    return animated(rect(fx, y - 33, fw, 44, c.P.highlight, 'none', 6), anims);
  }
  return rect(bx, y - 33, bw, 44, c.P.highlight, 'none', 6);
}

const settledPane = (c: SceneContext, step: TraceStep, x: number, y: number): string =>
  exprBackground(c, x, y, step.expr) +
  paneText(c, x, y, step.pane, 0, step.pane.length, step.expr);

function inContext(step: TraceStep, span: Span): boolean {
  return Boolean(step.expr) && (span[1] <= step.expr![0] || span[0] >= step.expr![1]);
}

function dim(c: SceneContext, name: string, markup: string): string {
  const { focus } = c;
  const on = focus.now.has(name);
  const was = focus.before.has(name);
  const fade = (from: number, to: number, begin: number): string =>
    `<animate attributeName="opacity" from="${from}" to="${to}" dur="0.35s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;
  const begin = focus.begin.get(name) ?? 0;
  if (on === was) return on ? markup : `<g opacity="${DIM}">${markup}</g>`;
  const from = was ? 1 : DIM;
  return `<g opacity="${from}">${fade(from, on ? 1 : DIM, begin)}${markup}</g>`;
}

// Types ------------------------------------------------------------------------------------
// A type is a unit of measurement: one colour per type, on a label and under what it types.

const typeColour = (c: SceneContext, type: string): string =>
  c.P.types[c.m.typeColours.get(type) ?? 0];

/** A filled pill on the light palette, an outlined one on the dark (--cv-type-label). */
function typeLabel(
  c: SceneContext,
  cx: number,
  top: number,
  type: string,
  size: number,
  color: string
): string {
  const w = typeLabelWidth(type, size);
  const h = size + 7;
  const label = (fill: string): string => text(cx, top + size + 1, type, size, fill, 'middle');
  return c.P.typeLabel === 'fill'
    ? rect(cx - w / 2, top, w, h, color, 'none', h / 2) + label(c.P.bg)
    : rect(cx - w / 2, top, w, h, 'none', color, h / 2, 1.5) + label(color);
}

const labelTop = (y: number, label: PaneLabel): number =>
  y - 70 - label.row * LABEL.row + (LABEL.pane - label.size) / 2;

/** The types of one step's pane, settled, with the pane's text starting at (x, y). */
function paneTypes(c: SceneContext, step: TraceStep, x: number, y: number): string {
  const { P } = c;
  const op = step.op;
  const clash = op?.kind === 'clash';
  const labels = paneLabels(step, c.g.paneChar).map(label => ({ ...label, cx: x + label.cx }));
  const opStart = op && 'span' in op ? op.span[0] : undefined;
  const value = labels.find(label => !label.slot && label.start === opStart);
  const slot = labels.find(label => label.slot);
  let out = '';
  for (const part of step.types ?? []) {
    out +=
      `<path d="M ${round(x + part.span[0] * c.g.paneChar)} ${y + 14} H ${round(x + part.span[1] * c.g.paneChar)}" ` +
      `stroke="${typeColour(c, part.type)}" stroke-width="3" stroke-linecap="round"/>`;
  }
  for (const label of labels) {
    const top = labelTop(y, label);
    const middle = top + (label.size + 7) / 2;
    let mark = typeLabel(c, label.cx, top, label.type, label.size, typeColour(c, label.type));
    const current = c.animate && step === c.step && label === value;
    // A converted value's new unit pops; a unit that does not fit tries the slot and comes back.
    if (current && op?.kind === 'convert') {
      mark =
        `<g transform="translate(${round(label.cx)} ${round(middle)})"><g>${pulse(arrival(op) + 0.2)}` +
        `<g transform="translate(${round(-label.cx)} ${round(-middle)})">${mark}</g></g></g>`;
    }
    if (current && clash && slot) {
      mark =
        `<g><animateMotion path="M 0 0 H ${round(slot.cx - label.cx)}" keyPoints="0;0.75;0" keyTimes="0;0.55;1" ` +
        `calcMode="linear" begin="0.35s" dur="${T.clash - 0.4}s" fill="freeze"/>${mark}</g>`;
    }
    out += `<g class="cv-pane-type">${mark}</g>`;
    if (clash && (label === value || label === slot)) {
      const w = typeLabelWidth(label.type, label.size);
      const h = label.size + 7;
      out += rect(label.cx - w / 2 - 4, top - 4, w + 8, h + 8, 'none', P.error, h / 2 + 4, 2.5);
    }
  }
  if (clash && value && slot) out += text((slot.cx + value.cx) / 2, y - 48, '≠', 26, P.error, 'middle');
  return out;
}

function code(c: SceneContext, oldLine: number | null): string {
  const { m, g, P, step, op } = c;
  const x = g.code.x;
  let out = rect(x, g.code.y, g.code.w, g.code.h, P.panel);
  const boxes = (line: number): [number, number, number, number][] => {
    const source = m.source[line];
    const span = m.spans[line] || [0, source.replace(/;\s*$/, '').length];
    const rows = g.codeRows[line];
    const wrapped = rows.length > 1;
    return rows.flatMap(row => {
      const start = Math.max(span[0], row.start);
      const end = Math.min(span[1], row.end);
      if (start >= end) return [];
      return [[
        x + CODE_GUTTER + (row.indent + start - row.start) * CODE_CHAR - 3,
        row.y - (wrapped ? 24 : 30),
        (end - start) * CODE_CHAR + 6,
        wrapped ? 31 : 40,
      ]];
    });
  };
  const y = g.lineY(step.line);
  const spans = boxes(step.line);
  const stripeColour = op?.kind === 'clash' ? P.error : op?.kind === 'write' ? P.write : P.read;
  const continuationHeight = g.codeRows[step.line].at(-1)!.y - y;
  let stripe = rect(x + 8, y - 32, 4, 44 + continuationHeight, stripeColour, 'none', 0);
  let highlight = spans
    .map(([x, y, w, h]) => rect(x, y, w, h, P.highlight, 'none', 6))
    .join('');
  if (oldLine !== null) {
    const prev = boxes(oldLine);
    stripe = animated(stripe, animateAttr('y', g.lineY(oldLine) - 32, y - 32));
    if (prev.length === 1 && spans.length === 1) {
      const [ox, oy, ow, oh] = prev[0];
      const [nx, ny, nw, nh] = spans[0];
      highlight = animated(highlight,
        animateAttr('x', ox, nx) + animateAttr('y', oy, ny) +
        animateAttr('width', ow, nw) + animateAttr('height', oh, nh));
    }
  }
  out += stripe + highlight;
  m.source.forEach((source, i) => {
    out += text(x + 22, g.lineY(i), i + 1, 18, P.muted);
    const definition = /^\s*struct\b/.test(source);
    for (const row of g.codeRows[i]) {
      out += colored(
        c,
        x + CODE_GUTTER + row.indent * CODE_CHAR,
        row.y,
        source.slice(row.start, row.end),
        CODE_SIZE,
        definition,
        /(?:\.|->)\s*$/.test(source.slice(0, row.start))
      );
    }
  });
  for (const t of g.typeTargets) {
    if (t.underline) {
      out +=
        `<path d="M ${round(t.x + 1)} ${round(t.y + t.h - 1)} h ${round(t.w - 2)}" ` +
        `stroke="${P.muted}" stroke-width="1.6" stroke-dasharray="1.5 3.5" stroke-linecap="round" opacity="0.6"/>`;
    }
  }
  return out;
}

function tether(c: SceneContext, oldLine: number | null): string {
  const { g, P, step } = c;
  const right = g.code.x + g.code.w;
  const mid = g.pane.y + g.pane.h / 2;
  const path = (line: number): string =>
    g.stacked
      ? `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 18)} V ${mid} H ${round(g.pane.x + g.pane.w)}`
      : `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 28)} V ${mid} H ${round(g.pane.x)}`;
  const d = path(step.line);
  return animated(
    `<path d="${d}" fill="none" stroke="${P.tether}" stroke-width="2"/>`,
    oldLine !== null ? animateAttr('d', path(oldLine), d) : ''
  );
}

export function lineTargets(m: PreparedModel, S: PlayerStrings): string {
  return m.source
    .map(
      (source, i) =>
        `<rect class="cv-line" data-line="${i}" tabindex="0" role="button" ` +
        `aria-label="${esc(format(S.jump, { line: i + 1, code: source }))}" rx="6" height="48"/>`
    )
    .join('');
}

export function placeLineTargets(g: Geometry, targets: Element[]): void {
  targets.forEach((target, i) => {
    target.setAttribute('x', String(g.code.x + 12));
    target.setAttribute('y', String(g.lineY(i) - 34));
    target.setAttribute('width', String(round(g.code.w - 24)));
    target.setAttribute('height', String(48 + g.codeRows[i].at(-1)!.y - g.lineY(i)));
  });
}

function linkMarkup(
  c: SceneContext,
  l: PointerLink,
  { grow = null, fadeOut = null }: { grow?: number | null; fadeOut?: number | null } = {}
): string {
  const [x, y] = l.head;
  const color = l.from.color;
  const head = `<path d="M -11 -6.5 L 0 0 L -11 6.5 Z" fill="${color}" transform="translate(${round(x)} ${y}) rotate(90)"/>`;
  const growing = grow !== null ? ` data-grow="${round(grow)}"` : '';
  return dim(
    c,
    l.from.name.split('.')[0],
    `<g>` +
      (fadeOut !== null ? fade(1, 0, 0.3, fadeOut) : '') +
      `<path d="${l.d}" fill="none" stroke="${c.P.bg}" stroke-width="9"${growing}/>` +
      `<path d="${l.d}" fill="none" stroke="${color}" stroke-width="2.5"${growing}/>` +
      (grow !== null ? `<g opacity="0">${fade(0, 1, 0.15, grow + 0.5)}${head}</g>` : head) +
      '</g>'
  );
}

function arrows(c: SceneContext): string {
  const { g, step, prev, op } = c;
  const now = links(g, step);
  const writesPointer =
    op && op.kind === 'write' && g.cellsOf(op.name).some(l => l.kind === 'ptr');
  if (writesPointer && prev) {
    const at = arrival(op);
    const changed = new Set(g.cellsOf(op.name).map(l => l.name));
    let out = '';
    for (const l of links(g, prev)) {
      out += linkMarkup(c, l, changed.has(l.from.name) ? { fadeOut: at } : {});
    }
    for (const l of now) {
      if (changed.has(l.from.name)) out += linkMarkup(c, l, { grow: at + 0.1 });
    }
    return out;
  }
  let out = now.map(l => linkMarkup(c, l)).join('');
  if (op && op.kind === 'deref') {
    const l = now.find(link => link.from.name === op.via);
    if (l) {
      out += `<path d="${l.d}" fill="none" stroke="${l.from.color}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
    }
  }
  return out;
}

function outline(c: SceneContext, box: PlacedBox, color: string): string {
  if (c.g.isStruct(box)) {
    const f = frameOf(box);
    return rect(f.x + 3, f.y + 3, f.w - 6, f.h - 6, 'none', color, 8, 3);
  }
  return rect(box.x + 4.5, box.y + 4.5, box.w - 9, box.h - 9, 'none', color, 0, 3);
}

function tags(c: SceneContext, at: number): string {
  const { g, P, step, op } = c;
  const bound = step.refs || {};
  let out = '';
  for (const t of g.tags) {
    if (!bound[t.name]) continue;
    const h = t.style.size + 10;
    const x = t.cx - t.w / 2;
    const y = t.y - t.style.size + 1;
    const middle = y + h / 2;
    let markup = rect(x, y, t.w, h, P.panel, t.color, h / 2, 2);
    if (op && op.kind === 'alias' && op.name === t.name) {
      markup += `<g opacity="0">${fade(0, 0.45, 0.2)}${fade(0.45, 0, 0.5, at)}${rect(x, y, t.w, h, t.color, 'none', h / 2)}</g>`;
    }
    markup += text(t.cx, t.y, t.name, t.style.size, t.color, 'middle');
    if (op && op.kind === 'bind' && op.name === t.name) {
      markup =
        `<g opacity="0">${show(at)}<g transform="translate(${round(t.cx)} ${round(middle)})"><g>${pulse(at - 0.05)}` +
        `<g transform="translate(${round(-t.cx)} ${round(-middle)})">${markup}</g></g></g></g>`;
    }
    out += dim(c, t.name, markup);
  }
  return out;
}

/** Dashed boxes over the alignment gaps between cells `height` units tall. */
function gaps(c: SceneContext, height: number): string {
  return c.g.gaps
    .map(
      ([x, w, y]) =>
        `<rect x="${round(x + 3)}" y="${y + 3}" width="${round(w - 6)}" ` +
        `height="${height - 6}" fill="none" stroke="${c.P.gapStroke}" stroke-dasharray="5 5"/>`
    )
    .join('');
}

function memory(c: SceneContext): string {
  const { g, P, step, prev, op } = c;
  const values = op && op.kind === 'write' && prev ? prev.values : step.values;
  const at = op ? arrival(op) : 0;
  const writing = new Set(op && op.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
  const live = (l: { name: string }): boolean => values[l.name] !== null || writing.has(l.name);
  let out = '';

  out += gaps(c, CELL);
  const arrays = new Set(g.groups.filter(s => arrayType(s.type ?? '')).map(s => s.name));
  const inArray = (name: string): boolean => [...arrays].some(a => name.startsWith(a + '.'));
  // An element shows its address while something points at it, or at what starts with it.
  const startsAt = (target: string, cell: { name: string; address: number }): boolean =>
    target === cell.name ||
    (cell.name.startsWith(target + '.') && g.box(target)?.address === cell.address);
  const pointed = (shown: TraceStep | null, cell: { name: string; address: number }): boolean =>
    Boolean(shown && Object.values(shown.targets).some(t => startsAt(t, cell)));
  // Once `&` has taken an address, it stays shown until the statement ends.
  const taking = (i: number, cell: { name: string; address: number }): boolean => {
    const steps = c.m.steps;
    for (let j = i; j >= 0 && steps[j].line === steps[Math.max(i, 0)].line; j--) {
      const o = steps[j].op;
      if (o?.kind === 'addr' && startsAt(o.name, cell)) return true;
    }
    return false;
  };
  // A variable's start address always shows, even when an array starts it.
  const startsVariable = (cell: { name: string; address: number }): boolean =>
    g.box(cell.name.split('.')[0])?.address === cell.address;
  const addressOf = (cell: Geometry['leaves'][number], on: boolean): string => {
    const label = text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
    if (startsVariable(cell)) return label;
    const now = pointed(step, cell) || taking(c.index, cell);
    const before = c.animate ? pointed(prev, cell) || taking(c.index - 1, cell) : now;
    if (now && before) return label;
    // `&` shows the address as it starts taking it; a pointer's write, as the value lands.
    const appear = op?.kind === 'addr' ? 0 : at;
    if (now) return `<g opacity="0">${fade(0, 1, 0.3, appear)}${label}</g>`;
    if (before) return `<g>${fade(1, 0, 0.3, at)}${label}</g>`;
    return '';
  };
  for (const s of g.groups) {
    const on = g.cellsOf(s.name).some(live);
    const f = frameOf(s);
    const arrayGroup = arrays.has(s.name) || s.label.startsWith('[');
    const color = on ? (arrayGroup ? s.color : s.fieldColor || s.color) : null;
    out += dim(
      c,
      s.top,
      rect(f.x, f.y, f.w, f.h, 'none', color || P.deadStroke, 6, FRAME.stroke) +
        (s.parent
          ? text(
              s.x + s.w / 2,
              f.y + f.h + 24,
              s.label,
              Math.min(g.fieldSize, 22),
              color || P.grey,
              'middle'
            )
          : text(s.x + s.w / 2, f.y + f.h + 32, s.name, g.nameSize, color || P.grey, 'middle'))
    );
  }
  if (op && op.kind === 'addr') {
    const cell = g.cellsOf(op.name)[0];
    const [lx, ly] = labelCentre(cell);
    out +=
      `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.1)}` +
      rect(lx - labelWidth(cell) / 2 - 5, ly - 13, labelWidth(cell) + 10, 24, P.readFill, P.read, 5, 2) +
      '</g>';
  }
  for (const cell of g.leaves) {
    const on = live(cell);
    const changing = writing.has(cell.name);
    const element = cell.label.startsWith('[') && inArray(cell.name);
    const color = element ? cell.color : cell.fieldColor || cell.color;
    let markup = inArray(cell.name)
      ? addressOf(cell, on)
      : text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
    markup += text(
      cell.x + cell.w / 2,
      cell.y + cell.h + (cell.group ? 28 : 34),
      cell.label,
      cell.group ? g.fieldSize : g.nameSize,
      on ? color : P.grey,
      'middle'
    );
    markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, 'none', 0);
    markup += rect(
      cell.x + 1.5,
      cell.y + 1.5,
      cell.w - 3,
      cell.h - 3,
      'none',
      on ? color : P.deadStroke,
      0,
      3
    );
    if (on) {
      const shown = (value: unknown): string => {
        const display =
          typeof value === 'number' ? displayNumber(value, cell.floating ? cell.size : null) : String(value);
        const length = display.length;
        const size = Math.min(30, (cell.w - Math.min(12, cell.w / 5)) / (length * CHAR));
        return text(0, size / 3 + 1, display, round(size), value === '?' ? P.grey : P.fg, 'middle');
      };
      markup +=
        `<g transform="translate(${round(cell.x + cell.w / 2)} ${cell.y + cell.h / 2})"><g>` +
        (changing ? pulse(at - 0.2) : '');
      const before = prev ? prev.values[cell.name] : null;
      const after = step.values[cell.name];
      if (changing && !Object.is(before, after)) {
        if (before !== null) markup += `<g>${hide(at)}${shown(before)}</g>`;
        markup += `<g opacity="0">${show(at)}${shown(after)}</g>`;
      } else {
        markup += shown(changing ? after : values[cell.name]);
      }
      markup += '</g></g>';
    }
    out += dim(c, cell.name, markup);
  }
  if (op && (op.kind === 'read' || op.kind === 'write')) {
    out += chainHighlight(c, op, at);
  }
  if (op && op.kind === 'deref') {
    out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target)!, P.fg)}</g>`;
  }
  if (op && op.kind === 'alias') {
    out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target)!, P.fg)}</g>`;
  }
  if (op && op.kind === 'bind') {
    out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.5)}${outline(c, g.box(op.target)!, P.fg)}</g>`;
  }
  for (const label of g.typeLabels) {
    const on = g.cellsOf(label.name).some(live);
    const color = on ? typeColour(c, label.type) : P.deadStroke;
    out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, LABEL.memory, color));
  }
  return out + tags(c, at);
}

/** Reading or writing `a.f[0]` outlines `a`, then `a.f`, then `a.f[0]`. */
function chainHighlight(c: SceneContext, op: { kind: 'read' | 'write'; name: string }, at: number): string {
  const { g, P } = c;
  const color = op.kind === 'write' ? P.write : P.read;
  const levels = chainOf(op.name);
  const windows = memoryWalk(op.name, at);
  return levels
    .map((level, k) => {
      const box = g.box(level);
      if (!box) return '';
      const [begin, leave] = windows[k];
      const hidden = begin > 0;
      const appear = hidden ? fade(0, 1, 0.15, begin) : '';
      // A light wash in the highlight colour: stronger on a cell than across a whole frame.
      const r = g.isStruct(box) ? frameOf(box) : box;
      const wash = `<g opacity="${g.isStruct(box) ? 0.1 : 0.22}">${rect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, color, 'none', g.isStruct(box) ? 8 : 0)}</g>`;
      return `<g opacity="${hidden ? 0 : 1}">${appear}${fade(1, 0, 0.25, leave)}${wash}${outline(c, box, color)}</g>`;
    })
    .join('');
}

/** The pane's highlight box grows along the chain, `a` → `a.f` → `a.f[0]`. */
function walkBoxes(
  levels: string[] | null,
  end: number,
  box: (chars: number) => string,
  whole: string
): string {
  if (!levels) return whole;
  const windows = walkWindows(levels.length, end);
  return levels
    .map((level, k) => {
      const [begin, leave] = windows[k];
      return `<g opacity="0">${fade(0, 1, 0.15, begin)}${fade(1, 0, 0.2, leave)}${box(level.length)}</g>`;
    })
    .join('');
}

function valueBox(
  c: SceneContext,
  value: string,
  color: string,
  path: string,
  begin: number,
  travel: number,
  end: number
): string {
  const half = Math.max(28, (String(value).length * c.g.paneChar) / 2 + 12);
  return (
    `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g>` +
    `<g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}` +
    rect(-half, -25, 2 * half, 50, c.P.panel, color, 9) +
    text(0, 11, value, c.g.paneSize, c.P.fg, 'middle') +
    `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`
  );
}

function transfers(c: SceneContext): string {
  const { g, P, op } = c;
  if (!op) return '';
  const at = arrival(op);
  const begin = departure(op);
  const ty = g.ty - 11;
  const below = g.below;
  const spanCentre = (span: Span): number => g.tx + ((span[0] + span[1]) / 2) * c.g.paneChar;
  const p = (...values: number[]): string => values.map(round).join(' ');
  if (op.kind === 'read') {
    const [sx, sy] = valueCentre(g.box(op.name)!);
    const dx = spanCentre(op.span);
    return valueBox(
      c,
      op.value,
      P.read,
      `M ${p(sx, sy)} C ${p(sx, below)}, ${p(dx, below)}, ${p(dx, ty)}`,
      begin,
      T.travel,
      at
    );
  }
  if (op.kind === 'addr') {
    const cell = g.cellsOf(op.name)[0];
    const [sx, sy] = labelCentre(cell);
    const dx = spanCentre(op.span);
    const side = cell.x - 20;
    return valueBox(
      c,
      op.value,
      P.read,
      `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, cell.y + CELL)}, ${p(side, below)} ` +
        `C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`,
      begin,
      T.travel,
      at
    );
  }
  if (op.kind === 'write') {
    const sx = spanCentre(op.span);
    const [ex, ey] = valueCentre(g.box(op.name)!);
    return valueBox(
      c,
      op.value,
      P.write,
      `M ${p(sx, ty)} C ${p(sx, below)}, ${p(ex, below)}, ${p(ex, ey)}`,
      begin,
      T.travel,
      at
    );
  }
  if (op.kind === 'bind') {
    const tag = g.tags.find(t => t.name === op.name)!;
    const sx = spanCentre(op.destination);
    const ey = tag.y - tag.style.size / 2 + 4;
    return valueBox(
      c,
      op.name,
      tag.color,
      `M ${p(sx, ty)} C ${p(sx, ty - 70)}, ${p(tag.cx, ey + 70)}, ${p(tag.cx, ey)}`,
      begin,
      T.travel,
      at
    );
  }
  return '';
}

/** The pane, and over it the types of its parts: the old pane's give way to the new one's. */
function pane(c: SceneContext, copying: boolean): string {
  const { g, step, prev, op, animate } = c;
  const out = paneBody(c, copying);
  if (!c.m.typed) return out;
  const types = (shown: TraceStep): string => paneTypes(c, shown, g.tx, g.ty);
  if (!animate) return out + types(step);
  const appear = (at: number, shown: TraceStep): string =>
    `<g opacity="0">${fade(0, 1, 0.25, at)}${types(shown)}</g>`;
  if (copying) return out + appear(copyBegin(c.m.steps, c.index) + T.copyTravel, step);
  if (op?.kind === 'clash') return out + appear(0.15, step);
  if (!op || !prev || stores(op) || op.kind === 'print') return out + types(step);
  return (
    out +
    `<g>${fade(1, 0, 0.2, Math.max(0, arrival(op) - 0.35))}${types(prev)}</g>` +
    appear(arrival(op) + 0.2, step)
  );
}

function paneBody(c: SceneContext, copying: boolean): string {
  const { g, P, step, prev, op } = c;
  const tx = g.tx;
  const ty = g.ty;
  let out = `<g class="cv-pane">${rect(g.pane.x, g.pane.y, g.pane.w, g.pane.h, P.pane)}</g>`;
  if (copying) {
    const sx = g.code.x + CODE_GUTTER;
    const sy = g.lineY(step.line);
    const begin = copyBegin(c.m.steps, c.index);
    const total = begin + T.copyTravel;
    if (prev && prev.line !== step.line) {
      out += `<g>${fade(1, 0, 0.3, begin + 0.2)}${settledPane(c, prev, tx, ty)}</g>`;
    }
    const scale = CODE_SIZE / c.g.paneSize;
    out +=
      `<g><animateMotion dur="${round(total)}s" path="M ${round(sx)} ${sy} L ${tx} ${ty}" keyPoints="0;0;1" ` +
      `keyTimes="0;${(begin / total).toFixed(4)};1" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1" fill="freeze"/>` +
      `<g transform="scale(${scale})"><animateTransform attributeName="transform" type="scale" from="${scale}" to="1" ` +
      `begin="${begin}s" dur="${T.copyTravel}s" ${EASE} fill="freeze"/>` +
      `<g opacity="0">${fade(0, 1, 0.15, begin - 0.15)}${fade(1, 0, 0.12, total)}` +
      rect(-8, -36, step.pane.length * c.g.paneChar + 16, 48, P.highlight, P.read, 7, 2) +
      '</g>' +
      settledPane(c, step, 0, 0) +
      '</g></g>';
    return out;
  }
  if (
    op &&
    prev &&
    (op.kind === 'read' ||
      op.kind === 'addr' ||
      op.kind === 'deref' ||
      op.kind === 'eval' ||
      op.kind === 'alias' ||
      op.kind === 'convert')
  ) {
    const before = prev.pane;
    const [s, e] = op.span;
    const length = step.pane.length - before.length + (e - s);
    const at = arrival(op);
    const dx = (length - (e - s)) * c.g.paneChar;
    const sx = tx + s * c.g.paneChar;
    const [stroke, fill] =
      op.kind === 'read' || op.kind === 'addr'
        ? [P.read, P.readFill]
        : op.kind === 'convert'
          ? [P.write, P.writeFill]
          : [P.fg, P.derefFill];
    out += exprBackground(c, tx, ty, step.expr, prev.expr, at + 0.1);
    out += walkBoxes(
      op.kind === 'read' ? paneLevels(op.name, before.slice(s, e)) : null,
      at - 0.1,
      chars => markBox(sx, ty, chars * c.g.paneChar, stroke, fill),
      `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at - 0.1)}${markBox(sx, ty, (e - s) * c.g.paneChar, stroke, fill)}</g>`
    );
    out += paneText(c, tx, ty, before, 0, s, prev.expr);
    let old = paneText(c, sx, ty, before, s, e, prev.expr);
    let fresh = paneText(c, sx, ty, step.pane, s, s + length, step.expr);
    const middle = sx + ((e - s) * c.g.paneChar) / 2;
    if (op.kind === 'eval' || op.kind === 'convert') {
      // The operands gather into the middle of their span; the result grows out of it.
      old = scaleAbout(old, middle, ty - 11, 1, 0.45, 0.15, at - 0.15);
      fresh = scaleAbout(fresh, sx + (length * c.g.paneChar) / 2, ty - 11, 0.45, 1, at, 0.25);
    }
    out += `<g>${hide(at)}${old}</g>`;
    out += `<g opacity="0">${show(at)}${settle(fresh, ((e - s - length) / 2) * c.g.paneChar, at + 0.1)}</g>`;
    return (
      out +
      glide(
        paneText(c, tx + e * c.g.paneChar, ty, before, e, before.length, prev.expr),
        dx,
        at + 0.1,
        0.3
      )
    );
  }
  out += exprBackground(c, tx, ty, step.expr);
  if (op && op.kind === 'write') {
    const at = arrival(op);
    const [vs, ve] = op.span;
    const [ns, ne] = op.destination;
    const tight = ne === vs ? 4 : 0;
    out +=
      `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}` +
      rect(
        tx + vs * c.g.paneChar - 3 + tight,
        ty - 32,
        (ve - vs) * c.g.paneChar + 6 - tight,
        42,
        P.writeFill,
        P.write,
        6,
        2
      ) +
      '</g>';
    const destination = (chars: number): string =>
      rect(tx + ns * c.g.paneChar - 3, ty - 32, chars * c.g.paneChar + 6 - tight, 42, 'none', P.write, 6, 2);
    out += walkBoxes(
      paneLevels(op.name, step.pane.slice(ns, ne)),
      at + 0.4,
      destination,
      `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}${destination(ne - ns)}</g>`
    );
    out += paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
    if (inContext(step, op.destination)) {
      out +=
        `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.15)}` +
        colored(c, tx + ns * c.g.paneChar, ty, step.pane.slice(ns, ne)) +
        '</g>';
    }
    return out;
  }
  if (op && op.kind === 'bind') {
    const at = arrival(op);
    const [vs, ve] = op.span;
    const [ns, ne] = op.destination;
    out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}${markBox(tx + ns * c.g.paneChar, ty, (ne - ns) * c.g.paneChar, P.fg, P.derefFill)}</g>`;
    out +=
      `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}` +
      rect(tx + vs * c.g.paneChar - 3, ty - 32, (ve - vs) * c.g.paneChar + 6, 42, 'none', P.fg, 6, 2) +
      '</g>';
  }
  return out + paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
}

function output(c: SceneContext): string {
  const { g, P, S, step, prev, op } = c;
  if (!step.stdout) return '';
  const [ox, oy] = g.out;
  const label = S.output;
  const vx = ox + (label.length + 1) * 26 * CHAR;
  const printing = op && op.kind === 'print';
  const shown = printing && prev ? prev.stdout : step.stdout;
  let out =
    (printing && (!prev || !prev.stdout) ? `<g opacity="0">${fade(0, 1, 0.25)}` : '<g>') +
    text(ox, oy, label, 26, P.muted) +
    '</g>';
  shown.split('\n').forEach((line, i) => {
    out += text(vx, oy + i * 36, line, c.g.paneSize, P.fg);
  });
  if (printing && op.kind === 'print') {
    const lines = shown.split('\n');
    const x = vx + lines[lines.length - 1].length * c.g.paneChar;
    const y = oy + (lines.length - 1) * 36;
    const sx = g.tx + ((op.span[0] + op.span[1]) / 2) * c.g.paneChar;
    const w = op.value.length * c.g.paneChar;
    const p = (...values: number[]): string => values.map(round).join(' ');
    out += valueBox(
      c,
      op.value.trim() ? op.value : glyphs(op.value),
      P.muted,
      `M ${p(sx, g.ty - 11)} C ${p(sx, y - 30)}, ${p(x + w / 2, g.ty + 20)}, ${p(x + w / 2, y - 11)}`,
      0.2,
      0.7,
      0.9
    );
    out += `<g opacity="0">${show(0.9)}${text(x, y, op.value, c.g.paneSize, P.fg)}</g>`;
  }
  return out;
}

export { arrows, code, dim, gaps, output, pane, tether, transfers, typeColour, typeLabel };

export function scene(c: SceneContext): string {
  const { step, prev, animate } = c;
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const copying = animate && copies(c.m.steps, c.index);
  const oldLine = lineChanged && prev ? prev.line : null;
  return (
    code(c, oldLine) +
    tether(c, oldLine) +
    arrows(c) +
    memory(c) +
    pane(c, copying) +
    output(c) +
    transfers(c)
  );
}

export function describe(c: SceneContext): string {
  const { m, S, step } = c;
  const op = step.op;
  if (!op) return format(S.copy, { line: step.line + 1, code: m.source[step.line] });
  if (op.kind === 'print' && S.blank[op.value]) return S.blank[op.value];
  if (op.kind === 'clash') {
    return format(S.clash, {
      ...op,
      value: step.pane.slice(...op.span),
      slot: step.pane.slice(...op.destination),
    });
  }
  const template = op.kind === 'read' && op.compound ? S.compound : S[op.kind];
  return format(template, op as unknown as Record<string, unknown>);
}
