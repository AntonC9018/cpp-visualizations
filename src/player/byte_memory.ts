// Shared byte-accurate memory strip renderer for flush byte-level views (e.g. `bits_view`).
//
// Requires a single-row flush geometry (`flush: true` in `GeometryOptions`): centered per-byte
// address ruler, hatched `??` alignment padding, variable cells with centered value headers above
// hex byte cells, per-byte pulse animation, LSB→MSB byte-order arrows, and transient full-height
// read/write highlights.
import { type ByteValue, type DecodedBytes, hexByte, paddingRuns } from '../core/bytes.ts';
import { CHAR, LABEL, type Palette } from './constants.ts';
import type { PlacedLeaf } from './geometry.ts';
import { arrival } from './model.ts';
import { type SceneContext, dim, typeColour, typeLabel } from './scene.ts';
import { esc, fade, hide, pulse, rect, round, show, text } from './svg.ts';

export const BYTE_CELL_HEIGHT = 88;
const BYTE_SPLIT_OFFSET = 48;
/** Gaps up to this many bytes draw per-byte rulers and `??` cells; larger sparse gaps collapse. */
const MAX_DETAIL_GAP = 16;

let patternSeq = 0;

/** SVG `<defs>` pattern for alignment padding hatch, unique per render. */
export function hatchDefs(P: Palette): { defs: string; padId: string } {
  const uid = ++patternSeq;
  const padId = `cv-pad-hatch-${uid}`;
  const defs =
    '<defs>' +
    `<pattern id="${padId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="10" fill="${P.deadFill}"/>` +
    `<line x1="0" y1="0" x2="0" y2="10" stroke="${P.gapStroke}" stroke-width="3.2"/>` +
    '</pattern>' +
    '</defs>';
  return { defs, padId };
}

/** Pulse `inner` about `(cx, cy)` starting at `begin` seconds. */
export function scaledAt(cx: number, cy: number, inner: string, begin: number): string {
  return (
    `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}` +
    `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`
  );
}

/** Transient full-height write highlight over `[x, x + w)` during a write arrival. */
function transientWriteHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, Math.max(0, at - 0.25))}${fade(1, 0, 0.3, at + 0.35)}` +
    `<g opacity="0.2">${rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0)}</g>` +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

/** Transient full-height read highlight over `[x, x + w)` while a read travels to the pane. */
function transientReadHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, 0)}${fade(1, 0, 0.25, at)}` +
    `<g opacity="0.18">${rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0)}</g>` +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

/** Subtle LSB→MSB byte-order arrow directly beneath a multi-byte integer cell. */
function byteOrderArrow(
  vx: number,
  vw: number,
  byteW: number,
  gridY: number,
  cellH: number,
  littleEndian: boolean,
  on: boolean,
  P: Palette
): string {
  const ay = gridY + cellH + 10;
  const dir = littleEndian ? 1 : -1;
  const xLow = vx + (littleEndian ? byteW / 2 : vw - byteW / 2);
  const xHigh = vx + (littleEndian ? vw - byteW / 2 : byteW / 2);
  const arrowCol = on ? P.grey : P.deadStroke;
  return (
    `<g opacity="${on ? '0.75' : '0.45'}">` +
    `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M -8 -4 L 0 0 L -8 4 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${littleEndian ? 0 : 180})"/>` +
    '</g>'
  );
}

export interface ByteCellState {
  before: ByteValue;
  after: ByteValue;
}

export interface ByteVariableState {
  beforeHeader: DecodedBytes | null;
  afterHeader: DecodedBytes | null;
  bytes: ByteCellState[];
  /** True when the variable's value is written/changed during this animated step. */
  headerChanging?: boolean;
}

export interface ByteMemoryOptions {
  padId: string;
  /** Per-variable byte and header state for the current step. */
  stateOf(leaf: PlacedLeaf): ByteVariableState;
}

/**
 * Render the flush byte-accurate memory strip: address ruler, hatched padding, variable cells with
 * centered headers and hex bytes, per-byte pulse, byte-order arrows, names and type labels.
 */
