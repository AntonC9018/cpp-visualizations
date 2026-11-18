// PROTOTYPE, throwaway (casts and bit-level representation, #58).
// Derives directly from the base player (`Player`, `geometry`, `scene.ts`, `svg.ts`, `player.css`).
// Refinement pass:
//   - Execution pane uses the clean Lab-3 two-row binary-above-hex workbench (no tiny caption text,
//     no redundant hex under the right-hand decimal result).
//   - Widening contrasts negative sign-bit duplication (highlighted MSB `1` + cloning arcs filling
//     upper bytes with `1111 1111` / `F F`) against calm zero-extension (muted `0000 0000` / `0 0`).
//   - Memory cells show BOTH the overall decimal value AND hex per byte across variants A/B/C:
//       A: Two-tier cell (decimal top, little-endian address-order hex per byte bottom)
//       B: Two-tier cell (decimal top, MSB-first reading-order hex per byte bottom) + arc clone
//       C: Byte-hex cell (MSB-first hex inside cell, `= decimal` below variable name) + cascade clone
import type { ExecutionTrace, TraceStep } from '../core/trace_format.ts';
import { CHAR, type Palette } from './constants.ts';
import {
  type Geometry,
  type GeometryOptions,
  type PlacedLeaf,
  geometry,
} from './geometry.ts';
import {
  type PreparedModel,
  arrival,
  copies,
  stepSeconds,
} from './model.ts';
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

export type CastVariant = 'A' | 'B' | 'C';

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
    if (toInfo.bytes < fromInfo.bytes) kind = 'narrow';
    else if (toInfo.bytes > fromInfo.bytes) {
      kind = fromInfo.signed && beforeVal < 0 ? 'sign-extend' : 'zero-extend';
    }
    return { kind, fromType: op.from, toType: op.to, fromInfo, toInfo, beforeVal, afterVal };
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
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): zero-extend upper bytes`
      );
    }
    if (act.kind === 'sign-extend') {
      return (
        `Widen ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ` +
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): sign-extend by duplicating bit 1`
      );
    }
  }
  return describe(c);
}

// ============================================================================================
// MEMORY: Overall value + hex per byte
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

interface MemoryStyle {
  littleEndian: boolean;
  decimalBelow: boolean;
}

