// Shared byte-accurate memory strip renderer for byte-level views (`bits_view` and punning).
//
// Draws a flush horizontal byte grid (zero artificial gap between adjacent addresses): centered
// per-byte address ruler, hatched `??` alignment padding, variable cells with centered value
// headers above hex byte cells, per-byte pulse animation, LSB→MSB byte-order arrows, and
// transient full-height read/write highlights.
import { type ByteValue, type DecodedBytes, hexByte, paddingRuns } from '../core/bytes.ts';
import { CHAR, LABEL, type Palette } from './constants.ts';
import type { PlacedLeaf } from './geometry.ts';
import { arrival } from './model.ts';
import { type SceneContext, dim, typeColour, typeLabel } from './scene.ts';
import { esc, fade, hide, pulse, rect, round, show, text } from './svg.ts';

export const BYTE_CELL_HEIGHT = 88;
export const BYTE_SPLIT_OFFSET = 48;

let patternSeq = 0;

/** SVG `<defs>` patterns for alignment padding hatch and UB hazard hatch, unique per render. */
export function hatchDefs(P: Palette): { defs: string; padId: string; ubId: string } {
  const uid = ++patternSeq;
  const padId = `cv-pad-hatch-${uid}`;
  const ubId = `cv-ub-hatch-${uid}`;
  const defs =
    '<defs>' +
    `<pattern id="${padId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="10" fill="${P.deadFill}"/>` +
    `<line x1="0" y1="0" x2="0" y2="10" stroke="${P.gapStroke}" stroke-width="3.2"/>` +
    '</pattern>' +
    `<pattern id="${ubId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="10" fill="${P.panel}"/>` +
    `<rect width="10" height="10" fill="${P.error}" fill-opacity="0.13"/>` +
    `<line x1="0" y1="0" x2="0" y2="10" stroke="${P.error}" stroke-opacity="0.34" stroke-width="2.8"/>` +
    '</pattern>' +
    '</defs>';
  return { defs, padId, ubId };
}

/** Pulse `inner` about `(cx, cy)` starting at `begin` seconds. */
export function scaledAt(cx: number, cy: number, inner: string, begin: number): string {
  return (
    `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}` +
    `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`
  );
}

/** Render text, colouring runs of `?` in `errorColor` while preserving monospace `textLength`. */
export function poisonText(
  x: number,
  y: number,
  str: string,
  size: number,
  color: string,
  errorColor: string,
  anchor = 'start'
): string {
  if (!str.includes('?')) return text(x, y, str, size, color, anchor);
  const length =
    str.length > 1
      ? ` textLength="${round(str.length * size * CHAR)}" lengthAdjust="spacing"`
      : '';
  const inner = str
    .split(/(\?+)/)
    .filter(Boolean)
    .map(part => (part[0] === '?' ? `<tspan fill="${errorColor}">${esc(part)}</tspan>` : esc(part)))
    .join('');
  return (
    `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${color}" ` +
    `text-anchor="${anchor}" xml:space="preserve"${length}>${inner}</text>`
  );
}

/** Colour `?` runs inside `<text>` elements of an SVG fragment (e.g. a poisoned pane value). */
export function colorPoisonInSvg(markup: string, errorColor: string): string {
  return markup.replace(/(<text\b[^>]*>)([^<]*\?[^<]*)(<\/text>)/g, (_, open, body, close) => {
    const colored = String(body).replace(/(\?+)/g, `<tspan fill="${errorColor}">$1</tspan>`);
    return open + colored + close;
  });
}

/** Transient full-height write highlight over `[x, x + w)` during a write arrival. */
export function transientWriteHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, Math.max(0, at - 0.25))}${fade(1, 0, 0.3, at + 0.35)}` +
    rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0).replace('fill=', 'fill-opacity="0.2" fill=') +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

/** Transient full-height read highlight over `[x, x + w)` while a read travels to the pane. */
export function transientReadHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, 0)}${fade(1, 0, 0.25, at)}` +
    rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0).replace('fill=', 'fill-opacity="0.18" fill=') +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

/** Subtle LSB→MSB byte-order arrow directly beneath a multi-byte integer cell. */
export function byteOrderArrow(
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
  /** Full-height UB corruption fill on a foreign byte overwritten by a wider pointer. */
  corrupted?: boolean;
  /** Timing offset (seconds) for this byte's reveal/pulse during an animated write. */
  revealAt?: number;
}

export interface ByteVariableState {
  beforeHeader: DecodedBytes | null;
  afterHeader: DecodedBytes | null;
  bytes: ByteCellState[];
  /** True when the variable itself was corrupted by an out-of-bounds write. */
  corrupted?: boolean;
  /** True when the variable's value is written/changed during this animated step. */
  headerChanging?: boolean;
  /** Keep this variable undimmed even if the current pane does not name it. */
  keepBright?: boolean;
  /** Suppress the default transient read/write highlight on this cell (e.g. punning step). */
  suppressDefaultHighlight?: boolean;
}

