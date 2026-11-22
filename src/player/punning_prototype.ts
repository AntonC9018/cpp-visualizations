// PROTOTYPE, throwaway (pointer type punning with larger and smaller pointee types, #60).
// Clean folded design:
//   - Plain Lab 4 C++ (no reinterpret_cast), all native step animations active
//   - Byte-accurate horizontal hex memory strip (reusing bits_view style, no "pad" text)
//   - Clean overhead pointer arc (no type pill on arrow) landing on a clean scope box around
//     the exact bytes the pointer covers
//   - Larger pointer: calm 4-byte scope before write; red spilled bytes + "⚠ UB" ONLY on write
//   - Clean byte tiles in pane with no tiny sub-labels
//
// Three clean variations (?variant=A|B|C) for the smaller-pointer case (scenarios 3–4):
//   A: Subtle veil on untouched bytes + clean 4-byte reassembly strip in pane
//   B: Inline old->new header on `a` + clean LSB->MSB arrow below `a`
//   C: Minimalist (clean 1-byte scope + dimmed untouched bytes, nothing extra)
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
  /** True only once the larger pointer actually writes out of bounds. */
  ubTriggered: boolean;
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
  const writeDone = stepIndex >= meta.writeAction.stepIndex;
  const wStart = meta.targetAddress;
  const wEnd = meta.targetAddress + meta.pointeeSize;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const tStart = targetVar.address;
  const tEnd = targetVar.address + targetVar.size;

  const bytes: ByteSlot[] = [];
  let ubTriggered = false;
  const corruptedVars = new Set<string>();

  for (let i = 0; i < meta.totalBytes; i++) {
    const address = meta.baseAddress + i;
    const owner = ownerAt(meta, address);
    const inWindow = ptrLive && address >= wStart && address < wEnd;
    let status: AccessStatus = 'none';
    if (inWindow) {
      if (!owner) {
        status = 'padding';
        if (writeDone) ubTriggered = true;
      } else if (owner.name === meta.targetVar) {
        status = 'owned';
      } else {
        status = 'foreign';
        if (writeDone) {
          ubTriggered = true;
          corruptedVars.add(owner.name);
        }
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
    ubTriggered,
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
      hold: 1.2,
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
    subtitle: 'Scope covers 4 bytes (64..67) calmly while pointing; writing *b = 300 spills into padding and triggers UB.',
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
      hold: 1.2,
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
    subtitle: 'a (64) and c (65) sit side by side. Writing *b = 0x04030201 overwrites c and padding.',
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
    subtitle: '*b = 2 changes only byte 64. Flip Little-endian / Big-endian to see a become 2 vs 33554437.',
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
    subtitle: '261 is 05 01 00 00 (LE). *b = 0 clears only byte 64, leaving byte 65 (01) -> a becomes 256.',
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
// SHARED SVG HELPERS + NATIVE TRANSFERS
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
    `<rect width="9" height="9" fill="${P.deadFill}" fill-opacity="0.58"/>` +
    `<line x1="0" y1="0" x2="0" y2="9" stroke="${P.gapStroke}" stroke-opacity="0.45" stroke-width="1.6"/>` +
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
  if (meta && index === meta.writeAction.stepIndex) return m.steps[index].hold + 2.3;
  if (meta && index === meta.derefStep) return m.steps[index].hold + 1.6;
  return stepSeconds(m.steps, index);
}

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
// CLEAN, TONED-DOWN SCOPE BOX AROUND THE BYTES THE POINTER POINTS AT
// ============================================================================================

function targetScopeBox(
  c: SceneContext,
  meta: PunningMeta,
  sim: SimState,
  xOf: (addr: number) => number,
  byteW: number,
  gridY: number,
  cellH: number,
  pCol: string
): string {
  if (!sim.ptrLive) return '';
  const { P, animate, op } = c;
  const at = op ? arrival(op) : 0;
  const wLeft = xOf(meta.targetAddress);
  const wWidth = meta.pointeeSize * byteW;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const ownEnd = xOf(targetVar.address + targetVar.size);

  const pad = 2.5;
  const bx = wLeft - pad;
  const bw = wWidth + 2 * pad;
  const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
  const isDeref = animate && c.index === meta.derefStep;
  const hot = sim.windowActive;

  let box = '';
  if (meta.direction === 'larger') {
    const by = gridY - pad;
    const bh = cellH + 2 * pad;
    if (!sim.ubTriggered) {
      // Before writing: calm, clean 4-byte scope in pointer's color (no red / no UB yet!)
      box += rect(bx, by, bw, bh, 'none', pCol, 5, 3);
    } else {
      // On/after write: owned slice in write-gold, spilled slice in red — straight clean seam!
      const splitX = ownEnd;
      const calm = rect(bx, by, bw, bh, 'none', pCol, 5, 3);
      const breached =
        `<path d="M ${round(splitX)} ${round(by)} H ${round(bx + 5)} Q ${round(bx)} ${round(by)} ${round(bx)} ${round(by + 5)} ` +
        `V ${round(by + bh - 5)} Q ${round(bx)} ${round(by + bh)} ${round(bx + 5)} ${round(by + bh)} H ${round(splitX)}" ` +
        `fill="none" stroke="${P.write}" stroke-width="3.2" stroke-linecap="round"/>` +
        `<path d="M ${round(splitX)} ${round(by)} H ${round(bx + bw - 5)} Q ${round(bx + bw)} ${round(by)} ${round(bx + bw)} ${round(by + 5)} ` +
        `V ${round(by + bh - 5)} Q ${round(bx + bw)} ${round(by + bh)} ${round(bx + bw - 5)} ${round(by + bh)} H ${round(splitX)}" ` +
        `fill="none" stroke="${P.error}" stroke-width="3.4" stroke-linecap="round"/>`;
      box += animate && sim.isPunningWrite
        ? `<g>${hide(at)}${calm}</g><g opacity="0">${show(at)}${breached}</g>`
        : breached;
    }
  } else {
    // Smaller pointer: one clean rounded rectangle around byte 64's cell (no corner ticks, no glow, no slice line)
    const splitY = gridY + 48;
    const sby = splitY - 1;
    const sbh = gridY + cellH - splitY + pad + 1;
    const col = hot ? P.write : pCol;
    box += rect(bx, sby, bw, sbh, 'none', col, 4, 3);
  }

  if (isWritingPtr) {
    return `<g opacity="0">${fade(0, 1, 0.3, at + 0.55)}${box}</g>`;
  }
  if (isDeref) {
    const cy = meta.direction === 'larger' ? gridY + cellH / 2 : gridY + 68;
    const cx = bx + bw / 2;
    return `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.15)}<g transform="translate(${round(-cx)} ${round(-cy)})">${box}</g></g></g>`;
  }
  return box;
}

// ============================================================================================
// CLEAN FOLDED SCENE WITH 3 SMALLER-POINTER VARIATIONS (A / B / C)
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

  // 2. Padding runs (hatched only; red UB fill ONLY when write occurs!)
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
      if (slot.status === 'padding' && sim.ubTriggered) {
        const hexText = typeof slot.after === 'number' ? hex2(slot.after) : '??';
        const badgeBg = rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3);
        const hazard =
          rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 1.6) +
          badgeBg +
          text(bx + byteW / 2, hexY, hexText, 15.5, P.error, 'middle');
        if (animate && sim.isPunningWrite) {
          const revealAt = at + 0.08 * (addr - meta.targetAddress);
          mem +=
            `<g>${hide(revealAt)}${text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle')}</g>` +
            `<g opacity="0">${show(revealAt)}${hazard}</g>`;
        } else {
          mem += hazard;
        }
      } else {
        mem += text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle');
      }
    }
  }

  // Staggered rows for variable type pills so adjacent 1-byte variables never collide
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
    const borderCol = isCorrupted ? P.error : on ? col : P.deadStroke;

    let markup = '';
    markup += rect(vx + 1, gridY + 1, vw - 2, cellH - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Per-byte backgrounds inside the variable
    for (let k = 0; k < v.size; k++) {
      const addr = v.address + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);
      if (slot.status === 'foreign' && sim.ubTriggered) {
        const bg = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, 'none', 0);
        markup +=
          animate && sim.isPunningWrite
            ? `<g opacity="0">${show(at + 0.08 * (addr - meta.targetAddress))}${bg}</g>`
            : bg;
      } else if (slot.status === 'owned' && sim.windowActive) {
        const bg = rect(bx + 1.5, splitY, byteW - 3, cellH - (splitY - gridY) - 1.5, P.writeFill, 'none', 0);
        markup +=
          animate && c.index === meta.derefStep
            ? `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${bg}</g>`
            : bg;
      } else if (slot.status === 'untouched' && meta.direction === 'smaller' && smallerStyle === 'A') {
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

    // Outer variable border (only turns red once corrupted by write!)
    if (animate && sim.isPunningWrite && isCorrupted) {
      markup +=
        `<g>${hide(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', col, 0, 2.8)}</g>` +
        `<g opacity="0">${show(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', P.error, 0, 3.2)}</g>`;
    } else {
      markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);
    }

    // Value header + per-byte hex
    const renderBody = (val: number | null, useBefore: boolean): string => {
      if (val === null) return '';
      let body = '';
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
          slot.status === 'foreign' && sim.ubTriggered && !useBefore
            ? P.error
            : slot.status === 'owned' && c.index >= meta.writeAction.stepIndex && !useBefore
              ? P.write
              : v.kind === 'ptr'
                ? P.muted
                : P.fg;
        const opAttr =
          isUntouched && (smallerStyle === 'A' || smallerStyle === 'C')
            ? ' opacity="0.4"'
            : isUntouched && smallerStyle === 'B'
              ? ' opacity="0.55"'
              : v.kind === 'ptr'
                ? ' opacity="0.65"'
                : '';
        if (slot.status === 'foreign' && sim.ubTriggered && !useBefore) {
          body += rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3);
        }
        body += `<g${opAttr}>${text(bx + byteW / 2, hexY, hex2(bval), v.kind === 'ptr' ? 13 : 15.5, byteInk, 'middle')}</g>`;
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

    // Read/write highlight outline on normal steps
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
    const nameCol = isCorrupted ? P.error : on ? col : P.grey;
    if (animate && sim.isPunningWrite && isCorrupted) {
      markup +=
        `<g>${hide(at)}${text(vx + vw / 2, gridY + cellH + 26 + labelOffset, v.name, 20, col, 'middle')}</g>` +
        `<g opacity="0">${show(at)}${text(vx + vw / 2, gridY + cellH + 26 + labelOffset, v.name, 20, P.error, 'middle')}</g>`;
    } else {
      markup += text(vx + vw / 2, gridY + cellH + 26 + labelOffset, v.name, 20, nameCol, 'middle');
    }
    markup += typeLabel(c, vx + vw / 2, pillTop, v.type, 13.5, on ? typeColour(c, v.type) : P.deadStroke);

    const keepBright =
      isCorrupted ||
      (sim.ptrLive && (v.name === meta.targetVar || v.name === meta.ptrName));
    mem += keepBright ? markup : dim(c, v.name, markup);
  }

  // 4. Clean overhead pointer arc from `b` (no text on arrow)
  let arcMarkup = '';
  if (sim.ptrLive) {
    const sx = xOf(ptrVar.address) + (ptrVar.size * byteW) / 2;
    const ex = xOf(meta.targetAddress) + byteW * 0.5;
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

  // 5. Clean scope box around the exact bytes the pointer covers
  const scopeBox = targetScopeBox(c, meta, sim, xOf, byteW, gridY, cellH, pCol);

  // 6. Below-memory indicator:
  //    - Larger pointer: ONLY when ubTriggered (i.e. on write!), show clean bracket + "⚠ UB"
  //    - Smaller pointer: NO extra brackets/pills below! Only Variant B adds the clean bits_view LSB->MSB arrow
  let belowOverlay = '';
  if (meta.direction === 'larger' && sim.ubTriggered) {
    const wLeft = xOf(meta.targetAddress);
    const wRight = xOf(meta.targetAddress + meta.pointeeSize);
    const ownEnd = xOf(targetVar.address + targetVar.size);
    const brY = gridY + cellH + 38 + pillRowsCount * 24 + 8;
    const tickTop = brY - 10;
    const cal =
      `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${P.write}" stroke-width="2.2"/>` +
      `<path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="2.8"/>` +
      pill((ownEnd + wRight) / 2, brY + 18, '⚠ UB', 13.5, P.error, P.error, P.bg);
    belowOverlay += animate && sim.isPunningWrite
      ? `<g opacity="0">${fade(0, 1, 0.25, at)}${cal}</g>`
      : cal;
  }

  if (meta.direction === 'smaller' && smallerStyle === 'B' && sim.varAfter.get(targetVar.name) !== null) {
    // Variant B: clean LSB -> MSB arrow from bits_view.ts directly below `a`
    const ay = gridY + cellH + 10;
    const xLow = xOf(targetVar.address) + (c.littleEndian ? byteW / 2 : targetVar.size * byteW - byteW / 2);
    const xHigh = xOf(targetVar.address) + (c.littleEndian ? targetVar.size * byteW - byteW / 2 : byteW / 2);
    const dir = c.littleEndian ? 1 : -1;
    belowOverlay +=
      `<g opacity="0.8">` +
      `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${P.muted}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<path d="M -8 -4 L 0 0 L -8 4 Z" fill="${P.muted}" transform="translate(${round(xHigh)} ${ay}) rotate(${c.littleEndian ? 0 : 180})"/>` +
      text(xLow, ay + 12, 'LSB', 9.5, P.muted, 'middle') +
      text(xHigh, ay + 12, 'MSB', 9.5, P.muted, 'middle') +
      '</g>';
  }

  // 7. Clean pane byte strip + byte-tile flight (NO tiny sub-labels under tiles!)
  let wb = '';
  let flight = '';
  if (sim.windowActive) {
    const stripY = g.ty + 30;
    const tileW = 44;
    const tileH = 30;
    const tileGap = 6;
    const startX = g.tx + 10;

    if (meta.direction === 'larger') {
      const bytes = sim.writtenBytes;
      const labelStr = `${meta.writeAction.valueText} (${c.littleEndian ? 'LE' : 'BE'})`;
      wb += text(startX, stripY + 20, labelStr, 15, P.muted);
      const tilesX = startX + labelStr.length * 15 * CHAR + 14;
      for (let k = 0; k < bytes.length; k++) {
        const addr = meta.targetAddress + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bad = sim.ubTriggered && (slot.status === 'padding' || slot.status === 'foreign');
        const tx = tilesX + k * (tileW + tileGap);
        const stroke = bad ? P.error : P.write;
        const fill = bad ? P.panel : P.writeFill;
        wb +=
          rect(tx, stripY, tileW, tileH, fill, stroke, 5, 2) +
          text(tx + tileW / 2, stripY + 20, hex2(bytes[k]), 15.5, stroke, 'middle');

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
          const flyCol = slot.status === 'padding' || slot.status === 'foreign' ? P.error : P.write;
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
            text(0, 6, hex2(bytes[k]), 15, flyCol, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        }
      }
    } else {
      const writtenByte = sim.writtenBytes[0];
      if (smallerStyle === 'A') {
        // Variant A: Clean 4-byte reassembly strip — no small sub-labels!
        const labelStr = `a (${c.littleEndian ? 'LE' : 'BE'})`;
        wb += text(startX, stripY + 20, labelStr, 15, P.muted);
        const tilesX = startX + labelStr.length * 15 * CHAR + 14;
        for (let k = 0; k < targetVar.size; k++) {
          const addr = targetVar.address + k;
          const slot = sim.bytes[addr - meta.baseAddress];
          const hit = k === 0;
          const tx = tilesX + k * (tileW + tileGap);
          const bval = typeof slot.after === 'number' ? slot.after : 0;
          const stroke = hit ? P.write : P.gapStroke;
          const fill = hit ? P.writeFill : P.deadFill;
          wb +=
            rect(tx, stripY, tileW, tileH, fill, stroke, 5, hit ? 2.2 : 1.4) +
            text(tx + tileW / 2, stripY + 20, hex2(bval), 15.5, hit ? P.write : P.muted, 'middle');
        }
        const aVal = sim.varAfter.get(targetVar.name) ?? 0;
        const eqX = tilesX + targetVar.size * (tileW + tileGap) + 12;
        wb += text(eqX, stripY + 21, `→ a = ${aVal}`, 16, P.fg);
      } else {
        // Variant B & C: Clean single byte tile — no small sub-label!
        const labelStr = `${meta.writeAction.valueText}`;
        wb += text(startX, stripY + 20, labelStr, 15, P.muted);
        const tx = startX + labelStr.length * 15 * CHAR + 14;
        wb +=
          rect(tx, stripY, tileW, tileH, P.writeFill, P.write, 5, 2) +
          text(tx + tileW / 2, stripY + 20, hex2(writtenByte), 15.5, P.write, 'middle');
      }

      if (animate && sim.isPunningWrite) {
        const sx =
          smallerStyle === 'A'
            ? startX + (`a (${c.littleEndian ? 'LE' : 'BE'})`.length * 15 * CHAR + 14) + tileW / 2
            : startX + (`${meta.writeAction.valueText}`.length * 15 * CHAR + 14) + tileW / 2;
        const sy = stripY;
        const ex = xOf(meta.targetAddress) + byteW / 2;
        const ey = gridY + 70;
        const midY = (sy + ey) / 2;
        const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
        const begin = 0.25;
        const dur = 0.85;
        flight +=
          `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, begin + dur)}<path d="${path}" fill="none" stroke="${P.write}" stroke-width="2.4"/></g>` +
          `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(begin + dur + 0.05)}` +
          rect(-20, -14, 40, 28, P.panel, P.write, 6, 2) +
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
    scopeBox +
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
        meta.direction === 'larger' ? 96 : smallerStyle === 'B' ? 54 : 38;
      return {
        minByteWidth: 46,
        minColumnWidth: 780,
        cellHeight: 88,
        extraMemBottom,
        extraPaneHeight: 50,
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
    name: 'A · Subtle veil + clean 4-byte pane strip',
    summary:
      'Clean scope box on byte 64, subtle diagonal veil on untouched bytes 65..67, and a clean 4-byte reassembly strip in the pane (no tiny sub-labels, nothing extra below memory).',
    bullets: [
      'Larger pointers keep a calm 4-byte scope until the write step, then show red spilled bytes and ⚠ UB.',
      'Smaller pointers veil bytes 65..67 and show the four resulting bytes recombining in the pane.',
    ],
    view: makeView('A'),
  },
  {
    key: 'B',
    name: 'B · Inline old→new header + LSB→MSB arrow',
    summary:
      'Clean scope box on byte 64, old → new decimal mutation right in a’s header, and the bits-view LSB → MSB arrow under a so LE/BE impact is obvious without extra cards.',
    bullets: [
      'Flip Little-endian / Big-endian to see the LSB → MSB arrow reverse alongside 5 → 33554437.',
      'Pane shows only the single written byte tile.',
    ],
    view: makeView('B'),
  },
  {
    key: 'C',
    name: 'C · Minimal (clean scope + dimmed untouched bytes)',
    summary:
      'Stripped to the essentials: clean 1-byte scope box on byte 64, untouched bytes 65..67 gently dimmed, and a single written byte tile in the pane.',
    bullets: [
      'Zero extra visual widgets; relies purely on the scope box, flying byte, and updated value of a.',
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
