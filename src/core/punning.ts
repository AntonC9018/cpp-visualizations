// Byte-level pointer type punning model and step simulator (isomorphic).
//
// Shared by the player view (`src/player/punning_view.ts`) and tests so a single validated JSON
// trace renders accurately in both Little-endian and Big-endian modes with zero hardcoded scenario
// metadata.
import { type ByteValue, type DecodedBytes, encodeBytes, formatByteSlice } from './bytes.ts';
import { type Integer, bareSpelling, integerLiteral, integerName, integerSpelled } from './integers.ts';
import { type ExecutionTrace, POISONED_HEX, type PunningAccess, type ScalarVariable, type Span } from './trace_format.ts';

/** A pointer's integer pointee metadata parsed from its declared type (`int*`, `uint8_t*`). */
export interface PointeeInfo {
  type: string;
  size: number;
  signed: boolean;
}

/** Canonical builtin integer name behind an alias (`uint8_t` -> `unsigned char`, `long` != `long long`). */
function canonicalIntName(spelling: string | undefined, aliases: Record<string, string>): string | null {
  if (!spelling) return null;
  const bare = bareSpelling(spelling);
  if (Object.hasOwn(aliases, bare)) return integerName(aliases[bare]);
  return integerName(bare);
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
  /** True if this byte was already corrupted before the current step. */
  corruptedBefore: boolean;
  /** True if an out-of-bounds write touched this byte ON the current step. */
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
  /** True only on the step where `ubKind` first transitions from `'none'` to `'read' | 'write'`. */
  ubTriggeredNow: boolean;
}

export interface PaneReadReplacement {
  stepIndex: number;
  /** Exact span `[start, end)` of `originalValue` inside that step's pane text. */
  span: Span;
  originalValue: string;
  resolvedValue: string;
}

