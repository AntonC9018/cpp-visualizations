// Byte-level integer encoding, decoding, poisoned hex formatting, and alignment padding helpers.
// Isomorphic: shared by the tracer/validator (`src/core/`) and the byte-level player views (`src/player/`).

/** One byte of storage: a concrete 0..255 value, indeterminate (`?`), or not yet live (`null`). */
export type ByteValue = number | '?' | null;

export interface DecodedBytes {
  /** Decimal when all bytes are known; `0x…` with `?` nibbles whenever any byte is unknown. */
  text: string;
  poisoned: boolean;
  numeric: number | null;
}

export interface StorageSpan {
  address: number;
  size: number;
}

export interface PaddingRun {
  start: number;
  size: number;
}

/** Uppercase two-digit hexadecimal spelling of one byte (`05`, `2A`, `FF`). */
export const hexByte = (byte: number): string =>
  (byte & 0xff).toString(16).toUpperCase().padStart(2, '0');

/** The `size` bytes of `value` in two's complement, most significant byte first. */
export function toBytesMSB(value: bigint | number, size: number): number[] {
  const big = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  const unsigned = BigInt.asUintN(size * 8, big);
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) {
    out.push(Number((unsigned >> BigInt(i * 8)) & 0xffn));
  }
  return out;
}

/** The `size` bytes of `value` in memory order (little-endian or big-endian). */
export function encodeBytes(value: bigint | number, size: number, littleEndian: boolean): number[] {
  const msb = toBytesMSB(value, size);
  return littleEndian ? msb.reverse() : msb;
}

/** Reassemble `bytes` in memory order into a signed or unsigned integer. */
export function decodeBytes(bytes: readonly number[], signed: boolean, littleEndian: boolean): bigint {
  const ordered = littleEndian ? [...bytes].reverse() : bytes;
  let acc = 0n;
  for (const b of ordered) {
    acc = (acc << 8n) | BigInt(b & 0xff);
  }
  if (signed && bytes.length > 0) {
    const bits = BigInt(bytes.length * 8);
    const signBit = 1n << (bits - 1n);
    if (acc >= signBit) acc -= 1n << bits;
  }
  return acc;
}

/**
 * Format a slice of memory bytes as a variable or expression value.
 * Returns `null` when none of the bytes are live yet; `0x…` with `??` for unknown bytes when
 * poisoned (MSB first, respecting `littleEndian`); decimal otherwise.
 */
export function formatByteSlice(
  slice: readonly ByteValue[],
  signed: boolean,
  littleEndian: boolean
): DecodedBytes | null {
  if (slice.length === 0 || slice.every(b => b === null)) return null;
  if (slice.some(b => typeof b !== 'number')) {
    const ordered = littleEndian ? [...slice].reverse() : [...slice];
    const hex = ordered.map(b => (typeof b === 'number' ? hexByte(b) : '??')).join('');
    return { text: `0x${hex}`, poisoned: true, numeric: null };
  }
  const value = decodeBytes(slice as number[], signed, littleEndian);
  const numeric = Number(value);
  return { text: value.toString(10), poisoned: false, numeric };
}

/** Contiguous alignment-padding runs between `items` (and optional trailing padding up to `minEnd`). */
export function paddingRuns(items: readonly StorageSpan[], minEnd?: number): PaddingRun[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.address - b.address);
  const runs: PaddingRun[] = [];
  let cursor = sorted[0].address;
  for (const item of sorted) {
    if (item.address > cursor) {
      runs.push({ start: cursor, size: item.address - cursor });
    }
    cursor = Math.max(cursor, item.address + item.size);
  }
  if (minEnd !== undefined && minEnd > cursor) {
    runs.push({ start: cursor, size: minEnd - cursor });
  }
  return runs;
}
