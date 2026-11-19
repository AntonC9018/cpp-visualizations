// Integer conversions: a value changes its type in one step, whether or not its digits change.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { dumpsSorted } from '../src/core/json_format.ts';
import {
  type ConvertOperation,
  type ExecutionTrace,
  FormatError,
  type TraceStep,
  validate,
} from '../src/core/trace_format.ts';
import { text as svgText } from '../src/player/svg.ts';
import * as tracing from '../src/node/tracing.ts';
import { INTEGERS, Unsupported } from '../src/node/tracing.ts';
import { integerLiteral } from '../src/core/integers.ts';

type Conversion = [before: string, after: string, from: string, to: string];

/** Each conversion as (pane before, pane after, from, to). */
function conversions(trace: ExecutionTrace, line?: number): Conversion[] {
  const { steps } = trace;
  return steps.slice(1).flatMap((step, i): Conversion[] =>
    step.op?.kind === 'convert' && (line === undefined || step.line === line)
      ? [[steps[i].pane, step.pane, step.op.from, step.op.to]]
      : []
  );
}

function typed(step: TraceStep): string[] {
  return (step.types ?? []).map(part => step.pane.slice(...part.span) + ':' + part.type);
}

const throwsUnsupported = (run: () => unknown, reason: RegExp): void => {
  assert.throws(run, (err: unknown) => err instanceof Unsupported && reason.test(err.message));
};

describe('IntegerTests', () => {
  test('a_conversion_keeps_the_low_bits', () => {
    const cases: [string, bigint, bigint][] = [
      ['unsigned char', 256n, 0n],
      ['unsigned char', -1n, 255n],
      ['signed char', -200n, 56n],
      ['signed char', 255n, -1n],
      ['short', 65534n, -2n],
      ['unsigned int', -1n, 4294967295n],
      ['int', 2n ** 31n, -(2n ** 31n)],
      ['long', -3n, -3n],
      ['unsigned long', -1n, 2n ** 64n - 1n],
    ];
    for (const [spelling, value, expected] of cases) {
      assert.equal(INTEGERS[spelling].wrap(value), expected, `${spelling} ${value}`);
    }
  });

  test('unsigned_arithmetic_wraps_and_signed_overflow_is_undefined', () => {
    assert.equal(INTEGERS['unsigned int'].result(-1n), 4294967295n);
    assert.equal(INTEGERS.short.result(-32768n), -32768n);
    throwsUnsupported(() => INTEGERS.long.result(2n ** 63n), /signed integer overflow/);
  });
});

