// PROTOTYPE, throwaway (casts and bit-level representation, #58).
// Derives directly from the base player (`Player`, `geometry`, `scene.ts`, `svg.ts`, `player.css`).
// Refinement pass 2 (A/B):
//   - Player transport includes an LE / BE byte-order switch (casts/bits visualizations only).
//   - Memory removes LSB/MSB clutter, makes byte hex smaller, and pairs overall decimal + byte hex:
//       A: Two-tier cell (decimal top, smaller per-byte hex bottom) + curved arc bit-copy
//       B: Byte-hex cell (`= decimal` below variable name) + stepped cascade bit-copy
//   - Both negative (`1`) and positive (`0`) signed widening highlight the MSB, copy it across
//     upper bytes with tangent-aligned arrowheads, and remove the arcs after animation while
//     keeping the color coding. Unsigned widening remains calm muted zero-padding.
import type { ExecutionTrace } from '../core/trace_format.ts';
import { CHAR, EASE, T, type Palette } from './constants.ts';
import { type Geometry, type GeometryOptions, geometry } from './geometry.ts';
import { type PreparedModel, arrival, copies, copyBegin, stepSeconds } from './model.ts';
import { Player, type PlayerHooks } from './player_view.ts';
import {
  type SceneContext,
  arrows,
  code,
  describe,
  dim,
  output,
  pane,
  tether,
  transfers,
  typeColour,
  typeLabel,
} from './scene.ts';
import { esc, fade, hide, pulse, rect, round, show, text } from './svg.ts';

export type CastVariant = 'A' | 'B';

interface IntTypeInfo {
  bytes: number;
  bits: number;
  signed: boolean;
}

function typeInfo(typeName: string | undefined): IntTypeInfo {
  const clean = (typeName ?? 'int').replace(/^const\s+/, '').replace(/^std::/, '').trim();
  const table: Record<string, IntTypeInfo> = {
    int8_t: { bytes: 1, bits: 8, signed: true },
    'signed char': { bytes: 1, bits: 8, signed: true },
    uint8_t: { bytes: 1, bits: 8, signed: false },
    'unsigned char': { bytes: 1, bits: 8, signed: false },
    int16_t: { bytes: 2, bits: 16, signed: true },
    short: { bytes: 2, bits: 16, signed: true },
    'short int': { bytes: 2, bits: 16, signed: true },
    uint16_t: { bytes: 2, bits: 16, signed: false },
    'unsigned short': { bytes: 2, bits: 16, signed: false },
    int32_t: { bytes: 4, bits: 32, signed: true },
    int: { bytes: 4, bits: 32, signed: true },
    uint32_t: { bytes: 4, bits: 32, signed: false },
    'unsigned int': { bytes: 4, bits: 32, signed: false },
    unsigned: { bytes: 4, bits: 32, signed: false },
    int64_t: { bytes: 8, bits: 64, signed: true },
    long: { bytes: 8, bits: 64, signed: true },
    'long long': { bytes: 8, bits: 64, signed: true },
    uint64_t: { bytes: 8, bits: 64, signed: false },
    'unsigned long': { bytes: 8, bits: 64, signed: false },
    'unsigned long long': { bytes: 8, bits: 64, signed: false },
    size_t: { bytes: 8, bits: 64, signed: false },
  };
  return table[clean] ?? { bytes: 4, bits: 32, signed: true };
}

function toBytesMSB(value: number, bytes: number): number[] {
  const unsigned = BigInt.asUintN(bytes * 8, BigInt(value));
  const out: number[] = [];
  for (let i = bytes - 1; i >= 0; i--) {
    out.push(Number((unsigned >> BigInt(i * 8)) & 0xffn));
  }
  return out;
}

function toBytesLSB(value: number, bytes: number): number[] {
  return toBytesMSB(value, bytes).reverse();
}

const hexByte = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');
const nibbles = (b: number): [string, string] => [
  (b >> 4).toString(2).padStart(4, '0'),
  (b & 0xf).toString(2).padStart(4, '0'),
];
const fullHex = (value: number, bytes: number): string =>
  '0x' + toBytesMSB(value, bytes).map(hexByte).join('');

