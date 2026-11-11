// Behavioral coverage for compiler-backed traces and fail-closed eligibility.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Cell, Execution } from '../execution.mjs';
import { dumpsSorted } from '../json_format.mjs';
import * as tracing from '../tracing.mjs';
import { Pointer, Unsupported } from '../tracing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const DOUBLE_POINTER = `int a = 5;
int b = 6;
int* p = &a;
int** pp = &p;
**pp = 7;
*pp = &b;
**pp = 8;
std::cout << a << std::endl;
std::cout << *p << std::endl;
`;

function panes(trace, line) {
  return trace.steps.filter(step => step.line === line).map(step => step.pane);
}

function ops(trace, line) {
  return trace.steps.filter(step => step.line === line && step.op).map(step => step.op);
}

function final(trace, key = 'values') {
  return trace.steps[trace.steps.length - 1][key];
}

function addresses(trace) {
  return Object.fromEntries(trace.variables.map(v => [v.name, v.address]));
}

describe('StaticIntegerTraceTests', () => {
  const traceStatic = source => tracing.trace(source, { runtime: false });

  test('expression_and_cumulative_output', () => {
    const trace = traceStatic('int a = 5; int b = a + 6; a = 7; std::cout << b << std::endl;');
    assert.deepEqual(panes(trace, 1), [
      'int b = a + 6',
      'int b = 5 + 6',
      'int b = 11',
      'int b = 11',
    ]);
    assert.deepEqual(
      ops(trace, 1).map(op => op.kind),
      ['read', 'eval', 'write']
    );
    assert.deepEqual(ops(trace, 1)[1], { kind: 'eval', value: '11', span: [8, 13] });
    assert.deepEqual(ops(trace, 1)[2].destination, [4, 5]);
    assert.deepEqual(final(trace), { a: 7, b: 11 });
    assert.equal(final(trace, 'stdout'), '11\n');
    assert.deepEqual(trace.spans, [
      [8, 9],
      [8, 13],
      [4, 5],
      [13, 14],
    ]);
  });

  test('precedence_parentheses_and_repeated_reads', () => {
    const trace = traceStatic('int c{12}; int o{3}; int r = (c + o) * c;');
    assert.deepEqual(panes(trace, 2), [
      'int r = (c + o) * c',
      'int r = (12 + o) * c',
      'int r = (12 + 3) * c',
      'int r = (15) * c',
      'int r = 15 * c',
      'int r = 15 * 12',
      'int r = 180',
      'int r = 180',
    ]);
    assert.equal(
      ops(trace, 2).filter(op => op.kind === 'read' && op.name === 'c').length,
      2
    );
  });

  test('empty_braces_and_typed_value_initialization', () => {
    const trace = traceStatic('int a{}; a = int{}; int b = int{};');
    assert.deepEqual(panes(trace, 0), ['int a = {}', 'int a = 0', 'int a = 0']);
    assert.deepEqual(ops(trace, 0)[0], { kind: 'eval', value: '0', span: [8, 10] });
    assert.deepEqual(trace.spans[0], [5, 7]);
    assert.ok(!JSON.stringify(trace).includes('int0'));
    assert.deepEqual(final(trace), { a: 0, b: 0 });
  });

  test('literal_spelling_settles_on_its_value', () => {
    const trace = traceStatic('int a{0x10};');
    assert.deepEqual(panes(trace, 0), ['int a = 0x10', 'int a = 16', 'int a = 16']);
  });

  test('whitespace_comments_and_full_main', () => {
    const trace = traceStatic(`#include <iostream>