describe('ConversionTests', () => {
  const trace = (source: string): ExecutionTrace =>
    tracing.trace(source, { runtime: false, types: true });
  const sizes = (t: ExecutionTrace): Record<string, number> =>
    Object.fromEntries(t.variables.map(v => [v.name, v.size]));

  test('an_explicit_cast_is_one_step', () => {
    const t = trace('uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) };');
    assert.deepEqual(conversions(t, 1), [
      ['uint8_t b = static_cast<uint8_t>(256)', 'uint8_t b = 0', 'uint32_t', 'uint8_t'],
    ]);
    assert.deepEqual(t.steps.at(-1)!.values, { a: 256, b: 0 });
    assert.deepEqual(sizes(t), { a: 4, b: 1 });
  });

  test('the_same_digits_still_change_their_type', () => {
    const t = trace('uint8_t b{ 0 }; uint32_t c{ b };');
    assert.deepEqual(conversions(t), [
      ['uint8_t b = 0', 'uint8_t b = 0', 'int', 'uint8_t'],
      ['uint32_t c = 0', 'uint32_t c = 0', 'uint8_t', 'uint32_t'],
    ]);
    const [read, converted] = t.steps.filter(step => step.line === 1).slice(1, 3);
    assert.deepEqual([typed(read)[1], typed(converted)[1]], ['0:uint8_t', '0:uint32_t']);
  });

  test('an_implicit_conversion_in_an_assignment', () => {
    const t = trace('int16_t s{ -2 }; uint16_t u{ 0 }; u = s;');
    assert.deepEqual(conversions(t, 2), [['u = -2', 'u = 65534', 'int16_t', 'uint16_t']]);
    assert.deepEqual(sizes(t), { s: 2, u: 2 });
  });

  test('a_sign_change_of_one_width', () => {
    assert.deepEqual(conversions(trace('int8_t a{ -3 }; uint8_t b{ static_cast<uint8_t>(a) };'), 1), [
      ['uint8_t b = static_cast<uint8_t>(-3)', 'uint8_t b = 253', 'int8_t', 'uint8_t'],
    ]);
    assert.deepEqual(conversions(trace('uint8_t a{ 127 }; int8_t b{ static_cast<int8_t>(a) };'), 1), [
      ['int8_t b = static_cast<int8_t>(127)', 'int8_t b = 127', 'uint8_t', 'int8_t'],
    ]);
  });

  test('a_negative_number_widens_with_its_sign', () => {
    const t = trace('int8_t a{ -3 }; int b{ static_cast<int>(a) }; long c = b;');
    assert.deepEqual(conversions(t).slice(1), [
      ['int b = static_cast<int>(-3)', 'int b = -3', 'int8_t', 'int'],
      ['long c = -3', 'long c = -3', 'int', 'long'],
    ]);
  });

  test('narrowing_wraps', () => {
    const t = trace('int c{ -200 }; int8_t d{ static_cast<int8_t>(c) }; std::cout << static_cast<int>(d);');
    assert.deepEqual(conversions(t), [
      ['int8_t d = static_cast<int8_t>(-200)', 'int8_t d = 56', 'int', 'int8_t'],
      ['std::cout << static_cast<int>(56)', 'std::cout << 56', 'int8_t', 'int'],
    ]);
    assert.equal(t.steps.at(-1)!.stdout, '56');
  });

  test('operands_are_promoted_before_arithmetic', () => {
    const t = trace('uint8_t a{ 200 }; int b = a + a; unsigned x = 0; x = x - 1;');
    assert.deepEqual(conversions(t, 1), [
      ['int b = 200 + a', 'int b = 200 + a', 'uint8_t', 'int'],
      ['int b = 200 + 200', 'int b = 200 + 200', 'uint8_t', 'int'],
    ]);
    assert.deepEqual(conversions(t, 3), [['x = 0 - 1', 'x = 0 - 1', 'int', 'unsigned int']]);
    assert.deepEqual(t.steps.at(-1)!.values, { a: 200, b: 400, x: 4294967295 });
  });

  test('a_cast_to_the_same_type_only_goes_away', () => {
    const t = trace('int a{ 5 }; int b{ static_cast<int>(a) };');
    assert.deepEqual(conversions(t), []);
    assert.equal(t.steps.filter(step => step.line === 1).at(-1)!.pane, 'int b = 5');
  });

  test('bitwise_not_flips_the_promoted_operand', () => {
    const t = trace('uint8_t a{ 0 }; uint8_t b{ static_cast<uint8_t>(~a) }; unsigned c = ~0u;');
    assert.deepEqual(conversions(t, 1), [
      ['uint8_t b = static_cast<uint8_t>(~0)', 'uint8_t b = static_cast<uint8_t>(~0)', 'uint8_t', 'int'],
      ['uint8_t b = static_cast<uint8_t>(-1)', 'uint8_t b = 255', 'int', 'uint8_t'],
    ]);
    assert.deepEqual(t.steps.at(-1)!.values, { a: 0, b: 255, c: 4294967295 });
  });

  test('a_pointer_to_a_narrow_integer_writes_through', () => {
    const t = trace('uint8_t a{ 1 }; uint8_t* p = &a; *p = 300 - 45;');
    assert.deepEqual(conversions(t, 2), [['*p = 255', '*p = 255', 'int', 'uint8_t']]);
    assert.equal(t.steps.at(-1)!.values.a, 255);
  });

  test('floating_point_and_void_pointer_conversions_and_brace_conversions', () => {
    const t = trace(
      'int seven = 7; double half = static_cast<double>(seven) / 2; int three = half; ' +
        'struct A { int f; void* p; }; uint8_t u{ 3 }; A a{ u, &seven }; int* ip = static_cast<int*>(a.p);'
    );
    assert.deepEqual(conversions(t, 1), [
      ['double half = static_cast<double>(7) / 2', 'double half = 7 / 2', 'int', 'double'],
      ['double half = 7 / 2', 'double half = 7 / 2', 'int', 'double'],
    ]);
    assert.deepEqual(conversions(t, 2), [['int three = 3.5', 'int three = 3', 'double', 'int']]);
    assert.equal(t.steps.at(-1)!.values.half, 3.5);
    assert.equal(t.steps.at(-1)!.values.three, 3);
    assert.equal(t.steps.at(-1)!.values['a.f'], 3);
    assert.equal(t.steps.at(-1)!.targets.ip, 'seven');
  });

  test('what_is_not_a_supported_conversion_is_rejected', () => {
    const cases: Record<string, RegExp> = {
      'int value{ 7 }; long double half{ static_cast<long double>(value) / 2 };': /not long double/,
      'bool b{ true }; int a = b;': /not bool/,
      'char c{ 5 }; int a = c;': /not char/,
      'uint8_t a{ 65 }; std::cout << a;': /prints a one-byte integer as a character/,
      'int a{ 5 }; short s{ a };': /cannot be narrowed/,
      'int a{ 2147483647 }; long b = a + 1;': /signed integer overflow/,
      'unsigned long a = 18446744073709551615ul;': /beyond 2\^53/,
      'double d = 1e20; int a = static_cast<int>(d);': /overflows integer type/,
      'double d = 1.0 / 0.0;': /undefined floating-point division/,
      'float f = 3e38f; float g = f * 2.0f;': /undefined floating-point/,
    };
    for (const [source, reason] of Object.entries(cases)) {
      throwsUnsupported(() => trace(source), reason);
    }
  });

  test('a_conversion_must_match_the_typed_pane', () => {
    const t = trace('uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) };');
    const index = t.steps.findIndex(step => step.line === 1 && step.op?.kind === 'convert');
    const edits: ((op: Partial<ConvertOperation>) => void)[] = [
      op => (op.from = 'int'),
      op => (op.to = 'uint32_t'),
      op => (op.value = '1'),
      op => delete op.from,
    ];
    for (const edit of edits) {
      const broken = structuredClone(t);
      edit(broken.steps[index].op as ConvertOperation);
      assert.throws(() => validate(broken), FormatError);
    }
  });
});

