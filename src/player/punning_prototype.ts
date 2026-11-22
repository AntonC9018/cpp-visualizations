// PROTOTYPE, throwaway (pointer type punning with larger and smaller pointee types, #60).
// Folded base design:
//   - Plain Lab 4 C++ (no reinterpret_cast), all native step animations restored
//   - Byte-accurate horizontal hex memory strip (reusing bits_view style, no "pad" text)
//   - Clean overhead pointer arc (no type pill on the arrow) landing on a bold target box
//     around the exact bytes the pointer points at
//   - Larger pointer: red bytes + red hazard stripes + boundary breach + "⚠ UB" badge
//
// Three switchable variations (?variant=A|B|C) focusing on stronger treatments for
// the smaller-pointer case (uint8_t* into int):
//   A: Spotlight cutout + frosted veil on untouched bytes + pane 4-byte reassembly strip
//   B: Inline before->after mutation + LSB->MSB significance arrow + 4-byte coverage bar (⚠ 1/4)
//   C: Tethered byte-slice breakdown under `a` with positional weights (×1, ×256, ×2¹⁶, ×2²⁴)
import type { ExecutionTrace, ScalarVariable, TraceStep } from '../core/trace_format.ts';
import {
  CHAR,
  EASE,
  T,
  type Palette,
  VARIABLE_COLOURS,
} from './constants.ts';
import { typeLabelWidth } from './geometry.ts';
import { type PreparedModel, arrival, copies, departure, stepSeconds } from './model.ts';
import { Player } from './player_view.ts';
import {
  type SceneContext,
  code,
  dim,
  output,
  pane,
  tether,
  typeColour,
  typeLabel,
} from './scene.ts';
import { esc, fade, hide, pulse, rect, round, show, text } from './svg.ts';
import type { TraceView } from './views.ts';

// ============================================================================================
// BYTE-ACCURATE SCENARIO MODEL
// ============================================================================================

interface PunningVar {
  name: string;
  type: string;
  address: number;
  size: number;
  kind: 'int' | 'ptr';
  signed: boolean;
  color: number;
}

interface PunningWriteAction {
  stepIndex: number;
  value: number;
  valueText: string;
}

interface PunningMeta {
  id: string;
  title: string;
  subtitle: string;
  direction: 'larger' | 'smaller';
  baseAddress: number;
  totalBytes: number;
  vars: PunningVar[];
  ptrName: string;
  pointeeType: string;
  pointeeSize: number;
  targetVar: string;
  targetAddress: number;
  ptrInitStep: number;
  derefStep: number;
  writeAction: PunningWriteAction;
  initSteps: Array<{ stepIndex: number; varName: string; value: number }>;
}

const META = new WeakMap<ExecutionTrace, PunningMeta>();

type ByteVal = number | '?' | null;
type AccessStatus = 'none' | 'owned' | 'padding' | 'foreign' | 'untouched';

interface ByteSlot {
  address: number;
  owner: PunningVar | null;
  before: ByteVal;
  after: ByteVal;
  changed: boolean;
  status: AccessStatus;
  inWindow: boolean;
}

interface SimState {
  bytes: ByteSlot[];
  varBefore: Map<string, number | null>;
  varAfter: Map<string, number | null>;
  corruptedVars: Set<string>;
  hasUb: boolean;
  ptrLive: boolean;
  windowActive: boolean;
  isPunningWrite: boolean;
  writtenBytes: number[];
}

function encodeBytes(value: number, size: number, littleEndian: boolean): number[] {
  const big = BigInt.asUintN(size * 8, BigInt(Math.trunc(value)));
  const msb: number[] = [];
  for (let i = size - 1; i >= 0; i--) {
    msb.push(Number((big >> BigInt(i * 8)) & 0xffn));
  }
  return littleEndian ? msb.reverse() : msb;
}

function decodeBytes(bytes: number[], signed: boolean, littleEndian: boolean): number {
  const ordered = littleEndian ? [...bytes].reverse() : bytes;
  let acc = 0n;
  for (const b of ordered) {
    acc = (acc << 8n) | BigInt(b & 0xff);
  }
  if (signed) {
    const bits = BigInt(bytes.length * 8);
    const signBit = 1n << (bits - 1n);
    if (acc >= signBit) acc -= 1n << bits;
  }
  return Number(acc);
}

const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');

function ownerAt(meta: PunningMeta, addr: number): PunningVar | null {
  for (const v of meta.vars) {
    if (addr >= v.address && addr < v.address + v.size) return v;
  }
  return null;
}

function snapshotAt(meta: PunningMeta, stepIndex: number, littleEndian: boolean): ByteVal[] {
  const mem: ByteVal[] = [];
  for (let i = 0; i < meta.totalBytes; i++) {
    const addr = meta.baseAddress + i;
    mem.push(ownerAt(meta, addr) ? null : '?');
  }
  for (const init of meta.initSteps) {
    if (init.stepIndex <= stepIndex) {
      const v = meta.vars.find(x => x.name === init.varName)!;
      const bs = encodeBytes(init.value, v.size, littleEndian);
      for (let k = 0; k < v.size; k++) {
        mem[v.address - meta.baseAddress + k] = bs[k];
      }
    }
  }
  if (meta.writeAction.stepIndex <= stepIndex) {
    const bs = encodeBytes(meta.writeAction.value, meta.pointeeSize, littleEndian);
    for (let k = 0; k < meta.pointeeSize; k++) {
      const idx = meta.targetAddress - meta.baseAddress + k;
      if (idx >= 0 && idx < mem.length) mem[idx] = bs[k];
    }
  }
  return mem;
}

function decodeVarValues(
  meta: PunningMeta,
  mem: ByteVal[],
  littleEndian: boolean
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const v of meta.vars) {
    const slice = mem.slice(v.address - meta.baseAddress, v.address - meta.baseAddress + v.size);
    if (slice.some(b => typeof b !== 'number')) {
      out.set(v.name, null);
    } else {
      out.set(v.name, decodeBytes(slice as number[], v.signed, littleEndian));
    }
  }
  return out;
}

function simulate(meta: PunningMeta, stepIndex: number, littleEndian: boolean): SimState {
  const beforeMem =
    stepIndex > 0 ? snapshotAt(meta, stepIndex - 1, littleEndian) : snapshotAt(meta, 0, littleEndian);
  const afterMem = snapshotAt(meta, stepIndex, littleEndian);
  const ptrLive = stepIndex >= meta.ptrInitStep;
  const windowActive = stepIndex >= meta.derefStep;
  const isPunningWrite = stepIndex === meta.writeAction.stepIndex;
  const wStart = meta.targetAddress;
  const wEnd = meta.targetAddress + meta.pointeeSize;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const tStart = targetVar.address;
  const tEnd = targetVar.address + targetVar.size;

  const bytes: ByteSlot[] = [];
  let hasUb = false;
  const corruptedVars = new Set<string>();

  for (let i = 0; i < meta.totalBytes; i++) {
    const address = meta.baseAddress + i;
    const owner = ownerAt(meta, address);
    const inWindow = ptrLive && address >= wStart && address < wEnd;
    let status: AccessStatus = 'none';
    if (inWindow) {
      if (!owner) {
        status = 'padding';
        hasUb = true;
      } else if (owner.name === meta.targetVar) {
        status = 'owned';
      } else {
        status = 'foreign';
        hasUb = true;
        if (stepIndex >= meta.writeAction.stepIndex) corruptedVars.add(owner.name);
      }
    } else if (ptrLive && address >= tStart && address < tEnd) {
      status = 'untouched';
    }
    const before = beforeMem[i];
    const after = afterMem[i];
    bytes.push({
      address,
      owner,
      before,
      after,
      changed: stepIndex > 0 && before !== after,
      status,
      inWindow,
    });
  }

  return {
    bytes,
    varBefore: decodeVarValues(meta, beforeMem, littleEndian),
    varAfter: decodeVarValues(meta, afterMem, littleEndian),
    corruptedVars,
    hasUb,
    ptrLive,
    windowActive,
    isPunningWrite,
    writtenBytes: encodeBytes(meta.writeAction.value, meta.pointeeSize, littleEndian),
  };
}