export interface PunningSimState {
  baseAddress: number;
  endAddress: number;
  bytes: PunningByteSlot[];
  varBefore: Map<string, DecodedBytes | null>;
  varAfter: Map<string, DecodedBytes | null>;
  corruptedVars: Set<string>;
  /** Variables that have had a direct/same-type uninitialized read (cleared when cleanly overwritten). */
  uninitUbVars: Set<string>;
  /** Variables whose uninitialized read UB first triggers on the current step. */
  uninitUbTriggeredNow: Set<string>;
  /** Foreign variables overlapped by the current step's punning read (empty on other steps). */
  readForeignVars: Set<string>;
  /** All currently live punned pointers (canonical pointee type differs from target type). */
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
  /** Non-punned read of a variable containing indeterminate (`?`) bytes on this step, if any. */
  activePoisonRead: {
    varName: string;
    address: number;
    size: number;
    bytes: ByteValue[];
    readResult: DecodedBytes;
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
  /** Set on a normal write that stores poisoned bytes from a non-punned uninitialized read. */
  storeAfterPoisonRead: {
    destVar: ScalarVariable;
    bytes: ByteValue[];
    readResult: DecodedBytes;
    sourceAddress: number;
    sourceSize: number;
  } | null;
  /** Endian-resolved replacement for the current/previous pane when a read value differs in BE. */
  paneReadReplacement: PaneReadReplacement | null;
  prevPaneReadReplacement: PaneReadReplacement | null;
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

/** Whether a punning trace ever has a direct/same-type uninitialized read that shows a UB badge. */
export function hasUninitializedRead(trace: ExecutionTrace): boolean {
  return trace.steps.some(
    step => step.op?.kind === 'read' && !step.op.pun && POISONED_HEX.test(step.op.value)
  );
}

/** Parse a `POISONED_HEX` literal (MSB-first) into memory-order bytes for `littleEndian`. */
function parsePoisonedBytes(hex: string, littleEndian: boolean): ByteValue[] {
  const count = (hex.length - 2) / 2;
  const msb: ByteValue[] = [];
  for (let k = 0; k < count; k++) {
    const pair = hex.slice(2 + k * 2, 4 + k * 2);
    msb.push(pair === '??' ? '?' : Number.parseInt(pair, 16));
  }
  return littleEndian ? msb.reverse() : msb;
}

function directionOf(pointeeSize: number, targetSize: number): 'larger' | 'smaller' | 'same' {
  return pointeeSize > targetSize ? 'larger' : pointeeSize < targetSize ? 'smaller' : 'same';
}

function valueSpanInPane(pane: string, opStart: number, value: string): Span {
  if (pane.startsWith(`(${value})`, opStart)) {
    return [opStart + 1, opStart + 1 + value.length];
  }
  return [opStart, opStart + value.length];
}

interface DirectReadState {
  kind: 'pun' | 'normal';
  bytes: ByteValue[];
  readResult: DecodedBytes;
  originalValue: string;
  paneSpan: Span;
  pun?: PunningAccess;
  targetName: string;
  targetAddress: number;
  targetSize: number;
  direction?: 'larger' | 'smaller' | 'same';
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
  const liveVars = new Set<string>();
  const poisonedVars = new Set<string>();
  const corruptedAddrs = new Set<number>();
  const corruptedVars = new Set<string>();
  const uninitUbVars = new Set<string>();
  let uninitUbTriggeredNow = new Set<string>();
  let readForeignVars = new Set<string>();
  const ptrUbKind = new Map<string, 'none' | 'write' | 'read'>();
  let ubTriggeredNowPtrs = new Set<string>();

  let beforeMem: ByteValue[] = [...mem];
  let corruptedBeforeSet = new Set<number>();
  let corruptedNow = new Set<number>();

  // Per-statement direct-read state (cleared whenever arithmetic/unrelated eval intervenes or a new statement opens)
  let directRead: DirectReadState | null = null;
  let activePun: PunningSimState['activePun'] = null;
  let activePoisonRead: PunningSimState['activePoisonRead'] = null;
  let storeAfterPunRead: PunningSimState['storeAfterPunRead'] = null;
  let storeAfterPoisonRead: PunningSimState['storeAfterPoisonRead'] = null;
  let paneReadReplacement: PaneReadReplacement | null = null;
  let prevPaneReadReplacement: PaneReadReplacement | null = null;

  const decodeAll = (buf: ByteValue[]): Map<string, DecodedBytes | null> => {
    const out = new Map<string, DecodedBytes | null>();
    for (const v of vars) {
      if (!liveVars.has(v.name)) {
        out.set(v.name, null);
        continue;
      }
      const slice = buf.slice(v.address - baseAddress, v.address - baseAddress + v.size);
      if (slice.every(b => b === null)) {
        out.set(v.name, null);
      } else if (slice.every(b => b === '?') && !poisonedVars.has(v.name)) {
        out.set(v.name, { text: '?', poisoned: false, exact: null, numeric: null });
      } else {
        const info = integerOfVar(v, aliases);
        const signed = info ? info.signed : false;
        out.set(v.name, formatByteSlice(slice, signed, littleEndian));
      }
    }
    return out;
  };

  const shiftDirectSpan = (opEnd: number, paneDelta: number): void => {
    if (paneDelta === 0) return;
    if (directRead && opEnd <= directRead.paneSpan[0]) {
      directRead.paneSpan = [directRead.paneSpan[0] + paneDelta, directRead.paneSpan[1] + paneDelta];
    }
    if (paneReadReplacement && opEnd <= paneReadReplacement.span[0]) {
      paneReadReplacement = {
        ...paneReadReplacement,
        span: [paneReadReplacement.span[0] + paneDelta, paneReadReplacement.span[1] + paneDelta],
      };
    }
  };

  let varBefore = decodeAll(mem);

  const clampedIndex = Math.max(0, Math.min(stepIndex, trace.steps.length - 1));
  for (let i = 0; i <= clampedIndex; i++) {
    const step = trace.steps[i];
    const prev = i > 0 ? trace.steps[i - 1] : null;
    if (i === clampedIndex) {
      beforeMem = [...mem];
      varBefore = decodeAll(beforeMem);
      corruptedBeforeSet = new Set(corruptedAddrs);
      corruptedNow = new Set();
      ubTriggeredNowPtrs = new Set();
      uninitUbTriggeredNow = new Set();
      prevPaneReadReplacement = paneReadReplacement;
    }

    const op = step.op;
    activePun = null;
    activePoisonRead = null;
    storeAfterPunRead = null;
    storeAfterPoisonRead = null;
    readForeignVars = new Set();

    if (!op) {
      directRead = null;
      paneReadReplacement = null;
      // Declaration without initializer: null -> '?'
      for (const v of vars) {
        if (step.values[v.name] === '?' && (!prev || prev.values[v.name] === null)) {
          liveVars.add(v.name);
          poisonedVars.delete(v.name);
          corruptedVars.delete(v.name);
          uninitUbVars.delete(v.name);
          for (let k = 0; k < v.size; k++) {
            const addr = v.address + k;
            mem[addr - baseAddress] = '?';
            corruptedAddrs.delete(addr);
          }
        }
      }
      continue;
    }

    const paneDelta = prev ? step.pane.length - prev.pane.length : 0;

    if (op.kind === 'deref') {
      shiftDirectSpan(op.span[1], paneDelta);
      if (op.pun) {
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
      }
      continue;
    }

    if (op.kind === 'addr') {
      shiftDirectSpan(op.span[1], paneDelta);
      continue;
    }

    if (op.kind === 'convert') {
      const cur = directRead as DirectReadState | null;
      if (
        cur &&
        !cur.readResult.poisoned &&
        cur.readResult.exact !== null &&
        op.span[0] <= cur.paneSpan[0] &&
        op.span[1] >= cur.paneSpan[1]
      ) {
        const to = integerSpelled(op.to, aliases);
        if (to) {
          const wrapped = to.wrap(cur.readResult.exact);
          const encoded = encodeBytes(wrapped, to.size, littleEndian);
          const readResult = formatByteSlice(encoded, to.signed, littleEndian)!;
          const span = valueSpanInPane(step.pane, op.span[0], op.value);
          const widthChanged = to.size !== cur.bytes.length;
          directRead = {
            ...cur,
            ...(widthChanged ? { kind: 'normal' as const, pun: undefined, direction: undefined } : {}),
            bytes: encoded,
            readResult,
            originalValue: op.value,
            paneSpan: span,
          };
          paneReadReplacement =
            readResult.text !== op.value
              ? { stepIndex: i, span, originalValue: op.value, resolvedValue: readResult.text }
              : null;
          continue;
        }
      } else if (
        cur &&
        cur.readResult.poisoned &&
        cur.bytes.every(b => b === '?') &&
        op.span[0] <= cur.paneSpan[0] &&
        op.span[1] >= cur.paneSpan[1]
      ) {
        const from = integerSpelled(op.from, aliases);
        const to = integerSpelled(op.to, aliases);
        if (from && to) {
          const encoded: ByteValue[] =
            to.size > from.size && !from.signed
              ? littleEndian
                ? [...Array<ByteValue>(from.size).fill('?'), ...Array<ByteValue>(to.size - from.size).fill(0)]
                : [...Array<ByteValue>(to.size - from.size).fill(0), ...Array<ByteValue>(from.size).fill('?')]
              : Array<ByteValue>(to.size).fill('?');
          const readResult = formatByteSlice(encoded, to.signed, littleEndian)!;
          const span = valueSpanInPane(step.pane, op.span[0], op.value);
          directRead = {
            ...cur,
            kind: 'normal',
            pun: undefined,
            direction: undefined,
            bytes: encoded,
            readResult,
            originalValue: op.value,
            paneSpan: span,
          };
          paneReadReplacement =
            readResult.text !== op.value
              ? { stepIndex: i, span, originalValue: op.value, resolvedValue: readResult.text }
              : null;
          continue;
        }
      }
      directRead = null;
      paneReadReplacement = null;
      continue;
    }

    if (op.kind === 'eval') {
      const cur = directRead as DirectReadState | null;
      // Preserve directRead only for pass-through wrappers like `(...)` or `{...}` around the same value.
      if (
        cur &&
        op.value === cur.originalValue &&
        op.span[0] <= cur.paneSpan[0] &&
        op.span[1] >= cur.paneSpan[1]
      ) {
        const span = valueSpanInPane(step.pane, op.span[0], op.value);
        directRead = { ...cur, paneSpan: span };
        paneReadReplacement =
          cur.readResult.text !== op.value
            ? {
                stepIndex: i,
                span,
                originalValue: op.value,
                resolvedValue: cur.readResult.text,
              }
            : null;
      } else if (
        cur &&
        cur.readResult.poisoned &&
        POISONED_HEX.test(op.value) &&
        op.span[0] <= cur.paneSpan[0] &&
        op.span[1] >= cur.paneSpan[1]
      ) {
        const encoded = parsePoisonedBytes(op.value, littleEndian);
        const readResult = formatByteSlice(encoded, false, littleEndian)!;
        const span = valueSpanInPane(step.pane, op.span[0], op.value);
        directRead = {
          ...cur,
          kind: 'normal',
          pun: undefined,
          direction: undefined,
          bytes: encoded,
          readResult,
          originalValue: op.value,
          paneSpan: span,
        };
        paneReadReplacement =
          readResult.text !== op.value
            ? { stepIndex: i, span, originalValue: op.value, resolvedValue: readResult.text }
            : null;
      } else {
        directRead = null;
        paneReadReplacement = null;
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
            if (!owner || !liveVars.has(owner.name)) {
              hasOob = true;
            } else if (owner.name !== target.name) {
              hasOob = true;
              readForeignVars.add(owner.name);
            }
          }
          if (hasOob) {
            const prevUb = ptrUbKind.get(op.pun.via) ?? 'none';
            if (prevUb === 'none' && i === clampedIndex) ubTriggeredNowPtrs.add(op.pun.via);
            if (prevUb !== 'write') ptrUbKind.set(op.pun.via, 'read');
          }
          const span = valueSpanInPane(step.pane, op.span[0], op.value);
          directRead = {
            kind: 'pun',
            bytes: slice,
            readResult,
            originalValue: op.value,
            paneSpan: span,
            pun: op.pun,
            targetName: target.name,
            targetAddress: target.address,
            targetSize: target.size,
            direction: dir,
          };
          paneReadReplacement =
            readResult.text !== op.value
              ? { stepIndex: i, span, originalValue: op.value, resolvedValue: readResult.text }
              : null;
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
          const slice = mem.slice(start, start + src.size);
          const hasUnknown = slice.some(b => b === '?');
          if (src.kind === 'ptr' && !hasUnknown) {
            // Reading a pointer (e.g. LHS `q` in `*q = *b`) must not clobber RHS `directRead`.
            shiftDirectSpan(op.span[1], paneDelta);
          } else {
            const info = integerOfVar(src, aliases);
            const decoded = hasUnknown
              ? formatByteSlice(slice, info?.signed ?? false, littleEndian)
              : decodeAll(mem).get(src.name);
            if (decoded) {
              if (hasUnknown) {
                if (!uninitUbVars.has(src.name) && i === clampedIndex) {
                  uninitUbTriggeredNow.add(src.name);
                }
                uninitUbVars.add(src.name);
                activePoisonRead = {
                  varName: src.name,
                  address: src.address,
                  size: src.size,
                  bytes: slice,
                  readResult: decoded,
                };
              }
              const span = valueSpanInPane(step.pane, op.span[0], op.value);
              directRead = {
                kind: 'normal',
                bytes: slice,
                readResult: decoded,
                originalValue: op.value,
                paneSpan: span,
                targetName: src.name,
                targetAddress: src.address,
                targetSize: src.size,
              };
              paneReadReplacement =
                decoded.text !== op.value
                  ? { stepIndex: i, span, originalValue: op.value, resolvedValue: decoded.text }
                  : null;
            }
          }
        }
      }
      continue;
    }

    if (op.kind === 'write') {
      if (op.pun) {
        const target = byName.get(op.name);
        const cur = directRead as DirectReadState | null;
        let encoded: ByteValue[] | null = null;
        if (cur && cur.bytes.length === op.pun.size && cur.bytes.every(b => typeof b === 'number')) {
          encoded = [...cur.bytes];
        } else {
          const val =
            cur && !cur.readResult.poisoned && cur.readResult.exact !== null
              ? cur.readResult.exact
              : integerLiteral(op.value);
          if (val !== null) encoded = encodeBytes(val, op.pun.size, littleEndian);
        }
        if (target && encoded) {
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
              if (liveVars.has(owner.name)) {
                corruptedAddrs.add(addr);
                corruptedVars.add(owner.name);
                if (i === clampedIndex) corruptedNow.add(addr);
              }
            }
          }
          // Update poisonedVars for any live integer overlapped by this punned write
          for (const v of vars) {
            if (!liveVars.has(v.name) || v.kind !== 'int') continue;
            if (v.address >= target.address + op.pun.size || v.address + v.size <= target.address) continue;
            const slice = mem.slice(v.address - baseAddress, v.address - baseAddress + v.size);
            if (slice.some(b => b === '?')) poisonedVars.add(v.name);
            else poisonedVars.delete(v.name);
          }
          if (hasOob) {
            const prevUb = ptrUbKind.get(op.pun.via) ?? 'none';
            if (prevUb === 'none' && i === clampedIndex) ubTriggeredNowPtrs.add(op.pun.via);
            ptrUbKind.set(op.pun.via, 'write');
          }
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
          liveVars.add(dest.name);
          corruptedVars.delete(dest.name);
          const dstStart = dest.address - baseAddress;
          for (let k = 0; k < dest.size; k++) {
            corruptedAddrs.delete(dest.address + k);
          }
          const cur = directRead as DirectReadState | null;
          if (cur && cur.bytes.length === dest.size) {
            for (let k = 0; k < dest.size; k++) {
              mem[dstStart + k] = cur.bytes[k];
            }
            if (cur.readResult.poisoned) {
              poisonedVars.add(dest.name);
            } else {
              poisonedVars.delete(dest.name);
              uninitUbVars.delete(dest.name);
            }
            if (cur.kind === 'pun' && cur.pun && cur.direction) {
              storeAfterPunRead = {
                destVar: dest,
                bytes: cur.bytes,
                readResult: cur.readResult,
                targetSize: cur.targetSize,
                direction: cur.direction,
                pun: cur.pun,
                targetAddress: cur.targetAddress,
              };
            } else if (cur.readResult.poisoned) {
              storeAfterPoisonRead = {
                destVar: dest,
                bytes: cur.bytes,
                readResult: cur.readResult,
                sourceAddress: cur.targetAddress,
                sourceSize: cur.targetSize,
              };
            }
          } else if (cur && !cur.readResult.poisoned && cur.readResult.exact !== null) {
            poisonedVars.delete(dest.name);
            uninitUbVars.delete(dest.name);
            const encoded = encodeBytes(cur.readResult.exact, dest.size, littleEndian);
            for (let k = 0; k < dest.size; k++) {
              mem[dstStart + k] = encoded[k];
            }
          } else if (POISONED_HEX.test(op.value) && op.value.length === 2 + dest.size * 2) {
            poisonedVars.add(dest.name);
            const encoded = parsePoisonedBytes(op.value, littleEndian);
            for (let k = 0; k < dest.size; k++) {
              mem[dstStart + k] = encoded[k];
            }
          } else {
            poisonedVars.delete(dest.name);
            uninitUbVars.delete(dest.name);
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
    const pointeeCanon = canonicalIntName(pointee.type, aliases);
    const targetCanon = canonicalIntName(target.type, aliases);
    if (pointeeCanon && targetCanon && pointeeCanon === targetCanon) {
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
      ubTriggeredNow: ubTriggeredNowPtrs.has(ptrName),
    });
  }

  const primary =
    punPointers.find(p => p.windowActive) ??
    punPointers.find(p => p.ubKind !== 'none') ??
    punPointers[0] ??
    null;

  const bytes: PunningByteSlot[] = [];
  for (let i = 0; i < totalBytes; i++) {
    const address = baseAddress + i;
    const owner = ownerAt(address);
    const ownerLive = owner !== null && liveVars.has(owner.name);
    let status: PunningByteStatus = 'none';
    if (primary) {
      const wStart = primary.targetAddress;
      const wEnd = wStart + primary.pointeeSize;
      const tStart = primary.targetAddress;
      const tEnd = tStart + primary.targetSize;
      if (address >= wStart && address < wEnd) {
        status = !owner || !ownerLive ? 'padding' : owner.name === primary.targetName ? 'owned' : 'foreign';
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
      corruptedBefore: corruptedBeforeSet.has(address),
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
    uninitUbVars,
    uninitUbTriggeredNow,
    readForeignVars,
    punPointers,
    activePun,
    activePoisonRead,
    storeAfterPunRead,
    storeAfterPoisonRead,
    paneReadReplacement,
    prevPaneReadReplacement,
  };
}
