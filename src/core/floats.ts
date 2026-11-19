// How floating-point values read: as `std::cout` prints them, and as memory cells show them.

// std::cout's defaultfloat precision: significant digits of a printed floating-point value.
const PRINTED_DIGITS = 6;

/** A finite, non-negative double exactly as `mantissa * 2 ** exponent`. */
function binaryParts(value: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biased = Number(bits >> 52n);
  const fraction = bits & ((1n << 52n) - 1n);
  return biased === 0
    ? { mantissa: fraction, exponent: -1074 }
    : { mantissa: fraction | (1n << 52n), exponent: biased - 1075 };
}

/** Whether a non-negative `value` is exactly `(digits - 0.5) * 10 ** scale`. */
function isTie(value: number, digits: number, scale: number): boolean {
  const { mantissa, exponent } = binaryParts(value);
  // Compare 2 * mantissa * 2^exponent with (2 * digits - 1) * 10^scale in integers.
  let left = 2n * mantissa;
  let right = 2n * BigInt(digits) - 1n;
  if (exponent >= 0) left <<= BigInt(exponent);
  else right <<= BigInt(-exponent);
  if (scale >= 0) right *= 10n ** BigInt(scale);
  else left *= 10n ** BigInt(-scale);
  return left === right;
}

/** Format a floating-point number the way `std::cout` defaultfloat (precision 6) prints it. */
export function formatFloat(value: number): string {
  if (Object.is(value, -0)) return '-0';
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const [mantissa, e] = magnitude.toExponential(PRINTED_DIGITS - 1).split('e');
  const exp = Number(e);
  let rounded = Number(mantissa.replace('.', ''));
  // toExponential rounds an exact tie up, printf rounds it to the even neighbour. The larger
  // neighbour of a tie that carries into the next power of ten is 100000, already even.
  if (rounded % 2 === 1 && isTie(magnitude, rounded, exp - (PRINTED_DIGITS - 1))) rounded -= 1;
  const digits = String(rounded);
  if (exp < -4 || exp >= PRINTED_DIGITS) {
    const trimmed = (digits[0] + '.' + digits.slice(1)).replace(/\.?0+$/, '');
    const expSign = exp < 0 ? '-' : '+';
    return `${sign}${trimmed}e${expSign}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  const point = exp + 1;
  const fixed =
    point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point);
  return sign + (fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed);
}

// Significant digits a memory cell or step shows before it rounds: past this, digits are noise
// to a student, and a cell would shrink its text to fit them.
const SHOWN_DIGITS = 8;

/** The shortest decimal that reads back as `value` at its storage size (4: float, 8: double). */
function shortestDecimal(value: number, size: number): string {
  if (size === 8) return String(value);
  for (let digits = 1; ; digits++) {
    const text = value.toPrecision(digits);
    if (Math.fround(Number(text)) === value) return String(Number(text));
  }
}

const significantDigits = (text: string): number =>
  Number(text).toExponential().split('e')[0].replace(/[-.]/g, '').length;

/**
 * A floating-point value of `size` bytes as a cell shows it: the shortest decimal that reads back
 * as the stored value (`0.1f` is `0.1`), or, past eight significant digits, `≈` and the value
 * rounded to eight (`0.1 + 0.2` is `≈0.3`). A whole number reads as itself.
 */
export function displayFloat(value: number, size: number): string {
  if (Object.is(value, -0)) return '-0';
  if (Number.isSafeInteger(value)) return String(value);
  const shortest = shortestDecimal(value, size);
  if (significantDigits(shortest) <= SHOWN_DIGITS) return shortest;
  return '≈' + String(Number(value.toPrecision(SHOWN_DIGITS)));
}

/** A cell's number as it is shown: a float of `floatSize` bytes, or an integer or address. */
export function displayNumber(value: number, floatSize: number | null = null): string {
  if (floatSize) return displayFloat(value, floatSize);
  return Object.is(value, -0) ? '-0' : String(value);
}
