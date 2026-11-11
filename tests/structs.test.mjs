// Aggregate tracing against Clang's ABI and GDB, including pointer aliasing.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Cell } from '../execution.mjs';
import * as generate from '../generate.mjs';
import { dumpsSorted } from '../json_format.mjs';
import { validate } from '../trace_format.mjs';
import * as tracing from '../tracing.mjs';
import { Unsupported } from '../tracing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const STRUCT_POINTERS = `struct S { int x; int *p; S *next; };
int a=1;
S s{2,&a,nullptr};
S t=s;
t=s;
S *p=&s;
p->x=3;
int *q=&s.x;
*t.p=7;
std::cout << p->x;
`;

describe('StructTests', () => {
  test('shallow_copy_preserves_pointer_fields', () => {
    const result = tracing.trace(STRUCT_POINTERS);
    validate(result);
    const last = result.steps[result.steps.length - 1];
    assert.deepEqual(last.targets, { 's.p': 'a', 't.p': 'a', p: 's', q: 's.x' });
    assert.equal(last.values['s.x'], 3);
    assert.equal(last.values['t.x'], 2);
    assert.equal(last.values.a, 7);
    assert.equal(last.stdout, '3');
    const variables = Object.fromEntries(result.variables.map(v => [v.name, v]));
    assert.equal(variables.s.size, 24);
    assert.deepEqual(
      variables.s.fields.map(f => f.offset),
      [0, 8, 16]
    );
    assert.deepEqual(variables.s.fields, variables.t.fields);
    assert.equal(last.values.p, last.values.q);
  });

  test('initialization_copies_and_arrow_chains', () => {
    const source = `struct S {int x; S *next;};
S a{.x=4}; S b{a}; S c{}; c=b; b.next=&a; S *p=&b;
p->next->x=9; c=*p; (*p).x=7; std::cout << a.x;`;
    const result = tracing.trace(source);
    const last = result.steps[result.steps.length - 1];
    assert.equal(last.stdout, '9');
    assert.equal(last.values['c.x'], 4);
    assert.equal(last.values['b.x'], 7);
    assert.deepEqual(last.targets, { 'b.next': 'a', 'c.next': 'a', p: 'b' });
  });

  test('a_list_of_literals_is_stored_as_spelled', () => {
    const result = tracing.trace(
      'struct A { int f1; int f2; };\nA a { 1, 2 };\nA b = A{ 1, 2 };\nA c{ .f2 = 5 };\n' +
        'A d = A{ .f1 = 3 };\nb = c;'
    );
    const steps = result.steps.map(step => [step.line, step.pane, step.op?.kind ?? null]);
    assert.deepEqual(steps, [
      [0, 'A a { 1, 2 }', null],
      [0, 'A a { 1, 2 }', 'write'],
      [1, 'A b = A{ 1, 2 }', null],
      [1, 'A b = A{ 1, 2 }', 'write'],
      [2, 'A c{ .f2 = 5 }', null],
      [2, 'A c{0, 5}', 'eval'],
      [2, 'A c{0, 5}', 'write'],
      [3, 'A d = A{ .f1 = 3 }', null],
      [3, 'A d = A{3, 0}', 'eval'],
      [3, 'A d = A{3, 0}', 'write'],
      [4, 'b = c', null],
      [4, 'b = A{0, 5}', 'read'],
      [4, 'b = A{0, 5}', 'write'],
    ]);
    validate(result);
  });

  test('elided_aggregate_initialization_and_struct_double_pointer', () => {
    const result = tracing.trace(
      'struct S {int x;}; S a=S{1}; S b{}; S *p=&a; S **pp=&p; b=**pp; p->x=9;'
    );
    assert.equal(result.steps[result.steps.length - 1].values['a.x'], 9);
    assert.equal(result.steps[result.steps.length - 1].values['b.x'], 1);
  });

  test('probe_and_trace_reject_materialized_temporaries_before_execution', () => {
    for (const source of [
      'struct S {int x;}; S a{1}; a=S{2}; int b=3;',
      'struct S {int x;}; S a{1}; S *p=&a; *p={2}; int b=3;',
    ]) {
      const temporary = mkdtempSync(join(tmpdir(), 'course-mat-temp-'));
      try {
        const path = join(temporary, 'source.cpp');
        writeFileSync(path, source);
        const results = {};
        const original = tracing.hooks.execute;
        for (const operation of ['probe', 'trace']) {
          let stdout = '';
          let stderr = '';
          let called = false;
          tracing.hooks.execute = () => {
            called = true;
          };
          let status;
          try {
            status = generate.main(
              [operation, '--source', path],
              {
                stdout: { write: s => (stdout += s) },
                stderr: { write: s => (stderr += s) },
              }
            );
          } finally {
            tracing.hooks.execute = original;
          }
          assert.equal(called, false);
          if (operation === 'probe') {
            assert.equal(status, 0);
            results[operation] = JSON.parse(stdout);
          } else {
            assert.equal(status, 1);
            results[operation] = stderr.trim();
          }
        }
        assert.equal(results.probe.supported, false);
        assert.match(results.probe.reason, /materialized temporary/);
        assert.equal(results.trace, 'unsupported: ' + results.probe.reason);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    }
  });

  test('a_temporary_after_the_last_declaration_is_assigned', () => {
    const result = tracing.trace(
      'struct S {int x;}; S a{1}; int b=3; S *p=&a; a=S{2}; *p={4}; std::cout << a.x;'
    );
    validate(result);
    assert.equal(result.steps[result.steps.length - 1].stdout, '4');
    const writes = result.steps
      .filter(step => (step.line === 3 || step.line === 4) && step.op)
      .map(step => step.op);
    assert.deepEqual(
      writes.map(op => op.kind),
      ['write', 'read', 'deref', 'write']
    );
    generate._storage_is_contiguous(result.variables);
  });

  test('nested_structs_are_stored_by_value', () => {
    const source = `struct N {int f; int g;}; struct A {int* p; N n; int f;};
