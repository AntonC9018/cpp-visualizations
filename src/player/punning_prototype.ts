// PROTOTYPE, throwaway (pointer type punning with larger and smaller pointee types, #60).
// Three structurally different UI variants on top of the real Player, switchable via ?variant=A|B|C:
//   A: Unified byte-accurate horizontal strip + overhead pointer arc + caliper footprint bracket + UB breach
//   B: Dual-track alignment view (ground-truth memory above, *b type lens below, vertical impact beams)
//   C: Vertical byte-address memory tape (1 row per byte; left ownership rail vs right pointer access rail)
import type { ExecutionTrace, ScalarVariable, TraceStep } from '../core/trace_format.ts';
import { codeLayout, columnsForCode, placeCodeRows } from './code_layout.ts';
import {
  CHAR,
  CODE_CHAR,
  CODE_SIZE,
  EASE,
  LABEL,
  MARGIN,
  PANE_MAX,
  PANE_MIN,
  T,
  type Palette,
  VARIABLE_COLOURS,
} from './constants.ts';
import { type Geometry, geometry, paneLabels, typeLabelWidth } from './geometry.ts';
import { type PreparedModel, arrival, copies, stepSeconds } from './model.ts';
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
  derefStep: number;
  writeAction: PunningWriteAction;
  /** Normal variable initializations/writes before the punning write. */
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
const bin8 = (b: number): string => {
  const s = b.toString(2).padStart(8, '0');
  return `${s.slice(0, 4)} ${s.slice(4)}`;
};

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
  const beforeMem = stepIndex > 0 ? snapshotAt(meta, stepIndex - 1, littleEndian) : snapshotAt(meta, 0, littleEndian);
  const afterMem = snapshotAt(meta, stepIndex, littleEndian);
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
    const inWindow = windowActive && address >= wStart && address < wEnd;
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
    } else if (windowActive && address >= tStart && address < tEnd) {
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
    windowActive,
    isPunningWrite,
    writtenBytes: encodeBytes(meta.writeAction.value, meta.pointeeSize, littleEndian),
  };
}

// ============================================================================================
// SCENARIOS (4 BYTE-ACCURATE CASES)
// ============================================================================================

