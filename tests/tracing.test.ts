// Behavioral coverage for compiler-backed traces and fail-closed eligibility.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from '../src/core/json_format.ts';
import {
  Builder,
  type ExecutionTrace,
  FormatError,
  type TraceOperation,
  type TraceStep,
  scalar,
  validate,
} from '../src/core/trace_format.ts';
import { createClangFrontend } from '../src/node/toolchain.ts';
import * as tracing from '../src/node/tracing.ts';
import { Pointer, Unsupported } from '../src/node/tracing.ts';

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

function panes(trace: ExecutionTrace, line: number): string[] {
  return trace.steps.filter(step => step.line === line).map(step => step.pane);
}

function ops(trace: ExecutionTrace, line: number): TraceOperation[] {
  return trace.steps
    .filter((step): step is TraceStep & { op: TraceOperation } => step.line === line && !!step.op)
    .map(step => step.op);
}

function final(trace: ExecutionTrace): ExecutionTrace['steps'][number]['values'];
function final<K extends keyof TraceStep>(trace: ExecutionTrace, key: K): TraceStep[K];
function final(trace: ExecutionTrace, key: keyof TraceStep = 'values'): unknown {
  return trace.steps[trace.steps.length - 1][key];
}

function addresses(trace: ExecutionTrace): Record<string, number> {
  return Object.fromEntries(trace.variables.map(v => [v.name, v.address]));
}