// ============================================================================================
// SCENARIOS (PLAIN LAB 4 CODE — NO reinterpret_cast)
// ============================================================================================

function makeScenario1(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'uint8_t', address: 64, size: 1, kind: 'int', signed: false, color: 0 },
    { name: 'c', type: 'int', address: 68, size: 4, kind: 'int', signed: true, color: 2 },
    { name: 'b', type: 'int*', address: 72, size: 8, kind: 'ptr', signed: false, color: 1 },
  ];
  const traceVars: ScalarVariable[] = vars.map(v => ({
    name: v.name,
    address: v.address,
    size: v.size,
    kind: v.kind,
    color: v.color,
    type: v.type,
  }));
  const source = [
    'uint8_t a{ 5 };',
    'int c{ 10 };',
    'int* b{ &a };',
    '*b = 300;',
  ];
  const v0 = { a: null, c: null, b: null };
  const v1 = { a: 5, c: null, b: null };
  const v2 = { a: 5, c: 10, b: null };
  const v3 = { a: 5, c: 10, b: 64 };
  const v4 = { a: 44, c: 10, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'uint8_t a{ 5 }', expr: [11, 12], values: v0, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 0,
      pane: 'uint8_t a{ 5 }',
      expr: [11, 12],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'write', name: 'a', value: '5', span: [11, 12], destination: [8, 9] },
    },
    { line: 1, pane: 'int c{ 10 }', expr: [7, 9], values: v1, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 1,
      pane: 'int c{ 10 }',
      expr: [7, 9],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'write', name: 'c', value: '10', span: [7, 9], destination: [4, 5] },
    },
    { line: 2, pane: 'int* b{ &a }', expr: [8, 10], values: v2, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 2,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [8, 10] },
    },
    {
      line: 2,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 3, pane: '*b = 300', expr: [0, 2], values: v3, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 3,
      pane: '*64 = 300',
      expr: [0, 3],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 3,
      pane: '*64 = 300',
      expr: [0, 3],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.3,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 3,
      pane: '*64 = 300',
      expr: [6, 9],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '300', span: [6, 9], destination: [0, 3] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Larger pointer overwrites alignment padding',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'larger-padding',
    title: '1. Larger pointer writes past 1-byte object into padding',
    subtitle: 'What would happen if int* b{ &a }; compiled: *b = 300 writes 4 bytes (64..67), hitting a and 3 padding bytes.',
    direction: 'larger',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'int',
    pointeeSize: 4,
    targetVar: 'a',
    targetAddress: 64,
    ptrInitStep: 6,
    derefStep: 9,
    writeAction: { stepIndex: 10, value: 300, valueText: '300' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 10 },
      { stepIndex: 6, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario2(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'uint8_t', address: 64, size: 1, kind: 'int', signed: false, color: 0 },
    { name: 'c', type: 'uint8_t', address: 65, size: 1, kind: 'int', signed: false, color: 3 },
    { name: 'd', type: 'int', address: 68, size: 4, kind: 'int', signed: true, color: 2 },
    { name: 'b', type: 'int*', address: 72, size: 8, kind: 'ptr', signed: false, color: 1 },
  ];
  const traceVars: ScalarVariable[] = vars.map(v => ({
    name: v.name,
    address: v.address,
    size: v.size,
    kind: v.kind,
    color: v.color,
    type: v.type,
  }));
  const source = [
    'uint8_t a{ 5 };',
    'uint8_t c{ 9 };',
    'int d{ 10 };',
    'int* b{ &a };',
    '*b = 0x04030201;',
  ];
  const v0 = { a: null, c: null, d: null, b: null };
  const v1 = { a: 5, c: null, d: null, b: null };
  const v2 = { a: 5, c: 9, d: null, b: null };
  const v3 = { a: 5, c: 9, d: 10, b: null };
  const v4 = { a: 5, c: 9, d: 10, b: 64 };
  const v5 = { a: 1, c: 2, d: 10, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'uint8_t a{ 5 }', expr: [11, 12], values: v0, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 0,
      pane: 'uint8_t a{ 5 }',
      expr: [11, 12],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'a', value: '5', span: [11, 12], destination: [8, 9] },
    },
    { line: 1, pane: 'uint8_t c{ 9 }', expr: [11, 12], values: v1, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 1,
      pane: 'uint8_t c{ 9 }',
      expr: [11, 12],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'c', value: '9', span: [11, 12], destination: [8, 9] },
    },
    { line: 2, pane: 'int d{ 10 }', expr: [7, 9], values: v2, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 2,
      pane: 'int d{ 10 }',
      expr: [7, 9],
      values: v3,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'd', value: '10', span: [7, 9], destination: [4, 5] },
    },
    { line: 3, pane: 'int* b{ &a }', expr: [8, 10], values: v3, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 3,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v3,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [8, 10] },
    },
    {
      line: 3,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 4, pane: '*b = 0x04030201', expr: [0, 2], values: v4, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 4,
      pane: '*64 = 0x04030201',
      expr: [0, 3],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 4,
      pane: '*64 = 0x04030201',
      expr: [0, 3],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.3,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 4,
      pane: '*64 = 0x04030201',
      expr: [6, 16],
      values: v5,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '0x04030201', span: [6, 16], destination: [0, 3] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Larger pointer corrupts adjacent variable and padding',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'larger-adjacent',
    title: '2. Larger pointer silently corrupts an adjacent variable',
    subtitle: 'a (64) and c (65) sit side by side, then 2 padding bytes (66..67). *b = 0x04030201 overwrites c without naming it.',
    direction: 'larger',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'int',
    pointeeSize: 4,
    targetVar: 'a',
    targetAddress: 64,
    ptrInitStep: 8,
    derefStep: 11,
    writeAction: { stepIndex: 12, value: 0x04030201, valueText: '0x04030201' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 9 },
      { stepIndex: 5, varName: 'd', value: 10 },
      { stepIndex: 8, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario3(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'int', address: 64, size: 4, kind: 'int', signed: true, color: 0 },
    { name: 'b', type: 'uint8_t*', address: 72, size: 8, kind: 'ptr', signed: false, color: 1 },
  ];
  const traceVars: ScalarVariable[] = vars.map(v => ({
    name: v.name,
    address: v.address,
    size: v.size,
    kind: v.kind,
    color: v.color,
    type: v.type,
  }));
  const source = [
    'int a = 5;',
    'uint8_t* b = &a;',
    '*b = 2;',
  ];
  const v0 = { a: null, b: null };
  const v1 = { a: 5, b: null };
  const v2 = { a: 5, b: 64 };
  const v3 = { a: 2, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'int a = 5', expr: [8, 9], values: v0, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 0,
      pane: 'int a = 5',
      expr: [8, 9],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'write', name: 'a', value: '5', span: [8, 9], destination: [4, 5] },
    },
    { line: 1, pane: 'uint8_t* b = &a', expr: [13, 15], values: v1, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [13, 15] },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'write', name: 'b', value: '64', span: [13, 15], destination: [9, 10] },
    },
    { line: 2, pane: '*b = 2', expr: [0, 2], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 2,
      pane: '*64 = 2',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 2,
      pane: '*64 = 2',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.2,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 2,
      pane: '*64 = 2',
      expr: [6, 7],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '2', span: [6, 7], destination: [0, 3] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Smaller pointer overwrites one byte of an int',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'smaller-five',
    title: '3. Smaller pointer overwrites only byte 64 of int a (a = 5)',
    subtitle: 'a spans 64..67 (4 B). *b = 2 changes only byte 64. Flip Little-endian / Big-endian to see a become 2 vs 33554437.',
    direction: 'smaller',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'uint8_t',
    pointeeSize: 1,
    targetVar: 'a',
    targetAddress: 64,
    ptrInitStep: 4,
    derefStep: 7,
    writeAction: { stepIndex: 8, value: 2, valueText: '2' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 4, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario4(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'int', address: 64, size: 4, kind: 'int', signed: true, color: 0 },
    { name: 'b', type: 'uint8_t*', address: 72, size: 8, kind: 'ptr', signed: false, color: 1 },
  ];
  const traceVars: ScalarVariable[] = vars.map(v => ({
    name: v.name,
    address: v.address,
    size: v.size,
    kind: v.kind,
    color: v.color,
    type: v.type,
  }));
  const source = [
    'int a = 261;',
    'uint8_t* b = &a;',
    '*b = 0;',
  ];
  const v0 = { a: null, b: null };
  const v1 = { a: 261, b: null };
  const v2 = { a: 261, b: 64 };
  const v3 = { a: 256, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'int a = 261', expr: [8, 11], values: v0, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 0,
      pane: 'int a = 261',
      expr: [8, 11],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'write', name: 'a', value: '261', span: [8, 11], destination: [4, 5] },
    },
    { line: 1, pane: 'uint8_t* b = &a', expr: [13, 15], values: v1, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [13, 15] },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'write', name: 'b', value: '64', span: [13, 15], destination: [9, 10] },
    },
    { line: 2, pane: '*b = 0', expr: [0, 2], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 2,
      pane: '*64 = 0',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 2,
      pane: '*64 = 0',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.2,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 2,
      pane: '*64 = 0',
      expr: [6, 7],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '0', span: [6, 7], destination: [0, 3] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Smaller pointer leaves upper bytes of int intact',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'smaller-261',
    title: '4. Smaller pointer leaves upper bytes intact (a = 261, *b = 0)',
    subtitle: '261 is 05 01 00 00 (LE). *b = 0 zeroes only byte 64, leaving byte 65 (01) -> a becomes 256, not 0.',
    direction: 'smaller',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'uint8_t',
    pointeeSize: 1,
    targetVar: 'a',
    targetAddress: 64,
    ptrInitStep: 4,
    derefStep: 7,
    writeAction: { stepIndex: 8, value: 0, valueText: '0' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 261 },
      { stepIndex: 4, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

const SCENARIOS = [makeScenario1(), makeScenario2(), makeScenario3(), makeScenario4()];

// ============================================================================================
// SHARED SVG HELPERS + NATIVE TRANSFERS ON THE FLUSH BYTE GRID
// ============================================================================================

type SmallerStyle = 'A' | 'B' | 'C';

let patternSeq = 0;

function hatchDefs(P: Palette): { defs: string; padId: string; ubId: string; veilId: string } {
  const uid = ++patternSeq;
  const padId = `cv-pad-hatch-${uid}`;
  const ubId = `cv-ub-hatch-${uid}`;
  const veilId = `cv-veil-hatch-${uid}`;
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
    `<pattern id="${veilId}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">` +
    `<rect width="9" height="9" fill="${P.deadFill}" fill-opacity="0.65"/>` +
    `<line x1="0" y1="0" x2="0" y2="9" stroke="${P.gapStroke}" stroke-opacity="0.5" stroke-width="1.8"/>` +
    '</pattern>' +
    '</defs>';
  return { defs, padId, ubId, veilId };
}

function varColor(P: Palette, v: PunningVar): string {
  return P.vars[v.color % VARIABLE_COLOURS];
}

function pill(
  cx: number,
  cy: number,
  label: string,
  size: number,
  fill: string,
  stroke: string,
  ink: string
): string {
  const w = label.length * size * CHAR + 16;
  const h = size + 10;
  return (
    rect(cx - w / 2, cy - h / 2, w, h, fill, stroke, h / 2, 1.8) +
    text(cx, cy + size * 0.35, label, size, ink, 'middle')
  );
}

function breachCrack(x: number, y1: number, y2: number, color: string): string {
  const steps = 6;
  const dy = (y2 - y1) / steps;
  let d = `M ${round(x)} ${round(y1)}`;
  for (let i = 1; i <= steps; i++) {
    const nx = x + (i === steps ? 0 : i % 2 === 1 ? -4.5 : 4.5);
    d += ` L ${round(nx)} ${round(y1 + i * dy)}`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function paddingRuns(meta: PunningMeta): Array<{ start: number; size: number }> {
  const runs: Array<{ start: number; size: number }> = [];
  let start: number | null = null;
  for (let i = 0; i < meta.totalBytes; i++) {
    const addr = meta.baseAddress + i;
    if (!ownerAt(meta, addr)) {
      if (start === null) start = addr;
    } else if (start !== null) {
      runs.push({ start, size: addr - start });
      start = null;
    }
  }
  if (start !== null) runs.push({ start, size: meta.baseAddress + meta.totalBytes - start });
  return runs;
}

function punningStepSeconds(m: PreparedModel, index: number): number {
  const meta = META.get(m.trace);
  if (meta && index === meta.writeAction.stepIndex) return m.steps[index].hold + 2.4;
  if (meta && index === meta.derefStep) return m.steps[index].hold + 1.8;
  return stepSeconds(m.steps, index);
}

/** Native flying value box matching scene.ts, using the flush byte grid's exact coordinates. */
function gridValueBox(
  c: SceneContext,
  value: string,
  color: string,
  path: string,
  begin: number,
  travel: number,
  end: number
): string {
  const half = Math.max(26, (value.length * c.g.paneChar) / 2 + 12);
  return (
    `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g>` +
    `<g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}` +
    rect(-half, -23, 2 * half, 46, c.P.panel, color, 9) +
    text(0, 10, value, c.g.paneSize, c.P.fg, 'middle') +
    `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`
  );
}

function gridTransfers(
  c: SceneContext,
  meta: PunningMeta,
  sim: SimState,
  xOf: (addr: number) => number,
  byteW: number,
  gridY: number,
  cellH: number
): string {
  const { g, P, op, animate } = c;
  if (!animate || !op || sim.isPunningWrite) return '';
  const at = arrival(op);
  const begin = departure(op);
  const ty = g.ty - 11;
  const below = g.below;
  const spanCentre = (span: [number, number]): number => g.tx + ((span[0] + span[1]) / 2) * g.paneChar;
  const p = (...vals: number[]): string => vals.map(round).join(' ');

  if (op.kind === 'read') {
    const v = meta.vars.find(x => x.name === op.name);
    if (!v) return '';
    const sx = xOf(v.address) + (v.size * byteW) / 2;
    const sy = gridY + cellH / 2;
    const dx = spanCentre(op.span);
    return gridValueBox(
      c,
      op.value,
      P.read,
      `M ${p(sx, sy)} C ${p(sx, below)}, ${p(dx, below)}, ${p(dx, ty)}`,
      begin,
      T.travel,
      at
    );
  }
  if (op.kind === 'addr') {
    const v = meta.vars.find(x => x.name === op.name);
    if (!v) return '';
    const sx = xOf(v.address) + byteW / 2;
    const sy = gridY - 17;
    const dx = spanCentre(op.span);
    const side = xOf(v.address) - 18;
    const flash =
      `<g opacity="0">${fade(0, 1, 0.15, begin - 0.1)}${fade(1, 0, 0.2, at + 0.1)}` +
      rect(sx - 15, sy - 12, 30, 22, P.readFill, P.read, 5, 2) +
      '</g>';
    return (
      flash +
      gridValueBox(
        c,
        op.value,
        P.read,
        `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, gridY + cellH)}, ${p(side, below)} C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`,
        begin,
        T.travel,
        at
      )
    );
  }
  if (op.kind === 'write') {
    const v = meta.vars.find(x => x.name === op.name);
    if (!v) return '';
    const sx = spanCentre(op.span);
    const ex = xOf(v.address) + (v.size * byteW) / 2;
    const ey = gridY + cellH / 2;
    return gridValueBox(
      c,
      op.value,
      P.write,
      `M ${p(sx, ty)} C ${p(sx, below)}, ${p(ex, below)}, ${p(ex, ey)}`,
      begin,
      T.travel,
      at
    );
  }
  return '';
}

// ============================================================================================
// STANDING-OUT TARGET BOX AROUND THE BYTES THE POINTER POINTS AT
// ============================================================================================

function targetFootprintBox(
  c: SceneContext,
  meta: PunningMeta,
  sim: SimState,
  xOf: (addr: number) => number,
  byteW: number,
  gridY: number,
  cellH: number,
  pCol: string,
  smallerStyle: SmallerStyle
): string {
  if (!sim.ptrLive) return '';
  const { P, animate, op } = c;
  const at = op ? arrival(op) : 0;
  const wLeft = xOf(meta.targetAddress);
  const wWidth = meta.pointeeSize * byteW;
  const wRight = wLeft + wWidth;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const ownEnd = xOf(targetVar.address + targetVar.size);

  const pad = 4;
  const bx = wLeft - pad;
  const by = gridY - pad;
  const bw = wWidth + 2 * pad;
  const bh = cellH + 2 * pad;

  const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
  const isDeref = animate && c.index === meta.derefStep;
  const hot = sim.windowActive;

  let box = '';
  if (meta.direction === 'larger') {
    // High-contrast outer halo + bold two-tone frame (pointer/write over owned byte, blazing red over spilled bytes!)
    const splitX = ownEnd;
    // Soft outer aura so the box jumps off the memory strip
    box += rect(bx, by, bw, bh, 'none', hot ? P.error : pCol, 6, 11).replace(
      'stroke-width="11"',
      `stroke-width="11" stroke-opacity="${hot ? 0.26 : 0.18}"`
    );
    // Clean bg cutout so it never muddies cell walls underneath
    box += rect(bx, by, bw, bh, 'none', P.bg, 6, 7.5);
    // Owned left half of the target box
    box +=
      `<path d="M ${round(splitX)} ${round(by)} H ${round(bx + 6)} Q ${round(bx)} ${round(by)} ${round(bx)} ${round(by + 6)} ` +
      `V ${round(by + bh - 6)} Q ${round(bx)} ${round(by + bh)} ${round(bx + 6)} ${round(by + bh)} H ${round(splitX)}" ` +
      `fill="none" stroke="${hot ? P.write : pCol}" stroke-width="4.2" stroke-linecap="round"/>`;
    // Spilled right half of the target box — blazing red!
    box +=
      `<path d="M ${round(splitX)} ${round(by)} H ${round(bx + bw - 6)} Q ${round(bx + bw)} ${round(by)} ${round(bx + bw)} ${round(by + 6)} ` +
      `V ${round(by + bh - 6)} Q ${round(bx + bw)} ${round(by + bh)} ${round(bx + bw - 6)} ${round(by + bh)} H ${round(splitX)}" ` +
      `fill="none" stroke="${P.error}" stroke-width="4.4" stroke-linecap="round"/>`;
    // Jagged boundary breach right where `a` ends
    box += breachCrack(splitX, by - 3, by + bh + 3, P.error);

    // Corner ticks to give it a crisp viewfinder/target silhouette
    const tick = 9;
    box +=
      `<path d="M ${round(bx - 3)} ${round(by + tick)} V ${round(by - 3)} H ${round(bx + tick)}" fill="none" stroke="${hot ? P.write : pCol}" stroke-width="2.4"/>` +
      `<path d="M ${round(bx + bw - tick)} ${round(by - 3)} H ${round(bx + bw + 3)} V ${round(by + tick)}" fill="none" stroke="${P.error}" stroke-width="2.4"/>` +
      `<path d="M ${round(bx - 3)} ${round(by + bh - tick)} V ${round(by + bh + 3)} H ${round(bx + tick)}" fill="none" stroke="${hot ? P.write : pCol}" stroke-width="2.4"/>` +
      `<path d="M ${round(bx + bw - tick)} ${round(by + bh + 3)} H ${round(bx + bw + 3)} V ${round(by + bh - tick)}" fill="none" stroke="${P.error}" stroke-width="2.4"/>`;
  } else {
    // Smaller pointer: wrap the exact 1-byte cell (`splitY .. gridY + cellH`) so the bold box
    // REALLY stands out without ever cutting through `a`'s 4-byte decimal header above!
    const col = hot ? P.write : pCol;
    const accent = smallerStyle === 'B' ? P.write : col;
    const splitY = gridY + 48;
    const sby = splitY - 2;
    const sbh = gridY + cellH - splitY + pad + 2;
    // Soft translucent column wash in the upper half of byte 64 (never obscures `a`'s decimal text)
    box += rect(wLeft + 2, gridY + 2, wWidth - 4, splitY - gridY - 4, accent, 'none', 0).replace(
      'fill=',
      'fill-opacity="0.12" fill='
    );
    // Wide outer spotlight glow around the byte cell
    box += rect(bx, sby, bw, sbh, 'none', accent, 6, 12).replace(
      'stroke-width="12"',
      `stroke-width="12" stroke-opacity="${hot ? 0.36 : 0.25}"`
    );
    // Crisp bg cutout separating the target box from `a`'s border and byte 65
    box += rect(bx, sby, bw, sbh, 'none', P.bg, 6, 8);
    // Bold main frame
    box += rect(bx, sby, bw, sbh, 'none', accent, 6, 4.4);
    // Corner viewfinder ticks
    const tick = 8;
    box +=
      `<path d="M ${round(bx - 3)} ${round(sby + tick)} V ${round(sby - 3)} H ${round(bx + tick)}" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
      `<path d="M ${round(bx + bw - tick)} ${round(sby - 3)} H ${round(bx + bw + 3)} V ${round(sby + tick)}" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
      `<path d="M ${round(bx - 3)} ${round(sby + sbh - tick)} V ${round(sby + sbh + 3)} H ${round(bx + tick)}" fill="none" stroke="${accent}" stroke-width="2.6"/>` +
      `<path d="M ${round(bx + bw - tick)} ${round(sby + sbh + 3)} H ${round(bx + bw + 3)} V ${round(sby + sbh - tick)}" fill="none" stroke="${accent}" stroke-width="2.6"/>`;
    // Vertical slice line cutting cleanly between byte 64 and byte 65 below the header
    const sliceX = wRight + 1;
    box += `<line x1="${round(sliceX)}" y1="${round(sby - 4)}" x2="${round(sliceX)}" y2="${round(sby + sbh + 8)}" stroke="${accent}" stroke-width="2.2" stroke-dasharray="4 3"/>`;
  }

  if (isWritingPtr) {
    return `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${box}</g>`;
  }
  if (isDeref) {
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    return `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.15)}<g transform="translate(${round(-cx)} ${round(-cy)})">${box}</g></g></g>`;
  }
  return box;
}

// ============================================================================================
// UNIFIED FOLDED SCENE WITH 3 SMALLER-POINTER VARIATIONS (A / B / C)
// ============================================================================================

function foldedScene(c: SceneContext, smallerStyle: SmallerStyle): string {
  const meta = META.get(c.m.trace)!;
  const sim = simulate(meta, c.index, c.littleEndian);
  const { g, P, animate, op, step, prev } = c;
  const { defs, padId, ubId, veilId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;

  const byteW = (g.pane.w - 48) / meta.totalBytes;
  const gridX = g.memX;
  const gridY = g.memY;
  const cellH = 88;
  const splitY = gridY + 48;
  const xOf = (addr: number): number => gridX + (addr - meta.baseAddress) * byteW;
  const at = op ? arrival(op) : 0;
  const ptrVar = meta.vars.find(v => v.name === meta.ptrName)!;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const pCol = varColor(P, ptrVar);

  let mem = '';

  // 1. Address ruler above every byte
  for (let i = 0; i < meta.totalBytes; i++) {
    const addr = meta.baseAddress + i;
    const owner = ownerAt(meta, addr);
    const isStart = owner && owner.address === addr;
    const bx = xOf(addr);
    mem += text(
      bx + byteW / 2,
      gridY - 12,
      addr,
      isStart ? 15 : 13,
      isStart ? P.muted : P.grey,
      'middle'
    );
  }

  // 2. Padding runs (hatched only — NO "pad" text!)
  for (const run of paddingRuns(meta)) {
    const rx = xOf(run.start);
    const rw = run.size * byteW;
    mem += rect(rx + 1, gridY + 1, rw - 2, cellH - 2, `url(#${padId})`, P.gapStroke, 0, 1.5);
    for (let k = 0; k < run.size; k++) {
      const addr = run.start + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);
      if (k > 0) {
        mem += `<line x1="${round(bx)}" y1="${gridY + 2}" x2="${round(bx)}" y2="${gridY + cellH - 2}" stroke="${P.gapStroke}" stroke-dasharray="3 3" stroke-width="1"/>`;
      }
      const hexY = gridY + 74;
      if (slot.status === 'padding') {
        const hexText = typeof slot.after === 'number' ? hex2(slot.after) : '??';
        const badgeBg = rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3);
        const hazard =
          rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 1.8) +
          badgeBg +
          text(bx + byteW / 2, hexY, hexText, 15.5, P.error, 'middle');
        if (animate && sim.isPunningWrite) {
          const revealAt = at + 0.08 * (addr - meta.targetAddress);
          mem +=
            `<g>${hide(revealAt)}` +
            rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 1.4) +
            badgeBg +
            text(bx + byteW / 2, hexY, '??', 14, P.error, 'middle') +
            '</g>' +
            `<g opacity="0">${show(revealAt)}${hazard}</g>`;
        } else if (animate && op?.kind === 'write' && op.name === meta.ptrName) {
          mem +=
            text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle') +
            `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${hazard}</g>`;
        } else {
          mem += hazard;
        }
      } else {
        mem += text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle');
      }
    }
  }

  // Compute staggered rows for variable type pills so adjacent 1-byte variables never collide
  const pillRowEdge: number[] = [];
  const pillRowOf = new Map<string, number>();
  for (const v of meta.vars) {
    const cx = xOf(v.address) + (v.size * byteW) / 2;
    const half = typeLabelWidth(v.type, 13.5) / 2;
    let r = 0;
    while (pillRowEdge[r] !== undefined && cx - half < pillRowEdge[r] + 6) r++;
    pillRowEdge[r] = cx + half;
    pillRowOf.set(v.name, r);
  }
  const pillRowsCount = Math.max(1, pillRowEdge.length);

  // 3. Variables (flush on the byte grid)
  for (const v of meta.vars) {
    const vx = xOf(v.address);
    const vw = v.size * byteW;
    const col = varColor(P, v);
    const valAfter = sim.varAfter.get(v.name) ?? null;
    const valBefore = sim.varBefore.get(v.name) ?? null;
    const on = valAfter !== null;
    const isCorrupted = sim.corruptedVars.has(v.name);
    const isForeignThreat =
      sim.ptrLive &&
      v.name !== meta.targetVar &&
      sim.bytes.some(s => s.owner?.name === v.name && s.status === 'foreign');
    const borderCol = isCorrupted || isForeignThreat ? P.error : on ? col : P.deadStroke;

    let markup = '';
    markup += rect(vx + 1, gridY + 1, vw - 2, cellH - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Per-byte backgrounds inside the variable
    for (let k = 0; k < v.size; k++) {
      const addr = v.address + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);
      if (slot.status === 'foreign') {
        const bg = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, 'none', 0);
        markup +=
          animate && op?.kind === 'write' && op.name === meta.ptrName
            ? `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${bg}</g>`
            : bg;
      } else if (slot.status === 'owned' && sim.ptrLive) {
        const bg = rect(bx + 1.5, splitY, byteW - 3, cellH - (splitY - gridY) - 1.5, P.writeFill, 'none', 0);
        markup +=
          animate && op?.kind === 'write' && op.name === meta.ptrName
            ? `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${bg}</g>`
            : bg;
      } else if (slot.status === 'untouched' && meta.direction === 'smaller' && smallerStyle === 'A') {
        // Variant A: Frosted/veiled blind spot on the 3 bytes outside *b's reach!
        const veil = rect(bx + 1.5, splitY, byteW - 3, cellH - (splitY - gridY) - 1.5, `url(#${veilId})`, 'none', 0);
        markup +=
          animate && op?.kind === 'write' && op.name === meta.ptrName
            ? `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${veil}</g>`
            : veil;
      }
    }

    // Horizontal split & vertical byte dividers
    const divCol = on ? P.gapStroke : P.deadStroke;
    markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
    for (let k = 1; k < v.size; k++) {
      const lx = xOf(v.address + k);
      markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${gridY + cellH - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
    }

    // Outer variable border
    markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);

    // Value header + per-byte hex
    const renderBody = (val: number | null, useBefore: boolean): string => {
      if (val === null) return '';
      let body = '';

      // Variant B smaller-pointer: show `old -> new` directly in `a`'s header on write!
      const showHeaderDiff =
        !useBefore &&
        meta.direction === 'smaller' &&
        smallerStyle === 'B' &&
        v.name === meta.targetVar &&
        c.index >= meta.writeAction.stepIndex &&
        valBefore !== null &&
        valBefore !== val;

      const dec = showHeaderDiff ? `${valBefore} → ${val}` : String(val);
      const decSize = Math.min(showHeaderDiff ? 21 : 25, (vw - 12) / (Math.max(1, dec.length) * CHAR));
      const decCol = isCorrupted && !useBefore ? P.error : showHeaderDiff ? P.write : P.fg;
      if (isCorrupted && !useBefore) {
        body += rect(vx + vw / 2 - 14, gridY + 12, 28, 26, P.panel, 'none', 4);
      }
      body += text(vx + vw / 2, gridY + 33, dec, round(decSize), decCol, 'middle');

      const hexY = gridY + 74;
      for (let k = 0; k < v.size; k++) {
        const addr = v.address + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bval = useBefore ? slot.before : slot.after;
        if (typeof bval !== 'number') continue;
        const bx = xOf(addr);
        const isUntouched = slot.status === 'untouched';
        const byteInk =
          slot.status === 'foreign' && !useBefore
            ? P.error
            : slot.status === 'owned' && c.index >= meta.writeAction.stepIndex && !useBefore
              ? P.write
              : v.kind === 'ptr'
                ? P.muted
                : P.fg;
        const opAttr =
          isUntouched && smallerStyle === 'A'
            ? ' opacity="0.35"'
            : isUntouched && smallerStyle === 'B'
              ? ' opacity="0.55"'
              : v.kind === 'ptr'
                ? ' opacity="0.65"'
                : '';
        if (slot.status === 'foreign') {
          body += rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3);
        }
        // Variant B smaller-pointer: compact `old->new` stacked inside byte 64!
        if (
          !useBefore &&
          meta.direction === 'smaller' &&
          smallerStyle === 'B' &&
          slot.status === 'owned' &&
          c.index >= meta.writeAction.stepIndex &&
          typeof slot.before === 'number' &&
          slot.before !== bval
        ) {
          body += text(bx + byteW / 2, gridY + 62, hex2(slot.before), 11, P.muted, 'middle');
          body += `<line x1="${round(bx + 10)}" y1="${gridY + 58}" x2="${round(bx + byteW - 10)}" y2="${gridY + 58}" stroke="${P.muted}" stroke-width="1.2"/>`;
          body += text(bx + byteW / 2, gridY + 80, hex2(bval), 15.5, P.write, 'middle');
        } else {
          body += `<g${opAttr}>${text(bx + byteW / 2, hexY, hex2(bval), v.kind === 'ptr' ? 13 : 15.5, byteInk, 'middle')}</g>`;
        }
      }
      return body;
    };

    const writingThis =
      animate &&
      ((op?.kind === 'write' && op.name === v.name && !sim.isPunningWrite) ||
        (sim.isPunningWrite && valBefore !== valAfter));

    if (writingThis) {
      const cx = vx + vw / 2;
      const cy = gridY + cellH / 2;
      markup += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.15)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
      if (valBefore !== null) markup += `<g>${hide(at)}${renderBody(valBefore, true)}</g>`;
      markup += `<g opacity="0">${show(at)}${renderBody(valAfter, false)}</g>`;
      markup += '</g></g></g>';
    } else {
      markup += renderBody(valAfter, false);
    }

    // Read/write highlight outline on normal steps (matches scene.ts!)
    if (animate && op && !sim.isPunningWrite) {
      if (op.kind === 'read' && op.name === v.name) {
        markup +=
          `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.25, at)}` +
          rect(vx + 3, gridY + 3, vw - 6, cellH - 6, P.read, 'none', 0).replace('fill=', 'fill-opacity="0.18" fill=') +
          rect(vx + 3, gridY + 3, vw - 6, cellH - 6, 'none', P.read, 0, 3) +
          '</g>';
      } else if (op.kind === 'write' && op.name === v.name) {
        markup +=
          `<g opacity="0">${fade(0, 1, 0.15, at - 0.25)}${fade(1, 0, 0.3, at + 0.3)}` +
          rect(vx + 3, gridY + 3, vw - 6, cellH - 6, P.write, 'none', 0).replace('fill=', 'fill-opacity="0.18" fill=') +
          rect(vx + 3, gridY + 3, vw - 6, cellH - 6, 'none', P.write, 0, 3) +
          '</g>';
      }
    }

    // Variable name + staggered type pill below cell
    const pillRow = pillRowOf.get(v.name) ?? 0;
    const labelOffset =
      meta.direction === 'smaller' && smallerStyle === 'B' && v.name === meta.targetVar ? 16 : 0;
    const pillTop = gridY + cellH + 34 + labelOffset + pillRow * 24;
    markup += text(
      vx + vw / 2,
      gridY + cellH + 26 + labelOffset,
      v.name,
      20,
      isCorrupted ? P.error : on ? col : P.grey,
      'middle'
    );
    markup += typeLabel(c, vx + vw / 2, pillTop, v.type, 13.5, on ? typeColour(c, v.type) : P.deadStroke);

    const keepBright =
      isCorrupted ||
      isForeignThreat ||
      (sim.ptrLive && (v.name === meta.targetVar || v.name === meta.ptrName));
    mem += keepBright ? markup : dim(c, v.name, markup);
  }

  // 4. Clean overhead pointer arc from `b` (NO type label on arrow!) landing on the target box!
  let arcMarkup = '';
  if (sim.ptrLive) {
    const sx = xOf(ptrVar.address) + (ptrVar.size * byteW) / 2;
    const boxCenterX = xOf(meta.targetAddress) + (meta.pointeeSize * byteW) / 2;
    const ex = meta.direction === 'larger' ? xOf(meta.targetAddress) + byteW * 0.5 : boxCenterX;
    const sy = gridY - 2;
    const ey = gridY - 26;
    const apex = gridY - 92;
    const d = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(apex)}, ${round(ex)} ${round(apex)}, ${round(ex)} ${round(ey - 8)}`;
    const head = `<path d="M -10 -6 L 0 0 L -10 6 Z" fill="${pCol}" transform="translate(${round(ex)} ${round(ey)}) rotate(90)"/>`;
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    const grow = isWritingPtr ? ` data-grow="${round(at + 0.08)}"` : '';
    arcMarkup +=
      '<g>' +
      `<path d="${d}" fill="none" stroke="${P.bg}" stroke-width="9"${grow}/>` +
      `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="2.6"${grow}/>` +
      (isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.15, at + 0.55)}${head}</g>` : head) +
      '</g>';
    if (animate && c.index === meta.derefStep) {
      arcMarkup += `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
    }
  }

  // 5. Standing-out target box around the exact bytes the pointer points at
  const targetBox = targetFootprintBox(c, meta, sim, xOf, byteW, gridY, cellH, pCol, smallerStyle);

  // 6. Larger-pointer UB caliper + badge ("⚠ UB", NO "+3 B"!)
  let belowOverlay = '';
  if (sim.ptrLive && meta.direction === 'larger') {
    const wLeft = xOf(meta.targetAddress);
    const wRight = xOf(meta.targetAddress + meta.pointeeSize);
    const ownEnd = xOf(targetVar.address + targetVar.size);
    const brY = gridY + cellH + 38 + pillRowsCount * 24 + 8;
    const tickTop = brY - 10;
    const cal =
      `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${P.write}" stroke-width="2.4"/>` +
      `<path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="3"/>` +
      pill((ownEnd + wRight) / 2, brY + 18, '⚠ UB', 13.5, P.error, P.error, P.bg);
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    belowOverlay += isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${cal}</g>` : cal;
  }

  // 7. Smaller-pointer variation-specific visuals (A / B / C)!
  if (sim.ptrLive && meta.direction === 'smaller') {
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    const wrap = (inner: string): string =>
      isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${inner}</g>` : inner;

    if (smallerStyle === 'A') {
      // Variant A: Spotlight caliper + explicit "untouched" badge below + pane reassembly strip (below)
      const wLeft = xOf(meta.targetAddress);
      const wRight = xOf(meta.targetAddress + meta.pointeeSize);
      const ownEnd = xOf(targetVar.address + targetVar.size);
      const brY = gridY + cellH + 38 + pillRowsCount * 24 + 8;
      const tickTop = brY - 10;
      const cal =
        `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.write}" stroke-width="2.8"/>` +
        pill((wLeft + wRight) / 2, brY + 18, '1 B', 13, P.writeFill, P.write, P.write) +
        `<path d="M ${round(wRight + 4)} ${brY} H ${round(ownEnd - 2)} V ${tickTop}" fill="none" stroke="${P.grey}" stroke-dasharray="4 4" stroke-width="1.8"/>` +
        pill((wRight + ownEnd) / 2, brY + 18, '3 B blind', 12.5, P.deadFill, P.gapStroke, P.muted);
      belowOverlay += wrap(cal);
    }

    if (smallerStyle === 'B') {
      // Variant B: LSB -> MSB arrow right below `a` + segmented 4-byte coverage bar + "⚠ 1/4" badge!
      const ay = gridY + cellH + 10;
      const xLow = xOf(targetVar.address) + (c.littleEndian ? byteW / 2 : targetVar.size * byteW - byteW / 2);
      const xHigh = xOf(targetVar.address) + (c.littleEndian ? targetVar.size * byteW - byteW / 2 : byteW / 2);
      const dir = c.littleEndian ? 1 : -1;
      let bVis =
        `<g opacity="0.82">` +
        `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${P.muted}" stroke-width="1.6" stroke-linecap="round"/>` +
        `<path d="M -8 -4 L 0 0 L -8 4 Z" fill="${P.muted}" transform="translate(${round(xHigh)} ${ay}) rotate(${c.littleEndian ? 0 : 180})"/>` +
        text(xLow, ay + 12, 'LSB', 9.5, P.muted, 'middle') +
        text(xHigh, ay + 12, 'MSB', 9.5, P.muted, 'middle') +
        '</g>';

      // 4-slot coverage meter under `a`'s type pill
      const barY = gridY + cellH + 84;
      const barH = 12;
      for (let k = 0; k < targetVar.size; k++) {
        const bx = xOf(targetVar.address + k) + 3;
        const bw = byteW - 6;
        if (k < meta.pointeeSize) {
          bVis += rect(bx, barY, bw, barH, P.write, P.write, 3, 1.5);
        } else {
          bVis +=
            rect(bx, barY, bw, barH, P.deadFill, P.gapStroke, 3, 1.4) +
            `<line x1="${round(bx + 4)}" y1="${barY + barH - 2}" x2="${round(bx + bw - 4)}" y2="${barY + 2}" stroke="${P.grey}" stroke-width="1.4"/>`;
        }
      }
      bVis += pill(
        xOf(targetVar.address) + (targetVar.size * byteW) / 2,
        barY + 28,
        '⚠ 1 / 4 bytes',
        12.5,
        P.writeFill,
        P.write,
        P.write
      );
      belowOverlay += wrap(bVis);
    }

    if (smallerStyle === 'C') {
      // Variant C: Tethered byte-slice microscope card directly under `a` with positional weights!
      const cardTop = gridY + cellH + 74;
      const cardH = 82;
      const slotW = 76;
      const slotGap = 8;
      const cardPad = 12;
      const slotsTotal = targetVar.size * slotW + (targetVar.size - 1) * slotGap;
      const resW = 132;
      const cardW = cardPad + slotsTotal + 16 + resW + cardPad;
      const cardX = gridX;

      // Angled zoom lines connecting from just below `a`'s type pill down into the 4-slot breakdown card
      const aLeft = xOf(targetVar.address);
      const aRight = xOf(targetVar.address + targetVar.size);
      const zoomTop = gridY + cellH + 58;
      let zoom =
        `<path d="M ${round(aLeft)} ${zoomTop} L ${round(cardX + cardPad)} ${cardTop} ` +
        `M ${round(aRight)} ${zoomTop} L ${round(cardX + cardPad + slotsTotal)} ${cardTop}" ` +
        `fill="none" stroke="${P.gapStroke}" stroke-dasharray="4 4" stroke-width="1.5"/>` +
        rect(cardX, cardTop, cardW, cardH, P.panel, P.gapStroke, 8, 1.6);

      const weightsLE = ['× 1', '× 256', '× 2¹⁶', '× 2²⁴'];
      const weights = c.littleEndian ? weightsLE : [...weightsLE].reverse();
      const postWrite = c.index >= meta.writeAction.stepIndex;

      for (let k = 0; k < targetVar.size; k++) {
        const sx = cardX + cardPad + k * (slotW + slotGap);
        const sy = cardTop + 10;
        const sh = cardH - 20;
        const slot = sim.bytes[targetVar.address + k - meta.baseAddress];
        const hit = k < meta.pointeeSize;
        const bval = typeof slot.after === 'number' ? slot.after : 0;
        const beforeVal = typeof slot.before === 'number' ? slot.before : bval;
        const nonzeroSurvivor = !hit && bval !== 0;

        const stroke = hit ? P.write : nonzeroSurvivor ? varColor(P, targetVar) : P.gapStroke;
        const fill = hit ? P.writeFill : P.deadFill;
        zoom += rect(sx, sy, slotW, sh, fill, stroke, 6, hit ? 2.4 : nonzeroSurvivor ? 2 : 1.3);
        zoom += text(sx + slotW / 2, sy + 14, `@${slot.address} · ${weights[k]}`, 10.5, hit ? P.write : P.muted, 'middle');

        if (hit && postWrite && beforeVal !== bval) {
          zoom += text(sx + slotW / 2, sy + 38, `${hex2(beforeVal)}→${hex2(bval)}`, 14.5, P.write, 'middle');
          zoom += text(sx + slotW / 2, sy + 55, 'written', 10.5, P.write, 'middle');
        } else {
          zoom += text(sx + slotW / 2, sy + 38, hex2(bval), 15.5, nonzeroSurvivor ? P.fg : P.muted, 'middle');
          zoom += text(
            sx + slotW / 2,
            sy + 55,
            hit ? 'target' : nonzeroSurvivor ? 'kept!' : 'kept',
            10.5,
            hit ? P.write : nonzeroSurvivor ? varColor(P, targetVar) : P.grey,
            'middle'
          );
        }
      }

      // Recombined result on the right of the card
      const rx = cardX + cardPad + slotsTotal + 16;
      const aVal = sim.varAfter.get(targetVar.name) ?? 0;
      const aPrev = sim.varBefore.get(targetVar.name);
      zoom += text(rx + resW / 2, cardTop + 30, `a (${c.littleEndian ? 'LE' : 'BE'})`, 12.5, P.muted, 'middle');
      const eq = postWrite && aPrev !== null && aPrev !== aVal ? `${aPrev} → ${aVal}` : `= ${aVal}`;
      const eqSz = Math.min(20, (resW - 6) / (Math.max(1, eq.length) * CHAR));
      zoom += text(rx + resW / 2, cardTop + 58, eq, round(eqSz), postWrite ? P.write : P.fg, 'middle');

      belowOverlay += wrap(zoom);
    }
  }

  // 8. Pane workbench + byte-by-byte flight on the punning write step!
  let wb = '';
  let flight = '';
  if (sim.windowActive) {
    const stripY = g.ty + 34;
    const tileW = 44;
    const tileH = 30;
    const tileGap = 6;
    const startX = g.tx + 10;

    if (meta.direction === 'larger') {
      const bytes = sim.writtenBytes;
      const labelStr = `${meta.writeAction.valueText} (${meta.pointeeSize} B ${c.littleEndian ? 'LE' : 'BE'})`;
      wb += text(startX, stripY + 20, labelStr, 15, P.muted);
      const tilesX = startX + labelStr.length * 15 * CHAR + 16;
      for (let k = 0; k < bytes.length; k++) {
        const addr = meta.targetAddress + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bad = slot.status === 'padding' || slot.status === 'foreign';
        const tx = tilesX + k * (tileW + tileGap);
        const stroke = bad ? P.error : P.write;
        const fill = bad ? P.panel : P.writeFill;
        wb +=
          rect(tx, stripY, tileW, tileH, fill, stroke, 5, 2) +
          text(tx + tileW / 2, stripY + 20, hex2(bytes[k]), 15.5, stroke, 'middle') +
          text(tx + tileW / 2, stripY + tileH + 14, `@${addr}`, 11.5, bad ? P.error : P.grey, 'middle');

        if (animate && sim.isPunningWrite) {
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = xOf(addr) + byteW / 2;
          const ey = gridY + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const begin = 0.25 + k * 0.1;
          const dur = 0.85;
          const end = begin + dur;
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, stroke, 6, 2) +
            text(0, 6, hex2(bytes[k]), 15, stroke, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        }
      }
    } else {
      // Smaller pointer pane workbench
      const writtenByte = sim.writtenBytes[0];
      if (smallerStyle === 'A') {
        // Variant A: Full 4-byte reassembly strip showing byte 64 replaced + 3 surviving bytes -> new `a`!
        const labelStr = `a bytes (${c.littleEndian ? 'LE' : 'BE'})`;
        wb += text(startX, stripY + 20, labelStr, 14.5, P.muted);
        const tilesX = startX + labelStr.length * 14.5 * CHAR + 14;
        for (let k = 0; k < targetVar.size; k++) {
          const addr = targetVar.address + k;
          const slot = sim.bytes[addr - meta.baseAddress];
          const hit = k === 0;
          const tx = tilesX + k * (tileW + tileGap);
          const bval = typeof slot.after === 'number' ? slot.after : 0;
          const stroke = hit ? P.write : P.gapStroke;
          const fill = hit ? P.writeFill : P.deadFill;
          wb +=
            rect(tx, stripY, tileW, tileH, fill, stroke, 5, hit ? 2.4 : 1.4) +
            text(tx + tileW / 2, stripY + 20, hex2(bval), 15.5, hit ? P.write : P.muted, 'middle') +
            text(tx + tileW / 2, stripY + tileH + 14, hit ? 'new' : 'kept', 11, hit ? P.write : P.grey, 'middle');
        }
        const aVal = sim.varAfter.get(targetVar.name) ?? 0;
        const eqX = tilesX + targetVar.size * (tileW + tileGap) + 12;
        wb += text(eqX, stripY + 21, `→ a = ${aVal}`, 16.5, P.fg);
      } else {
        // Variant B & C: Compact single written byte tile
        const labelStr = `${meta.writeAction.valueText} (1 B)`;
        wb += text(startX, stripY + 20, labelStr, 15, P.muted);
        const tx = startX + labelStr.length * 15 * CHAR + 14;
        wb +=
          rect(tx, stripY, tileW, tileH, P.writeFill, P.write, 5, 2.2) +
          text(tx + tileW / 2, stripY + 20, hex2(writtenByte), 15.5, P.write, 'middle') +
          text(tx + tileW / 2, stripY + tileH + 14, `@${meta.targetAddress}`, 11.5, P.write, 'middle');
      }

      if (animate && sim.isPunningWrite) {
        const sx =
          smallerStyle === 'A'
            ? startX + (`a bytes (${c.littleEndian ? 'LE' : 'BE'})`.length * 14.5 * CHAR + 14) + tileW / 2
            : startX + (`${meta.writeAction.valueText} (1 B)`.length * 15 * CHAR + 14) + tileW / 2;
        const sy = stripY;
        const ex = xOf(meta.targetAddress) + byteW / 2;
        const ey = gridY + 70;
        const midY = (sy + ey) / 2;
        const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
        const begin = 0.25;
        const dur = 0.85;
        flight +=
          `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, begin + dur)}<path d="${path}" fill="none" stroke="${P.write}" stroke-width="2.6"/></g>` +
          `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(begin + dur + 0.05)}` +
          rect(-20, -14, 40, 28, P.panel, P.write, 6, 2.2) +
          text(0, 6, hex2(writtenByte), 15, P.write, 'middle') +
          `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
      }
    }
  }

  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    arcMarkup +
    mem +
    targetBox +
    belowOverlay +
    pane(c, animate && copies(c.m.steps, c.index)) +
    wb +
    output(c) +
    gridTransfers(c, meta, sim, xOf, byteW, gridY, cellH) +
    flight
  );
}

function makeView(smallerStyle: SmallerStyle): TraceView {
  return {
    geometry: m => {
      const meta = META.get(m.trace)!;
      const extraMemBottom =
        meta.direction === 'smaller'
          ? smallerStyle === 'C'
            ? 140
            : smallerStyle === 'B'
              ? 100
              : 86
          : 98;
      return {
        minByteWidth: 46,
        minColumnWidth: 780,
        cellHeight: 88,
        extraMemBottom,
        extraPaneHeight: 62,
        skipWrap: true,
      };
    },
    stackBelow: 900,
    maxScale: 0.72,
    byteOrder: true,
    scene: c => foldedScene(c, smallerStyle),
    stepSeconds: punningStepSeconds,
  };
}

// ============================================================================================
// PROTOTYPE SHELL + FLOATING VARIANT SWITCHER (?variant=A|B|C)
// ============================================================================================

interface VariantDef {
  key: SmallerStyle;
  name: string;
  summary: string;
  bullets: string[];
  view: TraceView;
}

const VARIANTS: VariantDef[] = [
  {
    key: 'A',
    name: 'A · Spotlight veil + reassembly strip',
    summary:
      'Folded hex layout and bold target box. For smaller pointers (scenarios 3–4), bytes 65..67 sit under a frosted blind-spot veil, a dashed slice cuts byte 64 off from the rest of a, and the pane shows all 4 bytes of a reassembling (new + 3 kept -> new decimal value).',
    bullets: [
      'Scenarios 1–2 share the folded design: clean arrow, bold target box, red spilled bytes, ⚠ UB.',
      'Scenarios 3–4 veil the 3 unreachable bytes inside a and show the 4-byte splice in the pane.',
      'Press Play on any player to watch every step animate from line 1.',
    ],
    view: makeView('A'),
  },
  {
    key: 'B',
    name: 'B · Inline diff + LSB/MSB + 1/4 coverage bar',
    summary:
      'Puts the smaller-pointer mutation right on memory: a’s header shows old -> new, byte 64 shows old hex struck through to new hex, an LSB -> MSB arrow shows which end of the int is being hit, and a 4-slot coverage meter marks ⚠ 1 / 4 bytes.',
    bullets: [
      'Direct visual symmetry with the larger-pointer UB badge (⚠ 1 / 4 bytes under the coverage meter).',
      'Flip Little-endian / Big-endian to see the LSB -> MSB arrow reverse and explain 5 -> 33554437.',
      'All native step animations run from line 1 when you hit Play.',
    ],
    view: makeView('B'),
  },
  {
    key: 'C',
    name: 'C · Zoomed byte-slice card with place values',
    summary:
      'Drops a tethered 4-byte microscope card under a showing each byte’s positional weight (× 1, × 256, × 2¹⁶, × 2²⁴). Byte 64 shows written (05 -> 00) while surviving non-zero bytes highlight as "kept!" so a = 256 is self-evident.',
    bullets: [
      'Connects Lab 3 binary/hex place values directly to Lab 4 pointer writes.',
      'Place values flip automatically when toggling Little-endian / Big-endian.',
      'Surviving non-zero bytes stand out immediately when *b = 0 leaves a = 256.',
    ],
    view: makeView('C'),
  },
];

let players: Player[] = [];

function currentVariantKey(): SmallerStyle {
  const param = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return param === 'B' || param === 'C' ? param : 'A';
}

function setVariantKey(key: SmallerStyle): void {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', key);
  window.history.replaceState(null, '', url.toString());
  mountVariant(key);
}

function mountVariant(key: SmallerStyle): void {
  for (const p of players) p.disconnect();
  players = [];

  const def = VARIANTS.find(v => v.key === key) ?? VARIANTS[0];
  const about = document.getElementById('about')!;
  about.innerHTML =
    `<p><strong>${esc(def.name)}</strong> — ${esc(def.summary)}</p>` +
    `<ul>${def.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;

  const label = document.getElementById('label')!;
  label.textContent = def.name;

  const sections = document.getElementById('sections')!;
  sections.innerHTML = '';

  for (const { trace, meta } of SCENARIOS) {
    const sec = document.createElement('section');
    sec.className = 'scenario';
    sec.innerHTML =
      `<h2>${esc(meta.title)}</h2>` +
      `<p class="note">${esc(meta.subtitle)}</p>` +
      `<div class="course-visualization"></div>`;
    sections.append(sec);
    const host = sec.querySelector('.course-visualization') as HTMLElement;
    const player = new Player(host, trace, def.view);
    // Land on the final state for quick side-by-side comparison; clicking Play replays from step 1
    // with all native value-flight, address-pickup, arrow-growth, and byte-write animations active.
    player.settle(trace.steps.length - 1);
    players.push(player);
  }
}

function cycleVariant(delta: number): void {
  const keys = VARIANTS.map(v => v.key);
  const idx = keys.indexOf(currentVariantKey());
  const next = keys[(idx + delta + keys.length) % keys.length];
  setVariantKey(next);
}

function init(): void {
  document.getElementById('prev')!.addEventListener('click', () => cycleVariant(-1));
  document.getElementById('next')!.addEventListener('click', () => cycleVariant(1));
  document.getElementById('theme')!.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    for (const p of players) p.refresh();
  });
  window.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    if (target && (target.matches('input, select, textarea') || target.isContentEditable)) return;
    if (event.key === '[') {
      event.preventDefault();
      cycleVariant(-1);
    } else if (event.key === ']') {
      event.preventDefault();
      cycleVariant(1);
    }
  });
  mountVariant(currentVariantKey());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