export function renderByteMemory(c: SceneContext, opts: ByteMemoryOptions): string {
  const { g, P, animate, op } = c;
  if (g.leaves.length === 0) return '';

  const byteW = g.byteWidth;
  const gridY = g.leaves[0].y;
  const cellH = g.leaves[0].h;
  const baseAddress = Math.min(...g.leaves.map(l => l.address));
  const xOf = (addr: number): number => g.memX + (addr - baseAddress) * byteW;
  const at = op ? arrival(op) : 0;

  const readCells = new Set(op?.kind === 'read' ? g.cellsOf(op.name).map(l => l.name) : []);
  const writeCells = new Set(op?.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
  let out = '';

  // 1. Centered per-byte address ruler above every variable's bytes (bounded by leaf sizes)
  for (const leaf of g.leaves) {
    for (let k = 0; k < leaf.size; k++) {
      const bx = leaf.x + k * byteW;
      out += text(
        bx + byteW / 2,
        leaf.y - 12,
        leaf.address + k,
        k === 0 ? 15 : 13,
        k === 0 ? P.muted : P.grey,
        'middle'
      );
    }
  }

  // 2. Hatched alignment-padding runs (per-byte detail for small gaps, collapsed for sparse spans)
  for (const run of paddingRuns(g.leaves)) {
    const rx = xOf(run.start);
    const rw = run.size * byteW;
    out +=
      `<g class="cv-byte-padding" data-address="${run.start}" data-size="${run.size}">` +
      rect(rx + 1, gridY + 1, rw - 2, cellH - 2, `url(#${opts.padId})`, P.gapStroke, 0, 1.5);
    if (run.size <= MAX_DETAIL_GAP) {
      for (let k = 0; k < run.size; k++) {
        const bx = xOf(run.start + k);
        out += text(bx + byteW / 2, gridY - 12, run.start + k, 13, P.grey, 'middle');
        if (k > 0) {
          out += `<line x1="${round(bx)}" y1="${gridY + 2}" x2="${round(bx)}" y2="${gridY + cellH - 2}" stroke="${P.gapStroke}" stroke-dasharray="3 3" stroke-width="1"/>`;
        }
        out += text(bx + byteW / 2, gridY + 74, '??', 13.5, P.grey, 'middle');
      }
    } else {
      out += text(rx + rw / 2, gridY - 12, `${run.start}..${run.start + run.size - 1}`, 13, P.grey, 'middle');
      out += text(rx + rw / 2, gridY + 74, '…', 15, P.grey, 'middle');
    }
    out += '</g>';
  }

  // 3. Variables
  const liveByName = new Map<string, boolean>();
  for (const leaf of g.leaves) {
    const st = opts.stateOf(leaf);
    const vx = leaf.x;
    const vy = leaf.y;
    const vw = leaf.w;
    const vh = leaf.h;
    const splitY = vy + BYTE_SPLIT_OFFSET;
    const col = leaf.fieldColor || leaf.color;
    const on = st.afterHeader !== null;
    liveByName.set(leaf.name, on);

    let markup = '';
    markup += rect(vx + 1, vy + 1, vw - 2, vh - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Horizontal split & vertical byte dividers
    const divCol = on ? P.gapStroke : P.deadStroke;
    markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
    for (let k = 1; k < leaf.size; k++) {
      const lx = vx + k * byteW;
      markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${vy + vh - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
    }

    // Outer variable border
    markup += rect(vx + 1.5, vy + 1.5, vw - 3, vh - 3, 'none', on ? col : P.deadStroke, 0, 2.8);

    // 3a. Centered header
    const headCx = vx + vw / 2;
    const renderHeader = (val: DecodedBytes | null): string => {
      if (!val) return '';
      const str = val.text;
      const decSize = Math.min(25, (vw - 12) / (Math.max(1, str.length) * CHAR));
      const decCol = str === '?' ? P.grey : P.fg;
      return text(headCx, vy + 33, str, round(decSize), decCol, 'middle');
    };

    if (animate && st.headerChanging) {
      const swapped =
        (st.beforeHeader !== null ? `<g>${hide(at)}${renderHeader(st.beforeHeader)}</g>` : '') +
        `<g opacity="0">${show(at)}${renderHeader(st.afterHeader)}</g>`;
      markup += scaledAt(headCx, vy + 26, swapped, at - 0.15);
    } else {
      markup += renderHeader(st.afterHeader);
    }

    // 3b. Individual hex byte cells — only changed bytes pulse
    const hexY = vy + 74;
    let hexGroup = `<g class="cv-byte-hex" data-name="${esc(leaf.name)}">`;
    for (let k = 0; k < leaf.size; k++) {
      const bs = st.bytes[k];
      if (!bs) continue;
      const bx = vx + k * byteW;
      const renderByte = (bval: ByteValue): string => {
        if (bval === null) return '';
        if (bval === '?') return text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle');
        const byteInk = leaf.kind === 'ptr' ? P.muted : P.fg;
        const opAttr = leaf.kind === 'ptr' ? ' opacity="0.65"' : '';
        return `<g${opAttr}>${text(bx + byteW / 2, hexY, hexByte(bval), leaf.kind === 'ptr' ? 13 : 15.5, byteInk, 'middle')}</g>`;
      };

      const byteChanged = animate && st.headerChanging && bs.before !== bs.after;
      if (byteChanged) {
        const swapped =
          (bs.before !== null ? `<g>${hide(at)}${renderByte(bs.before)}</g>` : '') +
          `<g opacity="0">${show(at)}${renderByte(bs.after)}</g>`;
        hexGroup += scaledAt(bx + byteW / 2, vy + 68, swapped, at - 0.15);
      } else {
        hexGroup += renderByte(bs.after);
      }
    }
    markup += hexGroup + '</g>';

    // 3c. Transient full-height read/write highlight
    if (animate && op) {
      if (readCells.has(leaf.name)) {
        markup += transientReadHighlight(vx, vy, vw, vh, P.read, at);
      } else if (writeCells.has(leaf.name)) {
        markup += transientWriteHighlight(vx, vy, vw, vh, P.write, at);
      }
    }

    // 3d. Byte-order arrow on multi-byte ints
    if (leaf.kind === 'int' && leaf.size > 1) {
      markup += byteOrderArrow(vx, vw, byteW, vy, vh, c.littleEndian, on, P);
    }

    // 3e. Variable name
    markup += text(vx + vw / 2, vy + vh + 34, leaf.label, g.nameSize, on ? col : P.grey, 'middle');

    out += dim(c, leaf.group || leaf.name, markup);
  }

  // 4. Staggered variable type labels below names (at LABEL.memory matching geometry.ts)
  for (const label of g.typeLabels) {
    const on = liveByName.get(label.name) ?? false;
    const color = on ? typeColour(c, label.type) : P.deadStroke;
    out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, LABEL.memory, color));
  }

  return out;
}
