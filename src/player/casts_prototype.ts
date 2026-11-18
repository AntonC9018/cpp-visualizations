// PROTOTYPE, throwaway (casts and bit-level representation, #58).
// Derives directly from the base player (`Player`, `geometry`, `scene.ts`, `svg.ts`, `player.css`)
// to compare three structural and animation-granularity variants:
//   A: Byte-lane memory (address order, little-endian) + byte-level cast steps
//   B: Word-level memory (decimal + hex + byte ticks) + Lab-3 bit/hex workbench in pane
//   C: Bit-and-byte memory tape (reading order, MSB-first) + bit-by-bit sweep animation
import type { ExecutionTrace, TraceStep } from '../core/trace_format.ts';
import { CHAR, type Palette, themeName } from './constants.ts';
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
  valueBox,
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
  // Initial literal on declaration line
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

function castStepSeconds(variant: CastVariant) {
  return (steps: ExecutionTrace['steps'], i: number): number => {
    const step = steps[i];
    if (step.op?.kind === 'convert' || isBitwiseInvert(steps, i)) {
      return step.hold + (variant === 'C' ? 2.15 : 1.85);
    }
    return stepSeconds(steps, i);
  };
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
        `${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): sign-extend with 1s`
      );
    }
  }
  return describe(c);
}

