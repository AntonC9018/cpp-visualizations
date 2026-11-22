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
  test('encodes and decodes signed and unsigned integers in both byte orders', () => {
    assert.equal(hexByte(5), '05');
    assert.equal(hexByte(42), '2A');
    assert.deepEqual(toBytesMSB(300, 4), [0x00, 0x00, 0x01, 0x2c]);
    assert.deepEqual(encodeBytes(300, 4, true), [0x2c, 0x01, 0x00, 0x00]);
    assert.deepEqual(encodeBytes(300, 4, false), [0x00, 0x00, 0x01, 0x2c]);
    assert.deepEqual(encodeBytes(-3, 4, true), [0xfd, 0xff, 0xff, 0xff]);
    assert.deepEqual(encodeBytes(-3, 4, false), [0xff, 0xff, 0xff, 0xfd]);

    assert.equal(decodeBytes([0x2c, 0x01, 0x00, 0x00], true, true), 300n);
    assert.equal(decodeBytes([0x00, 0x00, 0x01, 0x2c], true, false), 300n);
    assert.equal(decodeBytes([0xfd, 0xff, 0xff, 0xff], true, true), -3n);
    assert.equal(decodeBytes([0xfd, 0xff, 0xff, 0xff], false, true), 0xfffffffdn);
    assert.equal(decodeBytes([0x02, 0x00, 0x00, 0x05], true, false), 33554437n);
  });

  test('formats poisoned byte slices in hex with endian-accurate ? positions', () => {
    assert.equal(formatByteSlice([null, null, null, null], true, true), null);
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
