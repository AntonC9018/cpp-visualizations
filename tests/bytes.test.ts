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
import type { ExecutionTrace } from '../src/core/trace_format.ts';
import type { Palette } from '../src/player/constants.ts';
import { geometry } from '../src/player/geometry.ts';
import { prepare } from '../src/player/model.ts';

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
    assert.deepEqual(formatByteSlice([0xfd, 0xff, 0xff, 0xff], true, true), {
      text: '-3',
      poisoned: false,
      numeric: -3,
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

  test('computes alignment padding runs for sorted, unsorted, overlapping, and trailing spans', () => {
    assert.deepEqual(paddingRuns([]), []);
    assert.deepEqual(
      paddingRuns([
        { address: 72, size: 8 },
        { address: 64, size: 1 },
        { address: 68, size: 4 },
      ]),
      [{ start: 65, size: 3 }]
    );
    assert.deepEqual(
      paddingRuns(
        [
          { address: 64, size: 2 },
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

const STUB_PALETTE = {
  outputLabel: 'Output:',
  bg: '#000',
  panel: '#111',
  pane: '#111',
  fg: '#fff',
  muted: '#aaa',
  grey: '#888',
  context: '#777',
  read: '#08f',
  readFill: '#013',
  write: '#fa0',
  writeFill: '#320',
  derefFill: '#222',
  highlight: '#222',
  deadFill: '#111',
  deadStroke: '#333',
  gapStroke: '#444',
  tether: '#555',
  error: '#f44',
  typeLabel: 'outline',
  vars: ['#0a8', '#fa0', '#86f', '#e48', '#6b2'],
  fields: ['#8a0', '#c4c', '#e44', '#48f'],
  types: ['#0a8', '#fa0', '#86f', '#e48', '#6b2', '#48f'],
} as Palette;

describe('flush geometry', () => {
  test('rejects struct groups and keeps scalar variables on a single flush row without skipWrap', () => {
    const structTrace: ExecutionTrace = {
      format: 1,
      source: ['S s{ 1 };'],
      variables: [
        {
          name: 's',
          type: 'S',
          address: 64,
          size: 4,
          kind: 'struct',
          color: 0,
          fields: [{ name: 'x', offset: 0, size: 4, kind: 'int', color: 0 }],
        },
      ],
      steps: [{ line: 0, pane: 'S s = { 1 }', values: { 's.x': 1 }, targets: {}, stdout: '', hold: 1, op: null }],
    };
    assert.throws(() => geometry(prepare(structTrace), STUB_PALETTE, false, 900, { flush: true }), /flush byte layout/);

    const flatTrace: ExecutionTrace = {
      format: 1,
      source: ['int a{ 1 };', 'int b{ 2 };', 'int c{ 3 };', 'int d{ 4 };', 'int e{ 5 };'],
      variables: [
        { name: 'a', address: 64, size: 4, kind: 'int', color: 0 },
        { name: 'b', address: 68, size: 4, kind: 'int', color: 1 },
        { name: 'c', address: 72, size: 4, kind: 'int', color: 2 },
        { name: 'd', address: 76, size: 4, kind: 'int', color: 3 },
        { name: 'e', address: 80, size: 4, kind: 'int', color: 4 },
      ],
      steps: [
        { line: 0, pane: 'int a = 1', values: { a: 1, b: 2, c: 3, d: 4, e: 5 }, targets: {}, stdout: '', hold: 1, op: null },
      ],
    };
    const g = geometry(prepare(flatTrace), STUB_PALETTE, false, 900, { flush: true });
    assert.equal(g.flush, true);
    assert.ok(g.leaves.every(l => l.y === g.memY));
    assert.ok(g.leaves.every(l => Math.abs(l.x - (g.memX + (l.address - 64) * g.byteWidth)) < 0.01));
  });
});
