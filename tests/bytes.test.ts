// Unit tests for isomorphic byte-level integer encoding, decoding, poisoned hex, and padding runs.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  decodeBytes,
  encodeBytes,
  formatByteSlice,
  hexByte,
  paddingRuns,
  toBytesMSB,
} from '../src/core/bytes.ts';

describe('bytes', () => {
  test('encodes and decodes signed, unsigned, and 64-bit bigint values in both byte orders', () => {
    assert.equal(hexByte(5), '05');
    assert.equal(hexByte(42), '2A');
    assert.deepEqual(toBytesMSB(300, 4), [0x00, 0x00, 0x01, 0x2c]);
    assert.deepEqual(encodeBytes(300, 4, true), [0x2c, 0x01, 0x00, 0x00]);
    assert.deepEqual(encodeBytes(300, 4, false), [0x00, 0x00, 0x01, 0x2c]);
    assert.deepEqual(encodeBytes(-3, 4, true), [0xfd, 0xff, 0xff, 0xff]);
    assert.deepEqual(encodeBytes(-3, 4, false), [0xff, 0xff, 0xff, 0xfd]);

    const big = 0x0102030405060708n;
    assert.deepEqual(toBytesMSB(big, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(decodeBytes([1, 2, 3, 4, 5, 6, 7, 8], false, false), big);
    assert.equal(decodeBytes([8, 7, 6, 5, 4, 3, 2, 1], false, true), big);
    assert.equal(decodeBytes([0xff, 0xff, 0xff, 0xfd], false, false), 0xfffffffdn);
    assert.equal(decodeBytes([0xfd, 0xff, 0xff, 0xff], true, true), -3n);
    assert.equal(decodeBytes([0x02, 0x00, 0x00, 0x05], true, false), 33554437n);

    assert.throws(() => toBytesMSB(Number.NaN, 4), RangeError);
    assert.throws(() => toBytesMSB(Number.POSITIVE_INFINITY, 4), RangeError);
  });

  test('formats poisoned and mixed-null byte slices in hex with endian-accurate ? positions', () => {
    assert.equal(formatByteSlice([], true, true), null);
    assert.equal(formatByteSlice([null, null, null, null], true, true), null);
    assert.deepEqual(formatByteSlice([0x2a, null, null, null], true, true), {
      text: '0x??????2A',
      poisoned: true,
      numeric: null,
    });
    assert.deepEqual(formatByteSlice([0x2a, '?', '?', '?'], true, true), {
      text: '0x??????2A',
      poisoned: true,
      numeric: null,
    });
    assert.deepEqual(formatByteSlice([0x2a, '?', '?', '?'], true, false), {
      text: '0x2A??????',
      poisoned: true,
      numeric: null,
    });
    assert.deepEqual(formatByteSlice([0x05, 0x1a, '?', '?'], true, true), {
      text: '0x????1A05',
      poisoned: true,
      numeric: null,
    });
    assert.deepEqual(formatByteSlice([0x05, 0x1a, '?', '?'], true, false), {
      text: '0x051A????',
      poisoned: true,
      numeric: null,
    });
    assert.deepEqual(formatByteSlice([0x05, 0x00, 0x02, 0x00], true, true), {
      text: '131077',
      poisoned: false,
      numeric: 131077,
    });
    // Values beyond Number.MAX_SAFE_INTEGER keep exact decimal text and null numeric (never rounded).
    const unsafe = encodeBytes((1n << 53n) + 1n, 8, true);
    assert.deepEqual(formatByteSlice(unsafe, false, true), {
      text: '9007199254740993',
      poisoned: false,
      numeric: null,
    });
    const maxSafe = encodeBytes((1n << 53n) - 1n, 8, true);
    assert.deepEqual(formatByteSlice(maxSafe, false, true), {
      text: '9007199254740991',
      poisoned: false,
      numeric: Number.MAX_SAFE_INTEGER,
    });
  });

  test('computes alignment padding runs between and after variables', () => {
    assert.deepEqual(paddingRuns([]), []);
    assert.deepEqual(
      paddingRuns([
        { address: 64, size: 1 },
        { address: 68, size: 4 },
        { address: 72, size: 8 },
      ]),
      [{ start: 65, size: 3 }]
    );
    assert.deepEqual(
      paddingRuns(
        [
          { address: 64, size: 1 },
          { address: 65, size: 1 },
          { address: 68, size: 4 },
        ],
        76
      ),
      [
        { start: 66, size: 2 },
        { start: 72, size: 4 },
      ]
    );
  });
});
