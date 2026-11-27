// Shared byte-accurate memory strip renderer for flush byte-level views (`bits_view`, `punning_view`).
//
// Requires a single-row flush geometry (`flush: true` in `GeometryOptions`): centered per-byte
// address ruler, hatched `??` alignment padding, variable cells with centered value headers above
// hex byte cells, per-byte pulse animation, LSB→MSB byte-order arrows, optional corruption/poison
// hazard styling, and transient full-height read/write highlights.
import { type ByteValue, hexByte, paddingRuns } from '../core/bytes.ts';
import { CHAR, LABEL, type Palette } from './constants.ts';
import type { FlushRow, Geometry, PlacedLeaf } from './geometry.ts';
import { arrival } from './model.ts';
import { type SceneContext, dim, typeColour, typeLabel } from './scene.ts';
import { esc, fade, hide, pulse, rect, round, show, text } from './svg.ts';

export const BYTE_CELL_HEIGHT = 88;
export const BYTE_CELL_MAX_HEIGHT = 108;
const BYTE_SPLIT_OFFSET = 48;
/** Gaps up to this many bytes draw per-byte rulers and `??` cells; larger sparse gaps collapse. */
const MAX_DETAIL_GAP = 16;

export interface ByteCellMetrics {
  splitOffset: number;
  headerY: number;
  headerCenterY: number;
  headerMaxFont: number;
  headerBadgeTop: number;
  headerBadgeH: number;
  hexY: number;
  hexCenterY: number;
  hexSize: number;
  ptrHexSize: number;
  unknownHexSize: number;
  hexBadgeW: number;
  hexBadgeH: number;
  hexBadgeTopOff: number;
  addrStartSize: number;
  addrSize: number;
}

/** Vertical layout and font sizes for a flush byte cell of height `cellH` and width `byteW`. */
export function byteCellMetrics(cellH: number, byteW: number): ByteCellMetrics {
  const t = Math.max(0, Math.min(1, (cellH - BYTE_CELL_HEIGHT) / (BYTE_CELL_MAX_HEIGHT - BYTE_CELL_HEIGHT)));
  const lerp = (a: number, b: number): number => round(a + (b - a) * t);
  const baseHex = byteW >= 54 ? 17 : 15.5;
  const basePtrHex = byteW >= 54 ? 14.5 : 13;
  return {
    splitOffset: lerp(BYTE_SPLIT_OFFSET, 58),
    headerY: lerp(33, 40),
    headerCenterY: lerp(26, 30),
    headerMaxFont: lerp(25, 34),
    headerBadgeTop: lerp(12, 14),
    headerBadgeH: lerp(26, 34),
    hexY: lerp(74, 92),
    hexCenterY: lerp(68, 84),
    hexSize: lerp(baseHex, 22),
    ptrHexSize: lerp(basePtrHex, 19),
    unknownHexSize: lerp(13.5, 17.5),
    hexBadgeW: lerp(30, 38),
    hexBadgeH: lerp(20, 26),
    hexBadgeTopOff: lerp(15, 19),
    addrStartSize: byteW >= 54 ? 16 : 15,
    addrSize: byteW >= 54 ? 14.5 : 13,
  };
}

let patternSeq = 0;

/** SVG `<defs>` patterns for alignment padding and UB hazard hatches, unique per render. */
export function hatchDefs(P: Palette): { defs: string; padId: string; ubId: string } {
  const uid = ++patternSeq;
  const padId = `cv-pad-hatch-${uid}`;
  const ubId = `cv-ub-hatch-${uid}`;
  const defs =
    '<defs>' +
    `<pattern id="${padId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="10" fill="${P.deadFill}"/>` +
    `<line x1="5" y1="0" x2="5" y2="10" stroke="${P.gapStroke}" stroke-width="2.2"/>` +
    '</pattern>' +
    `<pattern id="${ubId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="10" height="10" fill="${P.panel}"/>` +
    `<rect width="10" height="10" fill="${P.error}" fill-opacity="0.13"/>` +
    `<line x1="5" y1="0" x2="5" y2="10" stroke="${P.error}" stroke-opacity="0.34" stroke-width="2.6"/>` +
    '</pattern>' +
    '</defs>';
  return { defs, padId, ubId };
}

/** Pulse `inner` about `(cx, cy)` starting at `begin` seconds. */
export function scaledAt(cx: number, cy: number, inner: string, begin: number): string {
  return (
    `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(Math.max(0, begin))}` +
    `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`
  );
}