function memoryWithByteHex(c: SceneContext, style: MemoryStyle): string {
  const { g, P, step, prev, op } = c;
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
    // Base address + optional consecutive byte addresses (+1, +2, +3) for little-endian view
    markup += text(cell.x + 3, cell.y - 12, cell.address, 17, on ? P.muted : P.grey);
    if (style.littleEndian && cell.size > 1) {
      const bw = cell.w / cell.size;
      for (let i = 1; i < cell.size; i++) {
        markup += text(cell.x + i * bw + 6, cell.y - 12, cell.address + i, 15, P.grey);
      }
    }

    // Background fill
    markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, 'none', 0);

    const bw = cell.w / cell.size;
    const divStroke = on ? P.gapStroke : P.deadStroke;

    if (style.decimalBelow) {
      // Full-height byte dividers
      for (let i = 1; i < cell.size; i++) {
        const lx = round(cell.x + i * bw);
        markup += `<line x1="${lx}" y1="${cell.y + 3}" x2="${lx}" y2="${cell.y + cell.h - 3}" stroke="${divStroke}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
      }
    } else {
      // Two-tier box: top = overall decimal, bottom = per-byte hex compartments
      const splitY = cell.y + 56;
      markup += `<line x1="${cell.x + 2}" y1="${splitY}" x2="${cell.x + cell.w - 2}" y2="${splitY}" stroke="${divStroke}" stroke-width="1.3"/>`;
      for (let i = 1; i < cell.size; i++) {
        const lx = round(cell.x + i * bw);
        markup += `<line x1="${lx}" y1="${splitY}" x2="${lx}" y2="${cell.y + cell.h - 2}" stroke="${divStroke}" stroke-width="1.3"/>`;
      }
    }

    // Outer border
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

    if (style.littleEndian && on && cell.size > 1) {
      const lsbY = style.decimalBelow ? cell.y + 16 : cell.y + 14;
      markup += text(cell.x + 7, lsbY, 'LSB', 11.5, P.grey);
      markup += text(cell.x + cell.w - 7, lsbY, 'MSB', 11.5, P.grey, 'end');
    }

    if (on) {
      const bytesOf = (v: number): number[] =>
        style.littleEndian ? toBytesLSB(v, cell.size) : toBytesMSB(v, cell.size);

      const renderCellBody = (val: unknown): string => {
        if (typeof val !== 'number') {
          if (style.decimalBelow) {
            return text(cell.x + cell.w / 2, cell.y + cell.h / 2 + 10, String(val), 28, P.grey, 'middle');
          }
          return text(cell.x + cell.w / 2, cell.y + 38, String(val), 28, P.grey, 'middle');
        }
        const bytes = bytesOf(val);
        let body = '';
        if (!style.decimalBelow) {
          const dec = String(val);
          const decSize = Math.min(30, (cell.w - 14) / (dec.length * CHAR));
          body += text(cell.x + cell.w / 2, cell.y + 38, dec, round(decSize), P.fg, 'middle');
        }
        const hexY = style.decimalBelow ? cell.y + cell.h / 2 + 9 : cell.y + 85;
        const hexSize = style.decimalBelow ? 24 : 20;
        for (let i = 0; i < cell.size; i++) {
          const bx = cell.x + i * bw + bw / 2;
          const b = bytes[i];
          body += text(bx, hexY, hexByte(b), hexSize, b !== 0 ? color : P.muted, 'middle');
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

    // Variable name + optional `= decimal` below
    markup += text(
      cell.x + cell.w / 2,
      cell.y + cell.h + 34,
      cell.label,
      g.nameSize,
      on ? color : P.grey,
      'middle'
    );
    if (style.decimalBelow) {
      const decLabel = on && typeof shownVal === 'number' ? `= ${shownVal}` : on && shownVal === '?' ? '= ?' : '';
      if (decLabel) {
        markup += text(
          cell.x + cell.w / 2,
          cell.y + cell.h + 62,
          decLabel,
          20,
          on ? P.fg : P.grey,
          'middle'
        );
      }
    }

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
  mutedColor: string,
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
      text(restCx, yBits, hi.slice(1), BIT_FONT, hi === '0000' ? mutedColor : bitColor, 'middle');
  } else {
    bitsMarkup += text(hiCx, yBits, hi, BIT_FONT, hi === '0000' ? mutedColor : bitColor, 'middle');
  }

  return (
    bitsMarkup +
    text(loCx, yBits, lo, BIT_FONT, lo === '0000' ? mutedColor : bitColor, 'middle') +
    text(hiCx, yHex, hex[0], 20, hex[0] === '0' ? mutedColor : hexColor, 'middle') +
    text(loCx, yHex, hex[1], 20, hex[1] === '0' ? mutedColor : hexColor, 'middle')
  );
}

function arrowheadDown(cx: number, tipY: number, color: string): string {
  return `<polygon points="${round(cx)},${round(tipY)} ${round(cx - 4.5)},${round(tipY - 7)} ${round(cx + 4.5)},${round(tipY - 7)}" fill="${color}"/>`;
}

function workbenchClean(c: SceneContext, signExtStyle: 'arcs' | 'cascade'): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate } = c;
  const cardX = g.tx - 6;
  const cardY = g.ty + 22;
  const cardW = g.pane.w - 36;
  const cardH = 104;
  const yBits = cardY + 50;
  const yHex = cardY + 82;
  const yRes = cardY + 64; // vertically centered against bits+hex (no redundant hex under decimal!)
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
            drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.error, P.error, P.error) +
            `<line x1="${bx + 6}" y1="${yBits - 16}" x2="${bx + BYTE_W - 6}" y2="${yHex + 6}" stroke="${P.error}" stroke-width="2"/>` +
            '</g>';
          if (animate) {
            out +=
              `<g>${hide(0.55)}${drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, fromCol, P.muted)}</g>` +
              `<g opacity="0">${show(0.55)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="0.55s" dur="0.35s" fill="freeze"/>${settled}</g>`;
          } else {
            out += settled;
          }
        } else {
          out += drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, toCol, toCol);
        }
      }
      out += `<line x1="${round(cutX)}" y1="${cardY + 14}" x2="${round(cutX)}" y2="${cardY + cardH - 12}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`;
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else if (act.kind === 'sign-extend') {
      // Negative signed number: highlight highest bit `1` and visually duplicate it into every upper byte
      const srcTopPos = fromBytes.length - 1;
      const srcX = slotX(srcTopPos);
      const signBitCx = srcX + NIBBLE_W / 2 - 1.5 * BIT_STEP;

      // Render source bytes; top source byte frames the sign bit `1`
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
          P.muted,
          isTopSrc ? { fill: P.writeFill, stroke: P.write, text: P.write } : undefined
        );
        if (animate && isTopSrc) {
          const cx = signBitCx;
          const cy = yBits - 6;
          out += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(0.1)}<g transform="translate(${round(-cx)} ${round(-cy)})">${col}</g></g></g>`;
        } else {
          out += col;
        }
      }

      // Extended upper bytes: filled by cloning the sign bit `1`
      for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
        const bx = slotX(lsbPos);
        const byteVal = toBytes[toBytes.length - 1 - lsbPos];
        const dstCx = bx + BYTE_W / 2;
        const k = lsbPos - fromBytes.length; // 0 = nearest extended byte, 1, 2...
        const arcDelay = 0.25 + k * 0.24;
        const fillDelay = 0.58 + k * 0.24;

        const extByte = drawLab3ByteColumn(bx, yBits, yHex, byteVal, P.write, P.write, P.write);
        if (signExtStyle === 'arcs') {
          const sy = yBits - 21;
          const apex = cardY + 9 + k * 2;
          const d = `M ${round(signBitCx)} ${sy} C ${round(signBitCx)} ${apex}, ${round(dstCx)} ${apex}, ${round(dstCx)} ${sy - 2}`;
          const arc = `<path d="${d}" fill="none" stroke="${P.write}" stroke-width="2" stroke-linecap="round"${animate ? ` data-grow="${round(arcDelay)}"` : ''}/>`;
          const head = arrowheadDown(dstCx, sy + 1, P.write);
          out += arc;
          out += animate ? `<g opacity="0">${show(fillDelay - 0.08)}${head}</g>` : head;
        } else {
          // Cascade: horizontal step chain cloning bit 1 byte-by-byte leftward
          const prevOriginX = k === 0 ? signBitCx : slotX(lsbPos - 1) + NIBBLE_W / 2 - 1.5 * BIT_STEP;
          const dstLeftBitX = bx + NIBBLE_W / 2 - 1.5 * BIT_STEP;
          const yTop = cardY + 18;
          const d = `M ${round(prevOriginX)} ${yBits - 21} L ${round(prevOriginX)} ${yTop} L ${round(dstLeftBitX)} ${yTop} L ${round(dstLeftBitX)} ${yBits - 23}`;
          const link = `<path d="${d}" fill="none" stroke="${P.write}" stroke-width="2" stroke-linejoin="round"${animate ? ` data-grow="${round(arcDelay)}"` : ''}/>`;
          const head = arrowheadDown(dstLeftBitX, yBits - 20, P.write);
          out += link;
          out += animate ? `<g opacity="0">${show(fillDelay - 0.08)}${head}</g>` : head;
        }

        if (animate) {
          out +=
            `<g opacity="0">${show(fillDelay)}` +
            `<g transform="translate(${round(dstCx)} ${round(yBits + 10)})"><g>${pulse(fillDelay)}<g transform="translate(${round(-dstCx)} ${round(-(yBits + 10))})">${extByte}</g></g></g>` +
            '</g>';
        } else {
          out += extByte;
        }
      }
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else if (act.kind === 'zero-extend') {
      // Positive / unsigned widening: simple, calm muted 0-fill (no cloning arcs)
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isExt = lsbPos >= fromBytes.length;
        const isSignedPosTop = act.fromInfo.signed && lsbPos === fromBytes.length - 1;
        const block = drawLab3ByteColumn(
          bx,
          yBits,
          yHex,
          toBytes[idx],
          isExt ? P.grey : P.fg,
          isExt ? P.grey : toCol,
          P.muted,
          isSignedPosTop ? { fill: P.panel, stroke: P.muted, text: P.fg } : undefined
        );
        if (animate && isExt) {
          out += `<g opacity="0">${fade(0, 0.72, 0.35, 0.3)}${block}</g>`;
        } else if (isExt) {
          out += `<g opacity="0.72">${block}</g>`;
        } else {
          out += block;
        }
      }
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
    } else {
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        out += drawLab3ByteColumn(slotX(lsbPos), yBits, yHex, toBytes[idx], P.fg, toCol, P.muted);
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
      const afterBlock = drawLab3ByteColumn(bx, yBits, yHex, afterBytes[idx], P.write, P.write, P.muted);
      if (animate) {
        out +=
          `<g>${hide(0.45)}${drawLab3ByteColumn(bx, yBits, yHex, beforeBytes[idx], P.fg, P.fg, P.muted)}</g>` +
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
      out += drawLab3ByteColumn(bx, yBits, yHex, bytes[idx], P.fg, col, P.muted);
    }
    out += text(rightAnchor + 22, yRes, `= ${act.value}`, 26, col);
  }
  return out;
}

// ============================================================================================
// Variant hooks & prototype page controller
// ============================================================================================

function hooksFor(variant: CastVariant): PlayerHooks {
  const memoryOpts: Record<CastVariant, MemoryStyle> = {
    A: { littleEndian: true, decimalBelow: false },
    B: { littleEndian: false, decimalBelow: false },
    C: { littleEndian: false, decimalBelow: true },
  };
  const geomOpts: Record<CastVariant, GeometryOptions> = {
    A: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 98, extraPaneHeight: 112, skipWrap: true },
    B: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 98, extraPaneHeight: 112, skipWrap: true },
    C: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 78, extraMemBottom: 34, extraPaneHeight: 112, skipWrap: true },
  };
  return {
    stackBelow: 900,
    maxScale: 0.78,
    geometry: (m: PreparedModel, P: Palette, stacked: boolean, width: number): Geometry =>
      geometry(m, P, stacked, width, geomOpts[variant]),
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
        memoryWithByteHex(c, memoryOpts[variant]) +
        pane(c, copying) +
        workbenchClean(c, variant === 'C' ? 'cascade' : 'arcs') +
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
    name: 'Little-endian byte hex + arc sign-clone',
    claim: 'Two-tier memory in true address order (LSB left at +0) paired with the clean binary/hex pane and sign-bit duplication arcs.',
    points: [
      'Memory shows overall decimal on top and consecutive address-ordered hex bytes (+0..+3) along the bottom.',
      'Pane keeps binary nibbles above hex digits with no caption clutter and no duplicate hex under the decimal result.',
      'Negative signed widening highlights the MSB `1` and clones it via warm arcs across upper bytes; positive/unsigned fills muted `0`s.',
    ],
  },
  B: {
    name: 'MSB-first byte hex + arc sign-clone',
    claim: 'Two-tier memory in reading order (matching the binary/hex workbench left-to-right), clean pane, and sign-bit duplication arcs.',
    points: [
      'Memory shows overall decimal on top and per-byte hex compartments underneath (`00 | 00 | 01 | 00`).',
      'Pane drops the tiny text and duplicate hex under `→ val`, keeping binary nibbles paired with hex digits directly below.',
      'Sign extension highlights the highest `1` bit and draws cloning arcs filling `1111 1111` (`F F`) across upper bytes; positive/unsigned quietly zero-fills.',
    ],
  },
  C: {
    name: 'Hex cells + cascade sign-clone',
    claim: 'Full-height byte-hex memory cells with `= decimal` below the variable name, plus stepped cascade cloning for sign extension.',
    points: [
      'Memory gives full box height to per-byte hex compartments and puts the overall `= decimal` cleanly under the variable name.',
      'Compare stepped byte-by-byte cascade cloning on negative sign extension against B’s curved arcs.',
      'Same clean binary/hex pane without caption text or duplicate hex under the decimal result.',
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
  const rawVar = (params.get('variant') || 'B').toUpperCase();
  const state: { variant: CastVariant } = {
    variant: rawVar === 'A' || rawVar === 'B' || rawVar === 'C' ? rawVar : 'B',
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
        `<details data-case="${i}"${i <= 1 || params.get('open') === 'all' ? ' open' : ''}>` +
        `<summary>Execution trace</summary><div class="slot"></div></details></section>`
    )
    .join('');

  function mount(): void {
    const savedIndices = new Map<number, number>();
    for (const details of sections.querySelectorAll<HTMLDetailsElement>('details')) {
      const idx = Number(details.dataset.case);
      const old = players[idx];
      if (old) {
        savedIndices.set(idx, old.index);
        old.disconnect();
      }
    }
    players.length = 0;

    for (const details of sections.querySelectorAll<HTMLDetailsElement>('details')) {
      const idx = Number(details.dataset.case);
      const slot = details.querySelector<HTMLElement>('.slot')!;
      slot.innerHTML = '<div class="course-visualization"></div>';
      const host = slot.firstElementChild as HTMLElement;
      const player = new Player(host, data[idx], hooksFor(state.variant));
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

    const url = new URL(location.href);
    url.searchParams.set('variant', state.variant);
    url.searchParams.set('theme', document.documentElement.dataset.theme || 'dark');
    history.replaceState(null, '', url);
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
    const keys: CastVariant[] = ['A', 'B', 'C'];
    state.variant = keys[(keys.indexOf(state.variant) + delta + keys.length) % keys.length];
    mount();
  };

  document.getElementById('prev')!.onclick = () => cycle(-1);
  document.getElementById('next')!.onclick = () => cycle(1);
  document.getElementById('theme')!.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    for (const p of players) p.refresh();
    const url = new URL(location.href);
    url.searchParams.set('theme', root.dataset.theme);
    history.replaceState(null, '', url);
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