describe('UntypedConversionTests', () => {
  // Without types a conversion is an evaluation: a step only when the text changes.
  test('only_a_changed_value_is_a_step', () => {
    const t = tracing.trace(
      'uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) }; uint32_t c{ b };',
      { runtime: false }
    );
    assert.deepEqual(
      t.steps.filter(step => step.line).map(step => [step.pane, step.op?.kind ?? null]),
      [
        ['uint8_t b = static_cast<uint8_t>(a)', null],
        ['uint8_t b = static_cast<uint8_t>(256)', 'read'],
        ['uint8_t b = 0', 'eval'],
        ['uint8_t b = 0', 'write'],
        ['uint32_t c = b', null],
        ['uint32_t c = 0', 'read'],
        ['uint32_t c = 0', 'write'],
      ]
    );
    assert.ok(!t.steps.some(step => 'types' in step));
    assert.ok(!t.variables.some(variable => 'type' in variable));
  });

  test('a_mismatch_is_not_shown', () => {
    throwsUnsupported(() => tracing.trace('int a = 5; int* p = a;', { runtime: false }), /cannot initialize/);
  });
});

describe('RuntimeConversionTests', () => {
  test('gdb_agrees_on_every_width_and_sign', () => {
    const t = tracing.trace(
      'int8_t a{ -3 }; uint16_t b = a; int c{ -200 }; ' +
        'int8_t d{ static_cast<int8_t>(c) }; uint64_t e = b; long f = d - 60; ' +
        'std::cout << b << std::endl; std::cout << f;'
    );
    assert.deepEqual(t.steps.at(-1)!.values, { a: -3, b: 65533, c: -200, d: 56, e: 65533, f: -4 });
    assert.equal(t.steps.at(-1)!.stdout, '65533\n-4');
    assert.deepEqual(Object.fromEntries(t.variables.map(v => [v.name, v.size])), {
      a: 1,
      b: 2,
      c: 4,
      d: 1,
      e: 8,
      f: 8,
    });
  });

  test('gdb_agrees_on_floats_void_pointers_and_sizeof', () => {
    const t = tracing.trace(
      'int seven = 7; double half = static_cast<double>(seven) / 2; float quarter = half / 2.0f; ' +
        'double negZero = -0.0; double big = 1000000.0; ' +
        'void* vp = &seven; int* ip = static_cast<int*>(vp); size_t sz = sizeof(*ip) + sizeof(double); ' +
        'std::cout << half << std::endl; std::cout << quarter << std::endl; ' +
        'std::cout << negZero << std::endl; std::cout << big << std::endl; std::cout << sz << std::endl;'
    );
    assert.deepEqual(t.steps.at(-1)!.values.half, 3.5);
    assert.deepEqual(t.steps.at(-1)!.values.quarter, 1.75);
    assert.equal(Object.is(t.steps.at(-1)!.values.negZero, -0), true);
    const reparsed = JSON.parse(dumpsSorted(t)) as ExecutionTrace;
    assert.equal(Object.is(reparsed.steps.at(-1)!.values.negZero, -0), true);
    assert.ok(svgText(0, 0, reparsed.steps.at(-1)!.values.negZero, 20, "#fff").includes(">-0</text>"));
    assert.deepEqual(t.steps.at(-1)!.values.big, 1000000);
    assert.deepEqual(t.steps.at(-1)!.values.sz, 12);
    assert.equal(t.steps.at(-1)!.targets.vp, 'seven');
    assert.equal(t.steps.at(-1)!.targets.ip, 'seven');
    assert.equal(t.steps.at(-1)!.stdout, '3.5\n1.75\n-0\n1e+06\n12\n');
  });

  test('float_precision_ties_truncation_and_subnormals', () => {
    const t = tracing.trace(
      'double d = 1.0000001; double q = d - 1.0; ' +
        'double tie = 123456.5; int negTrunc = static_cast<int>(-3.9); ' +
        'float f = 0.1f; double sub = 5e-324; double under = sub / 2.0; ' +
        'std::cout << tie << std::endl;'
    );
    const last = t.steps.at(-1)!;
    assert.equal(last.values.d, 1.0000001);
    assert.equal(last.values.q, 1.0000001 - 1.0);
    assert.equal(last.values.negTrunc, -3);
    assert.equal(last.values.f, Math.fround(0.1));
    assert.equal(last.values.sub, 5e-324);
    assert.equal(last.values.under, 0);
    const readStep = t.steps.find(s => s.op?.kind === 'read' && s.op.name === 'd')!;
    assert.equal(readStep.op?.kind === 'read' && readStep.op.value, '1.0000001');
  });
});

