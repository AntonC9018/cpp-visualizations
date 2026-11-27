// Geometry and layout calculation for memory cells, struct frames, pointer arcs, and reference tags.
import type { TraceStep } from '../core/trace_format.ts';
import { type CodeRow, codeLayout, columnsForCode, placeCodeRows } from './code_layout.ts';
import {
  CELL,
  CHAR,
  CODE_CHAR,
  CODE_GUTTER,
  CODE_SIZE,
  PANE_MAX,
  PANE_MIN,
  FIELD_COLOURS,
  FRAME,
  GAP,
  LABEL,
  MARGIN,
  MAX_BYTE,
  MEMORY_WIDTH,
  NARROW_BYTE,
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

/** A type label under the name of a top-level variable: its centre and top. */
export interface TypeLabel {
  name: string;
  type: string;
  cx: number;
  top: number;
}

export interface TypeTarget extends PlacedRect {
  type: string;
  underline?: boolean;
}

export interface FlushRow {
  startAddress: number;
  endAddress: number;
  y: number;
}

/** What a view changes about the default geometry (see `views.ts`). */
export interface GeometryOptions {
  /** Units per byte at least, so a byte has room for its hex. */
  minByteWidth?: number;
  /** Width of the code's neighbouring column at least. */
  minColumnWidth?: number;
  cellHeight?: number;
  /** Maximum cell height when flush bytes expand onto wide cells. */
  maxCellHeight?: number;
  /** Room under the pane's text, for the view's own drawing. */
  extraPaneHeight?: number;
  /** Extra room under memory's names and type labels before the pane (e.g. UB bracket). */
  extraMemBottom?: number;
  /** Lay top-level variables flush on a single byte-accurate row without artificial `GAP`. */
  flush?: boolean;
  /** Reserve trailing alignment padding width up to this exclusive address (requires `flush`). */
  minEndAddress?: number;
  /** Keep memory on one row. */
  skipWrap?: boolean;
}

export interface Geometry {
  stacked: boolean;
  paneSize: number;
  paneChar: number;
  /** Units per byte on the memory row. */
  byteWidth: number;
  /** Whether top-level variables sit flush on a single contiguous byte row (or wrapped flush rows). */
  flush: boolean;
  /** Byte-address rows when `flush` is true (one entry per wrapped memory row). */
  flushRows: FlushRow[];
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
  codeRows: CodeRow[][];
  gaps: Array<[number, number, number]>;
  leaves: PlacedLeaf[];
  groups: PlacedGroup[];
  box(name: string): PlacedBox | undefined;
  cellsOf(name: string): PlacedLeaf[];
  tags: PlacedTag[];
  owner(token: string): PlacedGroup | PlacedLeaf | PlacedTag | undefined;
  field(token: string): PlacedLeaf | PlacedGroup | undefined;
  typeTargets: TypeTarget[];
  typeLabels: TypeLabel[];
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

export const typeLabelWidth = (type: string, size: number): number => type.length * size * CHAR + 14;

/** A type label over a typed pane, its centre relative to the start of the pane's text. */
export interface PaneLabel {
  type: string;
  cx: number;
  size: number;
  slot: boolean;
  /** The first character of the part it types. */
  start: number;
  /** 0 just above the text, each next row one LABEL.row higher. */
  row: number;
}

/** How far left of the pane's text a label may reach and still sit inside the pane. */
export const PANE_LABEL_LEFT = -16;
const PANE_LABEL_MIN = 14;
const PANE_LABEL_GAP = 6;

const paneLabelWidth = (label: PaneLabel): number => typeLabelWidth(label.type, label.size);

/**
 * One label per typed part of a pane. Neighbours of one type that would collide share a label;
 * neighbours of different types shrink a little if that is enough. A label that would still
 * collide, or that the pane's left edge pushes into its neighbour, keeps its size and takes the
 * first row above where it fits.
 */
export function paneLabels(step: TraceStep, paneChar: number): PaneLabel[] {
  const labels: PaneLabel[] = [];
  const centres: number[] = [];
  for (const part of step.types ?? []) {
    const cx = ((part.span[0] + part.span[1]) / 2) * paneChar;
    const last = labels[labels.length - 1];
    const label: PaneLabel = {
      type: part.type,
      cx,
      size: LABEL.pane,
      slot: Boolean(part.slot),
      start: part.span[0],
      row: 0,
    };
    const gap = (): number =>
      label.cx - last.cx - PANE_LABEL_GAP - (paneLabelWidth(last) + paneLabelWidth(label)) / 2;
    if (last && gap() < 0 && last.type === label.type && !last.slot) {
      last.cx = (centres[centres.length - 1] + cx) / 2;
      continue;
    }
    if (last && gap() < 0) {
      const before = last.size;
      while (gap() < 0 && label.size > PANE_LABEL_MIN) {
        last.size = label.size = Math.min(last.size, label.size) - 1;
      }
      // Too long to sit side by side even small: full size, in a row above.
      if (gap() < 0) [last.size, label.size] = [before, LABEL.pane];
    }
    labels.push(label);
    centres.push(cx);
  }
  const edges: number[] = [];
  for (const label of labels) {
    const half = paneLabelWidth(label) / 2;
    label.cx = Math.max(label.cx, PANE_LABEL_LEFT + half);
    let row = 0;
    while (edges[row] !== undefined && label.cx - half < edges[row] + PANE_LABEL_GAP) row++;
    edges[row] = label.cx + half;
    label.row = row;
  }
  return labels;
}

/** The rows and the right edge the labels of every step need, relative to the pane's text. */
function paneLabelExtent(m: PreparedModel, paneChar: number): { rows: number; right: number } {
  let rows = 0;
  let right = 0;
  for (const step of m.typed ? m.steps : []) {
    for (const label of paneLabels(step, paneChar)) {
      rows = Math.max(rows, label.row + 1);
      right = Math.max(right, label.cx + paneLabelWidth(label) / 2);
    }
  }
  return { rows, right };
}

/**
 * The types under the names of top-level storage. A label takes the first row where it clears
 * the label before it, so a narrow cell's type drops below its neighbour's.
 */
function typeRows(
  m: PreparedModel,
  box: (name: string) => PlacedBox | undefined,
  rowOf?: Map<string, number>
): { labels: Array<Omit<TypeLabel, 'top'> & { row: number }>; height: number } {
  const labels: Array<Omit<TypeLabel, 'top'> & { row: number }> = [];
  const edgesByRow = new Map<number, number[]>();
  let maxRows = 0;
  for (const item of m.typed || m.trace.punning ? m.tops : []) {
    if (!item.type) continue;
    const at = box(item.name)!;
    const cx = at.x + at.w / 2;
    const half = typeLabelWidth(item.type, LABEL.memory) / 2;
    const memRow = rowOf?.get(item.name) ?? 0;
    let edge = edgesByRow.get(memRow);
    if (!edge) {
      edge = [];
      edgesByRow.set(memRow, edge);
    }
    let row = 0;
    while (edge[row] !== undefined && cx - half < edge[row] + 6) row++;
    edge[row] = cx + half;
    maxRows = Math.max(maxRows, edge.length);
    labels.push({ name: item.name, type: item.type, cx, row });
  }
  return { labels, height: maxRows ? maxRows * LABEL.row + 6 : 0 };
}

export const labelWidth = (c: { address: number }): number =>
  String(c.address).length * 16 * CHAR;

export const labelCentre = (c: PlacedRect & { address: number }): [number, number] => [
  c.x + 3 + labelWidth(c) / 2,
  c.y - 18,
];

export const valueCentre = (c: PlacedRect): [number, number] => [
  c.x + c.w / 2,
  c.y + c.h / 2,
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
    const margin = Math.min(12, cell.w / 2);
    const left = cell.x + margin;
    const high = cell.x + cell.w - margin;
    const clearance = cell.x + 3 + labelWidth(cell) + 14;
    const intervals = ends.length - 1;
    // Fit every port on the cell, leaving room for its address when possible.
    const low = !g.isStruct(cell) && clearance + 20 * intervals <= high
      ? Math.max(left, clearance)
      : left;
    const spacing = intervals ? Math.min(20, (high - low) / intervals) : 0;
    const spread = spacing * intervals;
    const first = Math.min(Math.max(centre(cell) - spread / 2, low), high - spread);
    ends.forEach((end, i) => {
      end.l[end.key] = first + i * spacing;
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

const WRAP_HEIGHT_FACTOR = 1.5;

function placement(
  m: PreparedModel,
  byte: number,
  rowOf?: Map<string, number>,
  flush = false,
  minEndAddress?: number
): { spans: Map<string, [number, number]>; gaps: Array<[number, number, number]>; width: number } {
  const spans = new Map<string, [number, number]>();
  const gaps: Array<[number, number, number]> = [];
  const gap = flush ? 0 : GAP;
  let row = 0;
  const unused = (x: number, bytes: number): number => {
    if (bytes > 0) gaps.push([x, bytes * byte, row]);
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
  let x = 0;
  let address: number | null = null;
  for (const item of m.tops) {
    const r = rowOf?.get(item.name) ?? 0;
    if (r !== row) {
      if (flush && address !== null && item.address > address) {
        x += unused(x, item.address - address);
        width = Math.max(width, x);
      }
      row = r;
      x = 0;
      address = null;
    }
    if (address !== null) x += unused(x, item.address - address) + gap;
    x += put(item, x);
    address = item.address + item.size;
    width = Math.max(width, x);
  }
  if (flush && minEndAddress !== undefined && address !== null && minEndAddress > address) {
    x += unused(x, minEndAddress - address);
    width = Math.max(width, x);
  }
  return { spans, gaps, width };
}

function typeTargets(
  m: PreparedModel,
  g: { code: PlacedRect; codeRows: CodeRow[][]; groups: PlacedGroup[] }
): TypeTarget[] {
  const names = Object.keys(m.types);
  if (!names.length) return [];
  const word = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  const targets: TypeTarget[] = [];
  m.source.forEach((source, i) => {
    for (const match of source.matchAll(word)) {
      const idx = match.index ?? 0;
      const row = g.codeRows[i].find(row => row.start <= idx && idx < row.end);
      if (!row) continue;
      targets.push({
        type: match[1],
        underline: true,
        x: g.code.x + CODE_GUTTER + (row.indent + idx - row.start) * CODE_CHAR,
        y: row.y - CODE_SIZE * 0.85,
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
  // Only neighbours on one row of memory can collide.
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  let current = size;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.y !== b.y) continue;
    const room = b.x + b.w / 2 - (a.x + a.w / 2) - 8;
    const half = ((label(a).length + label(b).length) * CHAR) / 2;
    if (half * current > room) current = room / half;
  }
  return current;
}

const COLUMN_GAP = 56;
const STACK_TETHER_WIDTH = 30;
const FLUSH_BASE_BYTE = 84;
const FLUSH_MAX_BYTE = 170;

export function geometry(
  m: PreparedModel,
  P: Palette,
  stacked: boolean,
  viewport: number,
  options: GeometryOptions = {}
): Geometry {
  const baseCellH = options.cellHeight ?? CELL;
  const extraPaneHeight = options.extraPaneHeight ?? 0;
  const extraMemBottom = options.extraMemBottom ?? 0;
  const flush = Boolean(options.flush);
  const minEndAddress = flush ? options.minEndAddress : undefined;
  if (flush && m.groups.length > 0) {
    throw new Error('flush byte layout does not support struct or array groups');
  }
  const gap = flush ? 0 : GAP;
  const minByteWidth = options.minByteWidth ?? 0;
  const isStruct = (c: { fields?: unknown }): c is PlacedGroup => Boolean(c.fields);
  const unwrapped = codeLayout(m.source);
  // Preserve the natural line when it fits near the target size in CSS pixels.
  const targetCodeSize = stacked ? 15 : 13;
  const canvasBudget = viewport > 0 ? viewport * CODE_SIZE / targetCodeSize : Infinity;
  const codeByColumns = new Map<number, ReturnType<typeof codeLayout>>();
  const fitCode = (budget: number) => {
    if (unwrapped.width <= budget + CODE_CHAR) return unwrapped;
    const columns = columnsForCode(budget);
    let layout = codeByColumns.get(columns);
    if (!layout) {
      layout = codeLayout(m.source, columns);
      codeByColumns.set(columns, layout);
    }
    return layout;
  };
  const stackedCodeBudget = canvasBudget - 2 * MARGIN - STACK_TETHER_WIDTH;
  const initialCode = stacked ? fitCode(stackedCodeBudget) : unwrapped;
  const besideCode =
    stacked || !Number.isFinite(canvasBudget) ? 0 : canvasBudget - unwrapped.width - COLUMN_GAP - 2 * MARGIN;

  const widest = flush
    ? Math.max(minByteWidth, stacked ? FLUSH_MAX_BYTE : FLUSH_BASE_BYTE)
    : Math.max(minByteWidth, m.leaves.some(leaf => leaf.size < 4) ? NARROW_BYTE : MAX_BYTE);
  const rise = m.rise;
  const structs = m.groups.length > 0;
  const paneChars = Math.max(...m.steps.map(step => step.pane.length));
  const finalStdout = m.steps[m.steps.length - 1].stdout;
  const outputLines = finalStdout ? finalStdout.replace(/\n$/, '').split('\n') : [];
  const outputChars = Math.max(0, ...outputLines.map(line => line.length));

  // Memory may wrap onto more rows, between top-level variables, to use the height
  // the code beside it leaves empty. Only where nothing would cross rows: no pointers or
  // references, and no type labels.
  const canWrap =
    !stacked &&
    !options.skipWrap &&
    !flush &&
    m.tops.length > 1 &&
    !m.typed &&
    m.references.length === 0 &&
    m.steps.every(step => Object.keys(step.targets).length === 0);
  const pitch =
    (structs ? baseCellH + FRAME.bottom + 32 : baseCellH + 34) +
    rise * RISE.bottom +
    (structs ? FRAME.top : 0) +
    30 +
    rise * RISE.top;
  const flushRowBounds = (rows: number[][]): Array<{ start: number; end: number }> =>
    rows.map((row, r) => {
      const items = row.map(i => m.tops[i]);
      const start = items[0].address;
      const lastEnd = items[items.length - 1].address + items[items.length - 1].size;
      const nextStart = r + 1 < rows.length ? m.tops[rows[r + 1][0]].address : undefined;
      const end =
        nextStart !== undefined
          ? Math.max(lastEnd, nextStart)
          : minEndAddress !== undefined
            ? Math.max(lastEnd, minEndAddress)
            : lastEnd;
      return { start, end };
    });
  const plan = (rows: number[][]) => {
    const rowOf = new Map<string, number>();
    rows.forEach((row, r) => row.forEach(i => rowOf.set(m.tops[i].name, r)));
    const bounds = flush ? flushRowBounds(rows) : null;
    const byteFor = (budget: number): number =>
      Math.max(
        minByteWidth,
        Math.min(
          widest,
          ...rows.map((row, r) => {
            const items = row.map(i => m.tops[i]);
            const bytes = bounds
              ? bounds[r].end - bounds[r].start
              : (() => {
                  const lastEnd = items[items.length - 1].address + items[items.length - 1].size;
                  const spanEnd = minEndAddress !== undefined ? Math.max(lastEnd, minEndAddress) : lastEnd;
                  return spanEnd - items[0].address;
                })();
            const nested = m.groups.filter(s => s.parent && rowOf.get(s.top) === rowOf.get(items[0].name));
            return Math.max(1, (budget - gap * (items.length - 1) - 2 * NEST * nested.length) / bytes);
          })
        )
      );
    // The pane's text shrinks (down to PANE_MIN) rather than widen the drawing past what
    // memory and the other parts need: a long pane line otherwise shrinks code and memory too.
    const natural = placement(m, byteFor(MEMORY_WIDTH), rowOf, flush, minEndAddress).width;
    const paneSize = Math.max(
      PANE_MIN,
      Math.min(PANE_MAX, Math.floor((Math.max(360, natural + 48) - 48) / (paneChars * CHAR)))
    );
    const paneChar = paneSize * CHAR;
    const labelExtent = paneLabelExtent(m, paneChar);
    // Everything but memory: the column is at least this wide whatever memory does.
    const others = Math.max(
      360,
      options.minColumnWidth ?? 0,
      paneChars * paneChar + 48,
      labelExtent.right + 24 - PANE_LABEL_LEFT,
      (P.outputLabel.length + 1) * 26 * CHAR + outputChars * paneChar + 48,
      stacked ? initialCode.width : 0
    );
    // Memory takes the width the rest of the column already has, or the viewport leaves beside
    // the code, never less than its budget.
    const byte = byteFor(Math.max(MEMORY_WIDTH, others - 48, besideCode - 48));
    const placed = placement(m, byte, rowOf, flush, minEndAddress);
    const columnW = Math.max(others, placed.width + 48);
    // Fit the source after reserving space for memory and the expression pane.
    const codeBudget = stacked
      ? Math.max(columnW, stackedCodeBudget)
      : canvasBudget - (columnW + COLUMN_GAP + 2 * MARGIN);
    const code = fitCode(codeBudget);
    const width = code.width + COLUMN_GAP + columnW;
    return { rows, rowOf, code, paneSize, paneChar, byte, labelExtent, placed, columnW, width, cell: byte / width };
  };
  const partitions = (n: number, count: number): number[][][] => {
    if (count === 1) return [[Array.from({ length: n }, (_, i) => i)]];
    const out: number[][][] = [];
    const cut = (from: number, left: number, acc: number[][]): void => {
      if (left === 1) {
        out.push([...acc, Array.from({ length: n - from }, (_, i) => from + i)]);
        return;
      }
      for (let to = from + 1; to <= n - left + 1; to++) {
        cut(to, left - 1, [...acc, Array.from({ length: to - from }, (_, i) => from + i)]);
      }
    };
    cut(0, count, []);
    return out;
  };
  const single = plan(partitions(m.tops.length, 1)[0]);
  // A row more is worth it while the column stays within WRAP_HEIGHT_FACTOR (half again) of the taller of the code
  // and the unwrapped column, and the drawing gets no wider (so code does not shrink); the
  // layout with the largest drawn cells wins.
  const baseH = (structs ? FRAME.top : 0) + 30 + rise * RISE.top + pitch + 132;
  const limit = Math.max(single.code.height, baseH) * WRAP_HEIGHT_FACTOR;
  let chosen = single;
  for (let count = 2; canWrap && count <= Math.min(3, m.tops.length); count++) {
    if (baseH + (count - 1) * pitch > limit) break;
    for (const rows of partitions(m.tops.length, count)) {
      const candidate = plan(rows);
      if (candidate.width <= single.width + 1 && candidate.cell > chosen.cell * 1.1) chosen = candidate;
    }
  }
  // Stacked flush byte views (e.g. mobile/vertical shorts) wrap wide byte strips onto balanced rows
  // so individual hex bytes and addresses remain readable instead of shrinking to half size.
  if (flush && stacked && !options.skipWrap && m.tops.length > 1) {
    const singleSpan = flushRowBounds(single.rows)[0];
    const totalBytes = singleSpan.end - singleSpan.start;
    if (totalBytes > 10) {
      const counts = totalBytes > 24 && m.tops.length >= 3 ? [3, 2] : [2];
      let bestCandidate: typeof single | null = null;
      let bestScore = Infinity;
      for (const rowCount of counts) {
        let bestRows: number[][] | null = null;
        let bestMax = Infinity;
        let bestSpread = Infinity;
        for (const rows of partitions(m.tops.length, rowCount)) {
          const lens = flushRowBounds(rows).map(b => b.end - b.start);
          const maxRowBytes = Math.max(...lens);
          const spread = maxRowBytes - Math.min(...lens);
          if (maxRowBytes < bestMax || (maxRowBytes === bestMax && spread < bestSpread)) {
            bestMax = maxRowBytes;
            bestSpread = spread;
            bestRows = rows;
          }
        }
        // Only wrap when the widest row shrinks meaningfully (avoid lopsided 15+1 splits).
        if (bestRows && bestMax <= totalBytes * 0.75) {
          const candidate = plan(bestRows);
          const singleScale = single.byte / single.columnW;
          const candidateScale = candidate.byte / candidate.columnW;
          if (candidateScale >= singleScale * 1.15 && bestMax < bestScore) {
            bestScore = bestMax;
            bestCandidate = candidate;
          }
        }
      }
      if (bestCandidate) chosen = bestCandidate;
    }
  }
  const { labelExtent } = chosen;
  const placed = chosen.placed;
  const rowOf = chosen.rowOf;
  const extraRows = chosen.rows.length - 1;
  const { rows, height: codeH } = chosen.code;
  let codeW = chosen.code.width;
  let columnW = chosen.columnW;
  if (stacked) codeW = columnW = Math.max(codeW, columnW);
  const cellH =
    stacked && flush && options.maxCellHeight && options.maxCellHeight > baseCellH
      ? Math.min(
          options.maxCellHeight,
          Math.max(baseCellH, Math.round(baseCellH + (chosen.byte - FLUSH_BASE_BYTE) * 0.25))
        )
      : baseCellH;

  const atLeaf = (memX: number, memY: number, c: ModelLeaf, rowOffset: (name: string) => number): PlacedLeaf => {
    const span = placed.spans.get(c.name)!;
    return {
      ...c,
      x: memX + span[0],
      y: memY + rowOffset(c.name),
      w: span[1],
      h: cellH,
      color: '',
      fieldColor: null,
    };
  };
  const atGroup = (memX: number, memY: number, c: ModelGroup, rowOffset: (name: string) => number): PlacedGroup => {
    const span = placed.spans.get(c.name)!;
    return {
      ...c,
      x: memX + span[0],
      y: memY + rowOffset(c.name),
      w: span[1],
      h: cellH,
      color: '',
      fieldColor: null,
    };
  };

  const probeRowY = (name: string): number => (rowOf.get(name.split('.')[0]) ?? 0) * pitch;
  const probeLeaves = m.leaves.map(l => atLeaf(0, 0, l, probeRowY));
  const probeGroups = m.groups.map(s => atGroup(0, 0, s, probeRowY));
  const probe: LinkProbe = {
    memY: 0,
    rise,
    leaves: probeLeaves,
    isStruct,
    box: name => probeGroups.find(s => s.name === name) || probeLeaves.find(l => l.name === name),
  };
  let level = -1;
  const sameRowMaxLevel = new Map<number, number>();
  let maxCrossLinks = 0;
  const maxCrossToRow = new Map<number, number>();
  const maxCrossFromRow = new Map<number, number>();
  for (const step of m.steps) {
    let stepCross = 0;
    const stepTo = new Map<number, number>();
    const stepFrom = new Map<number, number>();
    for (const l of links(probe, step)) {
      level = Math.max(level, l.level);
      const fromRow = rowOf.get(l.from.name.split('.')[0]) ?? 0;
      const toRow = rowOf.get(l.to.name.split('.')[0]) ?? 0;
      if (fromRow === toRow) {
        sameRowMaxLevel.set(fromRow, Math.max(sameRowMaxLevel.get(fromRow) ?? -1, l.level));
      } else {
        stepCross++;
        stepTo.set(toRow, (stepTo.get(toRow) ?? 0) + 1);
        stepFrom.set(fromRow, (stepFrom.get(fromRow) ?? 0) + 1);
      }
    }
    maxCrossLinks = Math.max(maxCrossLinks, stepCross);
    for (const [r, count] of stepTo) maxCrossToRow.set(r, Math.max(maxCrossToRow.get(r) ?? 0, count));
    for (const [r, count] of stepFrom) maxCrossFromRow.set(r, Math.max(maxCrossFromRow.get(r) ?? 0, count));
  }
  const baseRoom = (structs ? FRAME.top : 0) + 30 + rise * RISE.top;
  let room: number;
  if (flush && extraRows > 0) {
    const row0Same = sameRowMaxLevel.get(0) ?? -1;
    const row0SameRoom = row0Same >= 0 ? FRAME.top + 84 + row0Same * 40 + 10 : 0;
    const row0HasCross = (maxCrossToRow.get(0) ?? 0) > 0 || (maxCrossFromRow.get(0) ?? 0) > 0;
    const row0CrossRoom = row0HasCross ? 64 + Math.max(0, maxCrossLinks - 1) * 18 : 0;
    room = Math.max(baseRoom, row0SameRoom, row0CrossRoom);
  } else {
    room = level >= 0 ? FRAME.top + 84 + level * 40 + 10 + rise * RISE.top : baseRoom;
  }
  const tagged = tagRows(m, probe.box);
  const typeRow = typeRows(m, probe.box, rowOf);
  // A typed pane has room above its text for every row of labels.
  const labelHeight = m.typed ? LABEL.rise + Math.max(0, labelExtent.rows - 1) * LABEL.row : 0;
  const labelRise = m.typed ? labelHeight + 6 : 0;
  const named =
    (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + rise * RISE.bottom + tagged.height;
  const names = named + typeRow.height + extraMemBottom;
  const rowOffsets: number[] = [0];
  for (let r = 1; r <= extraRows; r++) {
    if (flush) {
      const baseGap = extraMemBottom > 0 ? 34 : 38;
      const rSame = sameRowMaxLevel.get(r) ?? -1;
      const sameGap = rSame >= 0 ? 96 + rSame * 32 : 0;
      const rHasCross = (maxCrossToRow.get(r) ?? 0) > 0 || (maxCrossFromRow.get(r) ?? 0) > 0;
      const crossGap = rHasCross ? 64 + Math.max(0, maxCrossLinks - 1) * 18 : 0;
      rowOffsets.push(rowOffsets[r - 1] + names + Math.max(baseGap, sameGap, crossGap));
    } else {
      rowOffsets.push(r * pitch);
    }
  }
  const rowY = (name: string): number => rowOffsets[rowOf.get(name.split('.')[0]) ?? 0] ?? 0;
  const paneGap = stacked ? (extraMemBottom > 0 ? 18 : flush ? 36 : 56) : 56;
  const paneTop = room + rowOffsets[extraRows] + names + paneGap;
  const paneH = 76 + labelRise + extraPaneHeight;
  const outputTop = paneTop + paneH + (stacked && flush ? 46 : 60);
  const columnH = outputLines.length
    ? outputTop + (outputLines.length - 1) * 36 + 14
    : paneTop + paneH;

  const codeX = MARGIN;
  let codeY: number;
  let columnX: number;
  let columnY: number;
  let width: number;
  let height: number;
  const minMemLeft =
    stacked && flush && extraRows > 0 && maxCrossLinks > 0
      ? 36 + Math.max(0, maxCrossLinks - 1) * 14
      : 0;
  if (stacked) {
    codeY = MARGIN;
    columnX = MARGIN;
    columnY = codeY + codeH + 24;
    if (minMemLeft > 0) {
      const minLeftPad = Math.max(24, minMemLeft - columnX);
      if (minLeftPad + placed.width + 24 > columnW) {
        codeW = columnW = minLeftPad + placed.width + 24;
      }
    }
    width = MARGIN + columnW + STACK_TETHER_WIDTH + MARGIN;
    height = columnY + columnH + MARGIN;
  } else {
    const content = Math.max(codeH, columnH);
    codeY = MARGIN + (content - codeH) / 2;
    columnX = codeX + codeW + COLUMN_GAP;
    columnY = MARGIN + (content - columnH) / 2;
    width = columnX + columnW + MARGIN;
    height = MARGIN + content + MARGIN;
  }

  const memX = stacked
    ? round(Math.max(minMemLeft, columnX + 24 + Math.max(0, (columnW - 48 - placed.width) / 2)))
    : columnX + 24;
  const memY = columnY + room;
  const pane: PlacedRect = { x: columnX, y: columnY + paneTop, w: columnW, h: paneH };
  const tx = columnX + 24;
  const ty = pane.y + 38 + 11 + labelHeight;
  const below = pane.y - paneGap;
  const out: [number, number] = [columnX + 24, columnY + outputTop];
  const code: PlacedRect = { x: codeX, y: codeY, w: codeW, h: codeH };
  const codeRows = placeCodeRows(rows, code.y + 50);
  const lineY = (i: number): number => codeRows[i][0].y;
  const gaps: Array<[number, number, number]> = placed.gaps.map(([x, w, row]) => [
    memX + x,
    w,
    memY + (rowOffsets[row] ?? row * pitch),
  ]);
  const colour = (list: string[], i: number, count: number): string => list[i % count];

  const leaves: PlacedLeaf[] = m.leaves.map(l => ({
    ...atLeaf(memX, memY, l, rowY),
    color: colour(P.vars, l.color, VARIABLE_COLOURS),
    fieldColor: l.group ? colour(P.fields, l.fieldColor ?? 0, FIELD_COLOURS) : null,
  }));
  const groups: PlacedGroup[] = m.groups.map(s => ({
    ...atGroup(memX, memY, s, rowY),
    color: colour(P.vars, s.color, VARIABLE_COLOURS),
    fieldColor: s.parent ? colour(P.fields, s.fieldColor ?? 0, FIELD_COLOURS) : null,
    drop: tagged.drop.get(s.name),
  }));
  const flushRows: FlushRow[] =
    flush && m.tops.length > 0
      ? flushRowBounds(chosen.rows).map((b, r) => ({
          startAddress: b.start,
          endAddress: b.end,
          y: memY + (rowOffsets[r] ?? 0),
        }))
      : [];
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
    paneSize: chosen.paneSize,
    paneChar: chosen.paneChar,
    byteWidth: chosen.byte,
    flush,
    flushRows,
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
    codeRows,
    gaps,
    leaves,
    groups,
    box,
    cellsOf,
    tags,
    owner,
    field,
    typeTargets: [],
    typeLabels: typeRow.labels.map(({ row, ...label }) => ({
      ...label,
      cx: label.cx + memX,
      top: memY + rowY(label.name) + named + 8 + row * LABEL.row,
    })),
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
