// PROTOTYPE, throwaway (casts and bit-level representation, #58).
// Derives directly from the base player (`Player`, `geometry`, `scene.ts`, `svg.ts`, `player.css`).
//   - Memory: overall decimal on top, neutral per-byte hex below, byte order from the player's
//     Little-endian / Big-endian switch, with a significance arrow under multi-byte cells.
//   - Execution pane: bits above hex, MSB left, in a card that hugs the numbers.
//     Signed widening lights the sign bit and carries it along flat nested arcs into the new
//     bytes; unsigned widening fades in grey zeros.
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
      const arrowCol = on ? P.grey : P.deadStroke;
      markup +=
        `<g opacity="${on ? '0.75' : '0.5'}">` +
        `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M -8 -4 L 0 0 L -8 4 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${littleEndian ? 0 : 180})"/>` +
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
// EXECUTION PANE: Lab-3 workbench (bits above hex, MSB left)
// ============================================================================================

const BIT_FONT = 22;
const HEX_FONT = 21;
const RESULT_FONT = 24;
const BIT_STEP = BIT_FONT * CHAR;
const NIBBLE_W = 4 * BIT_STEP;
const NIB_GAP = 8;
const BYTE_W = 2 * NIBBLE_W + NIB_GAP;
const BYTE_GAP = 26;
const CARD_PAD = 12;

interface ByteInk {
  bits: string;
  hex: string;
  /** Colour of the most significant bit when it differs from `bits`. */
  msb?: string;
}

/** Centre of bit `i` (0 = most significant) of the byte drawn at `x`. */
const bitCx = (x: number, i: number): number =>
  x + (i < 4 ? 0 : NIBBLE_W + NIB_GAP) + ((i % 4) + 0.5) * BIT_STEP;

function drawByte(x: number, yBits: number, yHex: number, byte: number, ink: ByteInk): string {
  const bits = byte.toString(2).padStart(8, '0');
  const hex = hexByte(byte);
  let out = '';
  for (let i = 0; i < 8; i++) {
    const color = i === 0 && ink.msb ? ink.msb : ink.bits;
    out += text(bitCx(x, i), yBits, bits[i], BIT_FONT, color, 'middle');
  }
  out += text(x + NIBBLE_W / 2, yHex, hex[0], HEX_FONT, ink.hex, 'middle');
  out += text(x + NIBBLE_W + NIB_GAP + NIBBLE_W / 2, yHex, hex[1], HEX_FONT, ink.hex, 'middle');
  return out;
}

const BOX_TOP = BIT_FONT * 0.78 + 4;

/** Frame around the sign bit of the byte drawn at `x`. */
function signFrame(x: number, yBits: number, stroke: string, fill = 'none'): string {
  return rect(bitCx(x, 0) - BIT_STEP / 2 - 3, yBits - BOX_TOP, BIT_STEP + 6, BOX_TOP + 6, fill, stroke, 4, 1.8);
}

/** Triangle arrowhead whose tip sits at (tipX, tipY), rotated to match direction (dx, dy). */
function arrowheadAt(tipX: number, tipY: number, dx: number, dy: number, color: string): string {
  const deg = round((Math.atan2(dy, dx) * 180) / Math.PI);
  return `<path d="M -10 -5 L 0 0 L -10 5 Z" fill="${color}" transform="translate(${round(tipX)} ${round(tipY)}) rotate(${deg})"/>`;
}

const scaled = (cx: number, cy: number, inner: string, begin: number): string =>
  `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}` +
  `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`;