int v=1; A a{ .p = &v, .n = { .f = 2 } }; A b{a}; N c; N* q=&b.n; q->g=9; int* r=&a.n.f; *r=4;
c=b.n; b.n={5, 6}; std::cout << c.g;`;
    const result = tracing.trace(source);
    validate(result);
    const last = result.steps[result.steps.length - 1];
    assert.equal(last.stdout, '9');
    assert.deepEqual(
      Object.fromEntries(
        ['a.n.f', 'a.n.g', 'a.f', 'b.n.f', 'b.n.g', 'c.f', 'c.g'].map(name => [
          name,
          last.values[name],
        ])
      ),
      { 'a.n.f': 4, 'a.n.g': 0, 'a.f': 0, 'b.n.f': 5, 'b.n.g': 6, 'c.f': 2, 'c.g': 9 }
    );
    assert.deepEqual(last.targets, { 'a.p': 'v', 'b.p': 'v', q: 'b.n', r: 'a.n.f' });
    const a = result.variables.find(v => v.name === 'a');
    assert.deepEqual(
      a.fields.map(f => [f.name, f.kind, f.offset, f.size]),
      [
        ['p', 'ptr', 0, 8],
        ['n', 'struct', 8, 8],
        ['f', 'int', 16, 4],
      ]
    );
    assert.equal(a.fields[1].type, 'N');
    assert.deepEqual(
      a.fields[1].fields.map(f => f.name),
      ['f', 'g']
    );
    const first = result.steps.filter(step => step.line === 1).map(step => step.pane);
    assert.deepEqual(first.slice(0, 2), [
      'A a{ .p = &v, .n = { .f = 2 } }',
      `A a{ .p = ${last.values['a.p']}, .n = { .f = 2 } }`,
    ]);
    assert.equal(first[2], `A a{${last.values['a.p']}, {2, 0}, 0}`);
    const copy = result.steps.filter(step => step.line === 8 && step.op).map(step => step.op);
    assert.deepEqual(
      copy.map(op => [op.kind, op.name, op.value]),
      [
        ['read', 'b.n', 'N{2, 9}'],
        ['write', 'c', 'N{2, 9}'],
      ]
    );
  });

  test('uninitialized_fields_are_tracked_independently', () => {
    const result = tracing.trace('struct S {int x; int *p;}; S a; a.x=3; a.p=&a.x; S b=a;');
    assert.equal(result.steps[1].values['a.x'], '?');
    const last = result.steps[result.steps.length - 1];
    assert.equal(last.values['b.x'], 3);
    assert.deepEqual(last.targets, { 'a.p': 'a.x', 'b.p': 'a.x' });
  });

  test('elaborated_local_struct_pointers', () => {
    for (const spelling of ['S', 'struct S']) {
      const source =
        'struct S {int x;}; S s{1}; ' +
        `${spelling} *p=&s; p->x=2; ` +
        `${spelling} **pp=&p; (*pp)->x=3;`;
      const result = tracing.trace(source);
      assert.deepEqual(result, tracing.trace(source, { runtime: false }));
      const last = result.steps[result.steps.length - 1];
      assert.equal(last.values['s.x'], 3);
      assert.deepEqual(last.targets, { p: 's', pp: 'p' });
    }
  });

  test('elaborated_struct_pointer_fields', () => {
    for (const spelling of ['S', 'struct S']) {
      const source =
        `struct S {int x; ${spelling} *next;}; ` +
        'S a{1,nullptr}; S b{2,&a}; b.next->x=9; ' +
        'b.next=&b; b.next->x=7;';
      const result = tracing.trace(source);
      assert.deepEqual(result, tracing.trace(source, { runtime: false }));
      const last = result.steps[result.steps.length - 1];
      assert.equal(last.values['a.x'], 9);
      assert.equal(last.values['b.x'], 7);
      assert.deepEqual(last.targets, { 'b.next': 'b' });
    }
  });

  test('multiple_types_and_forward_declarations', () => {
    const result = tracing.trace(
      'struct B; struct A {B *p;}; struct B {int x;}; B b{8}; A a{&b}; std::cout << a.p->x;'
    );
    assert.equal(result.steps[result.steps.length - 1].stdout, '8');
  });

  test('definitions_are_shown_on_hover_not_stepped', () => {
    const source =
      'struct S\n{\n    int x;\n};\n\nint main()\n{\n    struct T { int y; };\n    S a{ 1 };\n    T b{ 2 };\n}\n';
    const result = tracing.trace(source, { runtime: false });
    assert.deepEqual(result.source, ['S a{ 1 };', 'T b{ 2 };']);
    assert.deepEqual(result.types, {
      S: 'struct S\n{\n    int x;\n};',
      T: 'struct T { int y; };',
    });
    assert.equal(
      result.steps.some(step => step.pane.startsWith('struct')),
      false
    );
  });

  test('cold_runs_and_probe_layout', () => {
    const first = tracing.trace(STRUCT_POINTERS);
    assert.deepEqual(first, tracing.trace(STRUCT_POINTERS, { runtime: false }));
    assert.equal(dumpsSorted(first), dumpsSorted(tracing.trace(STRUCT_POINTERS)));
  });

  test('unsupported_definitions_and_reads_never_execute', () => {
    const cases = {
      'struct S {double x;}; S s{};': /unsupported field type double/,
      'struct S {int x[2];}; S s{};': /unsupported field type int/,
      'struct S {int x:2;}; S s{};': /bitfields/,
      'struct S {int x=1;}; S s{};': /default initializers/,
      'struct S {int x; S(){x=1;}}; S s;': /methods/,
      'struct A {int x;}; struct B {A a;}; B b; B c=b;': /uninitialized struct/,
      'struct A {int x;}; struct B {A a;}; B b; A c=b.a;': /uninitialized struct/,
      'struct S {}; S s{};': /empty structs/,
      'struct S {int x;}; S a; S b=a;': /uninitialized struct/,
      'struct S {int x;}; S a; int b=a.x;': /uninitialized variable a\.x/,
      'struct S {int x;}; S *p{}; p->x=1;': /null pointer p/,
    };
    const original = tracing.hooks.execute;
    for (const [source, reason] of Object.entries(cases)) {
      let called = false;
      tracing.hooks.execute = () => {
        called = true;
      };
      try {
        assert.throws(
          () => tracing.trace(source),
          err => err instanceof Unsupported && reason.test(err.message)
        );
        assert.equal(called, false);
      } finally {
        tracing.hooks.execute = original;
      }
    }
  });

  test('generated_browser_fixture_is_current', () => {
    const path = join(HERE, 'fixtures', 'struct-generated.json');
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    const source = [...Object.values(fixture.types ?? {}), ...fixture.source].join('\n');
    assert.deepEqual(tracing.trace(source), fixture);
  });

  test('unchanged_field_mismatch_is_fatal', () => {
    const original = tracing.hooks.execute;
    tracing.hooks.execute = (...args) => {
      const execution = original(...args);
      const last = execution.checkpoints[execution.checkpoints.length - 1];
      last['s.x'] = new Cell({ ...last['s.x'], value: 999 });
      return execution;
    };
    try {
      assert.throws(
        () => tracing.trace('struct S {int x; int y;}; S s{1,2}; s.y=3;'),
        err => err instanceof Unsupported && /s\.x disagrees/.test(err.message)
      );
    } finally {
      tracing.hooks.execute = original;
    }
  });
});