/** Text whose `?` runs render in `errorColor` (for poisoned hexadecimal values like `0x??????2A`). */
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

/** Highlight `?` digits inside poisoned hex literals (`0x[0-9A-F?]+`) within rendered SVG text nodes. */
export function colorPoisonHexInSvg(markup: string, errorColor: string): string {
  return markup.replace(
    /(<text\b[^>]*>)([^<]*0x[0-9A-F?]*\?[0-9A-F?]*[^<]*)(<\/text>)/g,
    (_, open, body, close) => {
      const colored = String(body).replace(/0x[0-9A-F?]+/g, hex =>
        hex.includes('?') ? hex.replace(/\?+/g, q => `<tspan fill="${errorColor}">${q}</tspan>`) : hex
      );
      return open + colored + close;
    }
  );
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
    `<g opacity="0.2">${rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0)}</g>` +
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

export type ByteHeader = string | { text: string; poisoned?: boolean } | null;

interface NormalizedHeader {
  text: string;
  poisoned: boolean;
}

function normalizeHeader(h: ByteHeader): NormalizedHeader | null {
  if (h === null) return null;
  if (typeof h === 'string') return { text: h, poisoned: false };
  return { text: h.text, poisoned: Boolean(h.poisoned) };
}

export interface ByteCellState {
  before: ByteValue;
  after: ByteValue;
  /** Full-height hazard hatch and error ink for bytes overwritten out of bounds. */
  corrupted?: boolean;
  /** True when out-of-bounds corruption lands on the current animated step. */
  corruptedNow?: boolean;
  /** Bottom-half hazard hatch and error `??` for indeterminate bytes copied into a variable. */
  poisoned?: boolean;
  /** Override reveal timestamp (seconds) for staggered byte arrivals. */
  revealAt?: number;
}

export interface ByteVariableState {
  beforeHeader: ByteHeader;
  afterHeader: ByteHeader;
  bytes: ByteCellState[];
  /** True when this variable is being written/modified during the current animated step. */
  changing?: boolean;
  /** True when an out-of-bounds write corrupted this variable. */
  corrupted?: boolean;
  /** True when out-of-bounds corruption lands on the current animated step. */
  corruptedNow?: boolean;
  /** Keep this variable and its type label undimmed even when unnamed in the pane. */
  keepBright?: boolean;
  /** Suppress default per-variable transient read/write highlight (caller draws its own span). */
  suppressDefaultHighlight?: boolean;
}

export interface PaddingByteState {
  value: ByteValue;
  beforeValue?: ByteValue;
  corrupted: boolean;
  corruptedBefore?: boolean;
  corruptedNow: boolean;
  revealAt?: number;
}

export interface ByteMemoryOptions {
  padId: string;
  ubId?: string;
  /** Exclusive end address for trailing alignment padding beyond the last variable. */
  minEndAddress?: number;
  /** Optional overwritten state for an alignment-padding byte. */
  paddingByte?(addr: number): PaddingByteState | null;
  /** Per-variable byte and header state for the current step. */
  stateOf(leaf: PlacedLeaf): ByteVariableState;
}

/** Map a byte address to its `(x, y)` top-left coordinate in a single-row or wrapped flush layout. */
export function flushAddrPos(g: Geometry, addr: number): { x: number; y: number; row: FlushRow } {
  const rows = g.flushRows;
  if (rows.length > 0) {
    const row =
      rows.find(r => addr >= r.startAddress && addr < r.endAddress) ??
      (addr < rows[0].startAddress ? rows[0] : rows[rows.length - 1]);
    return { x: g.memX + (addr - row.startAddress) * g.byteWidth, y: row.y, row };
  }
  const baseAddress = g.leaves.length ? Math.min(...g.leaves.map(l => l.address)) : 0;
  const y = g.leaves[0]?.y ?? g.memY;
  return {
    x: g.memX + (addr - baseAddress) * g.byteWidth,
    y,
    row: { startAddress: baseAddress, endAddress: baseAddress, y },
  };
}

/**
 * Render the flush byte-accurate memory strip: address ruler, hatched padding, variable cells with
 * centered headers and hex bytes, per-byte pulse, byte-order arrows, names and type labels.
 */
export function renderByteMemory(c: SceneContext, opts: ByteMemoryOptions): string {
  const { g, P, animate, op } = c;
  if (!g.flush) {
    throw new Error('renderByteMemory requires flush geometry');
  }
  if (g.leaves.length === 0) return '';

  const byteW = g.byteWidth;
  const cellH = g.leaves[0].h;
  const at = op ? arrival(op) : 0;
  const metrics = byteCellMetrics(cellH, byteW);
  const { addrStartSize, addrSize, hexSize, ptrHexSize, unknownHexSize } = metrics;

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
        k === 0 ? addrStartSize : addrSize,
        k === 0 ? P.muted : P.grey,
        'middle'
      );
    }
  }

  // 2. Hatched alignment-padding runs (split across wrapped flush rows; collapsed for sparse spans)
  const splitPaddingRuns = paddingRuns(g.leaves, opts.minEndAddress).flatMap(run => {
    if (g.flushRows.length <= 1) return [run];
    const pieces: Array<{ start: number; size: number }> = [];
    let cur = run.start;
    const runEnd = run.start + run.size;
    for (const row of g.flushRows) {
      if (cur >= runEnd) break;
      if (row.endAddress <= cur) continue;
      if (row.startAddress >= runEnd) break;
      const segStart = Math.max(cur, row.startAddress);
      const segEnd = Math.min(runEnd, row.endAddress);
      if (segEnd > segStart) pieces.push({ start: segStart, size: segEnd - segStart });
      cur = segEnd;
    }
    return pieces.length ? pieces : [run];
  });
  for (const run of splitPaddingRuns) {
    const pos = flushAddrPos(g, run.start);
    const rx = pos.x;
    const ry = pos.y;
    const rw = run.size * byteW;
    out +=
      `<g class="cv-byte-padding" data-address="${run.start}" data-size="${run.size}">` +
      rect(rx + 1, ry + 1, rw - 2, cellH - 2, `url(#${opts.padId})`, P.gapStroke, 0, 1.5);
    if (run.size <= MAX_DETAIL_GAP) {
      const hexY = ry + metrics.hexY;
      for (let k = 0; k < run.size; k++) {
        const addr = run.start + k;
        const bx = rx + k * byteW;
        out += text(bx + byteW / 2, ry - 12, addr, addrSize, P.grey, 'middle');
        if (k > 0) {
          out += `<line x1="${round(bx)}" y1="${ry + 2}" x2="${round(bx)}" y2="${ry + cellH - 2}" stroke="${P.gapStroke}" stroke-dasharray="3 3" stroke-width="1"/>`;
        }
        const padState = opts.paddingByte?.(addr);
        if (padState?.corrupted && opts.ubId) {
          const makeHazard = (val: ByteValue): string => {
            const hexText = typeof val === 'number' ? hexByte(val) : '??';
            const badgeBg = rect(
              bx + byteW / 2 - metrics.hexBadgeW / 2,
              hexY - metrics.hexBadgeTopOff,
              metrics.hexBadgeW,
              metrics.hexBadgeH,
              P.panel,
              'none',
              3
            );
            return (
              rect(bx + 1.5, ry + 1.5, byteW - 3, cellH - 3, `url(#${opts.ubId})`, P.error, 0, 1.6) +
              badgeBg +
              text(bx + byteW / 2, hexY, hexText, hexSize, P.error, 'middle')
            );
          };
          const hazard = makeHazard(padState.value);
          if (animate && padState.corruptedNow) {
            const rev = padState.revealAt ?? at;
            const beforeMarkup = padState.corruptedBefore
              ? makeHazard(padState.beforeValue ?? '?')
              : text(bx + byteW / 2, hexY, '??', unknownHexSize, P.grey, 'middle');
            const changed = !padState.corruptedBefore || padState.beforeValue !== padState.value;
            out +=
              `<g>${hide(rev)}${beforeMarkup}</g>` +
              `<g opacity="0">${show(rev)}${changed ? scaledAt(bx + byteW / 2, ry + metrics.hexCenterY, hazard, rev - 0.1) : hazard}</g>`;
          } else {
            out += hazard;
          }
        } else {
          out += text(bx + byteW / 2, hexY, '??', unknownHexSize, P.grey, 'middle');
        }
      }
    } else {
      out += text(rx + rw / 2, ry - 12, `${run.start}..${run.start + run.size - 1}`, addrSize, P.grey, 'middle');
      out += text(rx + rw / 2, ry + metrics.hexY, '…', unknownHexSize + 1.5, P.grey, 'middle');
    }
    out += '</g>';
  }

  // 3. Variables
  const liveByName = new Map<string, boolean>();
  const keepBrightByName = new Map<string, boolean>();
  for (const leaf of g.leaves) {
    const st = opts.stateOf(leaf);
    const beforeH = normalizeHeader(st.beforeHeader);
    const afterH = normalizeHeader(st.afterHeader);
    const vx = leaf.x;
    const vy = leaf.y;
    const vw = leaf.w;
    const vh = leaf.h;
    const splitY = vy + metrics.splitOffset;
    const col = leaf.fieldColor || leaf.color;
    const on = afterH !== null;
    const isCorrupted = Boolean(st.corrupted);
    liveByName.set(leaf.name, on);
    keepBrightByName.set(leaf.name, Boolean(st.keepBright));

    let markup = '';
    markup += rect(vx + 1, vy + 1, vw - 2, vh - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Per-byte hazard fills (full-height for corrupted foreign bytes, bottom-half for copied `?` bytes)
    if (opts.ubId) {
      for (let k = 0; k < leaf.size; k++) {
        const bs = st.bytes[k];
        if (!bs) continue;
        const bx = vx + k * byteW;
        const rev = bs.revealAt ?? at;
        if (bs.corrupted) {
          const bg = rect(bx + 1.5, vy + 1.5, byteW - 3, vh - 3, `url(#${opts.ubId})`, 'none', 0);
          markup += animate && bs.corruptedNow ? `<g opacity="0">${show(rev)}${bg}</g>` : bg;
        } else if (bs.poisoned && bs.after === '?') {
          const bg = rect(bx + 1.5, splitY + 0.8, byteW - 3, vy + vh - splitY - 2.3, `url(#${opts.ubId})`, 'none', 0);
          markup += animate && st.changing ? `<g opacity="0">${show(rev)}${bg}</g>` : bg;
        }
      }
    }

    // Horizontal split & vertical byte dividers
    const divCol = on ? P.gapStroke : P.deadStroke;
    markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
    for (let k = 1; k < leaf.size; k++) {
      const lx = vx + k * byteW;
      markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${vy + vh - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
    }

    // Outer variable border
    if (animate && st.corruptedNow) {
      markup +=
        `<g>${hide(at)}${rect(vx + 1.5, vy + 1.5, vw - 3, vh - 3, 'none', col, 0, 2.8)}</g>` +
        `<g opacity="0">${show(at)}${rect(vx + 1.5, vy + 1.5, vw - 3, vh - 3, 'none', P.error, 0, 3.2)}</g>`;
    } else {
      const borderCol = isCorrupted ? P.error : on ? col : P.deadStroke;
      markup += rect(vx + 1.5, vy + 1.5, vw - 3, vh - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);
    }

    // 3a. Centered header
    const headCx = vx + vw / 2;
    const renderHeader = (h: NormalizedHeader | null, useBefore: boolean): string => {
      if (h === null) return '';
      const inset = Math.min(12, vw / 5);
      const decSize = Math.min(metrics.headerMaxFont, (vw - inset) / (Math.max(1, h.text.length) * CHAR));
      const errNow = isCorrupted && !useBefore;
      const decCol = errNow ? P.error : !h.poisoned && h.text === '?' ? P.grey : P.fg;
      const badgeW = Math.min(vw - 8, Math.max(28, h.text.length * decSize * CHAR + 8));
      const bg = errNow
        ? rect(headCx - badgeW / 2, vy + metrics.headerBadgeTop, badgeW, metrics.headerBadgeH, P.panel, 'none', 4)
        : '';
      return (
        bg +
        (h.poisoned
          ? poisonText(headCx, vy + metrics.headerY, h.text, round(decSize), decCol, P.error, 'middle')
          : text(headCx, vy + metrics.headerY, h.text, round(decSize), decCol, 'middle'))
      );
    };

    const headerChanged = animate && st.changing && beforeH?.text !== afterH?.text;
    if (headerChanged) {
      const swapped =
        (beforeH !== null ? `<g>${hide(at)}${renderHeader(beforeH, true)}</g>` : '') +
        `<g opacity="0">${show(at)}${renderHeader(afterH, false)}</g>`;
      markup += scaledAt(headCx, vy + metrics.headerCenterY, swapped, at - 0.15);
    } else if (animate && st.corruptedNow) {
      markup +=
        (beforeH !== null ? `<g>${hide(at)}${renderHeader(beforeH, true)}</g>` : '') +
        `<g opacity="0">${show(at)}${renderHeader(afterH, false)}</g>`;
    } else {
      markup += renderHeader(afterH, false);
    }

    // 3b. Individual hex byte cells — only changed bytes pulse; unchanged corrupted bytes swap without pulsing
    const hexY = vy + metrics.hexY;
    let hexGroup = `<g class="cv-byte-hex" data-name="${esc(leaf.name)}">`;
    for (let k = 0; k < leaf.size; k++) {
      const bs = st.bytes[k];
      if (!bs) continue;
      const bx = vx + k * byteW;
      const rev = bs.revealAt ?? at;
      const renderByte = (bval: ByteValue, useBefore: boolean): string => {
        if (bval === null) return '';
        if (bval === '?') {
          if (bs.poisoned && !useBefore) {
            const badgeBg = rect(
              bx + byteW / 2 - metrics.hexBadgeW / 2,
              hexY - metrics.hexBadgeTopOff,
              metrics.hexBadgeW,
              metrics.hexBadgeH,
              P.panel,
              'none',
              3
            );
            return badgeBg + text(bx + byteW / 2, hexY, '??', hexSize, P.error, 'middle');
          }
          return text(bx + byteW / 2, hexY, '??', unknownHexSize, P.grey, 'middle');
        }
        const errNow = Boolean(bs.corrupted && !useBefore);
        const bg = errNow
          ? rect(
              bx + byteW / 2 - metrics.hexBadgeW / 2,
              hexY - metrics.hexBadgeTopOff,
              metrics.hexBadgeW,
              metrics.hexBadgeH,
              P.panel,
              'none',
              3
            )
          : '';
        const byteInk = errNow ? P.error : leaf.kind === 'ptr' ? P.muted : P.fg;
        const size = !errNow && leaf.kind === 'ptr' ? ptrHexSize : hexSize;
        const glyph = text(bx + byteW / 2, hexY, hexByte(bval), size, byteInk, 'middle');
        return bg + (!errNow && leaf.kind === 'ptr' ? `<g opacity="0.65">${glyph}</g>` : glyph);
      };

      const byteChanged = animate && st.changing && bs.before !== bs.after;
      if (byteChanged) {
        const swapped =
          (bs.before !== null ? `<g>${hide(rev)}${renderByte(bs.before, true)}</g>` : '') +
          `<g opacity="0">${show(rev)}${renderByte(bs.after, false)}</g>`;
        hexGroup += scaledAt(bx + byteW / 2, vy + metrics.hexCenterY, swapped, rev - 0.15);
      } else if (animate && bs.corruptedNow) {
        hexGroup +=
          (bs.before !== null ? `<g>${hide(rev)}${renderByte(bs.before, true)}</g>` : '') +
          `<g opacity="0">${show(rev)}${renderByte(bs.after, false)}</g>`;
      } else {
        hexGroup += renderByte(bs.after, false);
      }
    }
    markup += hexGroup + '</g>';

    // 3c. Transient full-height read/write highlight
    if (animate && op && !st.suppressDefaultHighlight) {
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
    const nameY = vy + vh + 34;
    if (animate && st.corruptedNow) {
      markup +=
        `<g>${hide(at)}${text(vx + vw / 2, nameY, leaf.label, g.nameSize, col, 'middle')}</g>` +
        `<g opacity="0">${show(at)}${text(vx + vw / 2, nameY, leaf.label, g.nameSize, P.error, 'middle')}</g>`;
    } else {
      const nameCol = isCorrupted ? P.error : on ? col : P.grey;
      markup += text(vx + vw / 2, nameY, leaf.label, g.nameSize, nameCol, 'middle');
    }

    out += st.keepBright ? markup : dim(c, leaf.group || leaf.name, markup);
  }

  // 4. Staggered variable type labels below names (at LABEL.memory matching geometry.ts)
  for (const label of g.typeLabels) {
    const on = liveByName.get(label.name) ?? false;
    const color = on ? typeColour(c, label.type) : P.deadStroke;
    const pill = typeLabel(c, label.cx, label.top, label.type, LABEL.memory, color);
    out += keepBrightByName.get(label.name) ? pill : dim(c, label.name, pill);
  }

  return out;
}
