// The bits view (`bits` traces): integers drawn as their bytes and bits.
//
// Memory shows each variable's value above its bytes in hex, in the byte order the player's
// Little-endian / Big-endian switch picks, with an arrow from the least to the most significant
// byte. The pane adds a workbench under the expression: the value's bits above their hex, most
// significant bit left. Narrowing strikes out the dropped bytes; widening a signed value carries
// its sign bit along arcs into the new bytes, and widening an unsigned one fades in zeros.
import { type ByteValue, type DecodedBytes, encodeBytes, hexByte, toBytesMSB } from '../core/bytes.ts';
import { type ExecutionTrace, convertOperand } from '../core/trace_format.ts';
import { type Integer, integerLiteral, integerSpelled } from '../core/integers.ts';
import {
  BYTE_CELL_HEIGHT,
  type ByteCellState,
  type ByteVariableState,
  hatchDefs,
  renderByteMemory,
  scaledAt,
} from './byte_memory.ts';
import { CHAR, EASE, T } from './constants.ts';
import { type PreparedModel, arrival, copies, copyBegin, stepSeconds } from './model.ts';
import {
  type SceneContext,
  arrows,
  code,
  output,
  pane,
  tether,
  transfers,
  typeColour,
} from './scene.ts';
import { fade, hide, rect, round, show, text } from './svg.ts';
import type { TraceView } from './views.ts';

/** The integer type of a spelling; a valid bits trace types every part with an integer. */
function integerOf(m: PreparedModel, spelling: string | undefined): Integer {
  return integerSpelled(spelling ?? 'int', m.trace.integers) ?? integerSpelled('int')!;
}

type BitAction =
  | {
      kind: 'narrow' | 'zero-extend' | 'sign-extend' | 'reinterpret';
      signBit?: 0 | 1;
      fromType: string;
      toType: string;
      fromInfo: Integer;
      toInfo: Integer;
      beforeVal: bigint;
      afterVal: bigint;
    }
  | {
      kind: 'invert';
      type: string;
      info: Integer;
      beforeVal: bigint;
      afterVal: bigint;
    }
  | {
      kind: 'value';
      type: string;
      info: Integer;
      value: bigint;
    };

type Step = ExecutionTrace['steps'][number];

/** The operand of a `~` the step evaluates, if it is one. */
function invertedOperand(prev: Step | null, step: Step): bigint | null {
  if (step.op?.kind !== 'eval' || !prev) return null;
  const operand = prev.pane.slice(...step.op.span).match(/^\s*~(.*)$/)?.[1];
  return operand === undefined ? null : integerLiteral(operand);
}

/** Sign-bit copies a convert makes: one per byte a signed value widens into. */
function signCopies(m: PreparedModel, step: Step): number {
  const { op } = step;
  if (op?.kind !== 'convert') return 0;
  const from = integerOf(m, op.from);
  return from.signed ? Math.max(0, integerOf(m, op.to).size - from.size) : 0;
}

function activeBitAction(c: SceneContext): BitAction | null {
  const { step, prev, m } = c;
  const op = step.op;
  if (op?.kind === 'convert') {
    const beforeVal = prev ? convertOperand(prev, op) : null;
    const afterVal = integerLiteral(op.value);
    if (beforeVal === null || afterVal === null) return null;
    const fromInfo = integerOf(m, op.from);
    const toInfo = integerOf(m, op.to);
    let kind: 'narrow' | 'zero-extend' | 'sign-extend' | 'reinterpret' = 'reinterpret';
    let signBit: 0 | 1 | undefined;
    if (toInfo.size < fromInfo.size) {
      kind = 'narrow';
    } else if (toInfo.size > fromInfo.size) {
      if (fromInfo.signed) {
        kind = 'sign-extend';
        signBit = fromInfo.wrap(beforeVal) < 0n ? 1 : 0;
      } else {
        kind = 'zero-extend';
      }
    }
    return { kind, signBit, fromType: op.from, toType: op.to, fromInfo, toInfo, beforeVal, afterVal };
  }
  if (op?.kind === 'eval' || op?.kind === 'print') {
    const value = integerLiteral(op.value);
    const type = step.types?.find(t => !t.slot && t.span[0] === op.span[0])?.type;
    if (value === null || !type) return null;
    const beforeVal = invertedOperand(prev, step);
    if (beforeVal !== null) {
      return { kind: 'invert', type, info: integerOf(m, type), beforeVal, afterVal: value };
    }
    return { kind: 'value', type, info: integerOf(m, type), value };
  }
  if (op && (op.kind === 'read' || op.kind === 'write')) {
    const value = integerLiteral(op.value);
    if (value === null) return null;
    const type = m.leaves.find(l => l.name === op.name)?.type ?? 'int';
    return { kind: 'value', type, info: integerOf(m, type), value };
  }
  // A statement with a single literal shows it before anything happens to it.
  const literals = op === null ? (step.types ?? []).filter(t => !t.slot) : [];
  if (literals.length === 1) {
    const value = integerLiteral(step.pane.slice(...literals[0].span));
    if (value !== null) {
      const { type } = literals[0];
      return { kind: 'value', type, info: integerOf(m, type), value };
    }
  }
  return null;
}

