// Byte-level pointer type punning model and step simulator (isomorphic).
//
// Shared by the tracer (`src/core/tracing.ts`) and the player view (`src/player/punning_view.ts`)
// so a single validated JSON trace renders accurately in both Little-endian and Big-endian modes
// with zero hardcoded scenario metadata.
import { type ByteValue, type DecodedBytes, encodeBytes, formatByteSlice } from './bytes.ts';
import { type Integer, integerLiteral, integerSpelled } from './integers.ts';
import type { ExecutionTrace, PunningAccess, ScalarVariable } from './trace_format.ts';

/** A pointer's integer pointee metadata parsed from its declared type (`int*`, `uint8_t*`). */
export interface PointeeInfo {
  type: string;
  size: number;
  signed: boolean;
}

/** Parse a single-level pointer to a supported integer type (`int*`, `const uint8_t*`). */
export function punningPointee(
  spelling: string | undefined,
  aliases: Record<string, string> = {}
): PointeeInfo | null {
  if (!spelling) return null;
  const match = /^(?:const\s+)?(.+?)\s*\*$/.exec(spelling.trim());
  if (!match) return null;
  const base = match[1].trim();
  if (base.includes('*')) return null;
  const info = integerSpelled(base, aliases);
  if (!info) return null;
  return { type: base, size: info.size, signed: info.signed };
}

export type PunningByteStatus = 'none' | 'owned' | 'padding' | 'foreign' | 'untouched';

export interface PunningByteSlot {
  address: number;
  owner: ScalarVariable | null;
  before: ByteValue;
  after: ByteValue;
  changed: boolean;
  status: PunningByteStatus;
  /** True if an out-of-bounds write corrupted this byte at or before the current step. */
  corrupted: boolean;
  /** True if an out-of-bounds write corrupted this byte ON the current step. */
  corruptedNow: boolean;
}

export interface ActivePunPointer {
  ptrName: string;
  targetName: string;
  targetAddress: number;
  targetSize: number;
  pointeeType: string;
  pointeeSize: number;
  pointeeSigned: boolean;
  direction: 'larger' | 'smaller' | 'same';
  /** Active dereference/read/write window on this statement. */
  windowActive: boolean;
  /** Whether an out-of-bounds access through this pointer has occurred so far. */
  ubKind: 'none' | 'write' | 'read';
}

export interface PunningSimState {
  baseAddress: number;
  endAddress: number;
  bytes: PunningByteSlot[];
  varBefore: Map<string, DecodedBytes | null>;
  varAfter: Map<string, DecodedBytes | null>;
  corruptedVars: Set<string>;
  readForeignVars: Set<string>;
  /** All currently live punned pointers (pointee type differs from target type). */
  punPointers: ActivePunPointer[];
  /** The punning access actively executing on this step, if any. */
  activePun: {
    kind: 'deref' | 'read' | 'write';
    pun: PunningAccess;
    targetName: string;
    targetAddress: number;
    targetSize: number;
    direction: 'larger' | 'smaller' | 'same';
    bytes: ByteValue[];
    readResult: DecodedBytes | null;
  } | null;
  /** Set on a normal write that stores the result of an earlier punning read in the same statement. */
  storeAfterPunRead: {
    destVar: ScalarVariable;
    bytes: ByteValue[];
    readResult: DecodedBytes;
    targetSize: number;
    direction: 'larger' | 'smaller' | 'same';
    pun: PunningAccess;
    targetAddress: number;
  } | null;
  /** Endian-resolved text for the current/previous pane when a punning read result is shown. */
  paneReadReplacement: {
    stepIndex: number;
    originalValue: string;
    resolvedValue: string;
  } | null;
  prevPaneReadReplacement: {
    stepIndex: number;
    originalValue: string;
    resolvedValue: string;
  } | null;
}

function scalarVars(trace: ExecutionTrace): ScalarVariable[] {
  return trace.variables.filter((v): v is ScalarVariable => v.kind !== 'struct');
}

function integerOfVar(v: ScalarVariable, aliases: Record<string, string>): Integer | null {
  return v.kind === 'int' ? integerSpelled(v.type ?? '', aliases) : null;
}