function makeScenario1(): { trace: ExecutionTrace; meta: PunningMeta } {
  // uint8_t a{ 5 };        @ 64 (1B), padding @ 65..67 (3B)
  // int c{ 10 };           @ 68..71 (4B)
  // int* b{ reinterpret_cast<int*>(&a) };  @ 72..79 (8B)
  // *b = 300;              writes 4B @ 64..67 -> a + 3 padding bytes!
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
    'int* b{ reinterpret_cast<int*>(&a) };',
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
    {
      line: 2,
      pane: 'int* b{ reinterpret_cast<int*>(&a) }',
      expr: [8, 34],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: null,
    },
    {
      line: 2,
      pane: 'int* b{ reinterpret_cast<int*>(64) }',
      expr: [8, 34],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [31, 33] },
    },
    {
      line: 2,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'convert', value: '64', span: [8, 34], from: 'uint8_t*', to: 'int*' },
    },
    {
      line: 2,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.0,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 3, pane: '*b = 300', expr: [0, 2], values: v3, targets: { b: 'a' }, stdout: '', hold: 0.8, op: null },
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
      pane: '*(int*)64 = 300',
      expr: [0, 9],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.3,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 3,
      pane: '*(int*)64 = 300',
      expr: [12, 15],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '300', span: [12, 15], destination: [0, 9] },
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
    subtitle: 'uint8_t a at 64 (1 B), 3 bytes padding at 65..67, int c at 68..71. *b = 300 writes 4 bytes (64..67).',
    direction: 'larger',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'int',
    pointeeSize: 4,
    targetVar: 'a',
    targetAddress: 64,
    derefStep: 10,
    writeAction: { stepIndex: 11, value: 300, valueText: '300' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 10 },
      { stepIndex: 7, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario2(): { trace: ExecutionTrace; meta: PunningMeta } {
  // uint8_t a{ 5 };        @ 64 (1B)
  // uint8_t c{ 9 };        @ 65 (1B), padding @ 66..67 (2B)
  // int d{ 10 };           @ 68..71 (4B)
  // int* b{ reinterpret_cast<int*>(&a) };  @ 72..79 (8B)
  // *b = 0x04030201;       writes 4B @ 64..67 -> a, CORRUPTS c, + 2 padding bytes!
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
    'int* b{ reinterpret_cast<int*>(&a) };',
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
    {
      line: 3,
      pane: 'int* b{ reinterpret_cast<int*>(&a) }',
      expr: [8, 34],
      values: v3,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: null,
    },
    {
      line: 3,
      pane: 'int* b{ reinterpret_cast<int*>(64) }',
      expr: [8, 34],
      values: v3,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'addr', name: 'a', value: '64', span: [31, 33] },
    },
    {
      line: 3,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v3,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'convert', value: '64', span: [8, 34], from: 'uint8_t*', to: 'int*' },
    },
    {
      line: 3,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.0,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 4, pane: '*b = 0x04030201', expr: [0, 2], values: v4, targets: { b: 'a' }, stdout: '', hold: 0.8, op: null },
    {
      line: 4,
      pane: '*64 = 0x04030201',
      expr: [0, 3],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.8,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 4,
      pane: '*(int*)64 = 0x04030201',
      expr: [0, 9],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.3,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 4,
      pane: '*(int*)64 = 0x04030201',
      expr: [12, 22],
      values: v5,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '0x04030201', span: [12, 22], destination: [0, 9] },
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
    subtitle: 'a (64) and c (65) sit side by side, followed by 2 padding bytes (66..67). *b = 0x04030201 overwrites c without naming it.',
    direction: 'larger',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'int',
    pointeeSize: 4,
    targetVar: 'a',
    targetAddress: 64,
    derefStep: 12,
    writeAction: { stepIndex: 13, value: 0x04030201, valueText: '0x04030201' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 9 },
      { stepIndex: 5, varName: 'd', value: 10 },
      { stepIndex: 9, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario3(): { trace: ExecutionTrace; meta: PunningMeta } {
  // int a = 5;             @ 64..67 (4B), padding @ 68..71 (4B)
  // uint8_t* b = reinterpret_cast<uint8_t*>(&a); @ 72..79 (8B)
  // *b = 2;                overwrites ONLY byte 64 of a!
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
    'uint8_t* b = reinterpret_cast<uint8_t*>(&a);',
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
    {
      line: 1,
      pane: 'uint8_t* b = reinterpret_cast<uint8_t*>(&a)',
      expr: [13, 43],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: null,
    },
    {
      line: 1,
      pane: 'uint8_t* b = reinterpret_cast<uint8_t*>(64)',
      expr: [13, 43],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [40, 42] },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'convert', value: '64', span: [13, 43], from: 'int*', to: 'uint8_t*' },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.0,
      op: { kind: 'write', name: 'b', value: '64', span: [13, 15], destination: [9, 10] },
    },
    { line: 2, pane: '*b = 2', expr: [0, 2], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.8, op: null },
    {
      line: 2,
      pane: '*64 = 2',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.8,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 2,
      pane: '*(uint8_t*)64 = 2',
      expr: [0, 13],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.2,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 2,
      pane: '*(uint8_t*)64 = 2',
      expr: [16, 17],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '2', span: [16, 17], destination: [0, 13] },
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
    subtitle: 'int a spans 64..67 (4 B). *b = 2 touches only byte 64. Flip LE/BE to see a become 2 vs 33554437.',
    direction: 'smaller',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'uint8_t',
    pointeeSize: 1,
    targetVar: 'a',
    targetAddress: 64,
    derefStep: 8,
    writeAction: { stepIndex: 9, value: 2, valueText: '2' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 5, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario4(): { trace: ExecutionTrace; meta: PunningMeta } {
  // int a = 261; (0x00000105 -> LE: 05 01 00 00) @ 64..67, padding @ 68..71
  // uint8_t* b = reinterpret_cast<uint8_t*>(&a); @ 72..79
  // *b = 0; -> LE: 00 01 00 00 (a becomes 256, not 0!)
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
    'uint8_t* b = reinterpret_cast<uint8_t*>(&a);',
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
    {
      line: 1,
      pane: 'uint8_t* b = reinterpret_cast<uint8_t*>(&a)',
      expr: [13, 43],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: null,
    },
    {
      line: 1,
      pane: 'uint8_t* b = reinterpret_cast<uint8_t*>(64)',
      expr: [13, 43],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [40, 42] },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'convert', value: '64', span: [13, 43], from: 'int*', to: 'uint8_t*' },
    },
    {
      line: 1,
      pane: 'uint8_t* b = 64',
      expr: [13, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.0,
      op: { kind: 'write', name: 'b', value: '64', span: [13, 15], destination: [9, 10] },
    },
    { line: 2, pane: '*b = 0', expr: [0, 2], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.8, op: null },
    {
      line: 2,
      pane: '*64 = 0',
      expr: [0, 3],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.8,
      op: { kind: 'read', name: 'b', value: '64', span: [1, 2] },
    },
    {
      line: 2,
      pane: '*(uint8_t*)64 = 0',
      expr: [0, 13],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.2,
      op: { kind: 'deref', target: 'a', via: 'b', span: [0, 3] },
    },
    {
      line: 2,
      pane: '*(uint8_t*)64 = 0',
      expr: [16, 17],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'a', value: '0', span: [16, 17], destination: [0, 13] },
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
    title: '4. Smaller pointer leaves upper bytes surviving (a = 261, *b = 0)',
    subtitle: '261 is 05 01 00 00 (LE). Writing 0 through uint8_t* clears only byte 64, leaving byte 65 (01) -> a becomes 256.',
    direction: 'smaller',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'uint8_t',
    pointeeSize: 1,
    targetVar: 'a',
    targetAddress: 64,
    derefStep: 8,
    writeAction: { stepIndex: 9, value: 0, valueText: '0' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 261 },
      { stepIndex: 5, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

const SCENARIOS = [makeScenario1(), makeScenario2(), makeScenario3(), makeScenario4()];

// ============================================================================================
// SHARED SVG HELPERS (PATTERNS, BADGES, STEP TIMING)
// ============================================================================================

let patternSeq = 0;

function hatchDefs(P: Palette): { defs: string; padId: string; ubId: string } {
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
    `<rect width="10" height="10" fill="${P.error}" fill-opacity="0.12"/>` +
    `<line x1="0" y1="0" x2="0" y2="10" stroke="${P.error}" stroke-opacity="0.28" stroke-width="2.6"/>` +
    '</pattern>' +
    '</defs>';
  return { defs, padId, ubId };
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

/** Jagged boundary-breach crack drawn vertically at x from y1 to y2. */
function breachCrack(x: number, y1: number, y2: number, color: string): string {
  const steps = 6;
  const dy = (y2 - y1) / steps;
  let d = `M ${round(x)} ${round(y1)}`;
  for (let i = 1; i <= steps; i++) {
    const nx = x + (i === steps ? 0 : i % 2 === 1 ? -4.5 : 4.5);
    d += ` L ${round(nx)} ${round(y1 + i * dy)}`;
  }
  return (
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`
  );
}

function punningStepSeconds(m: PreparedModel, index: number): number {
  const meta = META.get(m.trace);
  if (meta && index === meta.writeAction.stepIndex) {
    return m.steps[index].hold + 2.5;
  }
  if (meta && index === meta.derefStep) {
    return m.steps[index].hold + 1.9;
  }
  return stepSeconds(m.steps, index);
}

/** Contiguous padding runs in `[baseAddress, baseAddress + totalBytes)`. */
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

// ============================================================================================
// VARIANT A: UNIFIED BYTE STRIP + OVERHEAD POINTER ARC + CALIPER FOOTPRINT BRACKET
// ============================================================================================

function variantAScene(c: SceneContext): string {
  const meta = META.get(c.m.trace)!;
  const sim = simulate(meta, c.index, c.littleEndian);
  const { g, P, animate, op, step, prev } = c;
  const { defs, padId, ubId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;

  const byteW = (g.pane.w - 48) / meta.totalBytes;
  const gridX = g.memX;
  const gridY = g.memY;
  const cellH = 88;
  const splitY = gridY + 48;
  const xOf = (addr: number): number => gridX + (addr - meta.baseAddress) * byteW;
  const at = op ? arrival(op) : 0;

  let mem = '';

  // 1. Address ruler above every byte (byte-accurate, zero gaps)
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

  // 2. Padding runs (hatched by default; breached bytes turn red hazard on/after write or deref)
  for (const run of paddingRuns(meta)) {
    const rx = xOf(run.start);
    const rw = run.size * byteW;
    mem += rect(rx + 1, gridY + 1, rw - 2, cellH - 2, `url(#${padId})`, P.gapStroke, 0, 1.5);
    // Individual padding byte dividers & contents
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
          rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 2.2) +
          badgeBg +
          text(bx + byteW / 2, hexY, hexText, 15.5, P.error, 'middle');
        if (animate && sim.isPunningWrite) {
          const revealAt = at + 0.08 * (addr - meta.targetAddress);
          mem +=
            `<g>${hide(revealAt)}` +
            rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 1.6) +
            badgeBg +
            text(bx + byteW / 2, hexY, '??', 14, P.error, 'middle') +
            '</g>' +
            `<g opacity="0">${show(revealAt)}${hazard}</g>`;
        } else if (animate && c.index === meta.derefStep) {
          mem +=
            text(bx + byteW / 2, hexY, '??', 14, P.grey, 'middle') +
            `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${hazard}</g>`;
        } else {
          mem += hazard;
        }
      } else {
        mem += text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle');
      }
    }
    // Subtle padding tag below
    mem += text(rx + rw / 2, gridY + cellH + 22, 'pad', 14.5, P.grey, 'middle');
  }

  // Compute non-overlapping rows for variable type pills below the strip
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

  // 3. Variables (flush on the exact byte grid)
  for (const v of meta.vars) {
    const vx = xOf(v.address);
    const vw = v.size * byteW;
    const col = varColor(P, v);
    const valAfter = sim.varAfter.get(v.name) ?? null;
    const valBefore = sim.varBefore.get(v.name) ?? null;
    const on = valAfter !== null;
    const isCorrupted = sim.corruptedVars.has(v.name);
    const isForeignThreat =
      sim.windowActive &&
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
        markup += animate && c.index === meta.derefStep
          ? `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${bg}</g>`
          : bg;
      } else if (slot.status === 'owned' && (sim.isPunningWrite || c.index >= meta.derefStep)) {
        const bg = rect(bx + 1.5, splitY, byteW - 3, cellH - (splitY - gridY) - 1.5, P.writeFill, 'none', 0);
        markup += animate && c.index === meta.derefStep
          ? `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${bg}</g>`
          : bg;
      }
    }

    // Horizontal split & vertical byte dividers
    const divCol = on ? P.gapStroke : P.deadStroke;
    markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
    for (let k = 1; k < v.size; k++) {
      const lx = xOf(v.address + k);
      markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${gridY + cellH - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
    }

    // Outer frame
    markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);

    // Value header + per-byte hex
    const renderBody = (val: number | null, useBefore: boolean): string => {
      if (val === null) return '';
      let body = '';
      const dec = String(val);
      const decSize = Math.min(25, (vw - 10) / (Math.max(1, dec.length) * CHAR));
      const decCol = isCorrupted && !useBefore ? P.error : P.fg;
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
            : slot.status === 'owned' && sim.isPunningWrite && !useBefore
              ? P.write
              : v.kind === 'ptr'
                ? P.muted
                : P.fg;
        const opAttr = isUntouched ? ' opacity="0.38"' : v.kind === 'ptr' ? ' opacity="0.65"' : '';
        if (slot.status === 'foreign') {
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

    // Name + staggered type pill under cell (never colliding on 1-byte neighbors!)
    const pillRow = pillRowOf.get(v.name) ?? 0;
    const pillTop = gridY + cellH + 32 + pillRow * 24;
    markup += text(
      vx + vw / 2,
      gridY + cellH + 24,
      v.name,
      20,
      isCorrupted ? P.error : on ? col : P.grey,
      'middle'
    );
    markup += typeLabel(c, vx + vw / 2, pillTop, v.type, 13.5, on ? typeColour(c, v.type) : P.deadStroke);

    // Keep corrupted neighbors fully bright during UB write!
    const keepBright = isCorrupted || isForeignThreat || v.name === meta.targetVar || v.name === meta.ptrName;
    mem += keepBright ? markup : dim(c, v.name, markup);
  }

  // 4. Overhead pointer arc from `b` landing at byte 64's START edge (not center!)
  const ptrVar = meta.vars.find(v => v.name === meta.ptrName)!;
  const ptrLive = sim.varAfter.get(ptrVar.name) !== null;
  let arcMarkup = '';
  if (ptrLive) {
    const pCol = varColor(P, ptrVar);
    const sx = xOf(ptrVar.address) + (ptrVar.size * byteW) / 2;
    const ex = xOf(meta.targetAddress) + byteW * 0.5;
    const sy = gridY - 2;
    const ey = gridY - 28;
    const apex = gridY - 94;
    const d = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(apex)}, ${round(ex)} ${round(apex)}, ${round(ex)} ${round(ey - 8)}`;
    const head = `<path d="M -10 -6 L 0 0 L -10 6 Z" fill="${pCol}" transform="translate(${round(ex)} ${round(ey)}) rotate(90)"/>`;
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    const grow = isWritingPtr ? ` data-grow="${round(at + 0.08)}"` : '';
    const midX = (sx + ex) / 2;
    const arcTag = pill(midX, apex + 16, `${meta.pointeeType}* (${meta.pointeeSize} B)`, 13.5, P.panel, pCol, pCol);
    arcMarkup +=
      '<g>' +
      `<path d="${d}" fill="none" stroke="${P.bg}" stroke-width="9"${grow}/>` +
      `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="2.6"${grow}/>` +
      (isWritingPtr
        ? `<g opacity="0">${fade(0, 1, 0.15, at + 0.55)}${head}${arcTag}</g>`
        : head + arcTag) +
      '</g>';
    if (animate && c.index === meta.derefStep) {
      arcMarkup += `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
    }
  }

  // 5. Caliper footprint bracket & boundary breach (cleanly below staggered type pills!)
  let overlay = '';
  if (sim.windowActive) {
    const wLeft = xOf(meta.targetAddress);
    const wWidth = meta.pointeeSize * byteW;
    const wRight = wLeft + wWidth;
    const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
    const ownEnd = xOf(targetVar.address + targetVar.size);
    const brY = gridY + cellH + 38 + pillRowsCount * 24 + 10;
    const tickTop = brY - 12;
    const revealAt = animate && c.index === meta.derefStep ? at - 0.1 : 0;

    let cal = '';
    if (meta.direction === 'larger') {
      cal +=
        `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${P.write}" stroke-width="2.6"/>` +
        `<path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="3"/>` +
        // Jagged boundary breach right where `a` ends!
        breachCrack(ownEnd, gridY - 4, gridY + cellH + 6, P.error) +
        pill((ownEnd + wRight) / 2, brY + 18, `⚠ UB · +${meta.pointeeSize - targetVar.size} B`, 13.5, P.error, P.error, P.bg);
    } else {
      cal +=
        `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.write}" stroke-width="2.8"/>` +
        pill((wLeft + wRight) / 2, brY + 18, `1 B`, 13, P.writeFill, P.write, P.write) +
        `<path d="M ${round(wRight + 4)} ${brY} H ${round(ownEnd - 2)} V ${tickTop}" fill="none" stroke="${P.grey}" stroke-dasharray="4 4" stroke-width="1.8"/>` +
        text((wRight + ownEnd) / 2, brY + 21, `${targetVar.size - meta.pointeeSize} B untouched`, 13, P.grey, 'middle');
    }
    overlay += revealAt > 0 ? `<g opacity="0">${fade(0, 1, 0.3, revealAt)}${cal}</g>` : cal;
  }

  // 6. Pane byte-strip workbench & byte-by-byte flight during punning write
  let wb = '';
  let flight = '';
  if (sim.windowActive) {
    const stripY = g.ty + 34;
    const tileW = 44;
    const tileH = 30;
    const tileGap = 6;
    const startX = g.tx + 10;
    const bytes = sim.writtenBytes;
    const labelStr =
      meta.direction === 'larger'
        ? `${meta.writeAction.valueText} (${meta.pointeeSize} B ${c.littleEndian ? 'LE' : 'BE'})`
        : `${meta.writeAction.valueText} (1 B)`;
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
  }

  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    arcMarkup +
    mem +
    overlay +
    pane(c, animate && copies(c.m.steps, c.index)) +
    wb +
    output(c) +
    flight
  );
}

