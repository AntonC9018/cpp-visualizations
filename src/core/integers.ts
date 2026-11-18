// The builtin integer types: their sizes, signedness and spellings. Plain data shared by the
// tracer and the player, which draws an integer's bytes from its type.
import { Unsupported } from './errors.ts';

/** A builtin integer type: its bytes and whether it is signed. Arithmetic is exact in bigint. */
export class Integer {
  readonly size: number;
  readonly signed: boolean;

  constructor(size: number, signed: boolean) {
    this.size = size;
    this.signed = signed;
    Object.freeze(this);
  }

  /** `value` converted to this type: its low bits, as every conversion keeps them. */
  wrap(value: bigint): bigint {
    return this.signed ? BigInt.asIntN(8 * this.size, value) : BigInt.asUintN(8 * this.size, value);
  }

  holds(value: bigint): boolean {
    return this.wrap(value) === value;
  }

  /** The result of arithmetic in this type: unsigned wraps, signed overflow is undefined. */
  result(value: bigint): bigint {
    if (this.signed && !this.holds(value)) {
      throw new Unsupported('signed integer overflow is outside the timeline category');
    }
    return this.wrap(value);
  }
}

// By Clang's canonical spelling, with the sizes of the pinned x86-64 toolchain; GDB checks the
// size of every cell. `char` and `bool` are not numbers in the lessons and stay out.
export const INTEGERS: Readonly<Record<string, Integer>> = Object.freeze({
  'signed char': new Integer(1, true),
  'unsigned char': new Integer(1, false),
  short: new Integer(2, true),
  'unsigned short': new Integer(2, false),
  int: new Integer(4, true),
  'unsigned int': new Integer(4, false),
  long: new Integer(8, true),
  'unsigned long': new Integer(8, false),
  'long long': new Integer(8, true),
  'unsigned long long': new Integer(8, false),
});

// Clang resolves an alias only where it is the whole type, not under a pointer (`uint8_t *`).
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  size_t: 'unsigned long',
  ptrdiff_t: 'long',
  intptr_t: 'long',
  uintptr_t: 'unsigned long',
  int8_t: 'signed char',
  uint8_t: 'unsigned char',
  int16_t: 'short',
  uint16_t: 'unsigned short',
  int32_t: 'int',
  uint32_t: 'unsigned int',
  int64_t: 'long',
  uint64_t: 'unsigned long',
});

/** The integer type a spelling names (`uint8_t`, `const int`, `std::size_t`), if any. */
export function integerSpelled(spelling: string): Integer | null {
  const name = spelling.replace(/^const /, '').replace(/^std::/, '');
  const canonical = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return Object.hasOwn(INTEGERS, canonical) ? INTEGERS[canonical] : null;
}
