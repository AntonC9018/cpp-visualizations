// PROTOTYPE, throwaway (pointer type punning with larger and smaller pointee types, #60).
// Approved design candidate:
//   - Plain Lab 4 syntax (no reinterpret_cast), all native step animations active
//   - Byte-accurate horizontal hex memory strip + bits_view byte-order arrow on multi-byte ints
//   - Clean overhead pointer arc (no type pill) + full-height open HUD corner reticle (zoom-snap lock)
//   - Values stay centered inside cells; per-byte write pulse keeps unaffected bytes rock-solid
//   - No persistent highlight or veil in memory: write highlight is transient and full-height over
//     the exact bytes actually written (4 tall bytes for int*, 1 tall misaligned byte for uint8_t*)
//   - Corrupted memory (padding & overwritten neighbors) stays red with "⚠ UB", triggered only on write
//   - Pane shows only the written bytes plus hollow dashed slots for untouched target bytes
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
  kind: 'write';
  stepIndex: number;
  value: number;
  valueText: string;
}

interface PunningReadAction {
  kind: 'read';
  readStepIndex: number;
  storeStepIndex: number;
  destVar: string;
  panePrefix: string;
  paneSuffix: string;
}

type PunningAction = PunningWriteAction | PunningReadAction;

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
  action: PunningAction;
  initSteps: Array<{ stepIndex: number; varName: string; value: number }>;
}

const META = new WeakMap<ExecutionTrace, PunningMeta>();

type ByteVal = number | '?' | null;
type AccessStatus = 'none' | 'owned' | 'padding' | 'foreign' | 'untouched';

interface DecodedVar {
  text: string;
  poisoned: boolean;
  numeric: number | null;
}

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
  varBefore: Map<string, DecodedVar | null>;
  varAfter: Map<string, DecodedVar | null>;
  corruptedVars: Set<string>;
  readForeignVars: Set<string>;
  ubTriggered: boolean;
  ubKind: 'none' | 'write' | 'read';
  ptrLive: boolean;
  windowActive: boolean;
  isPunningWrite: boolean;
  isPunningRead: boolean;
  isPoisonStore: boolean;
  /** Bytes transferred by the punning op (written bytes on write; read bytes on read/store). */
  paneBytes: ByteVal[];
  /** Formatted result of a punning read (always hex with `?` if any byte is poisoned). */
  readResult: DecodedVar | null;
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

function formatBytesValue(
  slice: ByteVal[],
  signed: boolean,
  littleEndian: boolean
): DecodedVar | null {
  if (slice.every(b => b === null)) return null;
  if (slice.some(b => b === '?' || b === null)) {
    const ordered = littleEndian ? [...slice].reverse() : [...slice];
    const hex = ordered.map(b => (typeof b === 'number' ? hex2(b) : '??')).join('');
    return { text: `0x${hex}`, poisoned: true, numeric: null };
  }
  const num = decodeBytes(slice as number[], signed, littleEndian);
  return { text: String(num), poisoned: false, numeric: num };
}

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
  if (meta.action.kind === 'write' && meta.action.stepIndex <= stepIndex) {
    const bs = encodeBytes(meta.action.value, meta.pointeeSize, littleEndian);
    for (let k = 0; k < meta.pointeeSize; k++) {
      const idx = meta.targetAddress - meta.baseAddress + k;
      if (idx >= 0 && idx < mem.length) mem[idx] = bs[k];
    }
  }
  if (meta.action.kind === 'read' && meta.action.storeStepIndex <= stepIndex) {
    const destName = meta.action.destVar;
    const dest = meta.vars.find(x => x.name === destName)!;
    const srcStart = meta.targetAddress - meta.baseAddress;
    const dstStart = dest.address - meta.baseAddress;
    const count = Math.min(dest.size, meta.pointeeSize);
    for (let k = 0; k < count; k++) {
      const raw = mem[srcStart + k];
      mem[dstStart + k] = raw === null ? '?' : raw;
    }
  }
  return mem;
}

function decodeVarValues(
  meta: PunningMeta,
  mem: ByteVal[],
  littleEndian: boolean
): Map<string, DecodedVar | null> {
  const out = new Map<string, DecodedVar | null>();
  for (const v of meta.vars) {
    const slice = mem.slice(v.address - meta.baseAddress, v.address - meta.baseAddress + v.size);
    out.set(v.name, formatBytesValue(slice, v.signed, littleEndian));
  }
  return out;
}

