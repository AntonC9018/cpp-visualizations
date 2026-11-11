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
      'struct A { int x[2]; };',
    ]) {
      assert.throws(() => trace(source), Unsupported);
    }
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