/** Exclusive end address required to display all variables plus any larger-pointer pointee window. */
export function punningMinEndAddress(trace: ExecutionTrace): number {
  const vars = scalarVars(trace);
  if (vars.length === 0) return 0;
  const byName = new Map(vars.map(v => [v.name, v]));
  const aliases = trace.integers ?? {};
  let end = Math.max(...vars.map(v => v.address + v.size));
  for (const step of trace.steps) {
    for (const [ptrName, targetName] of Object.entries(step.targets)) {
      const ptr = byName.get(ptrName);
      const target = byName.get(targetName);
      const pointee = punningPointee(ptr?.type, aliases);
      if (target && pointee) {
        end = Math.max(end, target.address + pointee.size);
      }
    }
    const op = step.op;
    if (op && 'pun' in op && op.pun) {
      const targetName = op.kind === 'deref' ? op.target : op.name;
      const target = byName.get(targetName);
      if (target) end = Math.max(end, target.address + op.pun.size);
    }
  }
  return end;
}

/** Whether a punning trace ever has a larger-pointer access that can show a below-memory UB badge. */
export function hasLargerPointerAccess(trace: ExecutionTrace): boolean {
  const vars = scalarVars(trace);
  const byName = new Map(vars.map(v => [v.name, v]));
  const aliases = trace.integers ?? {};
  for (const step of trace.steps) {
    for (const [ptrName, targetName] of Object.entries(step.targets)) {
      const ptr = byName.get(ptrName);
      const target = byName.get(targetName);
      const pointee = punningPointee(ptr?.type, aliases);
      if (target && pointee && pointee.size > target.size) return true;
    }
    const op = step.op;
    if (op && 'pun' in op && op.pun) {
      const targetName = op.kind === 'deref' ? op.target : op.name;
      const target = byName.get(targetName);
      if (target && op.pun.size > target.size) return true;
    }
  }
  return false;
}

function directionOf(pointeeSize: number, targetSize: number): 'larger' | 'smaller' | 'same' {
  return pointeeSize > targetSize ? 'larger' : pointeeSize < targetSize ? 'smaller' : 'same';
}

/**
 * Simulate byte-level memory across `trace.steps[0..stepIndex]` in `littleEndian` order.
 * Pure and deterministic: every variable value, poisoned byte, corruption state, and
 * endian-resolved read value is derived solely from `trace` and `littleEndian`.
 */