function simulate(meta: PunningMeta, stepIndex: number, littleEndian: boolean): SimState {
  const beforeMem =
    stepIndex > 0 ? snapshotAt(meta, stepIndex - 1, littleEndian) : snapshotAt(meta, 0, littleEndian);
  const afterMem = snapshotAt(meta, stepIndex, littleEndian);
  const ptrLive = stepIndex >= meta.ptrInitStep;
  const windowActive = stepIndex >= meta.derefStep;
  const isPunningWrite = meta.action.kind === 'write' && stepIndex === meta.action.stepIndex;
  const isPunningRead = meta.action.kind === 'read' && stepIndex === meta.action.readStepIndex;
  const isPoisonStore = meta.action.kind === 'read' && stepIndex === meta.action.storeStepIndex;
  const actionDone =
    meta.action.kind === 'write'
      ? stepIndex >= meta.action.stepIndex
      : stepIndex >= meta.action.readStepIndex;
  const wStart = meta.targetAddress;
  const wEnd = meta.targetAddress + meta.pointeeSize;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const tStart = targetVar.address;
  const tEnd = targetVar.address + targetVar.size;

  const bytes: ByteSlot[] = [];
  let ubTriggered = false;
  const corruptedVars = new Set<string>();
  const readForeignVars = new Set<string>();

  for (let i = 0; i < meta.totalBytes; i++) {
    const address = meta.baseAddress + i;
    const owner = ownerAt(meta, address);
    const inWindow = ptrLive && address >= wStart && address < wEnd;
    let status: AccessStatus = 'none';
    if (inWindow) {
      if (!owner) {
        status = 'padding';
        if (actionDone) ubTriggered = true;
      } else if (owner.name === meta.targetVar) {
        status = 'owned';
      } else {
        status = 'foreign';
        if (actionDone) {
          ubTriggered = true;
          if (meta.action.kind === 'write') {
            corruptedVars.add(owner.name);
          } else {
            readForeignVars.add(owner.name);
          }
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

  let paneBytes: ByteVal[];
  let readResult: DecodedVar | null = null;
  if (meta.action.kind === 'write') {
    paneBytes = encodeBytes(meta.action.value, meta.pointeeSize, littleEndian);
  } else {
    const readMem = snapshotAt(meta, meta.action.readStepIndex, littleEndian);
    const start = meta.targetAddress - meta.baseAddress;
    paneBytes = readMem.slice(start, start + meta.pointeeSize).map(b => (b === null ? '?' : b));
    const destName = meta.action.destVar;
    const dest = meta.vars.find(v => v.name === destName)!;
    readResult = formatBytesValue(paneBytes, dest.signed, littleEndian);
  }

  return {
    bytes,
    varBefore: decodeVarValues(meta, beforeMem, littleEndian),
    varAfter: decodeVarValues(meta, afterMem, littleEndian),
    corruptedVars,
    readForeignVars,
    ubTriggered,
    ubKind: ubTriggered ? meta.action.kind : 'none',
    ptrLive,
    windowActive,
    isPunningWrite,
    isPunningRead,
    isPoisonStore,
    paneBytes,
    readResult,
  };
}

// ============================================================================================
// SCENARIOS (PLAIN LAB 4 SYNTAX)
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
      hold: 1.2,
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
    subtitle: 'Scope locks onto 64..67 on line 3; writing *b = 300 highlights all 4 written bytes and marks spilled padding red.',
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
    action: { kind: 'write', stepIndex: 10, value: 300, valueText: '300' },
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
      hold: 1.2,
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
    action: { kind: 'write', stepIndex: 12, value: 0x04030201, valueText: '0x04030201' },
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
      hold: 1.2,
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
    subtitle: 'Hit Play or Replay on step 9 to see the tall 1-byte write highlight on byte 64. Flip LE/BE for 2 vs 33554437.',
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
    action: { kind: 'write', stepIndex: 8, value: 2, valueText: '2' },
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
      hold: 1.2,
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
    subtitle: '261 is 05 01 00 00 (LE). *b = 0 zeroes only byte 64, leaving byte 65 (01) -> a becomes 256.',
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
    action: { kind: 'write', stepIndex: 8, value: 0, valueText: '0' },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 261 },
      { stepIndex: 4, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario5(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'uint8_t', address: 64, size: 1, kind: 'int', signed: false, color: 0 },
    { name: 'x', type: 'int', address: 68, size: 4, kind: 'int', signed: true, color: 2 },
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
    'uint8_t a{ 42 };',
    'int* b{ &a };',
    'int x{ *b };',
  ];
  const v0 = { a: null, x: null, b: null };
  const v1 = { a: 42, x: null, b: null };
  const v2 = { a: 42, x: null, b: 64 };
  const v3 = { a: 42, x: 42, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'uint8_t a{ 42 }', expr: [11, 13], values: v0, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 0,
      pane: 'uint8_t a{ 42 }',
      expr: [11, 13],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'write', name: 'a', value: '42', span: [11, 13], destination: [8, 9] },
    },
    { line: 1, pane: 'int* b{ &a }', expr: [8, 10], values: v1, targets: {}, stdout: '', hold: 0.7, op: null },
    {
      line: 1,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.9,
      op: { kind: 'addr', name: 'a', value: '64', span: [8, 10] },
    },
    {
      line: 1,
      pane: 'int* b{ 64 }',
      expr: [8, 10],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.2,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 2, pane: 'int x{ *b }', expr: [7, 9], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 2,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [8, 9] },
    },
    {
      line: 2,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'deref', target: 'a', via: 'b', span: [7, 10] },
    },
    {
      line: 2,
      pane: 'int x{ 0x??????2A }',
      expr: [7, 17],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.5,
      op: { kind: 'read', name: 'a', value: '0x??????2A', span: [7, 10] },
    },
    {
      line: 2,
      pane: 'int x{ 0x??????2A }',
      expr: [7, 17],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'x', value: '0x??????2A', span: [7, 17], destination: [4, 5] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Larger pointer reads padding and poisons result',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'larger-read-padding',
    title: '5. Larger pointer reads past 1-byte object into padding',
    subtitle: 'Reading *b pulls byte 64 (2A) plus 3 indeterminate padding bytes -> 0x??????2A (LE) or 0x2A?????? (BE).',
    direction: 'larger',
    baseAddress: 64,
    totalBytes: 16,
    vars,
    ptrName: 'b',
    pointeeType: 'int',
    pointeeSize: 4,
    targetVar: 'a',
    targetAddress: 64,
    ptrInitStep: 4,
    derefStep: 7,
    action: {
      kind: 'read',
      readStepIndex: 8,
      storeStepIndex: 9,
      destVar: 'x',
      panePrefix: 'int x{ ',
      paneSuffix: ' }',
    },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 42 },
      { stepIndex: 4, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario6(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'uint8_t', address: 64, size: 1, kind: 'int', signed: false, color: 0 },
    { name: 'c', type: 'uint8_t', address: 65, size: 1, kind: 'int', signed: false, color: 3 },
    { name: 'x', type: 'int', address: 68, size: 4, kind: 'int', signed: true, color: 2 },
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
    'uint8_t c{ 26 };',
    'int* b{ &a };',
    'int x{ *b };',
  ];
  const v0 = { a: null, c: null, x: null, b: null };
  const v1 = { a: 5, c: null, x: null, b: null };
  const v2 = { a: 5, c: 26, x: null, b: null };
  const v3 = { a: 5, c: 26, x: null, b: 64 };
  const v4 = { a: 5, c: 26, x: 5, b: 64 };
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
    { line: 1, pane: 'uint8_t c{ 26 }', expr: [11, 13], values: v1, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 1,
      pane: 'uint8_t c{ 26 }',
      expr: [11, 13],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'c', value: '26', span: [11, 13], destination: [8, 9] },
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
      hold: 1.2,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 3, pane: 'int x{ *b }', expr: [7, 9], values: v3, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 3,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [8, 9] },
    },
    {
      line: 3,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'deref', target: 'a', via: 'b', span: [7, 10] },
    },
    {
      line: 3,
      pane: 'int x{ 0x????1A05 }',
      expr: [7, 17],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.5,
      op: { kind: 'read', name: 'a', value: '0x????1A05', span: [7, 10] },
    },
    {
      line: 3,
      pane: 'int x{ 0x????1A05 }',
      expr: [7, 17],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'x', value: '0x????1A05', span: [7, 17], destination: [4, 5] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Larger pointer reads neighbor variable and padding',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'larger-read-neighbor-padding',
    title: '6. Larger pointer reads neighbor c (1A) plus padding',
    subtitle: 'c stays intact (read, not write), but x gets both c’s byte and poisoned padding: 0x????1A05 (LE) / 0x051A???? (BE).',
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
    action: {
      kind: 'read',
      readStepIndex: 10,
      storeStepIndex: 11,
      destVar: 'x',
      panePrefix: 'int x{ ',
      paneSuffix: ' }',
    },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 26 },
      { stepIndex: 6, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario7(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'uint16_t', address: 64, size: 2, kind: 'int', signed: false, color: 0 },
    { name: 'c', type: 'uint16_t', address: 66, size: 2, kind: 'int', signed: false, color: 3 },
    { name: 'x', type: 'int', address: 68, size: 4, kind: 'int', signed: true, color: 2 },
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
    'uint16_t a{ 5 };',
    'uint16_t c{ 2 };',
    'int* b{ &a };',
    'int x{ *b };',
  ];
  const v0 = { a: null, c: null, x: null, b: null };
  const v1 = { a: 5, c: null, x: null, b: null };
  const v2 = { a: 5, c: 2, x: null, b: null };
  const v3 = { a: 5, c: 2, x: null, b: 64 };
  const v4 = { a: 5, c: 2, x: 131077, b: 64 };
  const steps: TraceStep[] = [
    { line: 0, pane: 'uint16_t a{ 5 }', expr: [12, 13], values: v0, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 0,
      pane: 'uint16_t a{ 5 }',
      expr: [12, 13],
      values: v1,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'a', value: '5', span: [12, 13], destination: [9, 10] },
    },
    { line: 1, pane: 'uint16_t c{ 2 }', expr: [12, 13], values: v1, targets: {}, stdout: '', hold: 0.6, op: null },
    {
      line: 1,
      pane: 'uint16_t c{ 2 }',
      expr: [12, 13],
      values: v2,
      targets: {},
      stdout: '',
      hold: 0.8,
      op: { kind: 'write', name: 'c', value: '2', span: [12, 13], destination: [9, 10] },
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
      hold: 1.2,
      op: { kind: 'write', name: 'b', value: '64', span: [8, 10], destination: [5, 6] },
    },
    { line: 3, pane: 'int x{ *b }', expr: [7, 9], values: v3, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 3,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [8, 9] },
    },
    {
      line: 3,
      pane: 'int x{ *64 }',
      expr: [7, 10],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'deref', target: 'a', via: 'b', span: [7, 10] },
    },
    {
      line: 3,
      pane: 'int x{ 131077 }',
      expr: [7, 13],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.5,
      op: { kind: 'read', name: 'a', value: '131077', span: [7, 10] },
    },
    {
      line: 3,
      pane: 'int x{ 131077 }',
      expr: [7, 13],
      values: v4,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'x', value: '131077', span: [7, 13], destination: [4, 5] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Larger pointer reads two adjacent variables',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'larger-read-adjacent',
    title: '7. Larger pointer reads across two adjacent uint16_t variables',
    subtitle: 'All 4 bytes are known (no padding), yet reading past a into c is still UB: 131077 (LE) or 327682 (BE).',
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
    action: {
      kind: 'read',
      readStepIndex: 10,
      storeStepIndex: 11,
      destVar: 'x',
      panePrefix: 'int x{ ',
      paneSuffix: ' }',
    },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 5 },
      { stepIndex: 3, varName: 'c', value: 2 },
      { stepIndex: 6, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

function makeScenario8(): { trace: ExecutionTrace; meta: PunningMeta } {
  const vars: PunningVar[] = [
    { name: 'a', type: 'int', address: 64, size: 4, kind: 'int', signed: true, color: 0 },
    { name: 'x', type: 'uint8_t', address: 68, size: 1, kind: 'int', signed: false, color: 2 },
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
    'uint8_t x = *b;',
  ];
  const v0 = { a: null, x: null, b: null };
  const v1 = { a: 261, x: null, b: null };
  const v2 = { a: 261, x: null, b: 64 };
  const v3 = { a: 261, x: 5, b: 64 };
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
      hold: 1.2,
      op: { kind: 'write', name: 'b', value: '64', span: [13, 15], destination: [9, 10] },
    },
    { line: 2, pane: 'uint8_t x = *b', expr: [12, 14], values: v2, targets: { b: 'a' }, stdout: '', hold: 0.7, op: null },
    {
      line: 2,
      pane: 'uint8_t x = *64',
      expr: [12, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 0.9,
      op: { kind: 'read', name: 'b', value: '64', span: [13, 14] },
    },
    {
      line: 2,
      pane: 'uint8_t x = *64',
      expr: [12, 15],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.1,
      op: { kind: 'deref', target: 'a', via: 'b', span: [12, 15] },
    },
    {
      line: 2,
      pane: 'uint8_t x = 5',
      expr: [12, 13],
      values: v2,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.5,
      op: { kind: 'read', name: 'a', value: '5', span: [12, 15] },
    },
    {
      line: 2,
      pane: 'uint8_t x = 5',
      expr: [12, 13],
      values: v3,
      targets: { b: 'a' },
      stdout: '',
      hold: 1.8,
      op: { kind: 'write', name: 'x', value: '5', span: [12, 13], destination: [8, 9] },
    },
  ];
  const trace: ExecutionTrace = {
    format: 1,
    title: 'Smaller pointer reads only byte 64 of an int',
    source,
    variables: traceVars,
    steps,
  };
  const meta: PunningMeta = {
    id: 'smaller-read-261',
    title: '8. Smaller pointer reads only byte 64 of int a (a = 261)',
    subtitle: '261 is 05 01 00 00 (LE) or 00 00 01 05 (BE). *b reads only byte 64 -> x = 5 (LE) or x = 0 (BE).',
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
    action: {
      kind: 'read',
      readStepIndex: 8,
      storeStepIndex: 9,
      destVar: 'x',
      panePrefix: 'uint8_t x = ',
      paneSuffix: '',
    },
    initSteps: [
      { stepIndex: 1, varName: 'a', value: 261 },
      { stepIndex: 4, varName: 'b', value: 64 },
    ],
  };
  META.set(trace, meta);
  return { trace, meta };
}