const VARIANT_A_VIEW: TraceView = {
  geometry: () => ({
    minByteWidth: 46,
    minColumnWidth: 780,
    cellHeight: 88,
    extraMemBottom: 100,
    extraPaneHeight: 62,
    skipWrap: true,
  }),
  stackBelow: 900,
  maxScale: 0.72,
  byteOrder: true,
  scene: variantAScene,
  stepSeconds: punningStepSeconds,
};

// ============================================================================================
// VARIANT B: DUAL-TRACK ALIGNMENT VIEW (GROUND-TRUTH MEMORY ABOVE vs *b TYPE LENS BELOW)
// ============================================================================================

function variantBScene(c: SceneContext): string {
  const meta = META.get(c.m.trace)!;
  const sim = simulate(meta, c.index, c.littleEndian);
  const { g, P, animate, op, step, prev } = c;
  const { defs, padId, ubId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;

  const byteW = (g.pane.w - 48) / meta.totalBytes;
  const gridX = g.memX;
  const track1Y = g.memY;
  const track1H = 74;
  const beamTop = track1Y + track1H + 34;
  const beamBot = beamTop + 48;
  const track2Y = beamBot + 4;
  const track2H = 68;
  const xOf = (addr: number): number => gridX + (addr - meta.baseAddress) * byteW;
  const at = op ? arrival(op) : 0;

  let out = '';

  // 1. Shared vertical byte-column gridlines + address ruler at top
  out += text(gridX, track1Y - 34, 'MEMORY (TRUE OBJECTS)', 12.5, P.muted);
  for (let i = 0; i < meta.totalBytes; i++) {
    const addr = meta.baseAddress + i;
    const bx = xOf(addr);
    const owner = ownerAt(meta, addr);
    const isStart = owner && owner.address === addr;
    out += `<line x1="${round(bx)}" y1="${track1Y - 6}" x2="${round(bx)}" y2="${track2Y + track2H}" stroke="${P.gapStroke}" stroke-opacity="0.35" stroke-width="1"/>`;
    out += text(bx + byteW / 2, track1Y - 11, addr, isStart ? 14.5 : 12.5, isStart ? P.muted : P.grey, 'middle');
  }
  const rightEdge = xOf(meta.baseAddress + meta.totalBytes);
  out += `<line x1="${round(rightEdge)}" y1="${track1Y - 6}" x2="${round(rightEdge)}" y2="${track2Y + track2H}" stroke="${P.gapStroke}" stroke-opacity="0.35" stroke-width="1"/>`;

  // 2. Track 1: Padding runs
  for (const run of paddingRuns(meta)) {
    const rx = xOf(run.start);
    const rw = run.size * byteW;
    out += rect(rx + 1, track1Y + 1, rw - 2, track1H - 2, `url(#${padId})`, P.gapStroke, 0, 1.4);
    for (let k = 0; k < run.size; k++) {
      const addr = run.start + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);
      if (slot.status === 'padding') {
        const hit =
          rect(bx + 1.5, track1Y + 1.5, byteW - 3, track1H - 3, `url(#${ubId})`, P.error, 0, 2.2) +
          text(bx + byteW / 2, track1Y + 61, typeof slot.after === 'number' ? hex2(slot.after) : '??', 15, P.error, 'middle');
        if (animate && sim.isPunningWrite) {
          out +=
            `<g>${hide(at)}${text(bx + byteW / 2, track1Y + 61, '??', 13.5, P.error, 'middle')}</g>` +
            `<g opacity="0">${show(at)}${hit}</g>`;
        } else {
          out += hit;
        }
      } else {
        out += text(bx + byteW / 2, track1Y + 61, '??', 13, P.grey, 'middle');
      }
    }
    out += text(rx + rw / 2, track1Y + track1H + 20, 'padding', 13, P.grey, 'middle');
  }

  // 3. Track 1: True variables
  const split1 = track1Y + 40;
  for (const v of meta.vars) {
    const vx = xOf(v.address);
    const vw = v.size * byteW;
    const col = varColor(P, v);
    const valBefore = sim.varBefore.get(v.name) ?? null;
    const valAfter = sim.varAfter.get(v.name) ?? null;
    const on = valAfter !== null;
    const corrupted = sim.corruptedVars.has(v.name);
    const foreignRisk =
      sim.windowActive &&
      v.name !== meta.targetVar &&
      sim.bytes.some(s => s.owner?.name === v.name && s.status === 'foreign');
    const stroke = corrupted || foreignRisk ? P.error : on ? col : P.deadStroke;

    let card = rect(vx + 1, track1Y + 1, vw - 2, track1H - 2, on ? P.panel : P.deadFill, 'none', 0);
    for (let k = 0; k < v.size; k++) {
      const slot = sim.bytes[v.address + k - meta.baseAddress];
      const bx = xOf(v.address + k);
      if (slot.status === 'foreign') {
        card += rect(bx + 1.5, track1Y + 1.5, byteW - 3, track1H - 3, `url(#${ubId})`, 'none', 0);
      } else if (slot.status === 'owned' && sim.windowActive) {
        card += rect(bx + 1.5, split1, byteW - 3, track1Y + track1H - split1 - 1.5, P.writeFill, 'none', 0);
      }
    }
    card += `<line x1="${round(vx + 2)}" y1="${split1}" x2="${round(vx + vw - 2)}" y2="${split1}" stroke="${on ? P.gapStroke : P.deadStroke}" stroke-width="1.1"/>`;
    for (let k = 1; k < v.size; k++) {
      const lx = xOf(v.address + k);
      card += `<line x1="${round(lx)}" y1="${split1}" x2="${round(lx)}" y2="${track1Y + track1H - 2}" stroke="${on ? P.gapStroke : P.deadStroke}" stroke-width="1.1"/>`;
    }
    card += rect(vx + 1.5, track1Y + 1.5, vw - 3, track1H - 3, 'none', stroke, 0, corrupted ? 3.2 : 2.6);

    const drawVals = (val: number | null, useBefore: boolean): string => {
      if (val === null) return '';
      let b = '';
      const dec = String(val);
      const decSz = Math.min(22, (vw - 8) / (Math.max(1, dec.length) * CHAR));
      b += text(vx + vw / 2, track1Y + 28, dec, round(decSz), corrupted && !useBefore ? P.error : P.fg, 'middle');
      for (let k = 0; k < v.size; k++) {
        const slot = sim.bytes[v.address + k - meta.baseAddress];
        const bv = useBefore ? slot.before : slot.after;
        if (typeof bv !== 'number') continue;
        const bx = xOf(v.address + k);
        const ink =
          slot.status === 'foreign' && !useBefore
            ? P.error
            : slot.status === 'owned' && sim.isPunningWrite && !useBefore
              ? P.write
              : v.kind === 'ptr'
                ? P.muted
                : P.fg;
        const opAttr = slot.status === 'untouched' ? ' opacity="0.36"' : v.kind === 'ptr' ? ' opacity="0.65"' : '';
        b += `<g${opAttr}>${text(bx + byteW / 2, track1Y + 61, hex2(bv), v.kind === 'ptr' ? 12.5 : 15, ink, 'middle')}</g>`;
      }
      return b;
    };

    const changing =
      animate &&
      ((op?.kind === 'write' && op.name === v.name && !sim.isPunningWrite) ||
        (sim.isPunningWrite && valBefore !== valAfter));
    if (changing) {
      const cx = vx + vw / 2;
      const cy = track1Y + track1H / 2;
      card += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.15)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
      if (valBefore !== null) card += `<g>${hide(at)}${drawVals(valBefore, true)}</g>`;
      card += `<g opacity="0">${show(at)}${drawVals(valAfter, false)}</g>`;
      card += '</g></g></g>';
    } else {
      card += drawVals(valAfter, false);
    }

    card += text(
      vx + vw / 2,
      track1Y + track1H + 20,
      v.size === 1 ? v.name : `${v.name} (${v.type})`,
      v.size === 1 ? 16 : 14,
      corrupted ? P.error : on ? col : P.grey,
      'middle'
    );
    out += card;
  }

  // 4. Track 2 (*b type lens) + vertical projection beams + pointer route from b
  const ptrVar = meta.vars.find(v => v.name === meta.ptrName)!;
  const ptrLive = sim.varAfter.get(ptrVar.name) !== null;
  if (ptrLive) {
    const pCol = varColor(P, ptrVar);
    const lensX = xOf(meta.targetAddress);
    const lensW = meta.pointeeSize * byteW;
    const lensRight = lensX + lensW;
    const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
    const targetEnd = xOf(targetVar.address + targetVar.size);
    const active = sim.windowActive;

    // Place Track 2 label strictly to the right of BOTH the lens and any ghost untouched frame
    const labelX = Math.max(lensRight, targetEnd) + 16;
    out += text(labelX, track2Y + 26, `*${meta.ptrName} LENS`, 13, active ? pCol : P.muted);
    out += text(
      labelX,
      track2Y + 46,
      `${meta.pointeeType} · ${meta.pointeeSize} B @ ${meta.targetAddress}`,
      14,
      active ? P.fg : P.grey
    );

    // Pointer curve leaves b (bottom of Track 1) and curves cleanly UNDER Track 2 into the lens bottom
    const sx = xOf(ptrVar.address) + (ptrVar.size * byteW) / 2;
    const sy = track1Y + track1H + 26;
    const ex = lensX + lensW / 2;
    const ey = track2Y + track2H + 4;
    const underY = track2Y + track2H + 44;
    const d = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(underY)}, ${round(ex)} ${round(underY)}, ${round(ex)} ${round(ey + 8)}`;
    const head = `<path d="M -6 10 L 0 0 L 6 10 Z" fill="${pCol}" transform="translate(${round(ex)} ${round(ey)})"/>`;
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    const grow = isWritingPtr ? ` data-grow="${round(at + 0.08)}"` : '';
    out +=
      `<path d="${d}" fill="none" stroke="${P.bg}" stroke-width="8"${grow}/>` +
      `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="2.5"${grow}/>` +
      (isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.15, at + 0.55)}${head}</g>` : head);

    // Lens box on Track 2
    const lensStroke = active ? (sim.hasUb ? P.error : P.write) : pCol;
    const split2 = track2Y + 36;
    let lens =
      rect(lensX + 1.5, track2Y + 1.5, lensW - 3, track2H - 3, P.panel, lensStroke, 4, active ? 3 : 2) +
      `<line x1="${round(lensX + 2)}" y1="${split2}" x2="${round(lensRight - 2)}" y2="${split2}" stroke="${P.gapStroke}" stroke-width="1.1"/>`;

    // Lens bytes (current interpreted value before write, or written value on/after write)
    const lensBytes: number[] =
      c.index >= meta.writeAction.stepIndex
        ? sim.writtenBytes
        : Array.from({ length: meta.pointeeSize }, (_, k) => {
            const bv = sim.bytes[meta.targetAddress - meta.baseAddress + k].after;
            return typeof bv === 'number' ? bv : -1;
          });
    const showVal =
      c.index >= meta.writeAction.stepIndex
        ? meta.writeAction.valueText
        : lensBytes.every(b => b >= 0)
          ? String(decodeBytes(lensBytes, meta.pointeeType === 'int', c.littleEndian))
          : '???';
    const valSz = Math.min(18.5, (lensW - 14) / (Math.max(1, showVal.length) * CHAR));
    lens += text(lensX + lensW / 2, track2Y + 25, showVal, round(valSz), active ? P.fg : P.muted, 'middle');

    for (let k = 0; k < meta.pointeeSize; k++) {
      const bx = xOf(meta.targetAddress + k);
      if (k > 0) {
        lens += `<line x1="${round(bx)}" y1="${split2}" x2="${round(bx)}" y2="${track2Y + track2H - 2}" stroke="${P.gapStroke}" stroke-width="1.1"/>`;
      }
      const slot = sim.bytes[meta.targetAddress + k - meta.baseAddress];
      const bad = slot.status === 'padding' || slot.status === 'foreign';
      const hexStr = lensBytes[k] >= 0 ? hex2(lensBytes[k]) : '??';
      lens += text(bx + byteW / 2, track2Y + 56, hexStr, 15, bad ? P.error : active ? P.write : P.muted, 'middle');
    }

    // For smaller pointer, draw ghost "outside lens" dashed frame under remaining bytes of `a`
    if (meta.direction === 'smaller' && active) {
      const gx = xOf(meta.targetAddress + meta.pointeeSize);
      const gw = (targetVar.size - meta.pointeeSize) * byteW;
      lens +=
        `<rect x="${round(gx + 2)}" y="${round(track2Y + 2)}" width="${round(gw - 4)}" height="${round(track2H - 4)}" rx="4" fill="${P.deadFill}" fill-opacity="0.45" stroke="${P.grey}" stroke-dasharray="5 4" stroke-width="1.4"/>` +
        text(gx + gw / 2, track2Y + 39, 'untouched', 13, P.grey, 'middle');
    }

    out += lens;

    // 5. Vertical projection beams (Track 2 -> Track 1) per byte!
    if (active) {
      for (let k = 0; k < meta.pointeeSize; k++) {
        const addr = meta.targetAddress + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const cx = xOf(addr) + byteW / 2;
        const bad = slot.status === 'padding' || slot.status === 'foreign';
        const col = bad ? P.error : P.write;
        const beam =
          `<line x1="${round(cx)}" y1="${beamBot}" x2="${round(cx)}" y2="${beamTop + 6}" stroke="${col}" stroke-width="${bad ? 3 : 2.4}" ${bad ? '' : 'stroke-dasharray="4 3"'}/>` +
          `<path d="M -6 8 L 0 0 L 6 8 Z" fill="${col}" transform="translate(${round(cx)} ${beamTop})"/>` +
          (bad ? text(cx, (beamTop + beamBot) / 2 + 5, '⚠', 15, P.error, 'middle') : '');

        if (animate && sim.isPunningWrite) {
          const begin = 0.25 + k * 0.1;
          const dur = 0.7;
          const bval = sim.writtenBytes[k];
          out +=
            beam +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(begin + dur + 0.05)}` +
            rect(-17, -12, 34, 24, P.panel, col, 5, 2) +
            text(0, 5, hex2(bval), 13.5, col, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="M ${round(cx)} ${beamBot} L ${round(cx)} ${track1Y + 58}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        } else if (animate && c.index === meta.derefStep) {
          out += `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${beam}</g>`;
        } else {
          out += beam;
        }
      }
      if (sim.hasUb) {
        const ownEnd = xOf(targetVar.address + targetVar.size);
        // Crack cuts only Track 1 and the beam zone, leaving Track 2 intact as *b's view!
        out += breachCrack(ownEnd, track1Y - 4, beamBot - 2, P.error);
        out += pill(
          labelX + 86,
          track2Y + 66,
          '⚠ UB · OUT OF BOUNDS',
          12.5,
          P.error,
          P.error,
          P.bg
        );
      }
    }
  }

  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    out +
    pane(c, animate && copies(c.m.steps, c.index)) +
    output(c)
  );
}

const VARIANT_B_VIEW: TraceView = {
  geometry: () => ({
    minByteWidth: 46,
    minColumnWidth: 780,
    cellHeight: 74,
    extraMemBottom: 196,
    extraPaneHeight: 10,
    skipWrap: true,
  }),
  stackBelow: 900,
  maxScale: 0.72,
  byteOrder: true,
  scene: variantBScene,
  stepSeconds: punningStepSeconds,
};

// ============================================================================================
// VARIANT C: VERTICAL BYTE-ADDRESS TAPE (1 ROW = 1 BYTE; LEFT OWNERSHIP RAIL vs RIGHT ACCESS RAIL)
// ============================================================================================

const TAPE_ROW_H = 34;
const TAPE_W = 592;

function variantCLayout(m: PreparedModel, P: Palette, stacked: boolean, viewport: number): Geometry {
  const meta = META.get(m.trace)!;
  const base = geometry(m, P, stacked, viewport, { skipWrap: true });
  const tapeH = meta.totalBytes * TAPE_ROW_H + 54;

  const targetCodeSize = stacked ? 12 : 13;
  const canvasBudget = viewport > 0 ? (viewport * CODE_SIZE) / targetCodeSize : Infinity;
  const unwrapped = codeLayout(m.source);
  const paneChars = Math.max(...m.steps.map(s => s.pane.length));
  const paneSize = Math.max(PANE_MIN, Math.min(PANE_MAX, 24));
  const paneChar = paneSize * CHAR;
  const paneNeededW = paneChars * paneChar + 48;

  const leftBudget = stacked
    ? Math.max(460, Math.min(TAPE_W, canvasBudget - 2 * MARGIN))
    : Math.max(460, Math.min(760, canvasBudget - TAPE_W - 44 - 2 * MARGIN));
  const codeL = unwrapped.width <= leftBudget + CODE_CHAR ? unwrapped : codeLayout(m.source, columnsForCode(leftBudget));

  const leftW = Math.max(codeL.width, paneNeededW, stacked ? TAPE_W : 460);
  const codeRect = { x: MARGIN, y: MARGIN, w: leftW, h: codeL.height };
  const paneH = 82;
  const paneRect = { x: MARGIN, y: codeRect.y + codeRect.h + 26, w: leftW, h: paneH };
  const leftH = paneRect.y + paneRect.h - MARGIN;

  const memX = stacked ? MARGIN : MARGIN + leftW + 44;
  const memY = stacked ? paneRect.y + paneRect.h + 44 : MARGIN + 34;
  const width = stacked ? MARGIN + Math.max(leftW, TAPE_W) + MARGIN : memX + TAPE_W + MARGIN;
  const height = stacked ? memY + tapeH + MARGIN : MARGIN + Math.max(leftH, tapeH) + MARGIN;

  const codeRows = placeCodeRows(codeL.rows, codeRect.y + 50);
  const lineY = (i: number): number => codeRows[i][0].y;

  return {
    ...base,
    stacked,
    paneSize,
    paneChar,
    width,
    height,
    code: codeRect,
    codeRows,
    lineY,
    pane: paneRect,
    tx: paneRect.x + 20,
    ty: paneRect.y + 50,
    memX,
    memY,
    below: paneRect.y - 20,
    out: [paneRect.x + 20, paneRect.y + paneRect.h + 36],
  };
}

function variantCScene(c: SceneContext): string {
  const meta = META.get(c.m.trace)!;
  const sim = simulate(meta, c.index, c.littleEndian);
  const { g, P, animate, op, step, prev } = c;
  const { defs, padId, ubId } = hatchDefs(P);
  const lineChanged = animate && prev !== null && prev.line !== step.line;
  const oldLine = lineChanged && prev ? prev.line : null;
  const at = op ? arrival(op) : 0;

  // Custom clean tether from active code line down/right into the pane directly underneath
  const codeRight = g.code.x + g.code.w;
  const activeY = g.lineY(step.line) - 10;
  const paneMidY = g.pane.y + g.pane.h / 2;
  const tetherPath = `M ${round(codeRight + 4)} ${round(activeY)} H ${round(codeRight + 18)} V ${round(paneMidY)} H ${round(g.pane.x + g.pane.w)}`;
  const customTether = `<path d="${tetherPath}" fill="none" stroke="${P.tether}" stroke-width="2"/>`;

  // Vertical tape columns:
  // [Left Ownership Rail: 162] [Addr: 42] [Byte Hex + Diff: 112] [Binary: 102] [Right Pointer/Access Rail: 138]
  const tx = g.memX;
  const ty = g.memY;
  const colOwnW = 162;
  const colAddrX = tx + colOwnW;
  const colAddrW = 42;
  const colHexX = colAddrX + colAddrW;
  const colHexW = 112;
  const colBinX = colHexX + colHexW;
  const colBinW = 102;
  const colRightX = colBinX + colBinW;
  const tapeBodyW = colAddrW + colHexW + colBinW;
  const totalH = meta.totalBytes * TAPE_ROW_H;
  const yOf = (addr: number): number => ty + (addr - meta.baseAddress) * TAPE_ROW_H;

  let tape = '';

  // Column headers
  tape += text(tx + colOwnW - 14, ty - 12, 'OWNER', 12, P.muted, 'end');
  tape += text(colAddrX + colAddrW / 2, ty - 12, 'ADDR', 12, P.muted, 'middle');
  tape += text(colHexX + colHexW / 2, ty - 12, `HEX (${c.littleEndian ? 'LE' : 'BE'})`, 12, P.muted, 'middle');
  tape += text(colBinX + colBinW / 2, ty - 12, 'BITS', 12, P.muted, 'middle');
  tape += text(colRightX + 14, ty - 12, `*${meta.ptrName} ACCESS`, 12, P.muted);

  // Outer tape background
  tape += rect(colAddrX, ty, tapeBodyW, totalH, P.panel, P.gapStroke, 6, 1.5);

  // Per-byte rows
  for (let i = 0; i < meta.totalBytes; i++) {
    const slot = sim.bytes[i];
    const ry = yOf(slot.address);
    const bad = slot.status === 'padding' || slot.status === 'foreign';
    const isPad = slot.owner === null;

    // Row fill
    if (bad) {
      const fill = rect(colAddrX + 1, ry + 1, tapeBodyW - 2, TAPE_ROW_H - 2, `url(#${ubId})`, P.error, 0, 1.6);
      tape += animate && c.index === meta.derefStep
        ? `<g opacity="0">${fade(0, 1, 0.25, at - 0.15)}${fill}</g>`
        : fill;
    } else if (isPad) {
      tape += rect(colAddrX + 1, ry + 1, tapeBodyW - 2, TAPE_ROW_H - 2, `url(#${padId})`, 'none', 0);
    } else if (slot.status === 'owned' && sim.windowActive) {
      tape += rect(colAddrX + 1, ry + 1, tapeBodyW - 2, TAPE_ROW_H - 2, P.writeFill, 'none', 0);
    }

    // Horizontal row separator
    if (i > 0) {
      const prevOwner = sim.bytes[i - 1].owner;
      const boundary = prevOwner !== slot.owner;
      tape += `<line x1="${colAddrX}" y1="${ry}" x2="${colAddrX + tapeBodyW}" y2="${ry}" stroke="${boundary ? P.muted : P.gapStroke}" stroke-opacity="${boundary ? 0.55 : 0.45}" stroke-width="${boundary ? 1.5 : 1}"/>`;
    }

    // Address
    const textY = ry + TAPE_ROW_H * 0.65;
    tape += text(
      colAddrX + colAddrW / 2,
      textY,
      slot.address,
      14,
      bad ? P.error : slot.owner && slot.owner.address === slot.address ? P.fg : P.grey,
      'middle'
    );

    // Byte value (show `before → after` diff when modified by punning write!)
    const isUntouched = slot.status === 'untouched';
    const rowOp = isUntouched ? ' opacity="0.38"' : slot.owner?.kind === 'ptr' ? ' opacity="0.65"' : '';
    const renderByteRow = (useBefore: boolean): string => {
      const b = useBefore ? slot.before : slot.after;
      if (b === null) return text(colHexX + colHexW / 2, textY, '·', 15, P.deadStroke, 'middle');
      if (b === '?') return text(colHexX + colHexW / 2, textY, '??', 14, bad ? P.error : P.grey, 'middle');
      const ink = bad && !useBefore ? P.error : slot.status === 'owned' && sim.isPunningWrite && !useBefore ? P.write : P.fg;
      const showDiff = !useBefore && sim.isPunningWrite && slot.changed;
      const hexLabel = showDiff
        ? `${typeof slot.before === 'number' ? hex2(slot.before) : '??'} → ${hex2(b)}`
        : hex2(b);
      return (
        `<g${rowOp}>` +
        text(colHexX + colHexW / 2, textY, hexLabel, showDiff ? 14 : 15, ink, 'middle') +
        text(colBinX + colBinW / 2, textY, bin8(b), 12.5, bad && !useBefore ? P.error : P.muted, 'middle') +
        '</g>'
      );
    };

    if (animate && slot.changed) {
      const revealAt = sim.isPunningWrite ? at + 0.08 * (slot.address - meta.targetAddress) : at;
      tape +=
        `<g>${hide(revealAt)}${renderByteRow(true)}</g>` +
        `<g opacity="0">${show(revealAt)}${renderByteRow(false)}</g>`;
    } else {
      tape += renderByteRow(false);
    }
  }

  // Vertical column dividers inside tape
  tape += `<line x1="${colHexX}" y1="${ty}" x2="${colHexX}" y2="${ty + totalH}" stroke="${P.gapStroke}" stroke-width="1"/>`;
  tape += `<line x1="${colBinX}" y1="${ty}" x2="${colBinX}" y2="${ty + totalH}" stroke="${P.gapStroke}" stroke-width="1"/>`;

  // Left Ownership Rail: vertical brackets per variable + padding runs
  for (const run of paddingRuns(meta)) {
    const y1 = yOf(run.start) + 3;
    const y2 = yOf(run.start + run.size) - 3;
    const midY = (y1 + y2) / 2;
    const hit = sim.bytes.some(s => s.address >= run.start && s.address < run.start + run.size && s.status === 'padding');
    const col = hit ? P.error : P.grey;
    tape +=
      `<path d="M ${colAddrX - 6} ${y1} H ${colAddrX - 14} V ${y2} H ${colAddrX - 6}" fill="none" stroke="${col}" stroke-dasharray="3 3" stroke-width="1.6"/>` +
      text(colAddrX - 22, midY + 5, `padding (${run.size} B)`, 13, col, 'end');
  }

  for (const v of meta.vars) {
    const y1 = yOf(v.address) + 3;
    const y2 = yOf(v.address + v.size) - 3;
    const midY = (y1 + y2) / 2;
    const col = varColor(P, v);
    const valBefore = sim.varBefore.get(v.name) ?? null;
    const valAfter = sim.varAfter.get(v.name) ?? null;
    const on = valAfter !== null;
    const corrupted = sim.corruptedVars.has(v.name);
    const stroke = corrupted ? P.error : on ? col : P.deadStroke;

    tape += `<path d="M ${colAddrX - 4} ${y1} H ${colAddrX - 14} V ${y2} H ${colAddrX - 4}" fill="none" stroke="${stroke}" stroke-width="${corrupted ? 3 : 2.5}"/>`;

    const nameLabel = `${v.name} : ${v.type}`;
    const valStr =
      valAfter === null
        ? ''
        : sim.isPunningWrite && valBefore !== null && valBefore !== valAfter
          ? `${valBefore} → ${valAfter}`
          : `= ${valAfter}`;

    if (v.size === 1) {
      // Compact 1-row layout: name & value on one line
      const line = valStr ? `${v.name} ${valStr}` : nameLabel;
      tape += text(colAddrX - 20, midY + 5, line, 14.5, corrupted ? P.error : on ? col : P.grey, 'end');
    } else {
      tape += text(colAddrX - 20, midY - 2, nameLabel, 14.5, corrupted ? P.error : on ? col : P.grey, 'end');
      if (valStr) {
        tape += text(colAddrX - 20, midY + 17, valStr, 14.5, corrupted ? P.error : P.fg, 'end');
      }
    }
  }

  // Right Rail: Vertical pointer arrow from b (72..79) up to row 64 + *b access bracket!
  const ptrVar = meta.vars.find(v => v.name === meta.ptrName)!;
  const ptrLive = sim.varAfter.get(ptrVar.name) !== null;
  if (ptrLive) {
    const pCol = varColor(P, ptrVar);
    const startY = yOf(ptrVar.address) + (ptrVar.size * TAPE_ROW_H) / 2;
    const endY = yOf(meta.targetAddress) + TAPE_ROW_H / 2;
    const startX = colRightX + 6;
    const bulgeX = colRightX + 168;
    const d = `M ${round(startX)} ${round(startY)} C ${round(bulgeX)} ${round(startY)}, ${round(bulgeX)} ${round(endY)}, ${round(startX + 10)} ${round(endY)}`;
    const head = `<path d="M 10 -6 L 0 0 L 10 6 Z" fill="${pCol}" transform="translate(${round(startX)} ${round(endY)})"/>`;
    const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
    const grow = isWritingPtr ? ` data-grow="${round(at + 0.08)}"` : '';
    tape +=
      `<path d="${d}" fill="none" stroke="${P.bg}" stroke-width="8"${grow}/>` +
      `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="2.5"${grow}/>` +
      (isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.15, at + 0.55)}${head}</g>` : head);

    // *b access-window bracket on the right rail (labels stay cleanly inside the pointer curve!)
    if (sim.windowActive) {
      const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
      const wY1 = yOf(meta.targetAddress) + 3;
      const wY2 = yOf(meta.targetAddress + meta.pointeeSize) - 3;
      const ownY2 = yOf(targetVar.address + targetVar.size);
      const bx = colRightX + 14;
      let win = '';
      if (meta.direction === 'larger') {
        win +=
          `<path d="M ${colRightX + 4} ${wY1} H ${bx + 8} V ${ownY2}" fill="none" stroke="${P.write}" stroke-width="2.6"/>` +
          `<path d="M ${bx + 8} ${ownY2} V ${wY2} H ${colRightX + 4}" fill="none" stroke="${P.error}" stroke-width="3"/>` +
          // Horizontal boundary breach across the tape right under `a`!
          `<line x1="${colAddrX - 18}" y1="${ownY2}" x2="${bx + 14}" y2="${ownY2}" stroke="${P.error}" stroke-width="2.8" stroke-dasharray="5 3"/>` +
          pill(bx + 54, (ownY2 + wY2) / 2, '⚠ UB', 13, P.error, P.error, P.bg);
      } else {
        win +=
          `<path d="M ${colRightX + 4} ${wY1} H ${bx + 8} V ${wY2} H ${colRightX + 4}" fill="none" stroke="${P.write}" stroke-width="2.8"/>` +
          text(bx + 16, (wY1 + wY2) / 2 + 5, '1 B', 13, P.write);
        const uY1 = wY2 + 6;
        const uY2 = ownY2 - 3;
        win +=
          `<path d="M ${colRightX + 4} ${uY1} H ${bx + 4} V ${uY2} H ${colRightX + 4}" fill="none" stroke="${P.grey}" stroke-dasharray="3 3" stroke-width="1.5"/>` +
          text(bx + 10, (uY1 + uY2) / 2 + 4, '3 B —', 12.5, P.grey);
      }
      tape += animate && c.index === meta.derefStep
        ? `<g opacity="0">${fade(0, 1, 0.28, at - 0.15)}${win}</g>`
        : win;
    }
  }

  return (
    defs +
    code(c, oldLine) +
    customTether +
    pane(c, animate && copies(c.m.steps, c.index)) +
    tape +
    output(c)
  );
}

const VARIANT_C_VIEW: TraceView = {
  layout: variantCLayout,
  stackBelow: 860,
  maxScale: 0.78,
  byteOrder: true,
  scene: variantCScene,
  stepSeconds: punningStepSeconds,
};

// ============================================================================================
// PROTOTYPE SHELL + FLOATING VARIANT SWITCHER (?variant=A|B|C)
// ============================================================================================

interface VariantDef {
  key: 'A' | 'B' | 'C';
  name: string;
  summary: string;
  bullets: string[];
  view: TraceView;
}

const VARIANTS: VariantDef[] = [
  {
    key: 'A',
    name: 'A · Footprint bracket + breach',
    summary:
      'Keeps the single horizontal byte-accurate memory strip and overhead pointer arc. On dereference, a caliper footprint bracket spans the pointer type’s bytes; spilling past the pointee’s wall triggers a jagged breach, red hazard stripes, and byte-tile transfers.',
    bullets: [
      'Zero artificial gaps: every byte 64..79 sits flush on one grid, with hatched padding inline.',
      'Pointer arc lands on byte 64’s start edge with its pointee size (4 B / 1 B).',
      'Smaller pointer dims the 3 untouched bytes and labels the untouched span.',
    ],
    view: VARIANT_A_VIEW,
  },
  {
    key: 'B',
    name: 'B · Dual-track memory vs. lens',
    summary:
      'Splits ground-truth memory ownership (Track 1) from what *b thinks sits at address 64 (Track 2) on one shared vertical byte grid. Upward projection beams show exactly which bytes hit owned storage, padding, or another variable.',
    bullets: [
      'Separates true layout from pointer interpretation so misalignment is obvious without prose.',
      'Pointer arc enters Track 2’s lens; writes fire upward byte-by-byte into Track 1.',
      'Smaller pointer shows a ghost "untouched" overhang under bytes 65..67 of the int.',
    ],
    view: VARIANT_B_VIEW,
  },
  {
    key: 'C',
    name: 'C · Vertical byte-address tape',
    summary:
      'Rotates memory into a vertical 1-row-per-byte address table beside code and pane. Ownership brackets sit on the left rail while the pointer arrow and *b write window sit on the right rail, facing each other across every byte.',
    bullets: [
      'Eliminates horizontal crowding; each byte shows address, inline hex diff (05 → 2C), and 8-bit binary.',
      'Breached padding and corrupted neighbor rows highlight full-width in red across the tape.',
      'Compact side-by-side layout on both desktop and narrow screens.',
    ],
    view: VARIANT_C_VIEW,
  },
];

let players: Player[] = [];

function currentVariantKey(): 'A' | 'B' | 'C' {
  const param = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return param === 'B' || param === 'C' ? param : 'A';
}

function setVariantKey(key: 'A' | 'B' | 'C'): void {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', key);
  window.history.replaceState(null, '', url.toString());
  mountVariant(key);
}

function mountVariant(key: 'A' | 'B' | 'C'): void {
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
    // Start settled on the final punning-write step so the UB / partial write is visible immediately,
    // while Reset / Play / Scrub let the reviewer step through from line 1.
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