describe('StaticIntegerTraceTests', () => {
  const traceStatic = (source: string): ExecutionTrace => tracing.trace(source);

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
    const writeOp = ops(trace, 1)[2];
    assert.ok(writeOp.kind === 'write');
    assert.deepEqual(writeOp.destination, [4, 5]);
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
    assert.deepEqual(trace.spans?.[0], [5, 7]);
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
    assert.deepEqual(trace.spans?.[2], [13, 22]);
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
    assert.equal(trace.spans?.[0], null);
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
  const traceStatic = (source: string): ExecutionTrace => tracing.trace(source);

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
    const line5Ops = ops(trace, 5);
    const lastOp5 = line5Ops[line5Ops.length - 1];
    assert.ok(lastOp5.kind === 'write');
    assert.deepEqual(lastOp5.destination, [0, 1]);
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
    assert.deepEqual([write.op?.kind, write.targets, write.values.b], [
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
    ] as const) {
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

  test('void_pointers_and_sizeof_reduce_cleanly', () => {
    const trace = traceStatic(
      'int a = 5; void* vp = &a; int* ip = static_cast<int*>(vp); *ip = sizeof(a) + sizeof(*ip);'
    );
    assert.equal(final(trace, 'targets').vp, 'a');
    assert.equal(final(trace, 'targets').ip, 'a');
    assert.equal(final(trace).a, 8);
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
      'long double a{1.5};',
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
    for (const source of sources) assert.throws(() => tracing.trace(source), Unsupported, source);
  });

  test('unsupported_pointer_constructs_never_execute', () => {
    const cases: Record<string, RegExp> = {
      'int a[2]{};': /arrays/,
      'int a{1}; int* p{&a}; int* q = p + 1;': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int d = *(p + 0);': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int* q{&a}; int d = p - q;': /pointer arithmetic/,
      'int a{1}; int* p{&a}; int d = p[0];': /ArraySubscriptExpr/,
      'int a{1}; int* p{&a}; int* q{&a}; int e = p == q;': /pointer arithmetic and comparison/,
      'int a{1}; int&& r = 1;': /references/,
      'int a{1}; int* p = (int*)&a;': /CStyleCastExpr/,
      'int a{1}; long* p = reinterpret_cast<long*>(&a);': /unsupported expression: CXXReinterpretCastExpr/,
      'int* p = new int{1};': /CXXNewExpr/,
      'char* p{};': /not char/,
      'int a = 42; void* p = &a; float* q = static_cast<float*>(p); float y = *q;': /dereferencing a pointer to float when a holds int/,
      'int a = 42; void* p = &a; float* q = static_cast<float*>(p); *q = 1.0f;': /dereferencing a pointer to float when a holds int/,
      'struct A { int x; }; struct B { float x; }; A a{ 1 }; void* p = &a; B* bp = static_cast<B*>(p); float y = bp->x;': /dereferencing a pointer to B when a holds A/,
      'const int a{1}; const int* p = &a;': /pointers to int/,
      'int a{1}; int* const p = &a;': /pointers to int/,
      'int a{5}; int b = *(&a);': /pointer variable/,
      'int a{5}; int* p{&a}; int* q = &*p;': /address of a variable/,
      'int* p{}; *p = 1;': /null pointer p/,
      'int* p; *p = 1;': /uninitialized variable p/,
      'int a{5}; int* b{&a}; int* c = b++;': /UnaryOperator/,
      'int a{5}; int* p{&a}; *p <<= 1;': /unsupported compound assignment <<=/,
      'int a{5}; std::cout << std::endl << a;': /one integer output followed only by whitespace/,
      'int a{5}; int* p{&a}; std::cout << std::endl << p;':
        /one integer output followed only by whitespace/,
      'int a{5}; std::cout << "\\n";': /string literal output/,
      "int a{5}; std::cout << '\\x0a';": /whitespace output is supported as/,
      "int a{5}; std::cout << 'x';": /not char/,
      'int a; (a) = 5;': /parenthesized variable/,
    };
    for (const [source, reason] of Object.entries(cases)) {
      assert.throws(() => tracing.trace(source), (err: unknown) => err instanceof Unsupported && reason.test(err.message));
    }
  });

  test('compiler_errors_name_no_temporary_path', () => {
    assert.throws(
      () => traceStatic('int* b{ 32 };'),
      (err: unknown) =>
        err instanceof Unsupported &&
        /^error: cannot initialize a variable of type 'int \*'/.test(err.message)
    );
  });
});

describe('CompoundAssignmentTests', () => {
  const unsupported = (source: string, reason: RegExp): void => {
    assert.throws(
      () => tracing.trace(source),
      (err: unknown) => err instanceof Unsupported && reason.test(err.message)
    );
  };

  test('the_read_opens_the_operator_into_a_plain_assignment', () => {
    const trace = tracing.trace('int a = 5; int b = 2; a += b;');
    assert.deepEqual(panes(trace, 2), ['a += b', 'a = 5 + b', 'a = 5 + 2', 'a = 7', 'a = 7']);
    assert.deepEqual(ops(trace, 2)[0], {
      kind: 'read',
      name: 'a',
      value: '5',
      compound: '+',
      grouped: false,
      span: [2, 4],
    });
    const expressions = trace.steps.filter(step => step.line === 2).map(step => step.pane.slice(...step.expr!));
    assert.deepEqual(expressions, ['+= b', '5 + b', '5 + 2', '7', '7']);
    assert.deepEqual(final(trace), { a: 7, b: 2 });
  });

  test('the_target_is_designated_once_before_its_value_is_read', () => {
    const trace = tracing.trace(
      'struct P { int x; int y; }; P s{1, 2}; P* p = &s; p->x -= 3; s.y%=2; int& r = s.x; r *= 4;'
    );
    assert.deepEqual(panes(trace, 2), ['p->x -= 3', '72->x -= 3', 's.x -= 3', 's.x = 1 - 3', 's.x = -2', 's.x = -2']);
    assert.deepEqual(panes(trace, 3), ['s.y%=2', 's.y = 2 % 2', 's.y = 0', 's.y = 0']);
    assert.deepEqual(panes(trace, 5), ['r *= 4', 's.x *= 4', 's.x = -2 * 4', 's.x = -8', 's.x = -8']);
    const deref = tracing.trace('int a{5}; int* p{&a}; *p += 1;');
    assert.deepEqual(panes(deref, 2), ['*p += 1', '*76 += 1', 'a += 1', 'a = 5 + 1', 'a = 6', 'a = 6']);
  });

  test('the_operation_runs_in_the_type_clang_computes_and_converts_back', () => {
    const trace = tracing.trace('short c = 1; c += 1; int a = 7; a *= 1.5; float f = 1.5f; f /= 2;', {
      types: true,
    });
    const converts = (line: number): string[] =>
      ops(trace, line).flatMap(op => (op.kind === 'convert' ? [`${op.from}->${op.to}`] : []));
    assert.deepEqual(panes(trace, 1), ['c += 1', 'c = 1 + 1', 'c = 1 + 1', 'c = 2', 'c = 2', 'c = 2']);
    assert.deepEqual(converts(1), ['short->int', 'int->short']);
    assert.deepEqual(panes(trace, 3), ['a *= 1.5', 'a = 7 * 1.5', 'a = 7 * 1.5', 'a = 10.5', 'a = 10', 'a = 10']);
    assert.deepEqual(converts(3), ['int->double', 'double->int']);
    assert.deepEqual(converts(5), ['int->float']);
    assert.deepEqual(final(trace), { c: 2, a: 10, f: 0.75 });
  });

  test('operators_without_a_binary_form_and_pointers_are_rejected', () => {
    unsupported('int a = 5; a <<= 1;', /unsupported compound assignment <<=/);
    unsupported('int a = 5; a |= 1;', /unsupported compound assignment \|=/);
    unsupported('int a = 5; int* p = &a; p += 1;', /pointer arithmetic/);
    unsupported('int a; a += 1;', /uninitialized variable a/);
    unsupported('int a = 5; a /= 0;', /undefined integer division/);
  });

  test('the_validator_checks_the_opened_operator', () => {
    const trace = tracing.trace('int b = 1; int a = 5; a -= 2;');
    const index = trace.steps.findIndex(step => step.op?.kind === 'read');
    const rejects = (message: RegExp, change: (op: Record<string, unknown>) => void): void => {
      const broken = structuredClone(trace);
      change(broken.steps[index].op as unknown as Record<string, unknown>);
      assert.throws(() => validate(broken), (err: unknown) => err instanceof FormatError && message.test(err.message));
    };
    validate(trace);
    rejects(/does not cover \+=/, op => (op.compound = '+'));
    rejects(/not an arithmetic operator/, op => (op.compound = '<<'));
    rejects(/expected a boolean on a compound read/, op => delete op.compound);
    rejects(/'a' does not designate b/, op => (op.name = 'b'));
    rejects(/reads an uninitialized value/, op => (op.value = '?'));
    const merged = structuredClone(trace);
    merged.steps[index].pane = 'a = 5 -2';
    merged.steps[index].expr = [4, 8];
    assert.throws(() => validate(merged), (err: unknown) => err instanceof FormatError && /is not 'a = 5 - 2'/.test(err.message));
    rejects(/'\{5\}' is not one number/, op => (op.value = '{5}'));
  });

  test('the_validator_requires_the_following_reductions_to_match_the_opened_pane', () => {
    const trace = tracing.trace('int a = 5; int b = 2; int c = 3; a *= b + c;');
    const index = trace.steps.findIndex(step => step.op?.kind === 'read');
    const broken = structuredClone(trace);
    broken.steps[index].pane = 'a = 5 * b + c';
    broken.steps[index].expr = [4, 13];
    assert.throws(
      () => validate(broken),
      (err: unknown) => err instanceof FormatError && /is not 'a = 5 \* \(b \+ c\)'/.test(err.message)
    );
  });

  test('groups the AST right operand, including template calls and raw string tokens', () => {
    const trace = tracing.trace([
      'std::array b{2, 3}; int a = 1;',
      'a *= b.size();',
      'a += b<:0:> * b[1];',
      'a *= sizeof(R"(say "two  words")") + 3;',
      'a *= (2 + 3);',
    ].join('\n'));
    assert.equal(panes(trace, 2)[1], 'a = 1 * b.size()');
    assert.equal(panes(trace, 3)[1], 'a = 2 + b<:0:> * b[1]');
    assert.equal(panes(trace, 4)[1], 'a = 8 * (sizeof(R"(say "two  words")") + 3)');
    assert.equal(panes(trace, 5)[1], 'a = 160 * (2 + 3)');
  });

  test('a_negative_value_does_not_join_the_sign_before_it', () => {
    const trace = tracing.trace('int a = 5; int b = 8; int c = -2; a *= b-c; int y = -c;');
    assert.equal(panes(trace, 3)[3], 'a = 5 * (8-(-2))');
    assert.deepEqual(panes(trace, 4).slice(0, 2), ['int y = -c', 'int y = -(-2)']);
    assert.deepEqual(final(trace), { a: 50, b: 8, c: -2, y: 2 });
    const written = tracing.trace('int y = -(-2);', { types: true });
    assert.deepEqual(panes(written, 0), ['int y = -(-2)', 'int y = 2', 'int y = 2']);
    const bits = tracing.trace('short x = -2; int y = -x;', { bits: true });
    assert.deepEqual(final(bits), { x: -2, y: 2 });
  });

  test('signs in the target of a compound assignment stay separate', () => {
    const source = 'std::array a{1,2}; int i=-1; a[0-i] += 3;';
    const trace = tracing.trace(source);
    assert.ok(panes(trace, 2).includes('a[0-(-1)] += 3'));
    assert.deepEqual(final(trace), { 'a.[0]': 1, 'a.[1]': 5, i: -1 });
  });

  test('hand_written_traces_keep_signs_apart_too', () => {
    const t = new Builder(['int x = -2;', 'int y = -x;'], [scalar('x', 64, 4), scalar('y', 68, 4)]);
    t.statement(0).write('x');
    t.statement(1).read('x').evaluate('-(-2)', 2).write('y');
    assert.deepEqual(
      t.build().steps.filter(step => step.line === 1).map(step => step.pane),
      ['int y = -x', 'int y = -(-2)', 'int y = 2', 'int y = 2']
    );
  });

  test('the_validator_reads_only_one_arithmetic_cell', () => {
    const trace = tracing.trace('int a = 5; int* p = &a; a -= 2;');
    const index = trace.steps.findIndex(step => step.op?.kind === 'read');
    const broken = structuredClone(trace);
    const op = broken.steps[index].op as unknown as Record<string, unknown>;
    broken.steps[index - 1].pane = broken.steps[index - 1].pane.replace(/^a/, 'p');
    op.name = 'p';
    assert.throws(() => validate(broken), (err: unknown) => err instanceof FormatError && /not one arithmetic cell/.test(err.message));
  });

  test('a_right_side_that_binds_looser_keeps_its_parentheses', () => {
    const trace = tracing.trace(
      'int a = 5; int b = 2; int c = 3; a *= b + c; a -= b - c; a += b * c; a += +b; double d = 1.5; d *= b + 1;'
    );
    assert.deepEqual(panes(trace, 3), [
      'a *= b + c',
      'a = 5 * (b + c)',
      'a = 5 * (2 + c)',
      'a = 5 * (2 + 3)',
      'a = 5 * (5)',
      'a = 5 * 5',
      'a = 25',
      'a = 25',
    ]);
    assert.equal(panes(trace, 4)[1], 'a = 25 - (b - c)');
    assert.equal(panes(trace, 5)[1], 'a = 26 + b * c');
    assert.equal(panes(trace, 6)[1], 'a = 32 + +b');
    assert.equal(panes(trace, 8)[1], 'd = 1.5 * (b + 1)');
    assert.deepEqual(final(trace), { a: 34, b: 2, c: 3, d: 4.5 });
  });

  test('a_target_written_otherwise_is_spelled_as_its_name_first', () => {
    const trace = tracing.trace('struct S { int x; }; S s{1}; (s.x) += 2; s . x *= 3; (s.x) = 4;', {
    });
    assert.deepEqual(panes(trace, 1), ['(s.x) += 2', 's.x += 2', 's.x = 1 + 2', 's.x = 3', 's.x = 3']);
    assert.deepEqual(panes(trace, 2), ['s . x *= 3', 's.x *= 3', 's.x = 3 * 3', 's.x = 9', 's.x = 9']);
    assert.deepEqual(panes(trace, 3), ['(s.x) = 4', 's.x = 4', 's.x = 4']);
  });

  test('spaces_and_comments_before_the_semicolon_still_run', () => {
    const trace = tracing.trace('int a = 5; a += 2 ; a *= 3 /* thrice */ ;\nint b = 1 // one\n;');
    assert.deepEqual(panes(trace, 1), ['a += 2', 'a = 5 + 2', 'a = 7', 'a = 7']);
    assert.deepEqual(final(trace), { a: 21, b: 1 });
    assert.deepEqual(trace.source.slice(1), ['a += 2;', 'a *= 3;', 'int b = 1 ;']);
  });

  test('line_splices_are_refused', () => {
    unsupported('int a = 5; a += 2 \\\n;', /line splice/);
    unsupported('int a = 1; // note \\ \na *= 3;', /line splice/);
    unsupported('int a = sizeof(+"a\\\n//b"[0]);', /line splice/);
    unsupported('int a = 5; a *= 1\\\r2;', /line splice/);
    unsupported('int a = 1;\n// R"(example \\\na += 3; // )"', /line splice/);
  });

  test('raw_strings_and_other_quotes_are_read_whole', () => {
    const raw = 'int n = sizeof(u8R"x(\n#include <iostream>\n)x");';
    assert.deepEqual(final(tracing.trace(raw)), { n: 22 });
    // A digit separator is no quote, and quotes in a comment or string open nothing.
    const trace = tracing.trace("int a = 1'000; // it's\nint b = 2'0; /* R\"( */ // R\"(\na += b;");
    assert.deepEqual(final(trace), { a: 1020, b: 20 });
    // A line comment ends at a carriage return as well.
    assert.deepEqual(final(tracing.trace('int a = 1; // note\ra += 3;')), { a: 4 });
  });

  test('a_comment_in_a_directive_keeps_it_one_line', () => {
    const include = '#include /* Gives us\nfixed-width integers. */ <cstdint>\nint n = 1;';
    assert.deepEqual(final(tracing.trace(include)), { n: 1 });
    unsupported('int n = 1;\n#include <cstdint> /* already\nincluded */ n += 3;', /extra tokens at end of #include|one variable/);
    // A lone carriage return ends a directive as it ends any line.
    assert.deepEqual(final(tracing.trace('int n = 1;\r#include <cstdint>\rn += 3;')), { n: 4 });
  });

  test('an_include_after_the_first_statement_stays_outside_main', () => {
    assert.deepEqual(final(tracing.trace('int a = 1;\n#include <cmath>\na = a + 1;')), { a: 2 });
    assert.deepEqual(final(tracing.trace('int a = 1;\n#include <math.h>\na = a + 1;')), { a: 2 });
    // Among other directives, an include stays where it is: here Clang skips it.
    assert.deepEqual(final(tracing.trace('int n = 1;\n#if 0\n#include <missing>\n#endif\nn += 1;')), { n: 2 });
  });

  test('cutting_a_mismatch_keeps_the_lines_before_the_source', () => {
    // Without its last statement the fragment no longer names `array`, but keeps its header.
    const source = '#if __LINE__ == 6\nint x=1;\n#else\nint y=2;\n#endif\nint* array = 42;';
    const result = tracing.trace(source, { types: true });
    assert.deepEqual(result.source, ['int x=1;', 'int* array = 42;']);
    assert.equal(result.steps.at(-1)!.op?.kind, 'clash');
  });

  test('a_macro_from_the_headers_is_expanded_as_in_the_program', () => {
    // libstdc++ defines this one empty, so the statement starts at `a`.
    const result = tracing.trace('int a = 1;\n_GLIBCXX_BEGIN_NAMESPACE_VERSION a = 2;');
    assert.deepEqual(result.source, ['int a = 1;', 'a = 2;']);
    assert.deepEqual(final(result), { a: 2 });
  });

  test('identifiers_beyond_ascii_are_refused_by_name', () => {
    unsupported('int переменная = 5;\nint b = переменная + 1;', /identifiers outside ASCII/);
  });

  test('compiler headers are in scope when finding the first active token', () => {
    const source = '#ifndef UINT8_MAX\nint skipped=1;\n#endif\nint b=2;';
    assert.deepEqual(final(tracing.trace(source)), { b: 2 });
  });

  test('remapped source locations are rejected before building spans', () => {
    unsupported('int a=1;\n#line 4 "lesson"\na=2;', /physical source locations/);
  });

  test('tokens inside a raw string cannot be mistaken for diagnostics', () => {
    const source = 'int n = sizeof(R"(abc: error: text)");';
    assert.deepEqual(final(tracing.trace(source)), { n: 17 });
  });

  test('the_statement_ends_at_its_own_semicolon_past_comments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'analyze-'));
    try {
      const frontend = createClangFrontend(directory);
      const sources = (source: string): string[] =>
        tracing.analyzeWithFrontend(source, frontend)[0].map(statement => statement.source);
      assert.deepEqual(sources('int a = 5; /* before */ a *= 3 /* after */ ;'), ['int a = 5;', 'a *= 3;']);
      assert.deepEqual(sources('int a = 5; a *= 3 // note\r;'), ['int a = 5;', 'a *= 3;']);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('clang_values_agree', () => {
    const trace = tracing.trace(
      'int a = 5; a += 2; a %= 4; unsigned u = 1; u -= 2; double d = 0.1; d *= 3; long l = 9; l /= -2;'
    );
    assert.deepEqual(final(trace), { a: 3, u: 4294967295, d: 0.30000000000000004, l: -4 });
  });
});

describe('MemoryLayoutTests', () => {
  test('normalization_keeps_alignment', () => {
    assert.deepEqual(
      tracing.normalizeAddresses({ a: 0x1004, p: 0x1008 }, { a: 4, p: 8 }),
      { a: 68, p: 72 }
    );
    assert.deepEqual(
      tracing.normalizeAddresses({ a: 0x1004, b: 0x1008 }, { a: 4, b: 4 }),
      { a: 64, b: 68 }
    );
  });
});

describe('CompilerTraceTests', () => {
  test('values_and_illustrative_addresses', () => {
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
      .map(step => (step.op as { value: string }).value);
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
    ] as const) {
      assert.equal(final(tracing.trace(source), 'stdout'), output);
    }
  });

  test('whitespace_output_is_rendered', () => {
    const source =
      "int a{5}; std::cout << std::endl; std::cout << a; std::cout << '\\n' << ' ' << std::endl;";
    assert.equal(final(tracing.trace(source), 'stdout'), '\n5\n \n');
  });

  test('generated_endl_browser_fixture_is_current', () => {
    const path = join(HERE, 'fixtures', 'endl-generated.json');
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as ExecutionTrace;
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
    const predicted = tracing.trace(DOUBLE_POINTER);
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
    assert.equal((writes[1].op as { value: string }).value, '0');
    assert.equal((writes[writes.length - 1].op as { value: string }).value, '0');
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

  test('illustrative_addresses_keep_each_object_aligned', () => {
    const traced = tracing.trace('int a{1}; int* p{&a}; int b{2}; int** pp{&p}; int c{3};');
    assert.deepEqual(addresses(traced), { a: 100, p: 88, b: 84, pp: 72, c: 68 });
  });

  test('removing output preserves preprocessor directives in the replay', () => {
    const source = 'int a=5; std::cout << a\n#if 1\n;\n#endif\na=7;';
    const traced = tracing.trace(source);
    assert.deepEqual(final(traced), { a: 7 });
    assert.equal(final(traced, 'stdout'), '5');
  });

  test('replay checks the active C++20 branch of feature tests', () => {
    const source = 'int n=1;\n#if __cpp_constexpr < 202211L\nn=2;\n#else\nn=3;\n#endif';
    const original = tracing.hooks.after;
    tracing.hooks.after = (statement, state) => {
      const next = original(statement, state);
      return next.n === 2 ? { ...next, n: 4 } : next;
    };
    try {
      assert.throws(
        () => tracing.trace(source),
        (error: unknown) => error instanceof Unsupported && /verification failed after statement 2/.test(error.message)
      );
    } finally {
      tracing.hooks.after = original;
    }
    assert.deepEqual(final(tracing.trace(source)), { n: 2 });
  });

  test('replay retains global record scope', () => {
    const source = 'struct S { int x; }; int main() { std::array<int, sizeof(::S)> a{}; a[0] = 1; }';
    assert.equal(final(tracing.trace(source))['a.[0]'], 1);
  });

  test('replay retains headers selected by preprocessing', () => {
    const source = '#if __cpp_constexpr < 202211L\n#include <csignal>\n#endif\nstd::sig_atomic_t n = 7;';
    assert.deepEqual(final(tracing.trace(source)), { n: 7 });
  });

  test('fragment wrapping preserves the line used in a preprocessor condition', () => {
    const source = 'int n=1;\n#if __LINE__ == 6\nn=2;\n#else\nn=3;\n#endif';
    assert.deepEqual(final(tracing.trace(source)), { n: 2 });
  });

  test('compiler verification distinguishes objects at the same address', () => {
    const original = tracing.hooks.after;
    tracing.hooks.after = (statement, state) => {
      const next = original(statement, state);
      return statement.target === 'p' ? { ...next, p: new Pointer('s.x') } : next;
    };
    try {
      assert.throws(
        () => tracing.trace('struct S { int x; }; S s{1}; void* p=&s;'),
        (error: unknown) => error instanceof Unsupported && /constant expression/.test(error.message)
      );
    } finally {
      tracing.hooks.after = original;
    }
  });

  test('traces_are_byte_identical', () => {
    const first = dumpsSorted(tracing.trace(DOUBLE_POINTER));
    const second = dumpsSorted(tracing.trace(DOUBLE_POINTER));
    assert.equal(first, second);
  });

  test('static_prediction_mismatch_is_fatal', () => {
    const original = tracing.hooks.after;
    for (const [source, kind] of [
      ['int a{5};', 'int'],
      ['int a{5}; int* p{&a};', 'ptr'],
    ] as const) {
      tracing.hooks.after = (statement, state) => {
        const result = original(statement, state);
        if (statement.target === null) return result;
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
          (err: unknown) =>
            err instanceof Unsupported && /compiler verification failed/.test(err.message)
        );
      } finally {
        tracing.hooks.after = original;
      }
    }
  });
});
