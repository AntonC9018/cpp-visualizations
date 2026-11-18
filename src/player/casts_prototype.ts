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
import { CHAR, type Palette } from './constants.ts';
import { type Geometry, type GeometryOptions, geometry } from './geometry.ts';
import { type PreparedModel, arrival, copies, stepSeconds } from './model.ts';
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
        const hexY = cell.y + 75;
        for (let i = 0; i < cell.size; i++) {
          const bx = cell.x + i * bw + bw / 2;
          body += text(bx, hexY, hexByte(bytes[i]), 13.5, P.muted, 'middle');
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

    // Subtle arrow indicating lowest-to-highest significance direction across multi-byte cells
    if (cell.size > 1) {
      const ay = cell.y + cell.h + 9;
      const dir = littleEndian ? 1 : -1;
      const xLow = cell.x + (littleEndian ? bw / 2 : cell.w - bw / 2);
      const xHigh = cell.x + (littleEndian ? cell.w - bw / 2 : bw / 2);
      const arrowCol = on ? P.muted : P.deadStroke;
      markup +=
        `<g opacity="0.65">` +
        `<circle cx="${round(xLow)}" cy="${ay}" r="1.8" fill="${arrowCol}"/>` +
        `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 5 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.3"/>` +
        `<path d="M -6.5 -3 L 0 0 L -6.5 3 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${littleEndian ? 0 : 180})"/>` +
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

function pillBadge(
  cx: number,
  topY: number,
  label: string,
  fill: string,
  stroke: string,
  textColor: string,
  size = 14
): string {
  const w = Math.max(24, label.length * size * CHAR + 14);
  const h = size + 8;
  return (
    rect(cx - w / 2, topY, w, h, fill, stroke, h / 2, 1.5) +
    text(cx, topY + size + 1.5, label, size, textColor, 'middle')
  );
}

function workbenchClean(c: SceneContext, variant: CastVariant): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate } = c;
  const cardX = g.tx - 6;
  const cardY = g.ty + 18;
  const cardW = g.pane.w - 36;
  const cardH = 128;
  const yTag = cardY + 11;
  const yBits = cardY + 72;
  const yHex = cardY + 104;
  const yRes = cardY + 86;
  const rightAnchor = cardX + 16 + 4 * BYTE_W + 3 * BYTE_GAP;
  const slotX = (bytesFromLSB: number): number =>
    rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;

  let out = rect(cardX, cardY, cardW, cardH, P.panel, P.gapStroke, 8, 1.5);

  if (act.kind === 'narrow' || act.kind === 'zero-extend' || act.kind === 'sign-extend' || act.kind === 'reinterpret') {
    const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
    const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);

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
              `<g>${hide(0.55)}${drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, fromCol)}</g>` +
              `<g opacity="0">${show(0.55)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="0.55s" dur="0.35s" fill="freeze"/>${settled}</g>`;
          } else {
            out += settled;
          }
        } else {
          out += drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, toCol);
        }
      }
      out += `<line x1="${round(cutX)}" y1="${cardY + 14}" x2="${round(cutX)}" y2="${cardY + cardH - 12}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`;
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else if (act.kind === 'sign-extend') {
      // Signed widening (both negative `1` and positive `0`):
      // Highlight the source type as signed and box its MSB, animate cloning paths across
      // upper bytes, then fade paths out leaving the signedness + color coding intact.
      const isNeg = act.signBit === 1;
      const extStroke = isNeg ? P.write : P.read;
      const extFill = isNeg ? P.writeFill : P.readFill;
      const extText = isNeg ? P.write : P.read;

      const srcTopPos = fromBytes.length - 1;
      const srcX = slotX(srcTopPos);
      const signBitCx = srcX + NIBBLE_W / 2 - 1.55 * BIT_STEP;

      const srcTag = `${act.fromType} · signed`;
      const srcCenter = (srcX + rightAnchor) / 2;
      const srcPillW = srcTag.length * 14 * CHAR + 14;
      const srcPillCx = Math.min(srcCenter, rightAnchor - srcPillW / 2);
      out += pillBadge(srcPillCx, yTag, srcTag, extFill, extStroke, extText, 14);

      for (let idx = 0; idx < fromBytes.length; idx++) {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isTopSrc = lsbPos === srcTopPos;
        const col = drawLab3ByteColumn(
          bx,
          yBits,
          yHex,
          fromBytes[idx],
          P.fg,
          toCol,
          isTopSrc ? { fill: extFill, stroke: extStroke, text: extText } : undefined
        );
        if (animate && isTopSrc) {
          const cx = signBitCx;
          const cy = yBits - 6;
          out += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(0.1)}<g transform="translate(${round(-cx)} ${round(-cy)})">${col}</g></g></g>`;
        } else {
          out += col;
        }
      }

      const extCount = toBytes.length - fromBytes.length;
      const fadeAt = 0.22 + Math.max(0, extCount - 1) * 0.22 + 0.82;
      let animArrows = '';

      for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
        const bx = slotX(lsbPos);
        const byteVal = toBytes[toBytes.length - 1 - lsbPos];
        const dstCx = bx + BYTE_W / 2;
        const k = lsbPos - fromBytes.length;
        const arcDelay = 0.22 + k * 0.22;
        const fillDelay = arcDelay + 0.42;

        const extByte = drawLab3ByteColumn(bx, yBits, yHex, byteVal, extText, extText);
        if (animate) {
          if (variant === 'A') {
            const sy = yBits - 21;
            const tipX = dstCx;
            const tipY = yBits - 21;
            const ctrlX = signBitCx * 0.28 + dstCx * 0.72;
            const apex = cardY + 34 + k * 1.5;
            const dx = tipX - ctrlX;
            const dy = tipY - apex;
            const len = Math.hypot(dx, dy) || 1;
            const ex = tipX - (5 * dx) / len;
            const ey = tipY - (5 * dy) / len;
            const d = `M ${round(signBitCx)} ${round(sy)} Q ${round(ctrlX)} ${round(apex)}, ${round(ex)} ${round(ey)}`;
            animArrows += `<path d="${d}" fill="none" stroke="${extStroke}" stroke-width="2" stroke-linecap="round" data-grow="${round(arcDelay)}"/>`;
            animArrows += `<g opacity="0">${show(fillDelay - 0.08)}${arrowheadAt(tipX, tipY, ex - ctrlX, ey - apex, extStroke)}</g>`;
          } else {
            const prevOriginX =
              k === 0 ? signBitCx : slotX(lsbPos - 1) + NIBBLE_W / 2 - 1.55 * BIT_STEP;
            const dstLeftBitX = bx + NIBBLE_W / 2 - 1.55 * BIT_STEP;
            const yTop = cardY + 42;
            const tipY = yBits - 21;
            const d = `M ${round(prevOriginX)} ${tipY} L ${round(prevOriginX)} ${yTop} L ${round(dstLeftBitX)} ${yTop} L ${round(dstLeftBitX)} ${tipY - 5}`;
            animArrows += `<path d="${d}" fill="none" stroke="${extStroke}" stroke-width="2" stroke-linejoin="round" data-grow="${round(arcDelay)}"/>`;
            animArrows += `<g opacity="0">${show(fillDelay - 0.08)}${arrowheadAt(dstLeftBitX, tipY, 0, 1, extStroke)}</g>`;
          }

          out +=
            `<g opacity="0">${show(fillDelay)}` +
            `<g transform="translate(${round(dstCx)} ${round(yBits + 10)})"><g>${pulse(fillDelay)}<g transform="translate(${round(-dstCx)} ${round(-(yBits + 10))})">${extByte}</g></g></g>` +
            '</g>';
        } else {
          out += extByte;
        }
      }

      if (animate && animArrows) {
        out += `<g>${fade(1, 0, 0.32, fadeAt)}${animArrows}</g>`;
      }

      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else if (act.kind === 'zero-extend') {
      // Unsigned widening: emphasize that source type is unsigned (MSB is NOT boxed/copied!),
      // and upper bytes receive fresh `0` padding independent of the source bits.
      const wallX = slotX(fromBytes.length - 1) - BYTE_GAP / 2;
      const srcStartX = slotX(fromBytes.length - 1);
      const srcTag = `${act.fromType} · unsigned`;
      const srcPillW = srcTag.length * 14 * CHAR + 14;
      const srcPillCx = Math.min((srcStartX + rightAnchor) / 2, rightAnchor - srcPillW / 2);
      out += pillBadge(srcPillCx, yTag, srcTag, P.bg, fromCol, fromCol, 14);

      // Dashed barrier separating unboxed unsigned source bytes from zero-filled upper bytes
      out += `<line x1="${round(wallX)}" y1="${yBits - 20}" x2="${round(wallX)}" y2="${yHex + 6}" stroke="${P.muted}" stroke-width="1.6" stroke-dasharray="4 4"/>`;

      const extCount = toBytes.length - fromBytes.length;
      const extLeftX = slotX(toBytes.length - 1);
      const extRightX = slotX(fromBytes.length) + BYTE_W;
      const extMidCx = (extLeftX + extRightX) / 2;

      if (variant === 'A') {
        // Variant A: external `0` pad source above the extended bytes dropping `0`s down
        const padChip = pillBadge(extMidCx, yTag, '0 fill', P.bg, P.grey, P.muted, 13.5);
        out += animate ? `<g opacity="0">${fade(0, 1, 0.25, 0.1)}${padChip}</g>` : padChip;
        if (animate) {
          let drops = '';
          const fadeAt = 0.22 + Math.max(0, extCount - 1) * 0.16 + 0.72;
          for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
            const dstCx = slotX(lsbPos) + BYTE_W / 2;
            const k = toBytes.length - 1 - lsbPos;
            const delay = 0.22 + k * 0.14;
            const sy = yTag + 24;
            const tipY = yBits - 21;
            const d = `M ${round(dstCx)} ${sy} L ${round(dstCx)} ${tipY - 5}`;
            drops += `<path d="${d}" fill="none" stroke="${P.grey}" stroke-width="1.8" data-grow="${round(delay)}"/>`;
            drops += `<g opacity="0">${show(delay + 0.32)}${arrowheadAt(dstCx, tipY, 0, 1, P.grey)}</g>`;
          }
          out += `<g>${fade(1, 0, 0.3, fadeAt)}${drops}</g>`;
        }
      } else {
        // Variant B: horizontal external `0` feed from the left filling upper bytes
        const padChip = pillBadge(extLeftX + 26, yTag, '0', P.bg, P.grey, P.muted, 14);
        out += animate ? `<g opacity="0">${fade(0, 1, 0.25, 0.1)}${padChip}</g>` : padChip;
        if (animate) {
          const yBar = cardY + 42;
          const xStart = extLeftX + 26;
          const tipY = yBits - 21;
          let feed = '';
          const fadeAt = 0.22 + Math.max(0, extCount - 1) * 0.16 + 0.75;
          for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
            const dstCx = slotX(lsbPos) + BYTE_W / 2;
            const k = toBytes.length - 1 - lsbPos;
            const delay = 0.22 + k * 0.15;
            const d =
              k === 0
                ? `M ${round(xStart)} ${yTag + 22} L ${round(xStart)} ${yBar} L ${round(dstCx)} ${yBar} L ${round(dstCx)} ${tipY - 5}`
                : `M ${round(slotX(lsbPos + 1) + BYTE_W / 2)} ${yBar} L ${round(dstCx)} ${yBar} L ${round(dstCx)} ${tipY - 5}`;
            feed += `<path d="${d}" fill="none" stroke="${P.grey}" stroke-width="1.8" stroke-linejoin="round" data-grow="${round(delay)}"/>`;
            feed += `<g opacity="0">${show(delay + 0.34)}${arrowheadAt(dstCx, tipY, 0, 1, P.grey)}</g>`;
          }
          out += `<g>${fade(1, 0, 0.3, fadeAt)}${feed}</g>`;
        }
      }

      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isExt = lsbPos >= fromBytes.length;
        const block = drawLab3ByteColumn(
          bx,
          yBits,
          yHex,
          toBytes[idx],
          isExt ? P.grey : P.fg,
          isExt ? P.grey : toCol
        );
        if (animate && isExt) {
          out += `<g opacity="0">${fade(0, 0.78, 0.35, 0.45)}${block}</g>`;
        } else if (isExt) {
          out += `<g opacity="0.78">${block}</g>`;
        } else {
          out += block;
        }
      }
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else {
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        out += drawLab3ByteColumn(slotX(lsbPos), yBits, yHex, toBytes[idx], P.fg, toCol);
      }
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    }
    return out;
  }

  if (act.kind === 'invert') {
    const beforeBytes = toBytesMSB(act.beforeVal, act.info.bytes);
    const afterBytes = toBytesMSB(act.afterVal, act.info.bytes);
    for (let idx = 0; idx < afterBytes.length; idx++) {
      const bx = slotX(afterBytes.length - 1 - idx);
      const afterBlock = drawLab3ByteColumn(bx, yBits, yHex, afterBytes[idx], P.write, P.write);
      if (animate) {
        out +=
          `<g>${hide(0.45)}${drawLab3ByteColumn(bx, yBits, yHex, beforeBytes[idx], P.fg, P.fg)}</g>` +
          `<g opacity="0">${show(0.45)}${afterBlock}</g>`;
      } else {
        out += afterBlock;
      }
    }
    out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, P.write);
    return out;
  }

  if (act.kind === 'value') {
    const bytes = toBytesMSB(act.value, act.info.bytes);
    const col = typeColour(c, act.type);
    for (let idx = 0; idx < bytes.length; idx++) {
      const bx = slotX(bytes.length - 1 - idx);
      out += drawLab3ByteColumn(bx, yBits, yHex, bytes[idx], P.fg, col);
    }
    out += text(rightAnchor + 22, yRes, `= ${act.value}`, 26, col);
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
    extraPaneHeight: 136,
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
    name: 'MSB-arc copy vs top-drop `0 fill`',
    claim: 'Pairs `type · signed` (boxed MSB + curved copy arcs) against `type · unsigned` (unboxed MSB + wall + external `0 fill` drops).',
    points: [
      'Signed widening (`int8_t · signed`) boxes the sign bit (`1` amber / `0` blue) and fans curved arcs to upper bytes before fading out.',
      'Unsigned widening (`uint8_t · unsigned`) keeps the source MSB unboxed behind a dashed barrier and drops external `0`s straight into upper bytes.',
      'Memory uses the locked two-tier cell (decimal top, subtle grey byte hex bottom) with the Little-endian / Big-endian player switch.',
    ],
  },
  B: {
    name: 'Stepped cascade copy vs left-feed `0` rail',
    claim: 'Contrasts a byte-by-byte stepped cascade from the boxed sign bit against an external `0` rail blocked from the unsigned source.',
    points: [
      'Signed widening (`int8_t · signed`) steps leftward byte-by-byte from the boxed MSB (`1` or `0`) and fades arrows away leaving the color coding.',
      'Unsigned widening (`uint8_t · unsigned`) blocks the source MSB with a dashed barrier and feeds `0` across upper bytes from an external `0` pill.',
      'Compare stepped cascade + left-feed `0` rail against A’s curved arcs + top-drop `0 fill`.',
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