function extractInt(fragment: string): number | null {
  const inner = fragment.match(/\(([^()]+)\)\s*$/)?.[1] ?? fragment;
  const match = inner.match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

type BitAction =
  | {
      kind: 'narrow' | 'zero-extend' | 'sign-extend' | 'reinterpret';
      signBit?: 0 | 1;
      fromType: string;
      toType: string;
      fromInfo: IntTypeInfo;
      toInfo: IntTypeInfo;
      beforeVal: number;
      afterVal: number;
    }
  | {
      kind: 'invert';
      type: string;
      info: IntTypeInfo;
      beforeVal: number;
      afterVal: number;
    }
  | {
      kind: 'value';
      label: string;
      type: string;
      info: IntTypeInfo;
      value: number;
    };

function activeBitAction(c: SceneContext): BitAction | null {
  const { step, prev, m } = c;
  const op = step.op;
  if (op?.kind === 'convert') {
    const beforeRaw = prev ? prev.pane.slice(...op.span) : op.value;
    const beforeVal = extractInt(beforeRaw) ?? Number.parseInt(op.value, 10);
    const afterVal = Number.parseInt(op.value, 10);
    const fromInfo = typeInfo(op.from);
    const toInfo = typeInfo(op.to);
    let kind: 'narrow' | 'zero-extend' | 'sign-extend' | 'reinterpret' = 'reinterpret';
    let signBit: 0 | 1 | undefined;
    if (toInfo.bytes < fromInfo.bytes) {
      kind = 'narrow';
    } else if (toInfo.bytes > fromInfo.bytes) {
      if (fromInfo.signed) {
        kind = 'sign-extend';
        signBit = beforeVal < 0 ? 1 : 0;
      } else {
        kind = 'zero-extend';
      }
    }
    return { kind, signBit, fromType: op.from, toType: op.to, fromInfo, toInfo, beforeVal, afterVal };
  }
  if (op?.kind === 'eval' && prev) {
    const raw = prev.pane.slice(...op.span);
    if (/^\s*~\s*-?\d+\s*$/.test(raw)) {
      const beforeVal = extractInt(raw) ?? 0;
      const afterVal = Number.parseInt(op.value, 10);
      const type =
        step.types?.find(t => !t.slot && t.span[0] === op.span[0])?.type ?? 'int';
      return { kind: 'invert', type, info: typeInfo(type), beforeVal, afterVal };
    }
  }
  if (op && (op.kind === 'read' || op.kind === 'write')) {
    const num = /^-?\d+$/.test(op.value) ? Number.parseInt(op.value, 10) : null;
    if (num !== null) {
      const variable = m.leaves.find(l => l.name === op.name);
      const type = variable?.type ?? 'int';
      return {
        kind: 'value',
        label: op.kind === 'write' ? `${op.name} = ${num}` : op.name,
        type,
        info: typeInfo(type),
        value: num,
      };
    }
  }
  const lit = step.types?.find(t => !t.slot);
  if (lit) {
    const slice = step.pane.slice(...lit.span);
    if (/^-?\d+$/.test(slice)) {
      return {
        kind: 'value',
        label: slice,
        type: lit.type,
        info: typeInfo(lit.type),
        value: Number.parseInt(slice, 10),
      };
    }
  }
  return null;
}

function isBitwiseInvert(steps: ExecutionTrace['steps'], i: number): boolean {
  const step = steps[i];
  if (step.op?.kind !== 'eval' || i === 0) return false;
  return /^\s*~\s*-?\d+\s*$/.test(steps[i - 1].pane.slice(...step.op.span));
}

function castStepSeconds(steps: ExecutionTrace['steps'], i: number): number {
  const step = steps[i];
  if (step.op?.kind === 'convert' || isBitwiseInvert(steps, i)) {
    return step.hold + 2.1;
  }
  return stepSeconds(steps, i);
}

function castDescribe(c: SceneContext): string {
  const act = activeBitAction(c);
  if (act && c.step.op?.kind === 'convert') {
    if (act.kind === 'narrow') {
      return (
        `Narrow ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ` +
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): drop high ` +
        `${act.fromInfo.bytes - act.toInfo.bytes} bytes`
      );
    }
    if (act.kind === 'zero-extend') {
      return (
        `Widen ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ` +
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): unsigned zero-extend upper bytes`
      );
    }
    if (act.kind === 'sign-extend') {
      return (
        `Widen ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ` +
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): sign-extend by duplicating bit ${act.signBit}`
      );
    }
  }
  return describe(c);
}

// ============================================================================================
// MEMORY: Overall value + compact hex per byte (driven by Player's LE / BE toggle)
// ============================================================================================

function drawTypeLabels(c: SceneContext, live: (l: { name: string }) => boolean): string {
  const { g, P } = c;
  let out = '';
  for (const label of g.typeLabels) {
    const on = g.cellsOf(label.name).some(live);
    const color = on ? typeColour(c, label.type) : P.deadStroke;
    out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, 18, color));
  }
  return out;
}

function memoryWithByteHex(c: SceneContext): string {
  const { g, P, step, prev, op } = c;
  const littleEndian = c.littleEndian ?? true;
  const values = op && op.kind === 'write' && prev ? prev.values : step.values;
  const at = op ? arrival(op) : 0;
  const writing = new Set(op && op.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
  const live = (l: { name: string }): boolean => values[l.name] !== null || writing.has(l.name);
  let out = '';

  for (const cell of g.leaves) {
    const on = live(cell);
    const changing = writing.has(cell.name);
    const color = cell.fieldColor || cell.color;
    const before = prev ? prev.values[cell.name] : null;
    const after = step.values[cell.name];
    const shownVal = changing ? after : values[cell.name];

    let markup = '';
    const bw = cell.w / cell.size;
    // Consecutive byte addresses across the cell
    markup += text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
    if (cell.size > 1) {
      for (let i = 1; i < cell.size; i++) {
        markup += text(cell.x + i * bw + 6, cell.y - 12, cell.address + i, 14, P.grey);
      }
    }

    // Two-tier cell: top = overall decimal value, bottom = subtle per-byte hex
    markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, 'none', 0);

    const divStroke = on ? P.gapStroke : P.deadStroke;
    const splitY = cell.y + 52;
    markup += `<line x1="${cell.x + 2}" y1="${splitY}" x2="${cell.x + cell.w - 2}" y2="${splitY}" stroke="${divStroke}" stroke-width="1.3"/>`;
    for (let i = 1; i < cell.size; i++) {
      const lx = round(cell.x + i * bw);
      markup += `<line x1="${lx}" y1="${splitY}" x2="${lx}" y2="${cell.y + cell.h - 2}" stroke="${divStroke}" stroke-width="1.3"/>`;
    }

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
      const bytesOf = (v: number): number[] =>
        littleEndian ? toBytesLSB(v, cell.size) : toBytesMSB(v, cell.size);

      const renderCellBody = (val: unknown): string => {
        if (typeof val !== 'number') {
          return text(cell.x + cell.w / 2, cell.y + 36, String(val), 26, P.grey, 'middle');
        }
        const bytes = bytesOf(val);
        let body = '';
        const dec = String(val);
        const decSize = Math.min(28, (cell.w - 14) / (dec.length * CHAR));
        body += text(cell.x + cell.w / 2, cell.y + 36, dec, round(decSize), P.fg, 'middle');
        const hexY = cell.y + 76;
        for (let i = 0; i < cell.size; i++) {
          const bx = cell.x + i * bw + bw / 2;
          body += `<g opacity="0.86">${text(bx, hexY, hexByte(bytes[i]), 15.5, P.fg, 'middle')}</g>`;
        }
        return body;
      };

      const cx = cell.x + cell.w / 2;
      const cy = cell.y + cell.h / 2;
      if (changing && before !== after) {
        markup += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.2)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
        if (before !== null) markup += `<g>${hide(at)}${renderCellBody(before)}</g>`;
        markup += `<g opacity="0">${show(at)}${renderCellBody(after)}</g>`;
        markup += '</g></g></g>';
      } else {
        markup += renderCellBody(shownVal);
      }
    }

    // Clear lowest-to-highest significance direction arrow across multi-byte cells
    if (cell.size > 1) {
      const ay = cell.y + cell.h + 10;
      const dir = littleEndian ? 1 : -1;
      const xLow = cell.x + (littleEndian ? bw / 2 : cell.w - bw / 2);
      const xHigh = cell.x + (littleEndian ? cell.w - bw / 2 : bw / 2);
      const arrowCol = on ? P.fg : P.deadStroke;
      markup +=
        `<g opacity="${on ? '0.82' : '0.55'}">` +
        `<circle cx="${round(xLow)}" cy="${ay}" r="2.8" fill="${arrowCol}"/>` +
        `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 7 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="2"/>` +
        `<path d="M -9 -4.5 L 0 0 L -9 4.5 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${littleEndian ? 0 : 180})"/>` +
        '</g>';
    }

    // Variable name
    markup += text(
      cell.x + cell.w / 2,
      cell.y + cell.h + 36,
      cell.label,
      g.nameSize,
      on ? color : P.grey,
      'middle'
    );

    out += dim(c, cell.group || cell.name, markup);
  }
  return out + drawTypeLabels(c, live);
}

// ============================================================================================
// EXECUTION PANE: Clean Lab-3 Binary-above-Hex Workbench
// ============================================================================================

const BYTE_W = 96;
const BYTE_GAP = 16;
const NIBBLE_W = 44;
const NIB_GAP = 8;
const BIT_FONT = 18;
const BIT_STEP = BIT_FONT * CHAR; // ~10.84px per bit glyph in 4-bit group

function drawLab3ByteColumn(
  x: number,
  yBits: number,
  yHex: number,
  byteVal: number,
  bitColor: string,
  hexColor: string,
  signBitHighlight?: { fill: string; stroke: string; text: string }
): string {
  const [hi, lo] = nibbles(byteVal);
  const hex = hexByte(byteVal);
  const hiCx = x + NIBBLE_W / 2;
  const loCx = x + NIBBLE_W + NIB_GAP + NIBBLE_W / 2;

  let bitsMarkup = '';
  if (signBitHighlight) {
    const signBitCx = hiCx - 1.55 * BIT_STEP;
    const restCx = hiCx + 0.55 * BIT_STEP;
    bitsMarkup +=
      rect(signBitCx - 6.2, yBits - 18, 12.4, 23, signBitHighlight.fill, signBitHighlight.stroke, 3.5, 1.8) +
      text(signBitCx, yBits, hi[0], BIT_FONT, signBitHighlight.text, 'middle') +
      text(restCx, yBits, hi.slice(1), BIT_FONT, bitColor, 'middle');
  } else {
    bitsMarkup += text(hiCx, yBits, hi, BIT_FONT, bitColor, 'middle');
  }

  return (
    bitsMarkup +
    text(loCx, yBits, lo, BIT_FONT, bitColor, 'middle') +
    text(hiCx, yHex, hex[0], 20, hexColor, 'middle') +
    text(loCx, yHex, hex[1], 20, hexColor, 'middle')
  );
}

/** Triangle arrowhead whose tip sits at (tipX, tipY), rotated to match direction (dx, dy). */
function arrowheadAt(tipX: number, tipY: number, dx: number, dy: number, color: string): string {
  const deg = round((Math.atan2(dy, dx) * 180) / Math.PI);
  return `<path d="M -8.5 -4.2 L 0 0 L -8.5 4.2 Z" fill="${color}" transform="translate(${round(tipX)} ${round(tipY)}) rotate(${deg})"/>`;
}

function workbenchClean(c: SceneContext, variant: CastVariant): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate, op } = c;
  const copying = animate && copies(c.m.steps, c.index);
  const cardX = g.tx - 6;
  const cardY = g.ty + 18;
  const cardW = g.pane.w - 36;
  const cardH = 160;
  const yBits = cardY + 98;
  const yHex = cardY + 132;
  const yRes = cardY + 112;
  const rightAnchor = cardX + 16 + 4 * BYTE_W + 3 * BYTE_GAP;
  const slotX = (bytesFromLSB: number): number =>
    rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;

  const reveal = (at: number, markup: string): string =>
    animate && at > 0 ? `<g opacity="0">${fade(0, 1, 0.22, at)}${markup}</g>` : markup;

  let out = rect(cardX, cardY, cardW, cardH, P.panel, P.gapStroke, 8, 1.5);

  if (act.kind === 'narrow' || act.kind === 'zero-extend' || act.kind === 'sign-extend' || act.kind === 'reinterpret') {
    const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
    const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);
    const baseAt = op ? arrival(op) : T.evaluate;

    if (act.kind === 'narrow') {
      const cutX = slotX(toBytes.length - 1) - BYTE_GAP / 2;
      for (let idx = 0; idx < fromBytes.length; idx++) {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const dropped = lsbPos >= toBytes.length;
        if (dropped) {
          const settled =
            `<g opacity="0.48">` +
            drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.error, P.error) +
            `<line x1="${bx + 6}" y1="${yBits - 16}" x2="${bx + BYTE_W - 6}" y2="${yHex + 6}" stroke="${P.error}" stroke-width="2"/>` +
            '</g>';
          if (animate) {
            out +=
              `<g>${hide(baseAt)}${drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, fromCol)}</g>` +
              `<g opacity="0">${show(baseAt)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="${round(baseAt)}s" dur="0.32s" fill="freeze"/>${settled}</g>`;
          } else {
            out += settled;
          }
        } else {
          out += drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, toCol);
        }
      }
      out += reveal(
        baseAt - 0.15,
        `<line x1="${round(cutX)}" y1="${cardY + 20}" x2="${round(cutX)}" y2="${cardY + cardH - 16}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`
      );
      out += reveal(baseAt + 0.34, text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol));
    } else if (act.kind === 'sign-extend') {
      // Signed widening (both negative `1` and positive `0`, zero text):
      // Highlight the source MSB in a crisp beacon box and launch spacious, non-intersecting
      // concentric rainbow arcs across upper bytes; arcs fade out leaving soft tinted upper-byte
      // cards + boxed MSB so the sign extension stays visually unmistakable even when settled.
      const isNeg = act.signBit === 1;
      const extStroke = isNeg ? P.write : P.read;
      const extFill = isNeg ? P.writeFill : P.readFill;
      const extText = isNeg ? P.write : P.read;

      const srcTopPos = fromBytes.length - 1;
      const srcX = slotX(srcTopPos);
      const signBitCx = srcX + NIBBLE_W / 2 - 1.55 * BIT_STEP;

      for (let idx = 0; idx < fromBytes.length; idx++) {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isTopSrc = lsbPos === srcTopPos;
        if (animate && isTopSrc) {
          const plain = drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, toCol);
          const boxed = drawLab3ByteColumn(
            bx,
            yBits,
            yHex,
            fromBytes[idx],
            P.fg,
            toCol,
            { fill: extFill, stroke: extStroke, text: extText }
          );
          const boxAt = Math.max(0.2, baseAt - 0.25);
          out +=
            `<g>${hide(boxAt)}${plain}</g>` +
            `<g opacity="0">${show(boxAt)}<g transform="translate(${round(signBitCx)} ${round(yBits - 6)})"><g>${pulse(boxAt)}<g transform="translate(${round(-signBitCx)} ${round(-(yBits - 6))})">${boxed}</g></g></g></g>`;
        } else {
          out += drawLab3ByteColumn(
            bx,
            yBits,
            yHex,
            fromBytes[idx],
            P.fg,
            toCol,
            isTopSrc ? { fill: extFill, stroke: extStroke, text: extText } : undefined
          );
        }
      }

      const extCount = toBytes.length - fromBytes.length;
      const stagger = 0.18;
      const fadeAt = baseAt + Math.max(0, extCount - 1) * stagger + 0.88;
      let animArrows = '';

      for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
        const bx = slotX(lsbPos);
        const byteVal = toBytes[toBytes.length - 1 - lsbPos];
        const dstCx = bx + BYTE_W / 2;
        const dstLeftBitX = bx + NIBBLE_W / 2 - 1.55 * BIT_STEP;
        const k = lsbPos - fromBytes.length;
        const arcDelay = baseAt + k * stagger;
        const fillDelay = arcDelay + 0.52;

        // Soft tinted card behind each sign-extended upper byte so signed polarity remains clear after arcs fade
        const extCard =
          `<g opacity="0.65">` +
          rect(bx + 2, yBits - 24, BYTE_W - 4, 68, extFill, extStroke, 6, 1.2) +
          `</g>` +
          drawLab3ByteColumn(bx, yBits, yHex, byteVal, extText, extText);

        if (animate) {
          const sy = yBits - 22;
          const tipY = yBits - 24;
          const tipX = variant === 'A' ? dstCx : dstLeftBitX;
          // Strictly concentric symmetric parabolic arcs: inner byte = low peak, outer byte = high peak (never cross!)
          const peakY = cardY + 52 - k * 18;
          const ctrlX = (signBitCx + tipX) / 2;
          const ctrlY = 2 * peakY - sy;
          const dx = tipX - ctrlX;
          const dy = tipY - ctrlY;
          const len = Math.hypot(dx, dy) || 1;
          const ex = tipX - (5.5 * dx) / len;
          const ey = tipY - (5.5 * dy) / len;
          const d = `M ${round(signBitCx)} ${round(sy)} Q ${round(ctrlX)} ${round(ctrlY)}, ${round(ex)} ${round(ey)}`;
          const fullPath = `M ${round(signBitCx)} ${round(sy)} Q ${round(ctrlX)} ${round(ctrlY)}, ${round(tipX)} ${round(tipY)}`;

          animArrows += `<path d="${d}" fill="none" stroke="${extStroke}" stroke-width="2.1" stroke-linecap="round" data-grow="${round(arcDelay)}"/>`;
          animArrows += `<g opacity="0">${show(fillDelay - 0.06)}${arrowheadAt(tipX, tipY, ex - ctrlX, ey - ctrlY, extStroke)}</g>`;

          if (variant === 'B') {
            animArrows +=
              `<g opacity="0">${show(arcDelay)}${hide(fillDelay + 0.08)}` +
              `<circle cx="0" cy="0" r="10.5" fill="${extFill}" stroke="${extStroke}" stroke-width="1.8"/>` +
              text(0, 5.5, String(act.signBit ?? 0), 15, extText, 'middle') +
              `<animateMotion begin="${round(arcDelay)}s" dur="0.58s" path="${fullPath}" keyPoints="0;1" ${EASE} fill="freeze"/>` +
              '</g>';
          }

          out +=
            `<g opacity="0">${show(fillDelay)}` +
            `<g transform="translate(${round(dstCx)} ${round(yBits + 10)})"><g>${pulse(fillDelay)}<g transform="translate(${round(-dstCx)} ${round(-(yBits + 10))})">${extCard}</g></g></g>` +
            '</g>';
        } else {
          out += extCard;
        }
      }

      if (animate && animArrows) {
        out += `<g>${fade(1, 0, 0.32, fadeAt)}${animArrows}</g>`;
      }

      const resAt = baseAt + Math.max(0, extCount - 1) * stagger + 0.56;
      out += reveal(resAt, text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol));
    } else if (act.kind === 'zero-extend') {
      // Unsigned widening (zero text):
      // Source MSB stays completely unboxed behind a solid vertical divider wall.
      //   A: New empty recessed zero-cells unfold leftward out from the divider wall.
      //   B: An external `(0)` bit-circle overhead (behind the wall) feeds neutral 0s straight down.
      const srcStartX = slotX(fromBytes.length - 1);
      const wallX = srcStartX - BYTE_GAP / 2;
      const extCount = toBytes.length - fromBytes.length;
      const extLeftX = slotX(toBytes.length - 1);
      const extRightX = slotX(fromBytes.length) + BYTE_W;
      const extMidCx = (extLeftX + extRightX) / 2;
      const boxTop = yBits - 24;
      const boxBot = yHex + 10;
      const boxH = boxBot - boxTop;
      const frameAt = Math.max(0.2, baseAt - 0.25);

      const divider =
        `<path d="M ${round(wallX - 5)} ${round(boxTop - 2)} H ${round(wallX)} V ${round(boxBot + 2)} H ${round(wallX - 5)}" ` +
        `fill="none" stroke="${P.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      out += reveal(frameAt, divider);

      if (variant === 'B' && animate) {
        const srcY = cardY + 28;
        const tipY = boxTop - 2;
        const fadeAt = baseAt + Math.max(0, extCount - 1) * 0.14 + 0.85;
        let feed =
          `<g opacity="0">${fade(0, 1, 0.22, Math.max(0.15, baseAt - 0.2))}` +
          `<circle cx="${round(extMidCx)}" cy="${round(srcY)}" r="12" fill="${P.bg}" stroke="${P.muted}" stroke-width="1.8"/>` +
          text(extMidCx, srcY + 5.5, '0', 16, P.muted, 'middle') +
          '</g>';
        for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
          const dstCx = slotX(lsbPos) + BYTE_W / 2;
          const k = toBytes.length - 1 - lsbPos;
          const delay = baseAt + k * 0.14;
          const d = `M ${round(extMidCx)} ${round(srcY + 12)} L ${round(extMidCx)} ${round(srcY + 22)} L ${round(dstCx)} ${round(srcY + 22)} L ${round(dstCx)} ${round(tipY - 5)}`;
          feed += `<path d="${d}" fill="none" stroke="${P.grey}" stroke-width="1.9" stroke-linejoin="round" data-grow="${round(delay)}"/>`;
          feed += `<g opacity="0">${show(delay + 0.48)}${arrowheadAt(dstCx, tipY, 0, 1, P.grey)}</g>`;
        }
        out += `<g>${fade(1, 0, 0.3, fadeAt)}${feed}</g>`;
      }

      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isExt = lsbPos >= fromBytes.length;
        if (!isExt) {
          out += drawLab3ByteColumn(bx, yBits, yHex, toBytes[idx], P.fg, toCol);
          continue;
        }
        const cell =
          rect(bx + 2, boxTop, BYTE_W - 4, boxH, P.bg, P.gapStroke, 6, 1.3) +
          `<g opacity="0.88">${drawLab3ByteColumn(bx, yBits, yHex, toBytes[idx], P.muted, P.muted)}</g>`;
        if (animate) {
          if (variant === 'A') {
            const k = lsbPos - fromBytes.length;
            const delay = baseAt + k * 0.14;
            out +=
              `<g opacity="0">${fade(0, 1, 0.25, delay)}` +
              `<g transform="translate(26 0)"><animateTransform attributeName="transform" type="translate" from="26 0" to="0 0" begin="${round(delay)}s" dur="0.34s" ${EASE} fill="freeze"/>${cell}</g>` +
              '</g>';
          } else {
            const k = toBytes.length - 1 - lsbPos;
            const delay = baseAt + k * 0.14 + 0.44;
            out += `<g opacity="0">${fade(0, 1, 0.24, delay)}${cell}</g>`;
          }
        } else {
          out += cell;
        }
      }

      const resAt =
        variant === 'A'
          ? baseAt + Math.max(0, extCount - 1) * 0.14 + 0.36
          : baseAt + Math.max(0, extCount - 1) * 0.14 + 0.56;
      out += reveal(resAt, text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol));
    } else {
      // Reinterpret (same bit width): keep source bytes until pane arrives, then settle to new type/value.
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const settled = drawLab3ByteColumn(bx, yBits, yHex, toBytes[idx], P.fg, toCol);
        if (animate) {
          const initial = drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, fromCol);
          out += `<g>${hide(baseAt)}${initial}</g><g opacity="0">${show(baseAt)}${settled}</g>`;
        } else {
          out += settled;
        }
      }
      out += reveal(baseAt + 0.12, text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol));
    }
    return out;
  }

  if (act.kind === 'invert') {
    const at = op ? arrival(op) : T.evaluate;
    const beforeBytes = toBytesMSB(act.beforeVal, act.info.bytes);
    const afterBytes = toBytesMSB(act.afterVal, act.info.bytes);
    for (let idx = 0; idx < afterBytes.length; idx++) {
      const bx = slotX(afterBytes.length - 1 - idx);
      const afterBlock = drawLab3ByteColumn(bx, yBits, yHex, afterBytes[idx], P.write, P.write);
      if (animate) {
        out +=
          `<g>${hide(at)}${drawLab3ByteColumn(bx, yBits, yHex, beforeBytes[idx], P.fg, P.fg)}</g>` +
          `<g opacity="0">${show(at)}${afterBlock}</g>`;
      } else {
        out += afterBlock;
      }
    }
    out += reveal(at + 0.18, text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, P.write));
    return out;
  }

  if (act.kind === 'value') {
    const bytes = toBytesMSB(act.value, act.info.bytes);
    const col = typeColour(c, act.type);
    let body = '';
    for (let idx = 0; idx < bytes.length; idx++) {
      const bx = slotX(bytes.length - 1 - idx);
      body += drawLab3ByteColumn(bx, yBits, yHex, bytes[idx], P.fg, col);
    }
    body += text(rightAnchor + 22, yRes, `= ${act.value}`, 26, col);

    // Do not show the value in the execution pane before it has traveled there.
    let appearAt = 0;
    if (copying) {
      appearAt = copyBegin(c.m.steps, c.index) + T.copyTravel;
    } else if (animate && op?.kind === 'read') {
      appearAt = arrival(op);
    }
    out += reveal(appearAt, body);
  }
  return out;
}

// ============================================================================================
// Variant hooks & prototype page controller (A / B)
// ============================================================================================

function hooksFor(
  variant: CastVariant,
  littleEndian: boolean,
  onEndianChange?: (le: boolean) => void
): PlayerHooks {
  const geomOpts: GeometryOptions = {
    minByteWidth: 66,
    minColumnWidth: 680,
    cellHeight: 88,
    extraPaneHeight: 170,
    skipWrap: true,
  };
  return {
    stackBelow: 900,
    maxScale: 0.78,
    endian: { littleEndian, onChange: onEndianChange },
    geometry: (m: PreparedModel, P: Palette, stacked: boolean, width: number): Geometry =>
      geometry(m, P, stacked, width, geomOpts),
    stepSeconds: castStepSeconds,
    describe: castDescribe,
    scene: (c: SceneContext): string => {
      const { step, prev, animate } = c;
      const lineChanged = animate && prev !== null && prev.line !== step.line;
      const copying = animate && copies(c.m.steps, c.index);
      const oldLine = lineChanged && prev ? prev.line : null;
      return (
        code(c, oldLine) +
        tether(c, oldLine) +
        arrows(c) +
        memoryWithByteHex(c) +
        pane(c, copying) +
        workbenchClean(c, variant) +
        output(c) +
        transfers(c)
      );
    },
  };
}

interface VariantMeta {
  name: string;
  claim: string;
  points: string[];
}

const VARIANTS: Record<CastVariant, VariantMeta> = {
  A: {
    name: 'Concentric MSB arcs vs unfolding empty zero-cells',
    claim: 'Signed widening fires spacious non-overlapping rainbow arcs from the boxed MSB and tints extended bytes; unsigned widening keeps the MSB unboxed behind a wall and unfolds neutral zero-cells leftward.',
    points: [
      'Signed widening (`1` amber / `0` blue) uses nested concentric arcs (zero intersections) and keeps a soft tinted wash behind the extended bytes.',
      'Unsigned widening shields the unboxed source byte and slides new recessed `0000 0000` cells out leftward.',
      'Memory shows brighter `15.5`px byte hex and a sharper `2`px significance arrow.',
    ],
  },
  B: {
    name: 'Bit-carrier MSB arcs vs external `(0)` origin behind wall',
    claim: 'Contrasts internal MSB origin (`[1]`/`[0]` riding concentric arcs) against an external `(0)` bit-node isolated behind the barrier wall.',
    points: [
      'Signed widening sends a glowing `1` or `0` bit gliding along each concentric arc tip to stamp tinted upper bytes.',
      'Unsigned widening places an external `(0)` bit-circle overhead behind a bulkhead wall to feed neutral `0000 0000` bytes without touching the source MSB.',
      'Compare unfolding zero-cells (A) against external `(0)` node drops (B).',
    ],
  },
};

declare global {
  interface Window {
    CastsPrototype?: {
      traces: ExecutionTrace[];
    };
  }
}

function boot(): void {
  const data = window.CastsPrototype?.traces ?? [];
  const params = new URLSearchParams(location.search);
  const rawVar = (params.get('variant') || 'A').toUpperCase();
  const state: { variant: CastVariant; littleEndian: boolean } = {
    variant: rawVar === 'A' || rawVar === 'B' ? rawVar : 'A',
    littleEndian: params.get('endian') !== 'be',
  };
  document.documentElement.dataset.theme = params.get('theme') || 'dark';

  const about = document.getElementById('about')!;
  const sections = document.getElementById('sections')!;
  const label = document.getElementById('label')!;
  const players: Player[] = [];

  sections.innerHTML = data
    .map(
      (t, i) =>
        `<section class="proto-case"><h2>${i + 1}. ${esc(t.title ?? '')}</h2>` +
        `<pre><code>${esc(t.source.join('\n'))}</code></pre>` +
        `<details data-case="${i}"${i <= 2 || params.get('open') === 'all' ? ' open' : ''}>` +
        `<summary>Execution trace</summary><div class="slot"></div></details></section>`
    )
    .join('');

  function syncUrl(): void {
    const url = new URL(location.href);
    url.searchParams.set('variant', state.variant);
    url.searchParams.set('endian', state.littleEndian ? 'le' : 'be');
    url.searchParams.set('theme', document.documentElement.dataset.theme || 'dark');
    history.replaceState(null, '', url);
  }

  function mount(): void {
    const savedIndices = new Map<number, number>();
    const savedEndian = new Map<number, boolean>();
    for (const details of sections.querySelectorAll<HTMLDetailsElement>('details')) {
      const idx = Number(details.dataset.case);
      const old = players[idx];
      if (old) {
        savedIndices.set(idx, old.index);
        savedEndian.set(idx, old.littleEndian);
        old.disconnect();
      }
    }
    players.length = 0;

    for (const details of sections.querySelectorAll<HTMLDetailsElement>('details')) {
      const idx = Number(details.dataset.case);
      const slot = details.querySelector<HTMLElement>('.slot')!;
      slot.innerHTML = '<div class="course-visualization"></div>';
      const host = slot.firstElementChild as HTMLElement;
      const le = savedEndian.get(idx) ?? state.littleEndian;
      const player = new Player(
        host,
        data[idx],
        hooksFor(state.variant, le, nextLe => {
          state.littleEndian = nextLe;
          syncUrl();
        })
      );
      const want = savedIndices.get(idx);
      if (want) {
        player.pristine = false;
        player.settle(want);
      }
      players[idx] = player;
    }

    const meta = VARIANTS[state.variant];
    label.textContent = `${state.variant} · ${meta.name}`;
    about.innerHTML =
      `<h3>${state.variant}. ${esc(meta.name)}</h3>` +
      `<p>${esc(meta.claim)}</p>` +
      `<ul>${meta.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;

    syncUrl();
  }

  sections.addEventListener(
    'toggle',
    event => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      const idx = Number(details.dataset.case);
      requestAnimationFrame(() => players[idx]?.refresh());
    },
    true
  );

  const cycle = (delta: number): void => {
    const keys: CastVariant[] = ['A', 'B'];
    state.variant = keys[(keys.indexOf(state.variant) + delta + keys.length) % keys.length];
    mount();
  };

  document.getElementById('prev')!.onclick = () => cycle(-1);
  document.getElementById('next')!.onclick = () => cycle(1);
  document.getElementById('theme')!.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    for (const p of players) p.refresh();
    syncUrl();
  };

  document.addEventListener('keydown', event => {
    if ((event.target as Element | null)?.matches('input, textarea, select, [contenteditable]')) return;
    if (event.key === '[') cycle(-1);
    if (event.key === ']') cycle(1);
  });

  mount();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