export function simulatePunningTrace(
  trace: ExecutionTrace,
  stepIndex: number,
  littleEndian: boolean
): PunningSimState {
  const vars = scalarVars(trace);
  const byName = new Map(vars.map(v => [v.name, v]));
  const aliases = trace.integers ?? {};
  const baseAddress = vars.length ? Math.min(...vars.map(v => v.address)) : 0;
  const endAddress = punningMinEndAddress(trace);
  const totalBytes = Math.max(0, endAddress - baseAddress);

  const ownerAt = (addr: number): ScalarVariable | null => {
    for (const v of vars) {
      if (addr >= v.address && addr < v.address + v.size) return v;
    }
    return null;
  };

  const mem: ByteValue[] = Array.from({ length: totalBytes }, (_, i) =>
    ownerAt(baseAddress + i) ? null : '?'
  );
  const corruptedAddrs = new Set<number>();
  const corruptedVars = new Set<string>();
  const readForeignVars = new Set<string>();
  const ptrUbKind = new Map<string, 'none' | 'write' | 'read'>();

  let beforeMem: ByteValue[] = [...mem];
  let corruptedNow = new Set<number>();

  // Per-statement transient punning read state (reset when a new statement opens with op === null)
  let stmtPunRead: {
    bytes: ByteValue[];
    readResult: DecodedBytes;
    originalValue: string;
    pun: PunningAccess;
    targetName: string;
    targetAddress: number;
    targetSize: number;
    direction: 'larger' | 'smaller' | 'same';
  } | null = null;
  let stmtNormalReadBytes: ByteValue[] | null = null;
  let activePun: PunningSimState['activePun'] = null;
  let storeAfterPunRead: PunningSimState['storeAfterPunRead'] = null;
  let paneReadReplacement: PunningSimState['paneReadReplacement'] = null;
  let prevPaneReadReplacement: PunningSimState['prevPaneReadReplacement'] = null;

  const decodeAll = (buf: ByteValue[]): Map<string, DecodedBytes | null> => {
    const out = new Map<string, DecodedBytes | null>();
    for (const v of vars) {
      const slice = buf.slice(v.address - baseAddress, v.address - baseAddress + v.size);
      if (slice.every(b => b === null)) {
        out.set(v.name, null);
      } else if (slice.every(b => b === '?')) {
        // Declared uninitialized variable (all bytes indeterminate before any partial known byte)
        out.set(v.name, { text: '?', poisoned: false, numeric: null });
      } else {
        const info = integerOfVar(v, aliases);
        const signed = info ? info.signed : false;
        out.set(v.name, formatByteSlice(slice, signed, littleEndian));
      }
    }
    return out;
  };

  let varBefore = decodeAll(mem);

  const clampedIndex = Math.max(0, Math.min(stepIndex, trace.steps.length - 1));
  for (let i = 0; i <= clampedIndex; i++) {
    const step = trace.steps[i];
    const prev = i > 0 ? trace.steps[i - 1] : null;
    if (i === clampedIndex) {
      beforeMem = [...mem];
      varBefore = decodeAll(beforeMem);
      corruptedNow = new Set();
      prevPaneReadReplacement = paneReadReplacement;
    }

    const op = step.op;
    activePun = null;
    storeAfterPunRead = null;

    if (!op) {
      stmtPunRead = null;
      stmtNormalReadBytes = null;
      paneReadReplacement = null;
      // Declaration without initializer: null -> '?'
      for (const v of vars) {
        if (step.values[v.name] === '?' && (!prev || prev.values[v.name] === null)) {
          for (let k = 0; k < v.size; k++) {
            mem[v.address - baseAddress + k] = '?';
          }
        }
      }
      continue;
    }

    if (op.kind === 'deref' && op.pun) {
      const target = byName.get(op.target);
      if (target) {
        const dir = directionOf(op.pun.size, target.size);
        const start = target.address - baseAddress;
        activePun = {
          kind: 'deref',
          pun: op.pun,
          targetName: target.name,
          targetAddress: target.address,
          targetSize: target.size,
          direction: dir,
          bytes: mem.slice(start, start + op.pun.size),
          readResult: null,
        };
      }
      continue;
    }

    if (op.kind === 'read') {
      if (op.pun) {
        const target = byName.get(op.name);
        if (target) {
          const start = target.address - baseAddress;
          const slice = mem.slice(start, start + op.pun.size).map(b => (b === null ? '?' : b));
          const info = integerSpelled(op.pun.type, aliases);
          const readResult = formatByteSlice(slice, info?.signed ?? true, littleEndian)!;
          const dir = directionOf(op.pun.size, target.size);
          let hasOob = false;
          for (let k = 0; k < op.pun.size; k++) {
            const addr = target.address + k;
            const owner = ownerAt(addr);
            if (!owner) {
              hasOob = true;
            } else if (owner.name !== target.name) {
              hasOob = true;
              readForeignVars.add(owner.name);
            }
          }
          if (hasOob && ptrUbKind.get(op.pun.via) !== 'write') {
            ptrUbKind.set(op.pun.via, 'read');
          }
          stmtPunRead = {
            bytes: slice,
            readResult,
            originalValue: op.value,
            pun: op.pun,
            targetName: target.name,
            targetAddress: target.address,
            targetSize: target.size,
            direction: dir,
          };
          paneReadReplacement = {
            stepIndex: i,
            originalValue: op.value,
            resolvedValue: readResult.text,
          };
          activePun = {
            kind: 'read',
            pun: op.pun,
            targetName: target.name,
            targetAddress: target.address,
            targetSize: target.size,
            direction: dir,
            bytes: slice,
            readResult,
          };
        }
      } else {
        const src = byName.get(op.name);
        if (src) {
          const start = src.address - baseAddress;
          stmtNormalReadBytes = mem.slice(start, start + src.size);
          const decoded = decodeAll(mem).get(src.name);
          if (decoded && decoded.text !== op.value) {
            paneReadReplacement = {
              stepIndex: i,
              originalValue: op.value,
              resolvedValue: decoded.text,
            };
          }
        }
      }
      continue;
    }

    if (op.kind === 'write') {
      if (op.pun) {
        const target = byName.get(op.name);
        const val = integerLiteral(op.value);
        if (target && val !== null) {
          const encoded = encodeBytes(val, op.pun.size, littleEndian);
          const dir = directionOf(op.pun.size, target.size);
          let hasOob = false;
          for (let k = 0; k < op.pun.size; k++) {
            const addr = target.address + k;
            const idx = addr - baseAddress;
            if (idx >= 0 && idx < mem.length) mem[idx] = encoded[k];
            const owner = ownerAt(addr);
            if (!owner) {
              hasOob = true;
              corruptedAddrs.add(addr);
              if (i === clampedIndex) corruptedNow.add(addr);
            } else if (owner.name !== target.name) {
              hasOob = true;
              corruptedAddrs.add(addr);
              corruptedVars.add(owner.name);
              if (i === clampedIndex) corruptedNow.add(addr);
            }
          }
          if (hasOob) ptrUbKind.set(op.pun.via, 'write');
          activePun = {
            kind: 'write',
            pun: op.pun,
            targetName: target.name,
            targetAddress: target.address,
            targetSize: target.size,
            direction: dir,
            bytes: encoded,
            readResult: null,
          };
        }
      } else {
        const dest = byName.get(op.name);
        if (dest) {
          const dstStart = dest.address - baseAddress;
          if (stmtPunRead && stmtPunRead.bytes.length === dest.size) {
            for (let k = 0; k < dest.size; k++) {
              mem[dstStart + k] = stmtPunRead.bytes[k];
            }
            storeAfterPunRead = {
              destVar: dest,
              bytes: stmtPunRead.bytes,
              readResult: stmtPunRead.readResult,
              targetSize: stmtPunRead.targetSize,
              direction: stmtPunRead.direction,
              pun: stmtPunRead.pun,
              targetAddress: stmtPunRead.targetAddress,
            };
          } else if (
            stmtNormalReadBytes &&
            stmtNormalReadBytes.length === dest.size &&
            stmtNormalReadBytes.some(b => b === '?')
          ) {
            for (let k = 0; k < dest.size; k++) {
              mem[dstStart + k] = stmtNormalReadBytes[k];
            }
          } else {
            const numeric = op.value === 'nullptr' ? 0n : integerLiteral(op.value);
            if (numeric !== null) {
              const encoded = encodeBytes(numeric, dest.size, littleEndian);
              for (let k = 0; k < dest.size; k++) {
                mem[dstStart + k] = encoded[k];
              }
            }
          }
          // Writing a pointer resets its prior UB state if reassigned to a new target
          if (dest.kind === 'ptr' && prev && prev.targets[dest.name] !== step.targets[dest.name]) {
            ptrUbKind.delete(dest.name);
          }
        }
      }
    }
  }

  const step = trace.steps[clampedIndex];
  const punPointers: ActivePunPointer[] = [];
  for (const [ptrName, targetName] of Object.entries(step.targets)) {
    const ptr = byName.get(ptrName);
    const target = byName.get(targetName);
    const pointee = punningPointee(ptr?.type, aliases);
    if (!ptr || !target || !pointee) continue;
    if (target.kind !== 'int') continue;
    const targetInfo = integerOfVar(target, aliases);
    // Track any pointer whose pointee type or size differs from its target
    if (targetInfo && targetInfo.size === pointee.size && targetInfo.signed === pointee.signed) {
      continue;
    }
    const isWindowActive =
      (activePun !== null && activePun.pun.via === ptrName) ||
      (storeAfterPunRead !== null && storeAfterPunRead.pun.via === ptrName);
    punPointers.push({
      ptrName,
      targetName,
      targetAddress: target.address,
      targetSize: target.size,
      pointeeType: pointee.type,
      pointeeSize: pointee.size,
      pointeeSigned: pointee.signed,
      direction: directionOf(pointee.size, target.size),
      windowActive: isWindowActive,
      ubKind: ptrUbKind.get(ptrName) ?? 'none',
    });
  }

  // Build per-byte slot states using the primary active pun pointer (if any)
  const primary =
    punPointers.find(p => p.windowActive) ??
    punPointers.find(p => p.ubKind !== 'none') ??
    punPointers[0] ??
    null;

  const bytes: PunningByteSlot[] = [];
  for (let i = 0; i < totalBytes; i++) {
    const address = baseAddress + i;
    const owner = ownerAt(address);
    let status: PunningByteStatus = 'none';
    if (primary) {
      const wStart = primary.targetAddress;
      const wEnd = wStart + primary.pointeeSize;
      const tStart = primary.targetAddress;
      const tEnd = tStart + primary.targetSize;
      if (address >= wStart && address < wEnd) {
        status = !owner ? 'padding' : owner.name === primary.targetName ? 'owned' : 'foreign';
      } else if (address >= tStart && address < tEnd) {
        status = 'untouched';
      }
    }
    bytes.push({
      address,
      owner,
      before: beforeMem[i],
      after: mem[i],
      changed: clampedIndex > 0 && beforeMem[i] !== mem[i],
      status,
      corrupted: corruptedAddrs.has(address),
      corruptedNow: corruptedNow.has(address),
    });
  }

  return {
    baseAddress,
    endAddress,
    bytes,
    varBefore,
    varAfter: decodeAll(mem),
    corruptedVars,
    readForeignVars,
    punPointers,
    activePun,
    storeAfterPunRead,
    paneReadReplacement,
    prevPaneReadReplacement,
  };
}
