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
import { displayFloat, formatFloat } from '../src/core/floats.ts';
import { text as svgText } from '../src/player/svg.ts';
import * as tracing from '../src/node/tracing.ts';
import { INTEGERS, IllFormed, NeedsFlag, Unsupported } from '../src/node/tracing.ts';
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
    const wrapped = tracing.trace('unsigned int n = 0; n -= 1;');
    assert.equal(wrapped.steps.at(-1)!.values.n, 4294967295);
    throwsUnsupported(() => tracing.trace('int n = 2147483647; n += 1;'), /signed integer overflow/);
  });
});

describe('ConversionTests', () => {
  const trace = (source: string): ExecutionTrace =>
    tracing.trace(source, { types: true });
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
      'uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) }; uint32_t c{ b };'
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

  test('a_mismatch_is_not_shown_but_suggests_types', () => {
    assert.throws(
      () => tracing.trace('int a = 5; int* p = a;'),
      (err: unknown) =>
        err instanceof NeedsFlag && err.flag === 'types' && /cannot initialize.*with types on/.test(err.message)
    );
    // An error types cannot show stays a plain compile error.
    assert.throws(
      () => tracing.trace('int a = b;'),
      (err: unknown) => err instanceof IllFormed && !(err instanceof NeedsFlag)
    );
  });

  test('the_types_probe_honours_the_callers_checks', () => {
    assert.throws(
      () => tracing.trace('int a = 5; int* p = a;'),
      (err: unknown) => err instanceof NeedsFlag && /\(--types\)/.test(err.message)
    );
    const refuse = (): void => {
      throw new Unsupported('too many variables');
    };
    assert.throws(
      () => tracing.trace('int a = 5; int* p = a;', { accept: refuse }),
      (err: unknown) => err instanceof IllFormed && !(err instanceof NeedsFlag)
    );
  });
});

