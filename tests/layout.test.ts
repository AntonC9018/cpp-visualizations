// Compiler-backed static layouts and validation, including nonexecuting probes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FormatError, validate } from '../src/core/trace_format.ts';
import { trace } from '../src/node/layout.ts';
import { Unsupported } from '../src/node/toolchain.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('LayoutTests', () => {
  test('layout reads records even when main uses the offsetof macro', () => {
    const source = [
      '#include <cstddef>',
      'struct Packet { int first; int second; };',
      'int main() { return offsetof(Packet, second); }',
    ].join('\n');
    assert.deepEqual(trace(source).records[0].fields.map(field => field.offset), [0, 4]);
  });

  test('layout rejects a macro-generated global record instead of omitting it', () => {
    const source = '#define RECORD struct S { int x; };\nRECORD\nstruct T { int y; };\nint main() {}';
    assert.throws(() => trace(source), /macro-expanded declarations outside main/);
  });

  test('padding_and_types', () => {
    let result = trace('struct A { uint8_t f1; int f2; uint8_t f3; };');
    let record = result.records[0];
    assert.deepEqual([record.size, record.alignment], [12, 4]);
    assert.deepEqual(
      record.fields.map(f => f.offset),
      [0, 4, 8]
    );
    result = trace('struct B { int8_t a; int* p; size_t n; uint64_t v; };');
    record = result.records[0];
    assert.deepEqual([record.size, record.alignment], [32, 8]);
    assert.deepEqual(
      record.fields.map(f => f.size),
      [1, 8, 8, 8]
    );
  });

  test('multiple_and_no_execution', () => {
    const result = trace('struct A { int a; }; struct B { A* p; }; while (true) {}');
    assert.deepEqual(
      result.records.map(r => r.name),
      ['A', 'B']
    );
  });

  test('unsupported', () => {
    for (const source of [
      'int a;',
      'struct A {};',
      'struct A { double x; };',
      'struct A { int x:2; };',
      'struct A { double x[2]; };',
      'struct A { std::array<double, 2> x; };',
      'struct A { int x[65]; };',
      'struct A { std::array<int, 65> x; };',
    ]) {
      assert.throws(() => trace(source), Unsupported, source);
    }
  });

  test('arrays_and_std_byte_in_structs', () => {
    // Lab 10 Example 2: std::array<int, 4> + int*
    const stdArr = trace('#include <array>\nstruct A { std::array<int, 4> f1; int* f2; };');
    assert.deepEqual(stdArr.records[0], {
      name: 'A',
      size: 24,
      alignment: 8,
      fields: [
        { name: 'f1', type: 'std::array<int, 4>', offset: 0, size: 16, kind: 'int', alignment: 4, count: 4 },
        { name: 'f2', type: 'int *', offset: 16, size: 8, kind: 'ptr' },
      ],
    });

    // C arrays with padding: element alignment (4) governs struct alignment, not total field size (8)
    const cArr = trace('struct B { uint8_t tag; int vals[2]; uint8_t end; };');
    assert.deepEqual(cArr.records[0], {
      name: 'B',
      size: 16,
      alignment: 4,
      fields: [
        { name: 'tag', type: 'uint8_t', offset: 0, size: 1, kind: 'int' },
        { name: 'vals', type: 'int[2]', offset: 4, size: 8, kind: 'int', alignment: 4, count: 2 },
        { name: 'end', type: 'uint8_t', offset: 12, size: 1, kind: 'int' },
      ],
    });

    // Multi-dimensional C array, pointer array, and std::byte (scalar, C array, std::array)
    const bytesAndPtrs = trace(`
      #include <array>
      #include <cstddef>
      struct Packet {
        std::byte kind;
        std::byte buf[3];
        std::array<std::byte, 4> hdr;
        int grid[2][2];
        int* ptrs[2];
      };
    `);
    assert.deepEqual(bytesAndPtrs.records[0], {
      name: 'Packet',
      size: 40,
      alignment: 8,
      fields: [
        { name: 'kind', type: 'std::byte', offset: 0, size: 1, kind: 'int' },
        { name: 'buf', type: 'std::byte[3]', offset: 1, size: 3, kind: 'int', alignment: 1, count: 3 },
        { name: 'hdr', type: 'std::array<std::byte, 4>', offset: 4, size: 4, kind: 'int', alignment: 1, count: 4 },
        { name: 'grid', type: 'int[2][2]', offset: 8, size: 16, kind: 'int', alignment: 4, count: 4 },
        { name: 'ptrs', type: 'int *[2]', offset: 24, size: 16, kind: 'ptr', alignment: 8, count: 2 },
      ],
    });
    validate(stdArr);
    validate(cArr);
    validate(bytesAndPtrs);
  });

  test('shadowed_type_names', () => {
    const record = trace('using uint8_t = uint64_t; struct A { uint8_t x; };').records[0];
    assert.deepEqual([record.size, record.fields[0].size], [8, 8]);
    assert.equal(record.fields[0].type, 'uint8_t');
    for (const source of [
      'struct uint8_t { int a; int b; }; struct A { uint8_t x; };',
      'using size_t = double; struct A { size_t x; };',
    ]) {
      assert.throws(() => trace(source), Unsupported);
    }
  });

  test('invalid_layout', () => {
    const result = trace('struct A { int a; int b; };');
    for (const [key, value] of [
      ['offset', 2],
      ['size', 20],
      ['kind', 'float'],
    ] as const) {
      const bad = structuredClone(result) as unknown as Record<string, unknown>;
      const records = bad.records as Array<{ fields: Array<Record<string, unknown>> }>;
      records[0].fields[1][key] = value;
      assert.throws(() => validate(bad as unknown as typeof result), FormatError);
    }
  });

  test('cli_probe_matches_trace', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'course-layout-cli-'));
    try {
      const path = join(tmp, 'example.cpp');
      writeFileSync(path, 'struct A { uint8_t a; int b; };');
      const script = join(ROOT, 'generate.mjs');
      for (const operation of ['probe', 'trace']) {
        const stdout = execFileSync(
          process.execPath,
          [script, operation, '--template', 'layout', '--source', path],
          { encoding: 'utf8' }
        );
        const data = JSON.parse(stdout) as { template?: string; kind?: string };
        assert.equal(operation === 'probe' ? data.template : data.kind, 'layout');
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