int main() {
 // Русский комментарий is removed, not executed or displayed.
 int a{ 7 };
 int b = (
 a + 2
 );
 std::cout << b << '\\n';
 return 0;
}
`);
    assert.deepEqual(trace.source, [
      'int a{ 7 };',
      'int b = ( a + 2 );',
      "std::cout << b << '\\n';",
    ]);
    assert.deepEqual(final(trace), { a: 7, b: 9 });
    assert.equal(final(trace, 'stdout'), '9\n');
  });

  test('output_context_survives_later_statements', () => {
    const trace = traceStatic(
      'int a{1}; std::cout << a << std::endl; a=2; std::cout << a << std::endl;'
    );
    const first = trace.steps.findIndex(step => step.stdout.length > 0);
    assert.ok(trace.steps.slice(first).every(step => step.stdout.startsWith('1\n')));
    assert.equal(final(trace, 'stdout'), '1\n2\n');
  });

  test('bare_endl_prints_a_newline', () => {
    const trace = traceStatic('int a{1}; std::cout << a; std::cout << std::endl;');
    assert.deepEqual(panes(trace, 2), ['std::cout << std::endl', 'std::cout << std::endl']);
    assert.deepEqual(ops(trace, 2), [{ kind: 'print', value: '\n', span: [13, 22] }]);
    assert.deepEqual(trace.steps[trace.steps.length - 1].expr, [13, 22]);
    assert.deepEqual(trace.spans[2], [13, 22]);
    assert.equal(final(trace, 'stdout'), '1\n');
  });

  test('bare_newline_character_prints_a_newline', () => {
    const trace = traceStatic("int a{1}; std::cout << '\\n';");
    assert.deepEqual(panes(trace, 1), ["std::cout << '\\n'", "std::cout << '\\n'"]);
    assert.deepEqual(ops(trace, 1), [{ kind: 'print', value: '\n', span: [13, 17] }]);
    assert.equal(final(trace, 'stdout'), '\n');
  });

  test('mixed_value_and_whitespace_output', () => {
    const trace = traceStatic(
      "int a{1}; std::cout << a << ' '; std::cout << a << std::endl; " +
        "std::cout << endl << '\\t' << endl;"
    );
    assert.equal(final(trace, 'stdout'), '1 1\n\n\t\n');
    assert.deepEqual(ops(trace, 3), [{ kind: 'print', value: '\n', span: [13, 17] }]);
    assert.deepEqual(
      trace.steps.filter(step => step.line === 3).map(step => step.stdout),
      ['1 1\n', '1 1\n\n\t\n']
    );
  });

  test('const_and_auto_copy_are_scalar_values', () => {
    const trace = traceStatic('const int a{5}; auto b=a; b=6; std::cout << a;');
    assert.deepEqual(final(trace), { a: 5, b: 6 });
    assert.equal(final(trace, 'stdout'), '5');
  });

  test('uninitialized_storage_is_distinct_from_unallocated', () => {
    const trace = traceStatic('int a; a = 2 * 3 + 1; int b;');
    assert.deepEqual(trace.steps[0].values, { a: '?', b: null });
    assert.equal(trace.spans[0], null);
    assert.deepEqual(panes(trace, 1), ['a = 2 * 3 + 1', 'a = 6 + 1', 'a = 7', 'a = 7']);
    assert.deepEqual(final(trace), { a: 7, b: '?' });
  });

  test('cpp_negative_division_and_remainder', () => {
    const trace = traceStatic('int a{-7}; int b=a/3; int c=a%3;');
    assert.deepEqual(final(trace), { a: -7, b: -2, c: -1 });
  });

  test('cells_are_ordered_by_address', () => {
    const trace = traceStatic('int a{1}; int b{2}; int c{3};');
    assert.deepEqual(
      trace.variables.map(v => v.name),
      ['c', 'b', 'a']
    );
    assert.deepEqual(addresses(trace), { c: 64, b: 68, a: 72 });
    assert.deepEqual(
      trace.variables.map(v => v.color),
      [2, 1, 0]
    );
  });
});

describe('StaticPointerTraceTests', () => {
  const traceStatic = source => tracing.trace(source, { runtime: false });

  test('double_pointer_reduces_in_lesson_notation', () => {
    const trace = traceStatic(DOUBLE_POINTER);
    const at = addresses(trace);
    assert.deepEqual(panes(trace, 4), [
      '**pp = 7',
      `**${at.p} = 7`,
      '*p = 7',
      `*${at.a} = 7`,
      'a = 7',
      'a = 7',
    ]);
    assert.deepEqual(
      ops(trace, 4).map(op => op.kind),
      ['read', 'deref', 'read', 'deref', 'write']
    );
    assert.deepEqual(ops(trace, 4)[1], {
      kind: 'deref',
      target: 'p',
      via: 'pp',
      span: [1, 4],
    });
    assert.deepEqual(ops(trace, 4)[3], {
      kind: 'deref',
      target: 'a',
      via: 'p',
      span: [0, 3],
    });
    assert.deepEqual(panes(trace, 5), [
      '*pp = &b',
      `*pp = ${at.b}`,
      `*${at.p} = ${at.b}`,
      `p = ${at.b}`,
      `p = ${at.b}`,
    ]);
    assert.deepEqual(ops(trace, 5)[ops(trace, 5).length - 1].destination, [0, 1]);
    assert.deepEqual(final(trace, 'targets'), { p: 'b', pp: 'p' });
    assert.deepEqual(final(trace), { a: 7, b: 8, p: at.b, pp: at.p });
    assert.equal(final(trace, 'stdout'), '7\n8\n');
  });

  test('address_of_takes_the_label_and_sets_the_target', () => {
    const trace = traceStatic('int a{ 1 }; int* b{ &a }; *b = 2; std::cout << a;');
    assert.deepEqual(addresses(trace), { b: 64, a: 76 });
    assert.deepEqual(panes(trace, 1), ['int* b = &a', 'int* b = 76', 'int* b = 76']);
    assert.deepEqual(ops(trace, 1)[0], {
      kind: 'addr',
      name: 'a',
      value: '76',
      span: [9, 11],
    });
    const write = trace.steps[4];
    assert.deepEqual([write.op.kind, write.targets, write.values.b], [
      'write',
      { b: 'a' },
      76,
    ]);
    assert.deepEqual(panes(trace, 2), ['*b = 2', '*76 = 2', 'a = 2', 'a = 2']);
    assert.deepEqual(
      trace.variables.map(v => v.kind),
      ['ptr', 'int']
    );
    assert.deepEqual(
      trace.variables.map(v => v.size),
      [8, 4]
    );
  });

  test('pointer_variables_are_aligned', () => {
    const trace = traceStatic('int a{1}; int* p{&a}; int b{2}; int* q{&b};');
    for (const variable of trace.variables) {
      assert.equal(variable.address % variable.size, 0);
    }
  });

  test('null_pointers_are_stored_as_zero', () => {
    const trace = traceStatic('int* p{}; int* q = nullptr; int* r = 0; int a{1}; p = &a; q = p;');
    assert.deepEqual(panes(trace, 0), ['int* p = {}', 'int* p = 0', 'int* p = 0']);
    assert.deepEqual(panes(trace, 1), ['int* q = nullptr', 'int* q = 0', 'int* q = 0']);
    assert.deepEqual(panes(trace, 2), ['int* r = 0', 'int* r = 0']);
    assert.equal(trace.steps[2].values.p, 0);
    assert.deepEqual(trace.steps[2].targets, {});
    assert.deepEqual(final(trace, 'targets'), { p: 'a', q: 'a' });
    assert.equal(final(trace).r, 0);
  });

  test('empty_initialization_reads_as_assignment_whatever_the_spelling', () => {
    for (const [source, pane] of [
      ['int a{}; int* p{&a}; int * * pp{};', 'int * * pp = {}'],
      ['signed int* p{};', 'signed int* p = {}'],
    ]) {
      const trace = traceStatic(source);
      const shown = trace.steps.map(step => step.pane);
      assert.ok(shown.includes(pane));
      assert.ok(shown.includes(pane.replace('{}', '0')));
    }
  });

  test('copying_a_null_pointer_reads_zero', () => {
    const trace = traceStatic('int* p{}; int* q = p;');
    assert.deepEqual(panes(trace, 1), ['int* q = p', 'int* q = 0', 'int* q = 0']);
    assert.deepEqual(final(trace, 'targets'), {});
  });

  test('pointer_copies_share_a_target', () => {
    const trace = traceStatic(
      'int a = 5; int* p = &a; int* q = p; *q = 6; std::cout << *p << std::endl;'
    );
    const at = addresses(trace);
    assert.deepEqual(panes(trace, 2), [
      'int* q = p',
      `int* q = ${at.a}`,
      `int* q = ${at.a}`,
    ]);
    assert.deepEqual(panes(trace, 4), [
      'std::cout << *p << std::endl',
      `std::cout << *${at.a} << std::endl`,
      'std::cout << a << std::endl',
      'std::cout << 6 << std::endl',
      'std::cout << 6 << std::endl',
    ]);
    assert.deepEqual(final(trace, 'targets'), { p: 'a', q: 'a' });
    assert.equal(final(trace, 'stdout'), '6\n');
  });

  test('parentheses_reduce_with_a_dereference', () => {
    const trace = traceStatic('int a{ 5 }; int* b{ &a }; std::cout << (*b) + 7;');
    assert.deepEqual(panes(trace, 2), [
      'std::cout << (*b) + 7',
      'std::cout << (*76) + 7',
      'std::cout << a + 7',
      'std::cout << 5 + 7',
      'std::cout << 12',
      'std::cout << 12',
    ]);
    assert.deepEqual(ops(trace, 2)[1].span, [13, 18]);
  });

  test('auto_deduces_pointers', () => {
    const trace = traceStatic('int value{ 5 }; int* p{ &value }; auto pp{ &p }; **pp = 9;');
    assert.deepEqual(
      trace.variables.map(v => v.kind),
      ['ptr', 'ptr', 'int']
    );
    assert.equal(final(trace).value, 9);
    assert.equal(panes(trace, 2)[0], 'auto pp = &p');
  });

  test('reassigning_a_pointer_holds_longer', () => {
    const trace = traceStatic('int a = 5; int b = 7; int* p = &a; p = &b; int* q; q = &a;');
    const writes = trace.steps.filter(step => step.op && step.op.kind === 'write');
    assert.deepEqual(
      writes.slice(2).map(step => step.hold),
      [1.2, 1.6, 3]
    );
    assert.equal(trace.steps[trace.steps.length - 3].values.q, '?');
  });

  test('unsupported_and_undefined_never_execute', () => {
    const sources = [
      'int a; std::cout << a;',
      'int a=a;',
      'int a{5}; int b=++a;',
      'int a{5}; int b=(a=7);',
      'int a{2147483647}; a=a+1;',
      'int a{50000}; int b=a*a;',
      'int a{1}; int b=a/0;',
      'int a{1}; int b=a%0;',
      'double a{1.5};',
      'bool a{true};',
      'static int a{1};',
      'int a{1}; while(a) a=0;',
      'int a{1}; if(a) a=0;',
      'int a{1}; alignas(16) int b{2}; a=b;',
      'int a{1}; std::cout << a << a;',
      '#define VALUE 1\nint a{VALUE};',
      'int __course_checkpoint{5};',
      'int a,b;',
      'int a{1}; } int outside(){return 0;} int other(){',
      'int g;\nint main() { std::cout << g; }',
      'int f() { return 1; }\nint main() { int a{ f() }; }',
      'int a{1}; int b{2}; int c{3}; int d{4}; int e{5}; int f{6}; int g{7}; int h{8}; int i{9};',
    ];
    const original = tracing.hooks.execute;
    let called = false;
    tracing.hooks.execute = () => {
      called = true;
    };
    try {
      for (const source of sources) {
        assert.throws(() => tracing.trace(source), Unsupported);
      }
      assert.equal(called, false);
    } finally {
      tracing.hooks.execute = original;
    }
  });

  test('unsupported_pointer_constructs_never_execute', () => {
    const cases = {
      'int a[2]{};': /arrays/,
      'int a{1}; int* p{&a}; int* q = p + 1;': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int d = *(p + 0);': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int* q{&a}; int d = p - q;': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int d = p[0];': /ArraySubscriptExpr/,
      'int a{1}; int* p{&a}; int* q{&a}; int e = p == q;': /pointer arithmetic and comparison/,
      'int a{1}; int&& r = 1;': /references/,
      'int a{1}; int* p = (int*)&a;': /CStyleCastExpr/,
      'int a{1}; long* p = reinterpret_cast<long*>(&a);': /pointers to int/,
      'int* p = new int{1};': /CXXNewExpr/,
      'int a{1}; void* p = &a;': /pointers to int/,
      'const int a{1}; const int* p = &a;': /pointers to int/,
      'int a{1}; int* const p = &a;': /pointers to int/,
      'int a{5}; int b = *(&a);': /pointer variable/,
      'int a{5}; int* p{&a}; int* q = &*p;': /address of a variable/,
      'int* p{}; *p = 1;': /null pointer p/,
      'int* p; *p = 1;': /uninitialized variable p/,
      'int a{5}; int* b{&a}; int* c = b++;': /UnaryOperator/,
      'int a{5}; int* p{&a}; *p += 1;': /CompoundAssignOperator/,
      'int a{5}; std::cout << std::endl << a;': /one integer output followed only by whitespace/,
      'int a{5}; int* p{&a}; std::cout << std::endl << p;':
        /one integer output followed only by whitespace/,
      'int a{5}; std::cout << "\\n";': /string literal output/,
      "int a{5}; std::cout << '\\x0a';": /whitespace output is supported as/,
      "int a{5}; std::cout << 'x';": /not char/,
      'int a; (a) = 5;': /parenthesized variable/,
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

  test('compiler_errors_name_no_temporary_path', () => {
    assert.throws(
      () => traceStatic('int* b{ 32 };'),
      err =>
        err instanceof Unsupported &&
        /^error: cannot initialize a variable of type 'int \*'/.test(err.message)
    );
  });
});

describe('ObservationTests', () => {
  const PREDICTED = [{ a: 5 }, { a: 5, p: new Pointer('a') }];

  function makeExecution(pointerValue, size = 8) {
    const a = new Cell({ address: 0x7ffc_1004, size: 4, pointer: false, value: 5 });
    const p = new Cell({ address: 0x7ffc_0ff8, size, pointer: true, value: pointerValue });
    return new Execution([{ a }, { a, p }], '');
  }

  test('pointer_values_map_back_to_variables', () => {
    const [addrs, states] = tracing._observed(
      makeExecution(0x7ffc_1004),
      PREDICTED,
      new Set(['p'])
    );
    assert.deepEqual(states, PREDICTED);
    assert.deepEqual(tracing._normalize(addrs, { a: 4, p: 8 }), { a: 76, p: 64 });
  });

  test('a_pointer_to_anything_else_is_rejected', () => {
    assert.throws(
      () => tracing._observed(makeExecution(0x7ffc_1008), PREDICTED, new Set(['p'])),
      err => err instanceof Unsupported && /not the address of a variable/.test(err.message)
    );
  });

  test('a_disagreeing_target_is_rejected', () => {
    assert.throws(
      () => tracing._observed(makeExecution(0), PREDICTED, new Set(['p'])),
      err => err instanceof Unsupported && /runtime verification failed: p/.test(err.message)
    );
  });

  test('unexpected_storage_is_rejected', () => {
    assert.throws(
      () => tracing._observed(makeExecution(0x7ffc_1004, 4), PREDICTED, new Set(['p'])),
      err => err instanceof Unsupported && /runtime storage of p/.test(err.message)
    );
  });

  test('normalization_keeps_alignment', () => {
    assert.deepEqual(
      tracing._normalize({ a: 0x1004, p: 0x1008 }, { a: 4, p: 8 }),
      { a: 68, p: 72 }
    );
    assert.deepEqual(
      tracing._normalize({ a: 0x1004, b: 0x1008 }, { a: 4, b: 4 }),
      { a: 64, b: 68 }
    );
  });
});

describe('RuntimeTraceTests', () => {
  test('real_frame_values_and_relative_addresses', () => {
    const trace = tracing.trace('int a{5}; int b{a + 6}; a = 7; std::cout << b << std::endl;');
    assert.deepEqual(final(trace), { a: 7, b: 11 });
    assert.equal(final(trace, 'stdout'), '11\n');
    assert.deepEqual(
      Object.values(addresses(trace)).sort((a, b) => a - b),
      [64, 68]
    );
    assert.ok(!JSON.stringify(trace).includes('/tmp/'));
  });

  test('failed_swap_does_not_preserve_lost_old_value', () => {
    const trace = tracing.trace('int a{1}; int b{2}; a=b; b=a;');
    assert.deepEqual(final(trace), { a: 2, b: 2 });
    const writes = trace.steps
      .filter(step => step.op && step.op.kind === 'write')
      .map(step => step.op.value);
    assert.deepEqual(writes, ['1', '2', '2', '2']);
  });

  test('const_auto_empty_initialization_and_multiline_output', () => {
    for (const [source, output] of [
      [
        'const int a=5; auto b=a; b=6; std::cout << a << std::endl; std::cout << b << std::endl;',
        '5\n6\n',
      ],
      [
        'int a{}; a=int{}; int b=int{}; std::cout << a << std::endl; std::cout << b << std::endl;',
        '0\n0\n',
      ],
      ['int a; a=5; std::cout << a;', '5'],
    ]) {
      assert.equal(final(tracing.trace(source), 'stdout'), output);
    }
  });

  test('whitespace_output_is_verified_against_stdout', () => {
    const source =
      "int a{5}; std::cout << std::endl; std::cout << a; std::cout << '\\n' << ' ' << std::endl;";
    assert.equal(final(tracing.trace(source), 'stdout'), '\n5\n \n');
    const original = tracing.hooks.execute;
    tracing.hooks.execute = () =>
      new Execution(
        Array(4).fill({ a: new Cell({ address: 0x1000, size: 4, pointer: false, value: 5 }) }),
        '5\n \n'
      );
    try {
      assert.throws(
        () => tracing.trace(source),
        err => err instanceof Unsupported && /runtime output disagrees/.test(err.message)
      );
    } finally {
      tracing.hooks.execute = original;
    }
  });

  test('generated_endl_browser_fixture_is_current', () => {
    const path = join(HERE, 'fixtures', 'endl-generated.json');
    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(tracing.trace(fixture.source.join('\n')), fixture);
  });

  test('a_printed_pointer_shows_its_normalized_address_in_hex', () => {
    const result = tracing.trace(
      'int a{5}; int* b{&a}; int* n{};\nstd::cout << b << std::endl; std::cout << n;'
    );
    const address = addresses(result).a;
    const shown = `0x${address.toString(16).padStart(16, '0')}`;
    const line3Panes = panes(result, 3);
    assert.deepEqual(line3Panes.slice(-3, -1), [
      `std::cout << ${address} << std::endl`,
      `std::cout << ${shown} << std::endl`,
    ]);
    const line3Ops = ops(result, 3);
    assert.deepEqual(line3Ops[line3Ops.length - 1], {
      kind: 'print',
      value: shown,
      span: [13, 31],
    });
    assert.equal(final(result, 'stdout'), shown + '\n0');
  });

  test('double_pointer_runs_as_predicted', () => {
    const traced = tracing.trace(DOUBLE_POINTER);
    const predicted = tracing.trace(DOUBLE_POINTER, { runtime: false });
    assert.deepEqual(traced, predicted);
    assert.deepEqual(final(traced, 'targets'), { p: 'b', pp: 'p' });
    assert.ok(Object.values(addresses(traced)).every(address => 64 <= address && address < 128));
  });

  test('null_copy_and_reassignment_are_verified', () => {
    const traced = tracing.trace(
      'int a{5}; int* p = nullptr; int* q = p; p = &a; q = p; *q = 9; p = nullptr; std::cout << *q;'
    );
    assert.equal(final(traced, 'stdout'), '9');
    assert.deepEqual(final(traced, 'targets'), { q: 'a' });
    assert.equal(final(traced).p, 0);
    const writes = traced.steps.filter(step => step.op && step.op.kind === 'write');
    assert.equal(writes[1].op.value, '0');
    assert.equal(writes[writes.length - 1].op.value, '0');
  });

  test('three_pointer_levels_read_and_write', () => {
    const traced = tracing.trace(
      'int a{5}; int* p{&a}; int** pp{&p}; int*** ppp{&pp}; ***ppp = 9; int b = ***ppp; std::cout << b;'
    );
    assert.equal(final(traced, 'stdout'), '9');
    assert.deepEqual(final(traced, 'targets'), { p: 'a', pp: 'p', ppp: 'pp' });
    assert.deepEqual(
      ops(traced, 4).map(op => op.kind),
      ['read', 'deref', 'read', 'deref', 'read', 'deref', 'write']
    );
  });

  test('static_layout_matches_the_frame', () => {
    for (const source of [
      'int a{1}; int* p{&a}; int b{2}; int** pp{&p}; int c{3};',
      'int* p{}; int a{1}; int b{2}; int* q{&b};',
      'int x{ 0 }; int* px{ &x }; int y{ x }; int* py{ px }; *px = 1;',
    ]) {
      assert.deepEqual(
        addresses(tracing.trace(source)),
        addresses(tracing.trace(source, { runtime: false }))
      );
    }
  });

  test('traces_are_byte_identical', () => {
    const first = dumpsSorted(tracing.trace(DOUBLE_POINTER));
    const second = dumpsSorted(tracing.trace(DOUBLE_POINTER));
    assert.equal(first, second);
  });

  test('static_prediction_mismatch_is_fatal', () => {
    const original = tracing.defaultAfter;
    for (const [source, kind] of [
      ['int a{5};', 'int'],
      ['int a{5}; int* p{&a};', 'ptr'],
    ]) {
      tracing.hooks.after = (statement, state) => {
        const result = original(statement, state);
        const value = result[statement.target];
        if (kind === 'int' && typeof value === 'number') {
          result[statement.target] = value + 1;
        } else if (kind === 'ptr' && value instanceof Pointer) {
          result[statement.target] = new Pointer();
        }
        return result;
      };
      try {
        assert.throws(
          () => tracing.trace(source),
          err => err instanceof Unsupported && /runtime verification failed/.test(err.message)
        );
      } finally {
        tracing.hooks.after = null;
      }
    }
  });
});