describe('BitsTests', () => {
  const bits = (source: string): ExecutionTrace => tracing.trace(source, { runtime: false, bits: true });

  test('bits_imply_types_and_mark_the_trace', () => {
    const t = bits('int8_t a{ -3 }; int b{ static_cast<int>(a) };');
    assert.equal(t.bits, true);
    assert.deepEqual(conversions(t, 1), [['int b = static_cast<int>(-3)', 'int b = -3', 'int8_t', 'int']]);
    assert.deepEqual(
      t.variables.map(v => [v.name, v.type]),
      [
        ['b', 'int'],
        ['a', 'int8_t'],
      ]
    );
  });

  test('bits_take_integer_variables_only', () => {
    throwsUnsupported(() => bits('int a{ 5 }; int* p{ &a };'), /integer variables only/);
    throwsUnsupported(() => bits('int a{ 5 }; int& r{ a };'), /integer variables only/);
    throwsUnsupported(() => bits('struct A { int x; }; A a{ 1 };'), /integer variables only/);
    throwsUnsupported(() => bits('double d{ 1.5 };'), /integer variables only/);
  });

  test('bits_resolve_every_standard_alias', () => {
    const t = bits('std::uint_fast16_t a{ 300 }; int8_t b{ static_cast<int8_t>(a) };');
    assert.deepEqual(
      t.variables.map(v => [v.name, v.size]),
      [
        ['b', 1],
        ['a', 8],
      ]
    );
  });

  test('bits_carry_the_integer_aliases_clang_resolved', () => {
    const t = bits('std::streamsize a{ 3 }; int b{ static_cast<int>(a) };');
    assert.deepEqual(t.integers, { streamsize: 'long' });
    assert.equal(bits('int8_t a{ -3 };').integers, undefined);
    assert.throws(() => validate({ ...t, integers: { streamsize: 'double' } }), FormatError);
    const { integers: _, ...unresolved } = t;
    assert.throws(() => validate(unresolved), FormatError);
  });

  test('integer_literals_parse_as_cpp_spells_them', () => {
    const cases: [string, bigint | null][] = [
      ['42', 42n],
      ['-200', -200n],
      ["1'000", 1000n],
      ['0x1234', 0x1234n],
      ['-0XfF', -255n],
      ['0b1010', 10n],
      ['017', 15n],
      ['0', 0n],
      ['42ull', 42n],
      ['7LLu', 7n],
      ['08', null],
      ["1'", null],
      ["0x'F", null],
      ["1''0", null],
      ['abc', null],
      ['1.5', null],
    ];
    for (const [spelling, value] of cases) assert.equal(integerLiteral(spelling), value, spelling);
  });

  test('a_bits_trace_types_and_converts_integers_only', () => {
    const t = bits('int8_t a{ -3 }; int b{ static_cast<int>(a) };');
    const at = t.steps.findIndex(step => step.op?.kind === 'convert');
    const withStep = (change: (step: any) => void): ExecutionTrace => {
      const copy = structuredClone(t);
      change(copy.steps[at]);
      return copy;
    };
    validate(t);
    assert.throws(() => validate(withStep(step => (step.op.value = 'minus three'))), FormatError);
    assert.throws(() => validate(withStep(step => (step.op.to = 'double'))), FormatError);
    assert.throws(() => validate(withStep(step => (step.types[0].type = 'bool'))), FormatError);
    assert.throws(() => validate(withStep(step => (step.op.value = '-4'))), FormatError);
  });

  test('a_bits_trace_with_a_pointer_is_invalid', () => {
    const t = tracing.trace('int a{ 5 }; int* p{ &a };', { runtime: false, types: true });
    assert.throws(() => validate({ ...t, bits: true }), FormatError);
    assert.throws(() => validate({ ...bits('int a{ 5 };'), bits: false }), FormatError);
  });
});