// Shared helper to draw variable frame + address + name + type pill (reused by Variants A, B, C)
function drawCellChrome(
  c: SceneContext,
  cell: PlacedLeaf,
  on: boolean,
  showByteTicks: boolean,
  extraSubLabel: string | null,
  addressOrderSubTicks: boolean
): string {
  const { g, P } = c;
  const color = cell.fieldColor || cell.color;
  let markup = '';
  // Base address
  markup += text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
  // Optional consecutive byte addresses (+1, +2, +3) for address-order byte view
  if (addressOrderSubTicks && cell.size > 1) {
    const bw = cell.w / cell.size;
    for (let i = 1; i < cell.size; i++) {
      markup += text(cell.x + i * bw + 4, cell.y - 12, cell.address + i, 12, P.grey);
    }
  }
  // Background fill
  markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, 'none', 0);
  // Byte dividers inside the variable box
  if (cell.size > 1) {
    const bw = cell.w / cell.size;
    for (let i = 1; i < cell.size; i++) {
      const lx = round(cell.x + i * bw);
      if (showByteTicks) {
        markup +=
          `<line x1="${lx}" y1="${cell.y + 3}" x2="${lx}" y2="${cell.y + 9}" stroke="${P.deadStroke}" stroke-width="1.5"/>` +
          `<line x1="${lx}" y1="${cell.y + cell.h - 9}" x2="${lx}" y2="${cell.y + cell.h - 3}" stroke="${P.deadStroke}" stroke-width="1.5"/>`;
      } else {
        markup +=
          `<line x1="${lx}" y1="${cell.y + 3}" x2="${lx}" y2="${cell.y + cell.h - 3}" ` +
          `stroke="${on ? P.gapStroke : P.deadStroke}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
      }
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
  // Variable name below
  markup += text(
    cell.x + cell.w / 2,
    cell.y + cell.h + 34,
    cell.label,
    g.nameSize,
    on ? color : P.grey,
    'middle'
  );
  if (extraSubLabel !== null) {
    markup += text(
      cell.x + cell.w / 2,
      cell.y + cell.h + 56,
      extraSubLabel,
      14,
      on ? P.muted : P.grey,
      'middle'
    );
  }
  return markup;
}

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

// ============================================================================================
// VARIANT A: Byte-Lane Memory (Address Order / Little-Endian) + Byte-Step Conversion Strip
// ============================================================================================

function memoryVariantA(c: SceneContext): string {
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
    const decLabel = on && typeof shownVal === 'number' ? `= ${shownVal}` : on && shownVal === '?' ? '= ?' : '';

    let markup = drawCellChrome(c, cell, on, false, decLabel, true);
    if (on && cell.size > 1) {
      markup += text(cell.x + 6, cell.y + 13, 'LSB', 9, P.grey);
      markup += text(cell.x + cell.w - 6, cell.y + 13, 'MSB', 9, P.grey, 'end');
    }
    if (on) {
      const bw = cell.w / cell.size;
      const beforeBytes = typeof before === 'number' ? toBytesLSB(before, cell.size) : null;
      const afterBytes = typeof after === 'number' ? toBytesLSB(after, cell.size) : null;
      const shownBytes = typeof shownVal === 'number' ? toBytesLSB(shownVal, cell.size) : null;

      const renderByte = (b: number, bx: number): string => {
        const [hi, lo] = nibbles(b);
        return (
          text(bx + bw / 2, cell.y + 44, hexByte(b), 22, P.fg, 'middle') +
          text(bx + bw / 2, cell.y + 70, `${hi} ${lo}`, 9, b !== 0 ? color : P.muted, 'middle')
        );
      };

      for (let i = 0; i < cell.size; i++) {
        const bx = cell.x + i * bw;
        const cx = bx + bw / 2;
        const cy = cell.y + cell.h / 2;
        if (changing && afterBytes && (!beforeBytes || beforeBytes[i] !== afterBytes[i])) {
          markup += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.2)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
          if (beforeBytes) markup += `<g>${hide(at)}${renderByte(beforeBytes[i], bx)}</g>`;
          markup += `<g opacity="0">${show(at)}${renderByte(afterBytes[i], bx)}</g>`;
          markup += '</g></g></g>';
        } else if (shownBytes) {
          markup += renderByte(shownBytes[i], bx);
        } else {
          markup += text(cx, cell.y + 48, '?', 22, P.grey, 'middle');
        }
      }
    }
    out += dim(c, cell.group || cell.name, markup);
  }
  return out + drawTypeLabels(c, live);
}

function byteChip(
  x: number,
  y: number,
  w: number,
  h: number,
  byteVal: number,
  fill: string,
  stroke: string,
  textColor: string,
  bitColor: string
): string {
  const [hi, lo] = nibbles(byteVal);
  return (
    rect(x, y, w, h, fill, stroke, 6, 2) +
    text(x + w / 2, y + 18, hexByte(byteVal), 16, textColor, 'middle') +
    text(x + w / 2, y + 32, `${hi} ${lo}`, 8.5, bitColor, 'middle')
  );
}

function paneStripVariantA(c: SceneContext): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate } = c;
  const stripY = g.ty + 26;
  const chipW = 54;
  const chipH = 39;
  const gap = 7;
  const x0 = g.tx;
  let out = '';

  if (act.kind === 'narrow' || act.kind === 'zero-extend' || act.kind === 'sign-extend' || act.kind === 'reinterpret') {
    const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
    const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);

    if (act.kind === 'narrow') {
      const dropCount = fromBytes.length - toBytes.length;
      const cutX = x0 + dropCount * (chipW + gap) - gap / 2;
      for (let i = 0; i < fromBytes.length; i++) {
        const bx = x0 + i * (chipW + gap);
        const dropped = i < dropCount;
        if (dropped) {
          const settledDropped =
            `<g opacity="0.45">` +
            byteChip(bx, stripY + 10, chipW, chipH, fromBytes[i], P.panel, P.error, P.muted, P.muted) +
            `<line x1="${bx + 6}" y1="${stripY + 16}" x2="${bx + chipW - 6}" y2="${stripY + 10 + chipH - 6}" stroke="${P.error}" stroke-width="2"/>` +
            '</g>';
          if (animate) {
            const delay = 0.3 + i * 0.14;
            out +=
              `<g>${hide(delay)}${byteChip(bx, stripY, chipW, chipH, fromBytes[i], P.panel, fromCol, P.fg, P.muted)}</g>` +
              `<g opacity="0">${show(delay)}<animateTransform attributeName="transform" type="translate" from="0 -10" to="0 0" begin="${round(delay)}s" dur="0.35s" fill="freeze"/>${settledDropped}</g>`;
          } else {
            out += settledDropped;
          }
        } else {
          const kept = byteChip(bx, stripY, chipW, chipH, fromBytes[i], P.panel, toCol, P.fg, toCol);
          if (animate) {
            const cx = bx + chipW / 2;
            const cy = stripY + chipH / 2;
            out +=
              `<g>${hide(0.85)}${byteChip(bx, stripY, chipW, chipH, fromBytes[i], P.panel, fromCol, P.fg, P.muted)}</g>` +
              `<g opacity="0">${show(0.85)}<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(0.9)}<g transform="translate(${round(-cx)} ${round(-cy)})">${kept}</g></g></g></g>`;
          } else {
            out += kept;
          }
        }
      }
      out += `<line x1="${round(cutX)}" y1="${stripY - 4}" x2="${round(cutX)}" y2="${stripY + chipH + 10}" stroke="${P.error}" stroke-width="2" stroke-dasharray="4 3"/>`;
      const noteX = x0 + fromBytes.length * (chipW + gap) + 8;
      out += text(noteX, stripY + 17, `drop high ${dropCount}B`, 13, P.error);
      out += text(noteX, stripY + 35, `keep ${fullHex(act.afterVal, act.toInfo.bytes)} (${act.afterVal})`, 13, toCol);
    } else if (act.kind === 'zero-extend' || act.kind === 'sign-extend') {
      const extCount = toBytes.length - fromBytes.length;
      const extLabel = act.kind === 'sign-extend' ? 'sign-extend (1s)' : 'zero-extend (0s)';
      for (let i = 0; i < toBytes.length; i++) {
        const bx = x0 + i * (chipW + gap);
        const isExt = i < extCount;
        const chip = byteChip(
          bx,
          stripY,
          chipW,
          chipH,
          toBytes[i],
          P.panel,
          isExt ? P.write : toCol,
          P.fg,
          isExt ? P.write : toCol
        );
        if (animate && isExt) {
          const order = extCount - 1 - i; // right-to-left growth
          const delay = 0.35 + order * 0.22;
          out +=
            `<g opacity="0">${fade(0, 1, 0.28, delay)}` +
            `<animateTransform attributeName="transform" type="translate" from="14 0" to="0 0" begin="${round(delay)}s" dur="0.3s" fill="freeze"/>` +
            `${chip}</g>`;
        } else {
          out += chip;
        }
      }
      const noteX = x0 + toBytes.length * (chipW + gap) + 8;
      out += text(noteX, stripY + 17, extLabel, 13, P.write);
      out += text(noteX, stripY + 35, `${fullHex(act.afterVal, act.toInfo.bytes)} (${act.afterVal})`, 13, toCol);
    } else {
      for (let i = 0; i < toBytes.length; i++) {
        const bx = x0 + i * (chipW + gap);
        out += byteChip(bx, stripY, chipW, chipH, toBytes[i], P.panel, toCol, P.fg, toCol);
      }
      const noteX = x0 + toBytes.length * (chipW + gap) + 8;
      out += text(noteX, stripY + 26, `same bits → ${act.afterVal} (${act.toType})`, 13, toCol);
    }
    return out;
  }

  if (act.kind === 'invert') {
    const beforeBytes = toBytesMSB(act.beforeVal, act.info.bytes);
    const afterBytes = toBytesMSB(act.afterVal, act.info.bytes);
    const col = typeColour(c, act.type);
    for (let i = 0; i < afterBytes.length; i++) {
      const bx = x0 + i * (chipW + gap);
      const afterChip = byteChip(bx, stripY, chipW, chipH, afterBytes[i], P.panel, P.write, P.fg, P.write);
      if (animate) {
        const delay = 0.3 + i * 0.14;
        out +=
          `<g>${hide(delay)}${byteChip(bx, stripY, chipW, chipH, beforeBytes[i], P.panel, col, P.fg, P.muted)}</g>` +
          `<g opacity="0">${show(delay)}${afterChip}</g>`;
      } else {
        out += afterChip;
      }
    }
    const noteX = x0 + afterBytes.length * (chipW + gap) + 8;
    out += text(noteX, stripY + 26, `~ flips bytes → ${fullHex(act.afterVal, act.info.bytes)} (${act.afterVal})`, 13, P.write);
    return out;
  }

  if (act.kind === 'value') {
    const bytes = toBytesMSB(act.value, act.info.bytes);
    const col = typeColour(c, act.type);
    for (let i = 0; i < bytes.length; i++) {
      const bx = x0 + i * (chipW + gap);
      out += byteChip(bx, stripY, chipW, chipH, bytes[i], P.panel, col, P.fg, bytes[i] ? col : P.muted);
    }
    const noteX = x0 + bytes.length * (chipW + gap) + 8;
    out += text(noteX, stripY + 25, `${fullHex(act.value, act.info.bytes)} = ${act.value}`, 13, P.muted);
  }
  return out;
}

// ============================================================================================
// VARIANT B: Word-Level Memory + Lab-3 Two-Row Binary/Hex Workbench in Pane
// ============================================================================================

function memoryVariantB(c: SceneContext): string {
  const { g, P, step, prev, op } = c;
  const values = op && op.kind === 'write' && prev ? prev.values : step.values;
  const at = op ? arrival(op) : 0;
  const writing = new Set(op && op.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
  const live = (l: { name: string }): boolean => values[l.name] !== null || writing.has(l.name);
  let out = '';

  for (const cell of g.leaves) {
    const on = live(cell);
    const changing = writing.has(cell.name);
    let markup = drawCellChrome(c, cell, on, true, null, false);
    if (on) {
      const renderVal = (val: unknown): string => {
        if (typeof val !== 'number') {
          return text(0, 8, String(val), 26, val === '?' ? P.grey : P.fg, 'middle');
        }
        const dec = String(val);
        const decSize = Math.min(27, (cell.w - 10) / (dec.length * CHAR));
        const hex = fullHex(val, cell.size);
        const hexSize = Math.min(12.5, (cell.w - 8) / (hex.length * CHAR));
        return (
          text(0, 1, dec, round(decSize), P.fg, 'middle') +
          text(0, 23, hex, round(hexSize), P.muted, 'middle')
        );
      };
      markup +=
        `<g transform="translate(${round(cell.x + cell.w / 2)} ${round(cell.y + cell.h / 2)})"><g>` +
        (changing ? pulse(at - 0.2) : '');
      const before = prev ? prev.values[cell.name] : null;
      const after = step.values[cell.name];
      if (changing && before !== after) {
        if (before !== null) markup += `<g>${hide(at)}${renderVal(before)}</g>`;
        markup += `<g opacity="0">${show(at)}${renderVal(after)}</g>`;
      } else {
        markup += renderVal(changing ? after : values[cell.name]);
      }
      markup += '</g></g>';
    }
    out += dim(c, cell.group || cell.name, markup);
  }
  return out + drawTypeLabels(c, live);
}

// Lab 3 aligned binary-above-hex ruler, anchored on the right for consistent byte alignment
function drawLab3ByteColumn(
  x: number,
  yBits: number,
  yHex: number,
  byteVal: number,
  bitColor: string,
  hexColor: string,
  mutedColor: string
): string {
  const [hi, lo] = nibbles(byteVal);
  const hex = hexByte(byteVal);
  const nibbleW = 30;
  const nibGap = 6;
  const hiCx = x + nibbleW / 2;
  const loCx = x + nibbleW + nibGap + nibbleW / 2;
  return (
    text(hiCx, yBits, hi, 12.5, hi === '0000' ? mutedColor : bitColor, 'middle') +
    text(loCx, yBits, lo, 12.5, lo === '0000' ? mutedColor : bitColor, 'middle') +
    text(hiCx, yHex, hex[0], 13.5, hex[0] === '0' ? mutedColor : hexColor, 'middle') +
    text(loCx, yHex, hex[1], 13.5, hex[1] === '0' ? mutedColor : hexColor, 'middle')
  );
}

function workbenchVariantB(c: SceneContext): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate } = c;
  const cardX = g.tx - 4;
  const cardY = g.ty + 24;
  const cardW = g.pane.w - 40;
  const cardH = 82;
  const yBits = cardY + 28;
  const yHex = cardY + 50;
  const yCap = cardY + 71;
  const byteW = 66;
  const byteGap = 14;
  const rightAnchor = cardX + 12 + 4 * byteW + 3 * byteGap;
  const slotX = (bytesFromLSB: number): number =>
    rightAnchor - (bytesFromLSB + 1) * byteW - bytesFromLSB * byteGap;

  let out = rect(cardX, cardY, cardW, cardH, P.panel, P.gapStroke, 8, 1.5);

  if (act.kind === 'narrow' || act.kind === 'zero-extend' || act.kind === 'sign-extend' || act.kind === 'reinterpret') {
    const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
    const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);
    const maxBytes = Math.max(fromBytes.length, toBytes.length);

    if (act.kind === 'narrow') {
      const cutX = slotX(toBytes.length - 1) - byteGap / 2;
      for (let idx = 0; idx < fromBytes.length; idx++) {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const dropped = lsbPos >= toBytes.length;
        if (dropped) {
          const settled =
            `<g opacity="0.45">` +
            drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.error, P.error, P.error) +
            `<line x1="${bx + 4}" y1="${yBits - 14}" x2="${bx + byteW - 4}" y2="${yHex + 4}" stroke="${P.error}" stroke-width="1.5"/>` +
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
      out += `<line x1="${round(cutX)}" y1="${cardY + 8}" x2="${round(cutX)}" y2="${cardY + 58}" stroke="${P.error}" stroke-width="2" stroke-dasharray="4 3"/>`;
      out += text(cardX + 12, yCap, `dropped ${fromBytes.length - toBytes.length} high bytes`, 12, P.error);
      out += text(rightAnchor + 14, yBits + 6, `→ ${act.afterVal}`, 16, toCol);
      out += text(rightAnchor + 14, yHex + 4, fullHex(act.afterVal, act.toInfo.bytes), 12.5, P.muted);
    } else if (act.kind === 'zero-extend' || act.kind === 'sign-extend') {
      const extKind = act.kind === 'sign-extend' ? 'sign-extend (fill 1s from sign bit)' : 'zero-extend (fill 0s)';
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        const isExt = lsbPos >= fromBytes.length;
        const block = drawLab3ByteColumn(
          bx,
          yBits,
          yHex,
          toBytes[idx],
          isExt ? P.write : P.fg,
          isExt ? P.write : toCol,
          isExt ? P.write : P.muted
        );
        if (animate && isExt) {
          out += `<g opacity="0">${fade(0, 1, 0.35, 0.45)}${block}</g>`;
        } else {
          out += block;
        }
      }
      out += text(slotX(maxBytes - 1), yCap, extKind, 12, P.write);
      out += text(rightAnchor + 14, yBits + 6, `→ ${act.afterVal}`, 16, toCol);
      out += text(rightAnchor + 14, yHex + 4, fullHex(act.afterVal, act.toInfo.bytes), 12.5, P.muted);
    } else {
      for (let idx = 0; idx < toBytes.length; idx++) {
        const lsbPos = toBytes.length - 1 - idx;
        out += drawLab3ByteColumn(slotX(lsbPos), yBits, yHex, toBytes[idx], P.fg, toCol, P.muted);
      }
      out += text(slotX(toBytes.length - 1), yCap, `same bits interpreted as ${act.toType}`, 12, toCol);
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
    out += text(slotX(afterBytes.length - 1), yCap, `bitwise ~ flips every bit (0 ↔ 1)`, 12, P.write);
    out += text(rightAnchor + 14, yBits + 6, `→ ${act.afterVal}`, 16, P.write);
    out += text(rightAnchor + 14, yHex + 4, fullHex(act.afterVal, act.info.bytes), 12.5, P.muted);
    return out;
  }

  if (act.kind === 'value') {
    const bytes = toBytesMSB(act.value, act.info.bytes);
    const col = typeColour(c, act.type);
    for (let idx = 0; idx < bytes.length; idx++) {
      const bx = slotX(bytes.length - 1 - idx);
      out += drawLab3ByteColumn(bx, yBits, yHex, bytes[idx], P.fg, col, P.muted);
    }
    out += text(slotX(bytes.length - 1), yCap, `${act.type} (${act.info.bits} bits)`, 12, P.muted);
    out += text(rightAnchor + 14, yBits + 6, `= ${act.value}`, 16, col);
    out += text(rightAnchor + 14, yHex + 4, fullHex(act.value, act.info.bytes), 12.5, P.muted);
  }
  return out;
}

// ============================================================================================
// VARIANT C: Full Bit-and-Byte Memory Tape (MSB-first) + Bit-by-Bit Sweep Ribbon
// ============================================================================================

function memoryVariantC(c: SceneContext): string {
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
    const decLabel = on && typeof shownVal === 'number' ? `= ${shownVal}` : on && shownVal === '?' ? '= ?' : '';

    let markup = drawCellChrome(c, cell, on, false, decLabel, false);
    if (on) {
      const bw = cell.w / cell.size;
      const beforeBytes = typeof before === 'number' ? toBytesMSB(before, cell.size) : null;
      const afterBytes = typeof after === 'number' ? toBytesMSB(after, cell.size) : null;
      const shownBytes = typeof shownVal === 'number' ? toBytesMSB(shownVal, cell.size) : null;

      const renderByte = (b: number, bx: number, msbIndex: number): string => {
        const hiBit = (cell.size - msbIndex) * 8 - 1;
        const loBit = hiBit - 7;
        const [hi, lo] = nibbles(b);
        const hex = hexByte(b);
        const c1 = bx + bw * 0.27;
        const c2 = bx + bw * 0.73;
        return (
          text(bx + bw / 2, cell.y + 17, `${hiBit}..${loBit}`, 10, P.muted, 'middle') +
          text(c1, cell.y + 43, hi, 10.5, hi === '0000' ? P.muted : color, 'middle') +
          text(c2, cell.y + 43, lo, 10.5, lo === '0000' ? P.muted : color, 'middle') +
          text(c1, cell.y + 73, hex[0], 20, hex[0] === '0' ? P.muted : P.fg, 'middle') +
          text(c2, cell.y + 73, hex[1], 20, hex[1] === '0' ? P.muted : P.fg, 'middle')
        );
      };

      for (let i = 0; i < cell.size; i++) {
        const bx = cell.x + i * bw;
        const cx = bx + bw / 2;
        const cy = cell.y + cell.h / 2;
        if (changing && afterBytes && (!beforeBytes || beforeBytes[i] !== afterBytes[i])) {
          markup += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.2)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
          if (beforeBytes) markup += `<g>${hide(at)}${renderByte(beforeBytes[i], bx, i)}</g>`;
          markup += `<g opacity="0">${show(at)}${renderByte(afterBytes[i], bx, i)}</g>`;
          markup += '</g></g></g>';
        } else if (shownBytes) {
          markup += renderByte(shownBytes[i], bx, i);
        } else {
          markup += text(cx, cell.y + 52, '?', 24, P.grey, 'middle');
        }
      }
    }
    out += dim(c, cell.group || cell.name, markup);
  }
  return out + drawTypeLabels(c, live);
}

function bitPositions(x0: number, totalBits: number): number[] {
  const xs: number[] = [];
  let x = x0;
  for (let b = 0; b < totalBits; b++) {
    xs.push(x);
    x += 11;
    if ((b + 1) % 4 === 0 && b + 1 < totalBits) x += 5;
    if ((b + 1) % 8 === 0 && b + 1 < totalBits) x += 6;
  }
  return xs;
}

function toBitArrayMSB(value: number, bits: number): string[] {
  const u = BigInt.asUintN(bits, BigInt(value));
  const out: string[] = [];
  for (let i = bits - 1; i >= 0; i--) {
    out.push(((u >> BigInt(i)) & 1n) === 1n ? '1' : '0');
  }
  return out;
}

function bitSweepRibbonVariantC(c: SceneContext): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate } = c;
  const y = g.ty + 38;
  const yCap = y + 22;
  const x0 = g.tx;
  let out = '';

  if (act.kind === 'narrow' || act.kind === 'zero-extend' || act.kind === 'sign-extend' || act.kind === 'reinterpret') {
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);
    const maxBits = Math.max(act.fromInfo.bits, act.toInfo.bits);
    const xs = bitPositions(x0, maxBits);

    if (act.kind === 'narrow') {
      const fromBits = toBitArrayMSB(act.beforeVal, act.fromInfo.bits);
      const dropBits = act.fromInfo.bits - act.toInfo.bits;
      const cutX = (xs[dropBits - 1] + xs[dropBits]) / 2 + 1;
      for (let i = 0; i < fromBits.length; i++) {
        const bx = xs[i];
        const bit = fromBits[i];
        if (i < dropBits) {
          const dropped = text(bx, y, bit, 14, P.error, 'middle');
          if (animate) {
            const delay = 0.22 + i * 0.045;
            out +=
              `<g>${hide(delay)}${text(bx, y, bit, 14, bit === '1' ? fromCol : P.fg, 'middle')}</g>` +
              `<g opacity="0">${show(delay)}<animate attributeName="opacity" from="1" to="0.45" begin="${round(delay)}s" dur="0.25s" fill="freeze"/>${dropped}</g>`;
          } else {
            out += `<g opacity="0.45">${dropped}</g>`;
          }
        } else {
          out += text(bx, y, bit, 14, toCol, 'middle');
        }
      }
      const strikeDelay = round(0.22 + (dropBits - 1) * 0.045);
      const strike = `<line x1="${round(xs[0] - 5)}" y1="${y - 4}" x2="${round(xs[dropBits - 1] + 5)}" y2="${y - 4}" stroke="${P.error}" stroke-width="1.5"/>`;
      out += animate ? `<g opacity="0">${fade(0, 0.75, 0.2, strikeDelay)}${strike}</g>` : `<g opacity="0.75">${strike}</g>`;
      out += `<line x1="${round(cutX)}" y1="${y - 16}" x2="${round(cutX)}" y2="${y + 6}" stroke="${P.error}" stroke-width="2" stroke-dasharray="3 3"/>`;
      out += text(xs[xs.length - 1] + 18, y, `→ ${fullHex(act.afterVal, act.toInfo.bytes)} (${act.afterVal})`, 13, toCol);
      out += text(x0 - 4, yCap, `drop bits ${act.fromInfo.bits - 1}..${act.toInfo.bits}; keep bits ${act.toInfo.bits - 1}..0`, 12, P.error);
    } else if (act.kind === 'zero-extend' || act.kind === 'sign-extend') {
      const toBits = toBitArrayMSB(act.afterVal, act.toInfo.bits);
      const extBits = act.toInfo.bits - act.fromInfo.bits;
      for (let i = 0; i < toBits.length; i++) {
        const bx = xs[i];
        const bit = toBits[i];
        const isExt = i < extBits;
        const mark = text(bx, y, bit, 14, isExt ? P.write : toCol, 'middle');
        if (animate && isExt) {
          const order = extBits - 1 - i; // sweeps leftward from bit 8 to bit 31
          const delay = 0.35 + order * 0.045;
          out += `<g opacity="0">${fade(0, 1, 0.12, delay)}${mark}</g>`;
        } else {
          out += mark;
        }
      }
      out += text(
        xs[xs.length - 1] + 18,
        y,
        `→ ${fullHex(act.afterVal, act.toInfo.bytes)} (${act.afterVal})`,
        13,
        toCol
      );
      out += text(
        x0 - 4,
        yCap,
        act.kind === 'sign-extend'
          ? `sign-extend: fill bits ${act.toInfo.bits - 1}..${act.fromInfo.bits} with sign bit 1`
          : `zero-extend: fill bits ${act.toInfo.bits - 1}..${act.fromInfo.bits} with 0`,
        12,
        P.write
      );
    } else {
      const bits = toBitArrayMSB(act.afterVal, act.toInfo.bits);
      for (let i = 0; i < bits.length; i++) {
        out += text(xs[i], y, bits[i], 14, toCol, 'middle');
      }
      out += text(xs[xs.length - 1] + 18, y, `→ ${act.afterVal} (${act.toType})`, 13, toCol);
      out += text(x0 - 4, yCap, `same ${act.toInfo.bits} bits reinterpreted as ${act.toType}`, 12, toCol);
    }
    return out;
  }

  if (act.kind === 'invert') {
    const beforeBits = toBitArrayMSB(act.beforeVal, act.info.bits);
    const afterBits = toBitArrayMSB(act.afterVal, act.info.bits);
    const xs = bitPositions(x0, afterBits.length);
    for (let i = 0; i < afterBits.length; i++) {
      const bx = xs[i];
      if (animate) {
        const delay = 0.2 + i * 0.03;
        out +=
          `<g>${hide(delay)}${text(bx, y, beforeBits[i], 14, P.fg, 'middle')}</g>` +
          `<g opacity="0">${show(delay)}${text(bx, y, afterBits[i], 14, P.write, 'middle')}</g>`;
      } else {
        out += text(bx, y, afterBits[i], 14, P.write, 'middle');
      }
    }
    out += text(xs[xs.length - 1] + 18, y, `→ ${fullHex(act.afterVal, act.info.bytes)} (${act.afterVal})`, 13, P.write);
    out += text(x0 - 4, yCap, `bitwise ~ flips every bit across ${act.info.bits} bits`, 12, P.write);
    return out;
  }

  if (act.kind === 'value') {
    const bits = toBitArrayMSB(act.value, act.info.bits);
    const xs = bitPositions(x0, bits.length);
    const col = typeColour(c, act.type);
    for (let i = 0; i < bits.length; i++) {
      out += text(xs[i], y, bits[i], 14, bits[i] === '1' ? col : P.muted, 'middle');
    }
    out += text(xs[xs.length - 1] + 18, y, `${fullHex(act.value, act.info.bytes)} = ${act.value}`, 13, P.muted);
    out += text(x0 - 4, yCap, `${act.type} (${act.info.bits} bits, MSB left → LSB right)`, 12, P.muted);
  }
  return out;
}

// ============================================================================================
// Variant hooks & prototype page controller
// ============================================================================================

function hooksFor(variant: CastVariant): PlayerHooks {
  const geomOpts: Record<CastVariant, GeometryOptions> = {
    A: { minByteWidth: 68, minColumnWidth: 500, cellHeight: 86, extraMemBottom: 28, extraPaneHeight: 68, skipWrap: true },
    B: { minByteWidth: 48, minColumnWidth: 530, cellHeight: 76, extraPaneHeight: 98, skipWrap: true },
    C: { minByteWidth: 78, minColumnWidth: 550, cellHeight: 96, extraMemBottom: 28, extraPaneHeight: 64, skipWrap: true },
  };
  return {
    geometry: (m: PreparedModel, P: Palette, stacked: boolean, width: number): Geometry =>
      geometry(m, P, stacked, width, geomOpts[variant]),
    stepSeconds: castStepSeconds(variant),
    describe: castDescribe,
    scene: (c: SceneContext): string => {
      const { step, prev, animate } = c;
      const lineChanged = animate && prev !== null && prev.line !== step.line;
      const copying = animate && copies(c.m.steps, c.index);
      const oldLine = lineChanged && prev ? prev.line : null;
      const mem =
        variant === 'A'
          ? memoryVariantA(c)
          : variant === 'B'
            ? memoryVariantB(c)
            : memoryVariantC(c);
      const paneExtra =
        variant === 'A'
          ? paneStripVariantA(c)
          : variant === 'B'
            ? workbenchVariantB(c)
            : bitSweepRibbonVariantC(c);
      return (
        code(c, oldLine) +
        tether(c, oldLine) +
        arrows(c) +
        mem +
        pane(c, copying) +
        paneExtra +
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
    name: 'Byte lanes + byte-level casts',
    claim: 'Memory splits into 1-byte cells in address order (little-endian: LSB at +0); conversions drop or slide whole bytes.',
    points: [
      'Each byte cell shows 2-digit hex prominently with its 8 bits below, and a decimal summary (= 256) under the variable name.',
      'True address order (72..75 = 00 01 00 00) shows why b (at 71) reads the +0 byte directly.',
      'Pane strip steps at byte granularity: narrowing drops the 3 high bytes; widening slides in 3 zero/sign bytes.',
    ],
  },
  B: {
    name: 'Word memory + Lab-3 bit/hex workbench',
    claim: 'Memory stays at word level (decimal + hex + byte boundary ticks); the pane opens Lab 3’s aligned binary-above-hex ruler.',
    points: [
      'Matches the rest of the course’s player in memory (256, 0, -3) while keeping byte widths visible via tick marks.',
      'Pane workbench matches 03_numeric_conversions.md verbatim: 4-bit nibbles above each hex digit, wider gaps between bytes.',
      'Animations act on word/byte blocks: a red cut bar drops the upper 24 bits on narrowing, or expands 24 extension bits on widening.',
    ],
  },
  C: {
    name: 'Bit-and-byte tape + bit-by-bit sweep',
    claim: 'Memory renders every byte in reading order (MSB left, LSB right) with bits above hex; casts sweep across individual bits.',
    points: [
      'No little-endian mental flip needed in Lab 3: 256 reads left-to-right as 00 00 01 00 = 0x00000100 with bit 8 lit.',
      'Each byte cell stacks its two 4-bit nibbles directly over its two hex digits.',
      'Conversions animate bit-by-bit: bits 31→8 sweep out on narrowing, or extension bits 8→31 ripple in sequentially on widening.',
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
        `<details data-case="${i}"${i === 0 || params.get('open') === 'all' ? ' open' : ''}>` +
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
