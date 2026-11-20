// The builtin integer types: their sizes, signedness and spellings. Plain data shared by the
// tracer and the player, which draws an integer's bytes from its type.
/** A builtin integer type and its representation in the trace. */
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


}

// Canonical integer spellings and storage sizes in the pinned x86-64 ABI.
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
  int_least8_t: 'signed char',
  uint_least8_t: 'unsigned char',
  int_least16_t: 'short',
  uint_least16_t: 'unsigned short',
  int_least32_t: 'int',
  uint_least32_t: 'unsigned int',
  int_least64_t: 'long',
  uint_least64_t: 'unsigned long',
  int_fast8_t: 'signed char',
  uint_fast8_t: 'unsigned char',
  int_fast16_t: 'long',
  uint_fast16_t: 'unsigned long',
  int_fast32_t: 'long',
  uint_fast32_t: 'unsigned long',
  int_fast64_t: 'long',
  uint_fast64_t: 'unsigned long',
  intmax_t: 'long',
  uintmax_t: 'unsigned long',
  signed: 'int',
  unsigned: 'unsigned int',
  'signed int': 'int',
  'short int': 'short',
  'signed short': 'short',
  'unsigned short int': 'unsigned short',
  'long int': 'long',
  'signed long': 'long',
  'unsigned long int': 'unsigned long',
  'long long int': 'long long',
  'signed long long': 'long long',
  'unsigned long long int': 'unsigned long long',
});

/** A type spelling without `const` and `std::`: how aliases are looked up. */
export const bareSpelling = (spelling: string): string => spelling.replace(/^const /, '').replace(/^std::/, '');

/**
 * The integer type a spelling names (`uint8_t`, `const int`, `std::size_t`), if any. `aliases`
 * maps further bare spellings to the builtin names Clang resolved them to (`streamsize`: `long`).
 */
export function integerSpelled(spelling: string, aliases: Readonly<Record<string, string>> = {}): Integer | null {
  const name = integerName(spelling, aliases);
  return name === null ? null : INTEGERS[name];
}

/** The builtin name of the integer type a spelling names (`uint8_t`: `unsigned char`), if any. */
export function integerName(spelling: string, aliases: Readonly<Record<string, string>> = {}): string | null {
  const name = bareSpelling(spelling);
  const known = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  const canonical = Object.hasOwn(INTEGERS, known) || !Object.hasOwn(aliases, name) ? known : aliases[name];
  return Object.hasOwn(INTEGERS, canonical) ? canonical : null;
}

/**
 * The value of an integer literal as C++ spells it, after an optional sign: decimal, `0x`, `0b`
 * or octal digits, `'` separators and a `u`/`l`/`z` suffix (`-0xFF`, `1'000`, `42ull`).
 */
export function integerLiteral(spelling: string): bigint | null {
  const match = spelling
    .trim()
    .match(/^([-+]?)\s*(0[xX][0-9a-fA-F']+|0[bB][01']+|0[0-7']*|[1-9][0-9']*)(?:[uU](?:ll|LL|[lLzZ])?|(?:ll|LL|[lLzZ])[uU]?)?$/);
  if (!match || /^0[xXbB]'|''|'$/.test(match[2])) return null;
  const digits = match[2].replaceAll("'", '');
  const octal = /^0[0-7]+$/.test(digits) ? `0o${digits.slice(1)}` : digits;
  const value = BigInt(octal);
  return match[1] === '-' ? -value : value;
}
