// Geometry and layout calculation for memory cells, struct frames, pointer arcs, and reference tags.
import type { TraceStep } from '../core/trace_format.ts';
import {
  CELL,
  CHAR,
  CODE_CHAR,
  CODE_SIZE,
  EVAL_CHAR,
  FIELD_COLOURS,
  FRAME,
  GAP,
  LINE,
  MARGIN,
  MAX_BYTE,
  MEMORY_WIDTH,
  NEST,
  type Palette,
  RISE,
  TAG,
  type TagStyle,
  VARIABLE_COLOURS,
} from './constants.ts';
import type { ModelGroup, ModelItem, ModelLeaf, PreparedModel } from './model.ts';
import { round } from './svg.ts';

export interface PlacedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedLeaf extends Omit<ModelLeaf, 'color' | 'fieldColor'>, PlacedRect {
  color: string;
  fieldColor: string | null;
}

export interface PlacedGroup extends Omit<ModelGroup, 'color' | 'fieldColor'>, PlacedRect {
  color: string;
  fieldColor: string | null;
  drop?: number;
}

export type PlacedBox = PlacedLeaf | PlacedGroup;

export interface PointerLink {
  from: PlacedBox;
  to: PlacedBox;
  sx: number;
  ex: number;
  level: number;
  d: string;
  head: [number, number];
}

export interface PlacedTag {
  name: string;
  color: string;
  target: string;
  style: TagStyle;
  w: number;
  cx: number;
  level: string;
  row: number;
  y: number;
}

export interface TypeTarget extends PlacedRect {
  type: string;
  underline?: boolean;
}

export interface Geometry {
  stacked: boolean;
  isStruct(c: { fields?: unknown }): c is PlacedGroup;
  rise: number;
  width: number;
  height: number;
  code: PlacedRect;
  memX: number;
  memY: number;
  pane: PlacedRect;
  tx: number;
  ty: number;
  below: number;
  out: [number, number];
  lineY(i: number): number;
  gaps: Array<[number, number]>;
  leaves: PlacedLeaf[];
  groups: PlacedGroup[];
  box(name: string): PlacedBox | undefined;
  cellsOf(name: string): PlacedLeaf[];
  tags: PlacedTag[];
  owner(token: string): PlacedGroup | PlacedLeaf | PlacedTag | undefined;
  field(token: string): PlacedLeaf | PlacedGroup | undefined;
  typeTargets: TypeTarget[];
  nameSize: number;
  fieldSize: number;
}

export const frameOf = (
  s: PlacedRect & { rise: number; drop?: number }
): PlacedRect => ({
  x: s.x - FRAME.side,
  y: s.y - FRAME.top - s.rise * RISE.top,
  w: s.w + 2 * FRAME.side,
  h:
    s.h +
    FRAME.top +
    FRAME.bottom +
    s.rise * (RISE.top + RISE.bottom) +
    (s.drop || 0),
});

export const labelWidth = (c: { address: number }): number =>
  String(c.address).length * 16 * CHAR;

export const labelCentre = (c: PlacedRect & { address: number }): [number, number] => [
  c.x + 3 + labelWidth(c) / 2,
  c.y - 18,
];

export const valueCentre = (c: PlacedRect): [number, number] => [
  c.x + c.w / 2,
  c.y + 32,
];

interface LinkProbe {
  memY: number;
  rise: number;
  leaves: PlacedLeaf[];
  isStruct(c: { fields?: unknown }): c is PlacedGroup;
  box(name: string): PlacedBox | undefined;
}