export interface ByteMemoryOptions {
  padId: string;
  ubId: string;
  /** Minimum exclusive end address for the ruler and trailing padding (default: end of last leaf). */
  minEndAddress?: number;
  /** Per-variable byte and header state for the current step. */
  stateOf(leaf: PlacedLeaf): ByteVariableState;
  /** Optional custom rendering for one padding byte (returns markup, or null for default `??`). */
  paddingByte?(addr: number, bx: number, byteW: number, gridY: number, cellH: number): string | null;
  /** Type-pill font size below variable names (default `LABEL.memory`). */
  typeLabelSize?: number;
}

/**
 * Render the flush byte-accurate memory strip: address ruler, hatched padding, variable cells with
 * centered headers and hex bytes, per-byte pulse, byte-order arrows, names and type labels.
 */
export function renderByteMemory(c: SceneContext, opts: ByteMemoryOptions): string {
  const { g, P, animate, op } = c;
  if (g.leaves.length === 0) return '';

  const byteW = g.byteWidth;
  const gridY = g.memY;
  const cellH = g.leaves[0].h;
  const splitY = gridY + BYTE_SPLIT_OFFSET;
  const baseAddress = Math.min(...g.leaves.map(l => l.address));
  const lastEnd = Math.max(...g.leaves.map(l => l.address + l.size), opts.minEndAddress ?? 0);
  const totalBytes = Math.max(0, lastEnd - baseAddress);
  const xOf = (addr: number): number => g.memX + (addr - baseAddress) * byteW;
  const at = op ? arrival(op) : 0;
  const typeSize = opts.typeLabelSize ?? LABEL.memory;

  const ownerStarts = new Set(g.leaves.map(l => l.address));
  let out = '';

  // 1. Centered per-byte address ruler across the entire byte range
  for (let i = 0; i < totalBytes; i++) {
    const addr = baseAddress + i;
    const isStart = ownerStarts.has(addr);
    const bx = xOf(addr);
    out += text(
      bx + byteW / 2,
      gridY - 12,
      addr,
      isStart ? 15 : 13,
      isStart ? P.muted : P.grey,
      'middle'
    );
  }

  // 2. Hatched alignment-padding runs
  for (const run of paddingRuns(g.leaves, opts.minEndAddress)) {
    const rx = xOf(run.start);
    const rw = run.size * byteW;
    out += rect(rx + 1, gridY + 1, rw - 2, cellH - 2, `url(#${opts.padId})`, P.gapStroke, 0, 1.5);
    for (let k = 0; k < run.size; k++) {
      const addr = run.start + k;
      const bx = xOf(addr);
      if (k > 0) {
        out += `<line x1="${round(bx)}" y1="${gridY + 2}" x2="${round(bx)}" y2="${gridY + cellH - 2}" stroke="${P.gapStroke}" stroke-dasharray="3 3" stroke-width="1"/>`;
      }
      const custom = opts.paddingByte?.(addr, bx, byteW, gridY, cellH);
      out += custom ?? text(bx + byteW / 2, gridY + 74, '??', 13.5, P.grey, 'middle');
    }
  }

  // 3. Variables
  const liveByName = new Map<string, boolean>();
  const keepBrightByName = new Map<string, boolean>();
  for (const leaf of g.leaves) {
    const st = opts.stateOf(leaf);
    const vx = leaf.x;
    const vw = leaf.w;
    const col = leaf.fieldColor || leaf.color;
    const on = st.afterHeader !== null;
    liveByName.set(leaf.name, on);
    const isCorrupted = Boolean(st.corrupted);
    const borderCol = isCorrupted ? P.error : on ? col : P.deadStroke;

    let markup = '';
    markup += rect(vx + 1, gridY + 1, vw - 2, cellH - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Corrupted foreign bytes (full-height red hatch) or poisoned `?` bytes (bottom-half red hatch)
    for (let k = 0; k < leaf.size; k++) {
      const bs = st.bytes[k];
      if (!bs) continue;
      const bx = vx + k * byteW;
      const revealAt = bs.revealAt ?? at;
      if (bs.corrupted) {
        const bg = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${opts.ubId})`, 'none', 0);
        markup += animate && st.headerChanging ? `<g opacity="0">${show(revealAt)}${bg}</g>` : bg;
      } else if (bs.after === '?' && st.afterHeader?.poisoned) {
        const bg = rect(
          bx + 1.5,
          splitY + 0.8,
          byteW - 3,
          gridY + cellH - splitY - 2.3,
          `url(#${opts.ubId})`,
          'none',
          0
        );
        markup += animate && st.headerChanging ? `<g opacity="0">${show(revealAt)}${bg}</g>` : bg;
      }
    }

    // Horizontal split & vertical byte dividers
    const divCol = on ? P.gapStroke : P.deadStroke;
    markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
    for (let k = 1; k < leaf.size; k++) {
      const lx = vx + k * byteW;
      markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${gridY + cellH - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
    }

    // Outer variable border
    if (animate && st.headerChanging && isCorrupted) {
      markup +=
        `<g>${hide(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', col, 0, 2.8)}</g>` +
        `<g opacity="0">${show(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', P.error, 0, 3.2)}</g>`;
    } else {
      markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);
    }

    // 3a. Centered header (decimal or poisoned hex with red `?`)
    const headCx = vx + vw / 2;
    const renderHeader = (val: DecodedBytes | null, useBefore: boolean): string => {
      if (!val) return '';
      const str = val.text;
      const decSize = Math.min(25, (vw - 12) / (Math.max(1, str.length) * CHAR));
      const uninit = str === '?';
      const decCol = isCorrupted && !useBefore ? P.error : uninit ? P.grey : P.fg;
      const bg =
        isCorrupted && !useBefore
          ? rect(headCx - 14, gridY + 12, 28, 26, P.panel, 'none', 4)
          : '';
      return bg + poisonText(headCx, gridY + 33, str, round(decSize), decCol, P.error, 'middle');
    };

    if (animate && st.headerChanging) {
      const swapped =
        (st.beforeHeader !== null ? `<g>${hide(at)}${renderHeader(st.beforeHeader, true)}</g>` : '') +
        `<g opacity="0">${show(at)}${renderHeader(st.afterHeader, false)}</g>`;
      markup += scaledAt(headCx, gridY + 26, swapped, at - 0.15);
    } else {
      markup += renderHeader(st.afterHeader, false);
    }

    // 3b. Individual hex byte cells — only changed bytes pulse
    const hexY = gridY + 74;
    let hexGroup = `<g class="cv-byte-hex" data-name="${esc(leaf.name)}">`;
    for (let k = 0; k < leaf.size; k++) {
      const bs = st.bytes[k];
      if (!bs) continue;
      const bx = vx + k * byteW;
      const renderByte = (bval: ByteValue, useBefore: boolean): string => {
        if (bval === null) return '';
        if (bval === '?') {
          const poisoned = Boolean(st.afterHeader?.poisoned && !useBefore);
          const badgeBg = poisoned ? rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3) : '';
          return badgeBg + text(bx + byteW / 2, hexY, '??', poisoned ? 15.5 : 13.5, poisoned ? P.error : P.grey, 'middle');
        }
        const byteInk =
          bs.corrupted && !useBefore
            ? P.error
            : leaf.kind === 'ptr'
              ? P.muted
              : P.fg;
        const opAttr = leaf.kind === 'ptr' ? ' opacity="0.65"' : '';
        const bg =
          bs.corrupted && !useBefore
            ? rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3)
            : '';
        return (
          bg +
          `<g${opAttr}>${text(bx + byteW / 2, hexY, hexByte(bval), leaf.kind === 'ptr' ? 13 : 15.5, byteInk, 'middle')}</g>`
        );
      };

      const byteChanged = animate && st.headerChanging && bs.before !== bs.after;
      if (byteChanged) {
        const byteAt = bs.revealAt ?? at;
        const swapped =
          (bs.before !== null ? `<g>${hide(byteAt)}${renderByte(bs.before, true)}</g>` : '') +
          `<g opacity="0">${show(byteAt)}${renderByte(bs.after, false)}</g>`;
        hexGroup += scaledAt(bx + byteW / 2, gridY + 68, swapped, byteAt - 0.15);
      } else {
        hexGroup += renderByte(bs.after, false);
      }
    }
    markup += hexGroup + '</g>';

    // 3c. Default transient full-height read/write highlight
    if (animate && op && !st.suppressDefaultHighlight) {
      if (op.kind === 'read' && op.name === leaf.name) {
        markup += transientReadHighlight(vx, gridY, vw, cellH, P.read, at);
      } else if (op.kind === 'write' && op.name === leaf.name) {
        markup += transientWriteHighlight(vx, gridY, vw, cellH, P.write, at);
      }
    }

    // 3d. Byte-order arrow on multi-byte ints
    if (leaf.kind === 'int' && leaf.size > 1) {
      markup += byteOrderArrow(vx, vw, byteW, gridY, cellH, c.littleEndian, on, P);
    }

    // 3e. Variable name
    const nameY = gridY + cellH + 34;
    const nameCol = isCorrupted ? P.error : on ? col : P.grey;
    if (animate && st.headerChanging && isCorrupted) {
      markup +=
        `<g>${hide(at)}${text(vx + vw / 2, nameY, leaf.label, g.nameSize, col, 'middle')}</g>` +
        `<g opacity="0">${show(at)}${text(vx + vw / 2, nameY, leaf.label, g.nameSize, P.error, 'middle')}</g>`;
    } else {
      markup += text(vx + vw / 2, nameY, leaf.label, g.nameSize, nameCol, 'middle');
    }

    const keepBright = Boolean(isCorrupted || st.keepBright);
    keepBrightByName.set(leaf.name, keepBright);
    out += keepBright ? markup : dim(c, leaf.group || leaf.name, markup);
  }

  // 4. Staggered variable type labels below names
  for (const label of g.typeLabels) {
    const on = liveByName.get(label.name) ?? false;
    const color = on ? typeColour(c, label.type) : P.deadStroke;
    const pill = typeLabel(c, label.cx, label.top, label.type, typeSize, color);
    out += keepBrightByName.get(label.name) ? pill : dim(c, label.name, pill);
  }

  return out;
}