const STAGGER = 0.2;
const TRAVEL = 0.55;
/** Seconds from the start of the sign copies until their arcs have faded. */
const signSeconds = (copies: number): number => (copies - 1) * STAGGER + TRAVEL + 0.7;

function bitStepSeconds(m: PreparedModel, i: number): number {
  const { steps } = m;
  const step = steps[i];
  if (step.op?.kind === 'convert' || invertedOperand(steps[i - 1] ?? null, step) !== null) {
    const copies = signCopies(m, step);
    const signDone = copies > 0 ? arrival(step.op!) + signSeconds(copies) : 0;
    return step.hold + Math.max(2.1, signDone);
  }
  return stepSeconds(steps, i);
}

// ============================================================================================
// MEMORY: shared byte-accurate hex strip, in the chosen byte order
// ============================================================================================

function headerFor(val: unknown): DecodedBytes | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return { text: String(val), poisoned: false, numeric: val };
  return { text: String(val), poisoned: false, numeric: null };
}

function bytesFor(val: unknown, size: number, littleEndian: boolean): ByteValue[] {
  if (val === null || val === undefined) return Array.from({ length: size }, () => null);
  if (typeof val === 'number') return encodeBytes(BigInt(val), size, littleEndian);
  return Array.from({ length: size }, () => '?');
}