export function links(g: LinkProbe, step: TraceStep): PointerLink[] {
  const list: PointerLink[] = g.leaves
    .filter(l => l.kind === 'ptr' && step.targets[l.name] && g.box(step.targets[l.name]))
    .map(l => ({
      from: l,
      to: g.box(step.targets[l.name])!,
      sx: 0,
      ex: 0,
      level: 0,
      d: '',
      head: [0, 0] as [number, number],
    }));
  const centre = (c: PlacedRect): number => c.x + c.w / 2;
  const ports = new Map<
    string,
    { cell: PlacedBox; ends: Array<{ l: PointerLink; key: 'sx' | 'ex'; other: number }> }
  >();
  for (const l of list) {
    for (const [cell, other, key] of [
      [l.from, l.to, 'sx'],
      [l.to, l.from, 'ex'],
    ] as const) {
      if (!ports.has(cell.name)) ports.set(cell.name, { cell, ends: [] });
      ports.get(cell.name)!.ends.push({ l, key, other: centre(other) });
    }
  }
  // Ends leading left sit left of ends leading right; on each side the farther-reaching arc
  // sits nearer the centre and rises higher, so chains and shared pointees never cross.
  for (const { cell, ends } of ports.values()) {
    const side = (end: { other: number }): number => (end.other < centre(cell) ? 0 : 1);
    ends.sort((p, q) => side(p) - side(q) || q.other - p.other);
    const spread = 20 * (ends.length - 1);
    // Arc ends keep clear of the cell's address label.
    const low = g.isStruct(cell) ? cell.x + 12 : cell.x + 3 + labelWidth(cell) + 14;
    const high = cell.x + cell.w - 12;
    const first = Math.min(Math.max(centre(cell) - spread / 2, low), Math.max(low, high - spread));
    ends.forEach((end, i) => {
      end.l[end.key] = first + i * 20;
    });
  }
  const range = (l: PointerLink): [number, number] => [
    Math.min(l.sx, l.ex),
    Math.max(l.sx, l.ex),
  ];
  for (const l of list) {
    const [a, b] = range(l);
    l.level = list.filter(o => o !== l && range(o)[0] >= a && range(o)[1] <= b).length;
    // An arc to a struct ends on its frame; an arc to a field passes through onto the field.
    const sy = l.from.y - 2;
    const ey = g.isStruct(l.to) ? frameOf(l.to).y - 1 : l.to.y - 3;
    const apex = g.memY - FRAME.top - g.rise * RISE.top - 84 - l.level * 40;
    l.d = `M ${round(l.sx)} ${sy} C ${round(l.sx)} ${apex}, ${round(l.ex)} ${apex}, ${round(l.ex)} ${ey - 9}`;
    l.head = [l.ex, ey];
  }
  return list;
}

interface RawTag {
  name: string;
  color: number;
  target: string;
  style: TagStyle;
  w: number;
  cx: number;
  level: string;
  row: number;
}

function tagRows(
  m: PreparedModel,
  box: (name: string) => PlacedBox | undefined
): { tags: RawTag[]; drop: Map<string, number>; height: number } {
  const bound = m.steps[m.steps.length - 1].refs || {};
  const tags: RawTag[] = [];
  const rows = new Map<string, number>();
  const drop = new Map<string, number>();
  for (const r of m.references) {
    const target = bound[r.name];
    if (!target) continue;
    const item = box(target)!;
    const style = target.includes('.') ? TAG.field : TAG.top;
    const w = Math.max(r.name.length * style.size * CHAR + 20, style.size + 18);
    const cx = item.x + item.w / 2;
    const level = target.includes('.') ? target.slice(0, target.lastIndexOf('.')) : '';
    let row = 0;
    while (
      tags.some(
        t => t.level === level && t.row === row && Math.abs(t.cx - cx) < (t.w + w) / 2 + 6
      )
    ) {
      row++;
    }
    tags.push({ ...r, target, style, w, cx, level, row });
    rows.set(target, Math.max(rows.get(target) || 0, row + 1));
  }
  const below = (name: string): number =>
    (rows.get(name) || 0) * (name.includes('.') ? TAG.field : TAG.top).step;
  const sink = (item: ModelItem): number => {
    const children = item.children || [];
    const inner = Math.max(0, ...children.map(child => below(child.name) + sink(child)));
    drop.set(item.name, inner);
    return inner;
  };
  const height = Math.max(0, ...m.tops.map(item => sink(item) + below(item.name)));
  return { tags, drop, height };
}

function placement(
  m: PreparedModel,
  byte: number
): { spans: Map<string, [number, number]>; gaps: Array<[number, number]>; width: number } {
  const spans = new Map<string, [number, number]>();
  const gaps: Array<[number, number]> = [];
  const unused = (x: number, bytes: number): number => {
    if (bytes > 0) gaps.push([x, bytes * byte]);
    return Math.max(0, bytes) * byte;
  };
  const put = (item: ModelItem, x: number): number => {
    let w = item.size * byte;
    if (item.children) {
      let address = item.address;
      w = 0;
      for (const child of item.children) {
        w += unused(x + w, child.address - address);
        const pad = child.children ? NEST : 0;
        w += pad + put(child, x + w + pad) + pad;
        address = child.address + child.size;
      }
      w += unused(x + w, item.address + item.size - address);
    }
    spans.set(item.name, [x, w]);
    return w;
  };
  let width = 0;
  let address: number | null = null;
  for (const item of m.tops) {
    if (address !== null) width += unused(width, item.address - address) + GAP;
    width += put(item, width);
    address = item.address + item.size;
  }
  return { spans, gaps, width };
}