function workbenchClean(c: SceneContext): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate, op } = c;
  // Bytes sit in fixed right-aligned slots; the card hugs the bytes and the result beside them.
  // The space above the card is left for the sign-extension arcs.
  const cardTop = g.ty + 56;
  const yBits = cardTop + CARD_PAD + BOX_TOP;
  const yHex = yBits + 34;
  const yRes = yBits + 16;
  const cardBottom = yHex + CARD_PAD;
  const rightAnchor = g.tx + 12 + 4 * BYTE_W + 3 * BYTE_GAP;
  const slotX = (bytesFromLSB: number): number =>
    rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;
  const card = (bytes: number, resultLabel: string): string => {
    const left = slotX(bytes - 1) - CARD_PAD - 4;
    const right = rightAnchor + 20 + resultLabel.length * RESULT_FONT * CHAR + CARD_PAD + 4;
    return rect(left, cardTop, right - left, cardBottom - cardTop, P.panel, P.gapStroke, 8, 1.5);
  };

  const reveal = (at: number, markup: string): string =>
    animate && at > 0 ? `<g opacity="0">${fade(0, 1, 0.22, at)}${markup}</g>` : markup;
  const swap = (at: number, before: string, after: string): string =>
    animate ? `<g>${hide(at)}${before}</g><g opacity="0">${show(at)}${after}</g>` : after;
  const result = (at: number, label: string, color: string): string =>
    reveal(at, text(rightAnchor + 20, yRes, label, RESULT_FONT, color));
  /** Bytes of `value` (MSB first) laid out right-aligned. */
  const plainValue = (value: number, info: IntTypeInfo, hexInk: string): string => {
    const bytes = toBytesMSB(value, info.bytes);
    let out = '';
    bytes.forEach((b, idx) => {
      out += drawByte(slotX(bytes.length - 1 - idx), yBits, yHex, b, { bits: P.fg, hex: hexInk });
    });
    return out;
  };

  if (act.kind === 'value') {
    const col = typeColour(c, act.type);
    // Do not show the value in the execution pane before it has traveled there.
    let appearAt = 0;
    if (animate && copies(c.m.steps, c.index)) {
      appearAt = copyBegin(c.m.steps, c.index) + T.copyTravel;
    } else if (animate && op?.kind === 'read') {
      appearAt = arrival(op);
    }
    const label = `= ${act.value}`;
    return reveal(
      appearAt,
      card(act.info.bytes, label) + plainValue(act.value, act.info, col) + text(rightAnchor + 20, yRes, label, RESULT_FONT, col)
    );
  }

  if (act.kind === 'invert') {
    const at = op ? arrival(op) : T.evaluate;
    const after = toBytesMSB(act.afterVal, act.info.bytes);
    let inverted = '';
    after.forEach((b, idx) => {
      inverted += drawByte(slotX(after.length - 1 - idx), yBits, yHex, b, { bits: P.write, hex: P.write });
    });
    const label = `→ ${act.afterVal}`;
    return card(act.info.bytes, label) + swap(at, plainValue(act.beforeVal, act.info, P.fg), inverted) + result(at + 0.18, label, P.write);
  }

  const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
  const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
  const fromCol = typeColour(c, act.fromType);
  const toCol = typeColour(c, act.toType);
  const at = op ? arrival(op) : T.evaluate;
  const label = `→ ${act.afterVal}`;
  let out = card(Math.max(fromBytes.length, toBytes.length), label);

  if (act.kind === 'narrow') {
    // The high bytes are struck out and dropped; what stays is reread as the new type.
    const keep = toBytes.length;
    fromBytes.forEach((b, idx) => {
      const lsbPos = fromBytes.length - 1 - idx;
      const bx = slotX(lsbPos);
      if (lsbPos < keep) {
        out += drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
        return;
      }
      const dropped =
        `<g opacity="0.48">` +
        drawByte(bx, yBits, yHex, b, { bits: P.error, hex: P.error }) +
        `<line x1="${round(bx + 4)}" y1="${round(yBits - 20)}" x2="${round(bx + BYTE_W - 4)}" y2="${round(yHex + 6)}" stroke="${P.error}" stroke-width="2"/>` +
        '</g>';
      out += animate
        ? `<g>${hide(at)}${drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: fromCol })}</g>` +
          `<g opacity="0">${show(at)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="${round(at)}s" dur="0.32s" fill="freeze"/>${dropped}</g>`
        : dropped;
    });
    const cutX = slotX(keep - 1) - BYTE_GAP / 2;
    out += reveal(
      at - 0.15,
      `<line x1="${round(cutX)}" y1="${cardTop + 6}" x2="${round(cutX)}" y2="${cardBottom - 6}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`
    );
    return out + result(at + 0.34, label, toCol);
  }

  if (act.kind === 'zero-extend') {
    // Unsigned source: no sign bit to copy, so the new bytes are quiet zeros.
    toBytes.forEach((b, idx) => {
      const lsbPos = toBytes.length - 1 - idx;
      const isExt = lsbPos >= fromBytes.length;
      const block = drawByte(slotX(lsbPos), yBits, yHex, b, {
        bits: isExt ? P.grey : P.fg,
        hex: isExt ? P.grey : toCol,
      });
      if (!isExt) out += block;
      else if (animate) out += `<g opacity="0">${fade(0, 0.72, 0.35, at)}${block}</g>`;
      else out += `<g opacity="0.72">${block}</g>`;
    });
    return out + result(at + 0.35, label, toCol);
  }

  if (act.kind === 'sign-extend') {
    // Signed source: the sign bit lights up and rides nested arcs into every new byte.
    // The arcs fade once the copies land; the colour stays.
    const ext = act.signBit === 1 ? { stroke: P.write, fill: P.writeFill } : { stroke: P.read, fill: P.readFill };
    const srcX = slotX(fromBytes.length - 1);
    const msbX = bitCx(srcX, 0);
    const litAt = Math.max(0.2, at - 0.25);

    fromBytes.forEach((b, idx) => {
      const lsbPos = fromBytes.length - 1 - idx;
      const bx = slotX(lsbPos);
      if (lsbPos !== fromBytes.length - 1) {
        out += drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
        return;
      }
      const lit =
        signFrame(bx, yBits, ext.stroke, ext.fill) + drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol, msb: ext.stroke });
      const plain = drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
      out += animate ? swap(litAt, plain, scaled(msbX, yBits - 8, lit, litAt)) : lit;
    });

    const stagger = 0.2;
    const travel = 0.55;
    const extCount = toBytes.length - fromBytes.length;
    const doneAt = at + (extCount - 1) * stagger + travel;
    const startY = yBits - BOX_TOP - 2;
    let arcs = '';
    for (let k = 0; k < extCount; k++) {
      const lsbPos = fromBytes.length + k;
      const bx = slotX(lsbPos);
      const copy = drawByte(bx, yBits, yHex, toBytes[toBytes.length - 1 - lsbPos], { bits: ext.stroke, hex: ext.stroke });
      if (!animate) {
        out += copy;
        continue;
      }
      const begin = at + k * stagger;
      const land = begin + travel;
      const tipX = bx + BYTE_W / 2;
      const tipY = yBits - BIT_FONT - 2;
      // Flat nested parabolas: the farther the byte, the higher the arc, so they never cross.
      const peakY = startY - 16 - k * 9;
      const ctrlX = (msbX + tipX) / 2;
      const ctrlY = 2 * peakY - (startY + tipY) / 2;
      const dx = tipX - ctrlX;
      const dy = tipY - ctrlY;
      const len = Math.hypot(dx, dy) || 1;
      const ex = tipX - (7 * dx) / len;
      const ey = tipY - (7 * dy) / len;
      const path = (x: number, y: number): string =>
        `M ${round(msbX)} ${round(startY)} Q ${round(ctrlX)} ${round(ctrlY)}, ${round(x)} ${round(y)}`;
      arcs += `<path d="${path(ex, ey)}" fill="none" stroke="${ext.stroke}" stroke-width="2.2" stroke-linecap="round" data-grow="${round(begin)}"/>`;
      arcs += `<g opacity="0">${show(land - 0.06)}${arrowheadAt(tipX, tipY, dx, dy, ext.stroke)}</g>`;
      arcs +=
        `<g opacity="0">${show(begin)}${hide(land + 0.04)}` +
        `<circle r="10" fill="${ext.fill}" stroke="${ext.stroke}" stroke-width="1.6"/>` +
        text(0, 5, String(act.signBit), 15, ext.stroke, 'middle') +
        `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path(tipX, tipY)}" keyPoints="0;1" ${EASE} fill="freeze"/>` +
        '</g>';
      out += `<g opacity="0">${show(land)}${scaled(tipX, yBits, copy, land)}</g>`;
    }
    if (arcs) out += `<g>${fade(1, 0, 0.32, doneAt + 0.35)}${arcs}</g>`;
    return out + result(doneAt, label, toCol);
  }

  // Reinterpret (same width): the bits stay, only the type reading them changes.
  out += swap(at, plainValue(act.beforeVal, act.fromInfo, fromCol), plainValue(act.afterVal, act.toInfo, toCol));
  return out + result(at + 0.12, label, toCol);
}

// ============================================================================================
// Player hooks & prototype page controller
// ============================================================================================

function hooksFor(
  littleEndian: boolean,
  onEndianChange?: (le: boolean) => void
): PlayerHooks {
  const geomOpts: GeometryOptions = {
    minByteWidth: 66,
    minColumnWidth: 680,
    cellHeight: 88,
    extraPaneHeight: 120,
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
        workbenchClean(c) +
        output(c) +
        transfers(c)
      );
    },
  };
}

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
  const state = { littleEndian: params.get('endian') !== 'be' };
  document.documentElement.dataset.theme = params.get('theme') || 'dark';

  const sections = document.getElementById('sections')!;
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
        hooksFor(le, nextLe => {
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
      (host as HTMLElement & { cvPlayer?: Player }).cvPlayer = player;
    }

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

  document.getElementById('theme')!.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    for (const p of players) p.refresh();
    syncUrl();
  };

  mount();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