describe('FloatFormatTests', () => {
  test('cout_rounds_exact_ties_to_even', () => {
    const cases: Record<string, number> = {
      '123456': 123456.5,
      '123458': 123457.5,
      '100000': 100000.5,
      '1e+06': 999999.5,
      '1.23456e+06': 1234565,
      '1.23458e+06': 1234575,
      '123457': 123456.50000001,
      '0.123456': 0.1234565,
      '-123456': -123456.5,
      '4.94066e-324': 5e-324,
      '1e-05': 0.00001,
      '-0': -0,
    };
    for (const [printed, value] of Object.entries(cases)) {
      assert.equal(formatFloat(value), printed, String(value));
    }
  });

  test('cells_show_the_shortest_decimal_up_to_eight_digits', () => {
    const cases: [number, number, string][] = [
      [Math.fround(0.1), 4, '0.1'],
      [Math.fround(1 / 3), 4, '0.33333334'],
      [0.1 + 0.2, 8, '≈0.3'],
      [1 / 3, 8, '≈0.33333333'],
      [1.0000001, 8, '1.0000001'],
      [123456789012, 8, '123456789012'],
      [5e-324, 8, '5e-324'],
      [-0, 4, '-0'],
      // At a power of two the decimal nearest the float misses it; its neighbour reads back.
      [2 ** -96, 4, '1.2621775e-29'],
      [1e20, 8, '1e+20'],
      // A whole number keeps its digits unless fewer read back as it.
      [Math.fround(1e15), 4, '1e+15'],
      [1e15, 8, '1e+15'],
      [123456789, 8, '123456789'],
      [3, 4, '3'],
      [Math.fround(16777217), 4, '16777216'],
      [123456789012345680000, 8, '≈1.2345679e+20'],
    ];
    for (const [value, size, shown] of cases) assert.equal(displayFloat(value, size), shown, String(value));
    const t = tracing.trace('float f = 0.1f; double c = 0.1 + 0.2; float g = f;');
    const texts = t.steps.flatMap(s => (s.op && 'value' in s.op ? [`${s.op.kind} ${s.op.value}`] : []));
    assert.ok(texts.includes('eval ≈0.3') && texts.includes('read 0.1'), texts.join('; '));
    assert.deepEqual(
      t.variables.map(v => [v.name, 'floating' in v && v.floating]),
      [
        ['g', true],
        ['c', true],
        ['f', true],
      ]
    );
    validate(t);
  });

  test('validation_compares_floating_values_exactly', () => {
    const t = tracing.trace('double d = 1.0000001; double e = d;');
    validate(t);
    const read = (value: string): ExecutionTrace => {
      const copy = structuredClone(t);
      const step = copy.steps.find(s => s.op?.kind === 'read' && s.op.name === 'd')!;
      (step.op as { value: string }).value = value;
      return copy;
    };
    // 1.00000012 is another double that rounds to the same float.
    assert.throws(() => validate(read('1.00000012')), FormatError);
  });

  /** `trace` with the value `from` spelled `to`, its spans moved to match. */
  function respelled(trace: ExecutionTrace, from: string, to: string): ExecutionTrace {
    const copy = structuredClone(trace);
    const shift = (pane: string) => {
      const at = pane.indexOf(from);
      return ([start, end]: [number, number]): [number, number] =>
        [start, end].map(x => (at >= 0 && x > at ? x + to.length - from.length : x)) as [number, number];
    };
    copy.steps.forEach((step, i) => {
      const now = shift(trace.steps[i].pane);
      const before = shift(trace.steps[Math.max(0, i - 1)].pane);
      if (step.expr) step.expr = now(step.expr);
      for (const part of step.types ?? []) part.span = now(part.span);
      const op = step.op as { kind: string; span?: [number, number]; destination?: [number, number]; value?: string } | null;
      if (op?.span) op.span = op.kind === 'write' ? now(op.span) : before(op.span);
      if (op?.destination) op.destination = now(op.destination);
      if (op?.value === from) op.value = to;
      step.pane = step.pane.replace(from, to);
    });
    assert.notDeepEqual(copy, trace);
    return copy;
  }

  test('validation_rejects_values_a_cell_cannot_hold', () => {
    const t = tracing.trace('float f = 0; int i = 1; float g = f;');
    validate(t);
    const broken = (change: (copy: ExecutionTrace) => void): ExecutionTrace => {
      const copy = structuredClone(t);
      change(copy);
      return copy;
    };
    const last = (copy: ExecutionTrace): ExecutionTrace['steps'][number] => copy.steps.at(-1)!;
    const rejects = (copy: ExecutionTrace, message: RegExp): void => {
      assert.throws(() => validate(copy), (err: unknown) => err instanceof FormatError && message.test(err.message));
    };
    rejects(broken(copy => (last(copy).values.f = 16777217)), /4-byte floating value/);
    rejects(broken(copy => (last(copy).values.i = 0.5)), /a value is an integer/);
    const everywhere = (copy: ExecutionTrace, name: string, value: number): void => {
      for (const step of copy.steps) if (typeof step.values[name] === 'number') step.values[name] = value;
    };
    rejects(broken(copy => everywhere(copy, 'i', 2 ** 32)), /4294967296 does not fit in 4 bytes/);
    const bits = tracing.trace('uint8_t a = 255;', { bits: true });
    validate(bits);
    const wide = structuredClone(bits);
    everywhere(wide, 'a', 256);
    rejects(wide, /256 does not fit in uint8_t/);
    const typed = tracing.trace('long n = 2147483648L;', { types: true });
    validate(typed);
    const narrowed = structuredClone(typed);
    (narrowed.variables[0] as { type?: string }).type = 'int';
    rejects(narrowed, /int is not 8 bytes/);
    const declared = tracing.trace('int n;', { types: true });
    validate(declared);
    const widened = structuredClone(declared);
    (widened.variables[0] as { type?: string }).type = 'long';
    rejects(widened, /long is not 4 bytes/);
    // Older traces spell a whole float with all its digits; that still reads back exactly.
    const whole = tracing.trace('float f = 1e15f; float g = f;');
    validate(respelled(whole, '1e+15', '999999986991104'));
    // A floating zero is no null pointer: the read of f may not say nullptr.
    rejects(
      broken(copy => {
        const index = copy.steps.findIndex(s => s.op?.kind === 'read');
        copy.steps = copy.steps.slice(0, index + 1);
        const step = copy.steps[index];
        (step.op as { value: string }).value = 'nullptr';
        step.pane = step.pane.replace(/0$/, 'nullptr');
      }),
      /f holds 0 before the read/
    );
  });
});

describe('RuntimeConversionTests', () => {
  test('compiler_agrees_on_every_width_and_sign', () => {
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

  test('compiler_agrees_on_floats_void_pointers_and_sizeof', () => {
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
    assert.equal(last.stdout, '123456\n');
    const readStep = t.steps.find(s => s.op?.kind === 'read' && s.op.name === 'd')!;
    assert.equal(readStep.op?.kind === 'read' && readStep.op.value, '1.0000001');
  });

  test('compiler_agrees_on_rounded_ties', () => {
    const t = tracing.trace(
      'double a = 100000.5; double b = 1234565.0; double c = 1234575.0; double d = 999999.5; ' +
        'std::cout << a << std::endl; std::cout << b << std::endl; ' +
        'std::cout << c << std::endl; std::cout << d << std::endl;'
    );
    assert.equal(t.steps.at(-1)!.stdout, '100000\n1.23456e+06\n1.23458e+06\n1e+06\n');
  });

  test('type_punning_is_rejected_before_execution', () => {
    throwsUnsupported(
      () => tracing.trace('int a = 42; void* p = &a; float* q = static_cast<float*>(p); float y = *q;'),
      /dereferencing a pointer to float when a holds int/
    );
  });
});

describe('BitsTests', () => {
  const bits = (source: string): ExecutionTrace => tracing.trace(source, { bits: true });

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
    const t = tracing.trace('int a{ 5 }; int* p{ &a };', { types: true });
    assert.throws(() => validate({ ...t, bits: true }), FormatError);
    assert.throws(() => validate({ ...bits('int a{ 5 };'), bits: false }), FormatError);
  });
});