function typeTargets(
  m: PreparedModel,
  g: { code: PlacedRect; lineY(i: number): number; groups: PlacedGroup[] }
): TypeTarget[] {
  const names = Object.keys(m.types);
  if (!names.length) return [];
  const word = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  const targets: TypeTarget[] = [];
  m.source.forEach((source, i) => {
    for (const match of source.matchAll(word)) {
      const idx = match.index ?? 0;
      targets.push({
        type: match[1],
        underline: true,
        x: g.code.x + 62 + idx * CODE_CHAR,
        y: g.lineY(i) - CODE_SIZE * 0.85,
        w: match[1].length * CODE_CHAR,
        h: CODE_SIZE * 1.2,
      });
    }
  });
  for (const s of [...g.groups].reverse()) {
    if (m.types[s.type]) targets.push({ type: s.type, ...frameOf(s) });
  }
  return targets;
}

function labelSize<T extends PlacedRect>(
  boxes: T[],
  label: (b: T) => string,
  size: number
): number {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  let current = size;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const room = b.x + b.w / 2 - (a.x + a.w / 2) - 8;
    const half = ((label(a).length + label(b).length) * CHAR) / 2;
    if (half * current > room) current = room / half;
  }
  return current;
}

export function geometry(m: PreparedModel, P: Palette, stacked: boolean): Geometry {
  const isStruct = (c: { fields?: unknown }): c is PlacedGroup => Boolean(c.fields);
  const longest = Math.max(...m.source.map(line => line.length));
  let codeW = Math.max(300, 62 + longest * CODE_CHAR + 30);
  const codeH = 44 + m.source.length * LINE;

  const first = m.tops[0];
  const last = m.tops[m.tops.length - 1];
  const fixed = GAP * (m.tops.length - 1) + 2 * NEST * m.groups.filter(s => s.parent).length;
  const placed = placement(
    m,
    Math.min(MAX_BYTE, (MEMORY_WIDTH - fixed) / (last.address + last.size - first.address))
  );
  const memoryW = placed.width;
  const rise = m.rise;
  const paneChars = Math.max(...m.steps.map(step => step.pane.length));
  const finalStdout = m.steps[m.steps.length - 1].stdout;
  const outputLines = finalStdout ? finalStdout.replace(/\n$/, '').split('\n') : [];
  const outputChars = Math.max(0, ...outputLines.map(line => line.length));
  let columnW = Math.max(
    360,
    memoryW + 48,
    paneChars * EVAL_CHAR + 48,
    (P.outputLabel.length + 1) * 26 * CHAR + outputChars * EVAL_CHAR + 48
  );
  if (stacked) codeW = columnW = Math.max(codeW, columnW);

  const atLeaf = (memX: number, memY: number, c: ModelLeaf): PlacedLeaf => {
    const span = placed.spans.get(c.name)!;
    return {
      ...c,
      x: memX + span[0],
      y: memY,
      w: span[1],
      h: CELL,
      color: '',
      fieldColor: null,
    };
  };
  const atGroup = (memX: number, memY: number, c: ModelGroup): PlacedGroup => {
    const span = placed.spans.get(c.name)!;
    return {
      ...c,
      x: memX + span[0],
      y: memY,
      w: span[1],
      h: CELL,
      color: '',
      fieldColor: null,
    };
  };

  const probeLeaves = m.leaves.map(l => atLeaf(0, 0, l));
  const probeGroups = m.groups.map(s => atGroup(0, 0, s));
  const probe: LinkProbe = {
    memY: 0,
    rise,
    leaves: probeLeaves,
    isStruct,
    box: name => probeGroups.find(s => s.name === name) || probeLeaves.find(l => l.name === name),
  };
  let level = -1;
  for (const step of m.steps) {
    for (const l of links(probe, step)) {
      level = Math.max(level, l.level);
    }
  }
  const structs = m.groups.length > 0;
  const room =
    (level >= 0 ? FRAME.top + 84 + level * 40 + 10 : (structs ? FRAME.top : 0) + 30) +
    rise * RISE.top;
  const tagged = tagRows(m, probe.box);
  const names =
    (structs ? CELL + FRAME.bottom + 32 : CELL + 34) + rise * RISE.bottom + tagged.height;
  const paneTop = room + names + 56;
  const paneH = 76;
  const outputTop = paneTop + paneH + 60;
  const columnH = outputLines.length
    ? outputTop + (outputLines.length - 1) * 36 + 14
    : paneTop + paneH;

  const codeX = MARGIN;
  let codeY: number;
  let columnX: number;
  let columnY: number;
  let width: number;
  let height: number;
  if (stacked) {
    codeY = MARGIN;
    columnX = MARGIN;
    columnY = codeY + codeH + 24;
    width = MARGIN + columnW + 30 + MARGIN;
    height = columnY + columnH + MARGIN;
  } else {
    const content = Math.max(codeH, columnH);
    codeY = MARGIN + (content - codeH) / 2;
    columnX = codeX + codeW + 56;
    columnY = MARGIN + (content - columnH) / 2;
    width = columnX + columnW + MARGIN;
    height = MARGIN + content + MARGIN;
  }

  const memX = columnX + 24;
  const memY = columnY + room;
  const pane: PlacedRect = { x: columnX, y: columnY + paneTop, w: columnW, h: paneH };
  const tx = columnX + 24;
  const ty = pane.y + 38 + 11;
  const below = pane.y - 56;
  const out: [number, number] = [columnX + 24, columnY + outputTop];
  const code: PlacedRect = { x: codeX, y: codeY, w: codeW, h: codeH };
  const lineY = (i: number): number => code.y + 50 + i * LINE;
  const gaps: Array<[number, number]> = placed.gaps.map(([x, w]) => [memX + x, w]);
  const colour = (list: string[], i: number, count: number): string => list[i % count];

  const leaves: PlacedLeaf[] = m.leaves.map(l => ({
    ...atLeaf(memX, memY, l),
    color: colour(P.vars, l.color, VARIABLE_COLOURS),
    fieldColor: l.group ? colour(P.fields, l.fieldColor ?? 0, FIELD_COLOURS) : null,
  }));
  const groups: PlacedGroup[] = m.groups.map(s => ({
    ...atGroup(memX, memY, s),
    color: colour(P.vars, s.color, VARIABLE_COLOURS),
    fieldColor: s.parent ? colour(P.fields, s.fieldColor ?? 0, FIELD_COLOURS) : null,
    drop: tagged.drop.get(s.name),
  }));
  const box = (name: string): PlacedBox | undefined =>
    groups.find(s => s.name === name) || leaves.find(l => l.name === name);
  const cellsOf = (name: string): PlacedLeaf[] =>
    leaves.filter(l => l.name === name || l.name.startsWith(name + '.'));

  const tags: PlacedTag[] = tagged.tags.map(t => {
    const item = box(t.target)!;
    let nameY: number;
    if (isStruct(item)) {
      const f = frameOf(item);
      nameY = f.y + f.h + (item.parent ? 24 : 32);
    } else {
      nameY = item.y + item.h + (item.group ? 28 : 34);
    }
    return {
      ...t,
      cx: t.cx + memX,
      y: nameY + (t.row + 1) * t.style.step,
      color: colour(P.vars, t.color, VARIABLE_COLOURS),
    };
  });

  const owner = (token: string): PlacedGroup | PlacedLeaf | PlacedTag | undefined =>
    groups.find(s => s.name === token) ||
    leaves.find(l => !l.group && l.name === token) ||
    tags.find(t => t.name === token);
  const field = (token: string): PlacedLeaf | PlacedGroup | undefined =>
    leaves.find(l => l.group && l.label === token) ||
    groups.find(s => s.parent && s.label === token);

  const g: Geometry = {
    stacked,
    isStruct,
    rise,
    width,
    height,
    code,
    memX,
    memY,
    pane,
    tx,
    ty,
    below,
    out,
    lineY,
    gaps,
    leaves,
    groups,
    box,
    cellsOf,
    tags,
    owner,
    field,
    typeTargets: [],
    nameSize: labelSize(
      [...groups.filter(s => !s.parent), ...leaves.filter(l => !l.group)],
      c => c.name,
      26
    ),
    fieldSize: labelSize(
      leaves.filter(l => l.group),
      c => c.label,
      20
    ),
  };
  g.typeTargets = typeTargets(m, g);
  return g;
}