function memory(c: SceneContext, padId: string, ubId: string): string {
  const { g, step, prev, op, littleEndian } = c;
  const writing = new Set(op && op.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
  return renderByteMemory(c, {
    padId,
    ubId,
    stateOf(leaf): ByteVariableState {
      const before = prev ? prev.values[leaf.name] : null;
      const after = step.values[leaf.name];
      const beforeBytes = bytesFor(before, leaf.size, littleEndian);
      const afterBytes = bytesFor(after, leaf.size, littleEndian);
      const bytes: ByteCellState[] = afterBytes.map((b, k) => ({
        before: beforeBytes[k],
        after: b,
      }));
      return {
        beforeHeader: headerFor(before),
        afterHeader: headerFor(after),
        bytes,
        headerChanging: writing.has(leaf.name) && before !== after,
      };
    },
  });
}

// ============================================================================================
// PANE: the workbench, bits above hex, most significant bit left
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

/** Each farther sign-bit arc peaks this much higher than the one before. */
const ARC_RISE = 9;
/** Arcs that fit between the expression and the card without moving it. */
const ROOMY_ARCS = 3;

/** What the workbench must hold for a trace: its widest integer, longest result, most arcs. */
interface WorkbenchExtent {
  bytes: number;
  labelChars: number;
  /** How far the card moves down so the tallest arc stays under the expression. */
  drop: number;
}

const extents = new WeakMap<PreparedModel, WorkbenchExtent>();

function workbenchExtent(m: PreparedModel): WorkbenchExtent {
  let extent = extents.get(m);
  if (extent) return extent;
  const sizes = m.leaves.map(l => l.size);
  let labelChars = 0;
  let arcs = 0;
  for (const step of m.steps) {
    arcs = Math.max(arcs, signCopies(m, step));
    for (const part of step.types ?? []) sizes.push(integerOf(m, part.type).size);
    const { op } = step;
    if (op?.kind === 'convert') sizes.push(integerOf(m, op.from).size, integerOf(m, op.to).size);
    if (op && 'value' in op) labelChars = Math.max(labelChars, op.value.length + 2);
  }
  extent = { bytes: Math.max(1, ...sizes), labelChars, drop: Math.max(0, arcs - ROOMY_ARCS) * ARC_RISE };
  extents.set(m, extent);
  return extent;
}

/** Width of `bytes` byte slots side by side. */
const slotsWidth = (bytes: number): number => bytes * BYTE_W + (bytes - 1) * BYTE_GAP;
const RESULT_GAP = 20;
const labelWidth = (label: string | number): number =>
  (typeof label === 'number' ? label : label.length) * RESULT_FONT * CHAR;

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
  let out = `<g class="cv-bit-byte" data-bits="${bits}">`;
  for (let i = 0; i < 8; i++) {
    const color = i === 0 && ink.msb ? ink.msb : ink.bits;
    out += text(bitCx(x, i), yBits, bits[i], BIT_FONT, color, 'middle');
  }
  out += text(x + NIBBLE_W / 2, yHex, hex[0], HEX_FONT, ink.hex, 'middle');
  out += text(x + NIBBLE_W + NIB_GAP + NIBBLE_W / 2, yHex, hex[1], HEX_FONT, ink.hex, 'middle');
  return out + '</g>';
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

function workbench(c: SceneContext): string {
  const act = activeBitAction(c);
  if (!act) return '';
  const { g, P, animate, op } = c;
  // Bytes sit in fixed right-aligned slots; the card hugs the bytes and the result beside them.
  // The space above the card is left for the sign-extension arcs.
  const cardTop = g.ty + 56 + workbenchExtent(c.m).drop;
  const yBits = cardTop + CARD_PAD + BOX_TOP;
  const yHex = yBits + 34;
  const yRes = yBits + 16;
  const cardBottom = yHex + CARD_PAD;
  const rightAnchor = g.tx + 12 + slotsWidth(workbenchExtent(c.m).bytes);
  const slotX = (bytesFromLSB: number): number =>
    rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;
  const card = (bytes: number, resultLabel: string): string => {
    const left = slotX(bytes - 1) - CARD_PAD - 4;
    const right = rightAnchor + RESULT_GAP + labelWidth(resultLabel) + CARD_PAD + 4;
    return rect(left, cardTop, right - left, cardBottom - cardTop, P.panel, P.gapStroke, 8, 1.5);
  };

  const reveal = (at: number, markup: string): string =>
    animate && at > 0 ? `<g opacity="0">${fade(0, 1, 0.22, at)}${markup}</g>` : markup;
  const swap = (at: number, before: string, after: string): string =>
    animate ? `<g>${hide(at)}${before}</g><g opacity="0">${show(at)}${after}</g>` : after;
  const result = (at: number, label: string, color: string): string =>
    reveal(at, text(rightAnchor + RESULT_GAP, yRes, label, RESULT_FONT, color));
  /** Bytes of `value` (MSB first) laid out right-aligned. */
  const plainValue = (value: bigint, info: Integer, hexInk: string): string => {
    const bytes = toBytesMSB(value, info.size);
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
      card(act.info.size, label) +
        plainValue(act.value, act.info, col) +
        text(rightAnchor + RESULT_GAP, yRes, label, RESULT_FONT, col)
    );
  }

  if (act.kind === 'invert') {
    const at = op ? arrival(op) : T.evaluate;
    const after = toBytesMSB(act.afterVal, act.info.size);
    let inverted = '';
    after.forEach((b, idx) => {
      inverted += drawByte(slotX(after.length - 1 - idx), yBits, yHex, b, { bits: P.write, hex: P.write });
    });
    const label = `→ ${act.afterVal}`;
    return card(act.info.size, label) + swap(at, plainValue(act.beforeVal, act.info, P.fg), inverted) + result(at + 0.18, label, P.write);
  }

  const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.size);
  const toBytes = toBytesMSB(act.afterVal, act.toInfo.size);
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
        bits: isExt ? P.muted : P.fg,
        hex: isExt ? P.muted : toCol,
      });
      if (!isExt) out += block;
      else if (animate) out += `<g opacity="0">${fade(0, 1, 0.35, at)}${block}</g>`;
      else out += block;
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
      out += animate ? swap(litAt, plain, scaledAt(msbX, yBits - 8, lit, litAt)) : lit;
    });

    const extCount = toBytes.length - fromBytes.length;
    const doneAt = at + (extCount - 1) * STAGGER + TRAVEL;
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
      const begin = at + k * STAGGER;
      const land = begin + TRAVEL;
      const tipX = bx + BYTE_W / 2;
      const tipY = yBits - BIT_FONT - 2;
      // Flat nested parabolas: the farther the byte, the higher the arc, so they never cross.
      const peakY = startY - 16 - k * ARC_RISE;
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
        `<animateMotion begin="${round(begin)}s" dur="${TRAVEL}s" path="${path(tipX, tipY)}" keyPoints="0;1" ${EASE} fill="freeze"/>` +
        '</g>';
      out += `<g opacity="0">${show(land)}${scaledAt(tipX, yBits, copy, land)}</g>`;
    }
    if (arcs) out += `<g>${fade(1, 0, 0.32, doneAt + 0.35)}${arcs}</g>`;
    return out + result(doneAt, label, toCol);
  }

  // Reinterpret (same width): the bits stay, only the type reading them changes.
  out += swap(at, plainValue(act.beforeVal, act.fromInfo, fromCol), plainValue(act.afterVal, act.toInfo, toCol));
  return out + result(at + 0.12, label, toCol);
}

function bitsScene(c: SceneContext): string {
  const { step, prev, animate, P } = c;
  const { defs, padId, ubId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;
  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    arrows(c) +
    memory(c, padId, ubId) +
    pane(c, animate && copies(c.m.steps, c.index)) +
    workbench(c) +
    output(c) +
    transfers(c)
  );
}

export const BITS_VIEW: TraceView = {
  geometry(m) {
    // The memory column also holds the workbench: its slots, the result and the card.
    const { bytes, labelChars, drop } = workbenchExtent(m);
    const workbench = 12 + slotsWidth(bytes) + RESULT_GAP + labelWidth(labelChars) + CARD_PAD + 28;
    return {
      minByteWidth: 66,
      minColumnWidth: Math.max(680, Math.ceil(workbench)),
      cellHeight: BYTE_CELL_HEIGHT,
      extraPaneHeight: 120 + drop,
      flush: true,
      skipWrap: true,
    };
  },
  stackBelow: 900,
  maxScale: 0.78,
  byteOrder: true,
  scene: bitsScene,
  stepSeconds: bitStepSeconds,
};