const SCENARIOS = [
  makeScenario1(),
  makeScenario2(),
  makeScenario3(),
  makeScenario4(),
  makeScenario5(),
  makeScenario6(),
  makeScenario7(),
  makeScenario8(),
];

// ============================================================================================
// SHARED SVG HELPERS + NATIVE TRANSFERS
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
    `<rect width="10" height="10" fill="${P.error}" fill-opacity="0.13"/>` +
    `<line x1="0" y1="0" x2="0" y2="10" stroke="${P.error}" stroke-opacity="0.34" stroke-width="2.8"/>` +
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

function scaledAt(cx: number, cy: number, inner: string, begin: number): string {
  return (
    `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}` +
    `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`
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

function poisonText(
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

function colorPoisonInSvg(markup: string, errorColor: string): string {
  return markup.replace(/(<text\b[^>]*>)([^<]*\?[^<]*)(<\/text>)/g, (_, open, body, close) => {
    const colored = String(body).replace(/(\?+)/g, `<tspan fill="${errorColor}">$1</tspan>`);
    return open + colored + close;
  });
}

function resolveReadContext(c: SceneContext, meta: PunningMeta, sim: SimState): SceneContext {
  if (meta.action.kind !== 'read' || !sim.readResult) return c;
  const { readStepIndex, storeStepIndex, panePrefix, paneSuffix } = meta.action;
  const val = sim.readResult.text;
  const resolvedPane = `${panePrefix}${val}${paneSuffix}`;
  const valSpan: [number, number] = [panePrefix.length, panePrefix.length + val.length];

  const patch = (st: TraceStep | null, idx: number): TraceStep | null => {
    if (!st) return null;
    if (idx === readStepIndex) {
      const op = st.op?.kind === 'read' ? { ...st.op, value: val } : st.op;
      return { ...st, pane: resolvedPane, expr: valSpan, op };
    }
    if (idx === storeStepIndex) {
      const op = st.op?.kind === 'write' ? { ...st.op, value: val, span: valSpan } : st.op;
      return { ...st, pane: resolvedPane, expr: valSpan, op };
    }
    return st;
  };

  const step = patch(c.step, c.index)!;
  const prev = patch(c.prev, c.index - 1);
  return { ...c, step, prev, op: step.op };
}

function punningStepSeconds(m: PreparedModel, index: number): number {
  const meta = META.get(m.trace);
  if (meta) {
    if (meta.action.kind === 'write' && index === meta.action.stepIndex) {
      return m.steps[index].hold + 2.3;
    }
    if (meta.action.kind === 'read') {
      if (index === meta.action.readStepIndex) return m.steps[index].hold + 2.2;
      if (index === meta.action.storeStepIndex) return m.steps[index].hold + 2.3;
    }
    if (index === meta.derefStep) return m.steps[index].hold + 1.6;
    if (index === meta.ptrInitStep) return m.steps[index].hold + 2.4;
  }
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
  if (!animate || !op || sim.isPunningWrite || sim.isPunningRead || sim.isPoisonStore) return '';
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
// FULL-HEIGHT OPEN HUD CORNER RETICLE (APPROVED VARIANT A)
// ============================================================================================

function drawHudReticle(
  bx: number,
  by: number,
  bw: number,
  bh: number,
  leftCol: string,
  rightCol: string,
  splitX: number | null
): string {
  const arm = Math.min(14, bw * 0.28);
  const tick = 5;
  const rx = bx + bw;
  const ry = by + bh;
  const mx = bx + bw / 2;
  const my = by + bh / 2;
  const rightTopCol = splitX !== null ? rightCol : leftCol;
  const topTickCol = splitX !== null && mx >= splitX ? rightCol : leftCol;

  let out = '';
  if (splitX !== null) {
    out +=
      `<path d="M ${round(splitX)} ${round(by)} H ${round(bx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/>` +
      `<path d="M ${round(splitX)} ${round(by)} H ${round(rx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${rightCol}" stroke-opacity="0.4" stroke-dasharray="3 3" stroke-width="1.3"/>`;
  } else {
    out += `<rect x="${round(bx)}" y="${round(by)}" width="${round(bw)}" height="${round(bh)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/>`;
  }
  out +=
    `<path d="M ${round(bx)} ${round(by + arm)} V ${round(by)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(bx)} ${round(ry - arm)} V ${round(ry)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(rx - arm)} ${round(by)} H ${round(rx)} V ${round(by + arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<path d="M ${round(rx - arm)} ${round(ry)} H ${round(rx)} V ${round(ry - arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/>` +
    `<line x1="${round(mx)}" y1="${round(by)}" x2="${round(mx)}" y2="${round(by + tick)}" stroke="${topTickCol}" stroke-width="2.2"/>` +
    `<line x1="${round(mx)}" y1="${round(ry)}" x2="${round(mx)}" y2="${round(ry - tick)}" stroke="${topTickCol}" stroke-width="2.2"/>` +
    `<line x1="${round(bx)}" y1="${round(my)}" x2="${round(bx + tick)}" y2="${round(my)}" stroke="${leftCol}" stroke-width="2.2"/>` +
    `<line x1="${round(rx)}" y1="${round(my)}" x2="${round(rx - tick)}" y2="${round(my)}" stroke="${rightTopCol}" stroke-width="2.2"/>`;
  return out;
}

function targetScopeReticle(
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
  const dep = op ? departure(op) : 0;
  const wLeft = xOf(meta.targetAddress);
  const wWidth = meta.pointeeSize * byteW;
  const targetVar = meta.vars.find(v => v.name === meta.targetVar)!;
  const ownEnd = xOf(targetVar.address + targetVar.size);

  const pad = 3.5;
  const bx = wLeft - pad;
  const by = gridY - pad;
  const bw = wWidth + 2 * pad;
  const bh = cellH + 2 * pad;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  const isWritingPtr = animate && op?.kind === 'write' && op.name === meta.ptrName;
  const isDeref = animate && c.index === meta.derefStep;
  const hot = sim.windowActive;
  const opCol = meta.action.kind === 'read' ? P.read : P.write;

  let inner = '';
  if (meta.direction === 'larger' && sim.ubTriggered) {
    const calm = drawHudReticle(bx, by, bw, bh, pCol, pCol, null);
    const breached = drawHudReticle(bx, by, bw, bh, opCol, P.error, ownEnd);
    const triggerAt = sim.isPunningRead ? dep : at;
    inner =
      animate && (sim.isPunningWrite || sim.isPunningRead)
        ? `<g>${hide(triggerAt)}${calm}</g><g opacity="0">${show(triggerAt)}${breached}</g>`
        : breached;
  } else {
    const col = hot ? opCol : pCol;
    inner = drawHudReticle(bx, by, bw, bh, col, col, null);
  }

  if (isWritingPtr) {
    const lockBegin = at + 0.52;
    return (
      `<g opacity="0">${fade(0, 1, 0.14, lockBegin)}` +
      `<g transform="translate(${round(cx)} ${round(cy)})"><g>` +
      `<animateTransform attributeName="transform" type="scale" values="1.28;0.96;1" keyTimes="0;0.74;1" ` +
      `calcMode="spline" keySplines="0.2 0 0.2 1;0.4 0 0.2 1" begin="${round(lockBegin)}s" dur="0.46s" fill="freeze"/>` +
      `<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g></g>`
    );
  }
  if (isDeref) {
    return scaledAt(cx, cy, inner, at - 0.18);
  }
  return inner;
}

/** Transient full-height write highlight over the exact byte span actually being written. */
function transientWriteHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, Math.max(0, at - 0.25))}${fade(1, 0, 0.3, at + 0.35)}` +
    rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0).replace('fill=', 'fill-opacity="0.2" fill=') +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

/** Transient full-height read highlight over the exact byte span actually being read. */
function transientReadHighlight(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  at: number
): string {
  return (
    `<g opacity="0">${fade(0, 1, 0.15, 0)}${fade(1, 0, 0.25, at)}` +
    rect(x + 2, y + 2, w - 4, h - 4, color, 'none', 0).replace('fill=', 'fill-opacity="0.18" fill=') +
    rect(x + 2, y + 2, w - 4, h - 4, 'none', color, 0, 2.8) +
    '</g>'
  );
}

// ============================================================================================
// UNIFIED SCENE
// ============================================================================================

function punningScene(rawC: SceneContext): string {
  const meta = META.get(rawC.m.trace)!;
  const sim = simulate(meta, rawC.index, rawC.littleEndian);
  const c = resolveReadContext(rawC, meta, sim);
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
  const dep = op ? departure(op) : 0;
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

  // 2. Padding runs (hatched only; corrupted red hatch ONLY on write UB, not on read)
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
      if (slot.status === 'padding' && sim.ubKind === 'write') {
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
            `<g opacity="0">${show(revealAt)}${scaledAt(bx + byteW / 2, gridY + 68, hazard, revealAt - 0.1)}</g>`;
        } else {
          mem += hazard;
        }
      } else {
        mem += text(bx + byteW / 2, hexY, '??', 13.5, P.grey, 'middle');
      }
    }
  }

  // Staggered rows for variable type pills
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

  // 3. Variables (clean panel fill; NO persistent highlight or veil; corrupted foreign bytes stay red;
  //    poisoned `?` bytes stored into a variable show red hazard hatch + red `??`)
  for (const v of meta.vars) {
    const vx = xOf(v.address);
    const vw = v.size * byteW;
    const col = varColor(P, v);
    const valAfter = sim.varAfter.get(v.name) ?? null;
    const valBefore = sim.varBefore.get(v.name) ?? null;
    const on = valAfter !== null;
    const isCorrupted = sim.corruptedVars.has(v.name);
    const isDestStore = meta.action.kind === 'read' && sim.isPoisonStore && v.name === meta.action.destVar;
    const borderCol = isCorrupted ? P.error : on ? col : P.deadStroke;

    let markup = '';
    markup += rect(vx + 1, gridY + 1, vw - 2, cellH - 2, on ? P.panel : P.deadFill, 'none', 0);

    // Corrupted foreign bytes (on write UB) keep full-height red hazard fill;
    // Poisoned `?` bytes copied into destVar (on read UB) keep bottom-half red hazard fill.
    for (let k = 0; k < v.size; k++) {
      const addr = v.address + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);
      if (slot.status === 'foreign' && sim.ubKind === 'write') {
        const bg = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, 'none', 0);
        markup +=
          animate && sim.isPunningWrite
            ? `<g opacity="0">${show(at + 0.08 * (addr - meta.targetAddress))}${bg}</g>`
            : bg;
      } else if (slot.after === '?') {
        const bg = rect(bx + 1.5, splitY + 0.8, byteW - 3, gridY + cellH - splitY - 2.3, `url(#${ubId})`, 'none', 0);
        markup +=
          animate && isDestStore
            ? `<g opacity="0">${show(at + 0.08 * k)}${bg}</g>`
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

    // Outer variable border
    if (animate && sim.isPunningWrite && isCorrupted) {
      markup +=
        `<g>${hide(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', col, 0, 2.8)}</g>` +
        `<g opacity="0">${show(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', P.error, 0, 3.2)}</g>`;
    } else {
      markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, 'none', borderCol, 0, isCorrupted ? 3.2 : 2.8);
    }

    // 3a. Centered header (decimal when clean, hex with red `?` when poisoned)
    const headCx = vx + vw / 2;
    const renderHeader = (val: DecodedVar | null, useBefore: boolean): string => {
      if (!val) return '';
      const str = val.text;
      const decSize = Math.min(25, (vw - 12) / (Math.max(1, str.length) * CHAR));
      const decCol = isCorrupted && !useBefore ? P.error : P.fg;
      const bg =
        isCorrupted && !useBefore
          ? rect(headCx - 14, gridY + 12, 28, 26, P.panel, 'none', 4)
          : '';
      return bg + poisonText(headCx, gridY + 33, str, round(decSize), decCol, P.error, 'middle');
    };

    const normalWrite = animate && op?.kind === 'write' && op.name === v.name && !sim.isPunningWrite && !isDestStore;
    const valueChanged =
      animate &&
      ((sim.isPunningWrite && valBefore?.text !== valAfter?.text) || isDestStore);

    if (normalWrite || valueChanged) {
      const headCy = gridY + 26;
      const swapped =
        (valBefore !== null ? `<g>${hide(at)}${renderHeader(valBefore, true)}</g>` : '') +
        `<g opacity="0">${show(at)}${renderHeader(valAfter, false)}</g>`;
      markup += scaledAt(headCx, headCy, swapped, at - 0.15);
    } else {
      markup += renderHeader(valAfter, false);
    }

    // 3b. Individual byte cells — ONLY changed bytes pulse; unaffected bytes stay still & clean
    const hexY = gridY + 74;
    for (let k = 0; k < v.size; k++) {
      const addr = v.address + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bx = xOf(addr);

      const renderByte = (bval: ByteVal, useBefore: boolean): string => {
        if (bval === null) return '';
        if (bval === '?') {
          const badgeBg = rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3);
          return badgeBg + text(bx + byteW / 2, hexY, '??', 15.5, P.error, 'middle');
        }
        const byteInk =
          slot.status === 'foreign' && sim.ubKind === 'write' && !useBefore
            ? P.error
            : v.kind === 'ptr'
              ? P.muted
              : P.fg;
        const opAttr = v.kind === 'ptr' ? ' opacity="0.65"' : '';
        const bg =
          slot.status === 'foreign' && sim.ubKind === 'write' && !useBefore
            ? rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, 'none', 3)
            : '';
        return bg + `<g${opAttr}>${text(bx + byteW / 2, hexY, hex2(bval), v.kind === 'ptr' ? 13 : 15.5, byteInk, 'middle')}</g>`;
      };

      const byteChanged =
        animate &&
        (normalWrite ||
          isDestStore ||
          (sim.isPunningWrite && slot.before !== slot.after));
      if (byteChanged) {
        const byteAt = sim.isPunningWrite
          ? at + 0.08 * (addr - meta.targetAddress)
          : isDestStore
            ? at + 0.08 * k
            : at;
        const swapped =
          (slot.before !== null ? `<g>${hide(byteAt)}${renderByte(slot.before, true)}</g>` : '') +
          `<g opacity="0">${show(byteAt)}${renderByte(slot.after, false)}</g>`;
        markup += scaledAt(bx + byteW / 2, gridY + 68, swapped, byteAt - 0.15);
      } else {
        markup += renderByte(slot.after, false);
      }
    }

    // Transient read / write highlight for non-punning steps (plus store into destVar `x`)
    if (animate && op && !sim.isPunningWrite && !sim.isPunningRead) {
      if (op.kind === 'read' && op.name === v.name) {
        markup += transientReadHighlight(vx, gridY, vw, cellH, P.read, at);
      } else if (op.kind === 'write' && op.name === v.name) {
        markup += transientWriteHighlight(vx, gridY, vw, cellH, P.write, at);
      }
    }

    // Byte-order arrow from bits_view.ts on every multi-byte int
    if (v.kind === 'int' && v.size > 1) {
      const ay = gridY + cellH + 10;
      const dir = c.littleEndian ? 1 : -1;
      const xLow = vx + (c.littleEndian ? byteW / 2 : vw - byteW / 2);
      const xHigh = vx + (c.littleEndian ? vw - byteW / 2 : byteW / 2);
      const arrowCol = on ? P.grey : P.deadStroke;
      markup +=
        `<g opacity="${on ? '0.75' : '0.45'}">` +
        `<line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M -8 -4 L 0 0 L -8 4 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${c.littleEndian ? 0 : 180})"/>` +
        '</g>';
    }

    // Variable name + staggered type pill below cell
    const pillRow = pillRowOf.get(v.name) ?? 0;
    const nameY = gridY + cellH + 34;
    const pillTop = nameY + 8 + pillRow * 24;
    const nameCol = isCorrupted ? P.error : on ? col : P.grey;
    if (animate && sim.isPunningWrite && isCorrupted) {
      markup +=
        `<g>${hide(at)}${text(vx + vw / 2, nameY, v.name, 20, col, 'middle')}</g>` +
        `<g opacity="0">${show(at)}${text(vx + vw / 2, nameY, v.name, 20, P.error, 'middle')}</g>`;
    } else {
      markup += text(vx + vw / 2, nameY, v.name, 20, nameCol, 'middle');
    }
    markup += typeLabel(c, vx + vw / 2, pillTop, v.type, 13.5, on ? typeColour(c, v.type) : P.deadStroke);

    const keepBright =
      isCorrupted ||
      sim.readForeignVars.has(v.name) ||
      (sim.ptrLive && (v.name === meta.targetVar || v.name === meta.ptrName));
    mem += keepBright ? markup : dim(c, v.name, markup);
  }

  // 3c. Transient full-height write OR read highlight on the EXACT bytes accessed by `*b`!
  //     (4 tall bytes for int*, 1 tall misaligned byte for uint8_t* — consistent across reads & writes!)
  let accessFlash = '';
  if (animate && sim.isPunningWrite) {
    const wLeft = xOf(meta.targetAddress);
    const wWidth = meta.pointeeSize * byteW;
    if (meta.direction === 'larger') {
      const ownW = targetVar.size * byteW;
      const spillW = wWidth - ownW;
      accessFlash += transientWriteHighlight(wLeft, gridY, ownW, cellH, P.write, at);
      if (spillW > 0) {
        accessFlash += transientWriteHighlight(wLeft + ownW, gridY, spillW, cellH, P.error, at + 0.08);
      }
    } else {
      accessFlash += transientWriteHighlight(wLeft, gridY, wWidth, cellH, P.write, at);
    }
  } else if (animate && sim.isPunningRead) {
    const wLeft = xOf(meta.targetAddress);
    const wWidth = meta.pointeeSize * byteW;
    if (meta.direction === 'larger') {
      const ownW = targetVar.size * byteW;
      const spillW = wWidth - ownW;
      accessFlash += transientReadHighlight(wLeft, gridY, ownW, cellH, P.read, at);
      if (spillW > 0) {
        accessFlash += transientReadHighlight(wLeft + ownW, gridY, spillW, cellH, P.error, at);
      }
    } else {
      accessFlash += transientReadHighlight(wLeft, gridY, wWidth, cellH, P.read, at);
    }
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

  // 5. Full-height open HUD corner reticle
  const scopeReticle = targetScopeReticle(c, meta, sim, xOf, byteW, gridY, cellH, pCol);

  // 6. UB bracket & badge below memory — ONLY on larger-pointer read or write!
  let belowOverlay = '';
  if (meta.direction === 'larger' && sim.ubTriggered) {
    const wLeft = xOf(meta.targetAddress);
    const wRight = xOf(meta.targetAddress + meta.pointeeSize);
    const ownEnd = xOf(targetVar.address + targetVar.size);
    const brY = gridY + cellH + 46 + pillRowsCount * 24 + 8;
    const tickTop = brY - 10;
    const ownCol = sim.ubKind === 'read' ? P.read : P.write;
    const cal =
      `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${ownCol}" stroke-width="2.2"/>` +
      `<path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="2.8"/>` +
      pill((ownEnd + wRight) / 2, brY + 18, '⚠ UB', 13.5, P.error, P.error, P.bg);
    const showAt = sim.isPunningRead ? dep : at;
    belowOverlay +=
      animate && (sim.isPunningWrite || sim.isPunningRead)
        ? `<g opacity="0">${fade(0, 1, 0.25, showAt)}${cal}</g>`
        : cal;
  }

  // 7. Standardized pane byte strip (write: bytes written + hollow slots; read: bytes read + hollow slots)
  let wb = '';
  let flight = '';
  const showPaneStrip =
    meta.action.kind === 'write'
      ? sim.windowActive
      : c.index >= meta.action.readStepIndex;
  if (showPaneStrip) {
    const stripY = g.ty + 28;
    const tileW = 44;
    const tileH = 30;
    const tileGap = 6;
    const rhsStart =
      meta.action.kind === 'read'
        ? meta.action.panePrefix.length
        : Math.max(0, step.pane.indexOf('= ') + 2);
    const tilesX = g.tx + rhsStart * g.paneChar;
    const bytes = sim.paneBytes;
    const destName = meta.action.kind === 'read' ? meta.action.destVar : null;
    const destVar = destName ? meta.vars.find(v => v.name === destName)! : null;

    for (let k = 0; k < bytes.length; k++) {
      const addr = meta.targetAddress + k;
      const slot = sim.bytes[addr - meta.baseAddress];
      const bval = bytes[k];
      const label = typeof bval === 'number' ? hex2(bval) : '??';
      const isBad =
        sim.ubTriggered &&
        (slot.status === 'padding' || slot.status === 'foreign' || bval === '?');
      const tx = tilesX + k * (tileW + tileGap);
      const isReadPhase = meta.action.kind === 'read' && !sim.isPoisonStore;
      const baseStroke = isReadPhase ? P.read : P.write;
      const baseFill = isReadPhase ? P.readFill : P.writeFill;
      const stroke = isBad ? P.error : baseStroke;
      const fill = isBad ? P.panel : baseFill;
      const tileMarkup =
        rect(tx, stripY, tileW, tileH, fill, stroke, 5, 2) +
        text(tx + tileW / 2, stripY + 20, label, 15.5, stroke, 'middle');

      if (animate && sim.isPunningRead) {
        // Read: byte tile lifts off memory and lands in pane strip
        const sx = xOf(addr) + byteW / 2;
        const sy = gridY + 70;
        const ex = tx + tileW / 2;
        const ey = stripY + tileH / 2;
        const midY = (sy + ey) / 2;
        const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
        const dur = 0.85;
        const begin = dep + k * 0.08;
        const end = begin + dur;
        const flyCol =
          slot.status === 'padding' || slot.status === 'foreign' ? P.error : P.read;
        wb += `<g opacity="0">${show(end)}${tileMarkup}</g>`;
        flight +=
          `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
          `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
          rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
          text(0, 6, label, 15, flyCol, 'middle') +
          `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
      } else {
        wb += tileMarkup;
        if (animate && sim.isPunningWrite) {
          // Write via punned pointer: byte tile flies up from pane into target memory
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = xOf(addr) + byteW / 2;
          const ey = gridY + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const dur = 0.85;
          const end = at + k * 0.08;
          const begin = Math.max(0.2, end - dur);
          const flyCol =
            slot.status === 'padding' || slot.status === 'foreign' ? P.error : P.write;
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
            text(0, 6, label, 15, flyCol, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        } else if (animate && sim.isPoisonStore && destVar) {
          // Store after punning read: byte tiles fly up from pane into destVar (`x`)
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = xOf(destVar.address + k) + byteW / 2;
          const ey = gridY + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const dur = 0.85;
          const end = at + k * 0.08;
          const begin = Math.max(0.2, end - dur);
          const flyCol = bval === '?' ? P.error : P.write;
          flight +=
            `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g>` +
            `<g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` +
            rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) +
            text(0, 6, label, 15, flyCol, 'middle') +
            `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        }
      }
    }

    if (meta.direction === 'smaller') {
      let slots = '';
      for (let k = bytes.length; k < targetVar.size; k++) {
        const tx = tilesX + k * (tileW + tileGap);
        slots += `<rect x="${round(tx)}" y="${stripY}" width="${tileW}" height="${tileH}" rx="5" fill="none" stroke="${P.grey}" stroke-opacity="0.75" stroke-dasharray="4 3" stroke-width="1.6"/>`;
      }
      wb += animate && sim.isPunningRead ? `<g opacity="0">${fade(0, 1, 0.2, dep + 0.65)}${slots}</g>` : slots;
    }
  }

  const paneMarkup = colorPoisonInSvg(pane(c, animate && copies(c.m.steps, c.index)), P.error);

  return (
    defs +
    code(c, oldLine) +
    tether(c, oldLine) +
    arcMarkup +
    mem +
    accessFlash +
    scopeReticle +
    belowOverlay +
    paneMarkup +
    wb +
    output(c) +
    gridTransfers(c, meta, sim, xOf, byteW, gridY, cellH) +
    flight
  );
}

const PUNNING_VIEW: TraceView = {
  geometry: m => {
    const meta = META.get(m.trace)!;
    return {
      minByteWidth: 46,
      minColumnWidth: 780,
      cellHeight: 88,
      extraMemBottom: meta.direction === 'larger' ? 104 : 46,
      extraPaneHeight: 46,
      skipWrap: true,
    };
  },
  stackBelow: 900,
  maxScale: 0.72,
  byteOrder: true,
  scene: punningScene,
  stepSeconds: punningStepSeconds,
};

// ============================================================================================
// PROTOTYPE SHELL
// ============================================================================================

let players: Player[] = [];

function init(): void {
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
    const player = new Player(host, trace, PUNNING_VIEW);
    player.settle(trace.steps.length - 1);
    players.push(player);
  }

  document.getElementById('theme')!.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    for (const p of players) p.refresh();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
