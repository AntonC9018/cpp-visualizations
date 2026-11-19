// Types in the pane: every name, literal and value carries its type, a declaration its slot.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  type ClashOperation,
  type ExecutionTrace,
  FormatError,
  type TraceStep,
  validate,
} from '../src/core/trace_format.ts';
import { discover, scanDocument } from '../src/node/discover.ts';
import * as tracing from '../src/node/tracing.ts';
import { Unsupported } from '../src/node/tracing.ts';

/** A step's typed parts as text: `int* p` is the slot `int* p:int*!`. */
function typed(step: TraceStep): string[] {
  return (step.types ?? []).map(
    part => step.pane.slice(...part.span) + ':' + part.type + (part.slot ? '!' : '')
  );
}

function lines(trace: ExecutionTrace, line: number): string[][] {
  return trace.steps.filter(step => step.line === line).map(typed);
}

const traceTyped = (source: string): ExecutionTrace =>
  tracing.trace(source, { runtime: false, types: true });

describe('TypedPaneTests', () => {
  test('names_literals_and_values_carry_their_types', () => {
    const trace = traceTyped('int a = 5; int b = a + 6; std::cout << b;');
    assert.deepEqual(lines(trace, 1), [
      ['int b:int!', 'a:int', '6:int'],
      ['int b:int!', '5:int', '6:int'],
      ['int b:int!', '11:int'],
      ['int b:int!', '11:int'],
    ]);
    assert.deepEqual(lines(trace, 2), [['b:int'], ['11:int'], ['11:int']]);
  });

  test('an_address_and_a_dereference_change_the_type', () => {
    const trace = traceTyped('int a = 5; int* p = &a; *p = 6;');
    assert.deepEqual(lines(trace, 1).slice(0, 2), [
      ['int* p:int*!', 'a:int'],
      ['int* p:int*!', '76:int*'],
    ]);
    assert.deepEqual(lines(trace, 2).slice(0, 3), [
      ['p:int*', '6:int'],
      ['76:int*', '6:int'],
      ['a:int', '6:int'],
    ]);
  });

  test('a_declaration_slot_shows_the_deduced_type', () => {
    const trace = traceTyped('int a = 5; auto p = &a; int b;');
    assert.equal(lines(trace, 1)[0][0], 'auto p:int*!');
    assert.deepEqual(lines(trace, 2), [['int b:int!']]);
    assert.deepEqual(
      Object.fromEntries(trace.variables.map(v => [v.name, v.type])),
      { a: 'int', p: 'int*', b: 'int' }
    );
  });

  test('a_struct_value_and_a_field_are_one_typed_part', () => {
    const trace = traceTyped('struct A { int f; int g; }; A a{ 1, 2 }; A b = a; A* p = &a; p->g = a.f;');
    assert.deepEqual(lines(trace, 0)[0], ['A a:A!', '{ 1, 2 }:A']);
    assert.deepEqual(lines(trace, 1)[1], ['A b:A!', 'A{1, 2}:A']);
    assert.deepEqual(lines(trace, 3).slice(0, 4), [
      ['p:A*', 'a.f:int'],
      ['p:A*', '1:int'],
      ['80:A*', '1:int'],
      ['a.g:int', '1:int'],
    ]);
  });

  test('a_reference_keeps_the_type_of_what_it_names', () => {
    const trace = traceTyped('struct A { int f; }; A s{ 1 }; A& r = s; r.f = 2;');
    assert.deepEqual(lines(trace, 1), [
      ['A& r:A&!', 's:A'],
      ['A& r:A&!', 's:A'],
    ]);
    assert.deepEqual(lines(trace, 2).slice(0, 2), [
      ['r.f:int', '2:int'],
      ['s.f:int', '2:int'],
    ]);
  });

  test('a_reference_declaration_is_its_slot', () => {
    const trace = traceTyped('int a{ 5 }; int& r{ a };');
    assert.deepEqual(lines(trace, 1), [
      ['int& r:int&!', 'a:int'],
      ['int& r:int&!', 'a:int'],
    ]);
    assert.equal(trace.steps.at(-1)!.op?.kind, 'bind');
    assert.deepEqual(trace.variables.map(v => v.name), ['a']);
  });

  test('null_pointers', () => {
    const trace = traceTyped('int* p{}; p = nullptr;');
    assert.deepEqual(lines(trace, 0).slice(0, 2), [['int* p:int*!'], ['int* p:int*!', '0:int*']]);
    assert.deepEqual(lines(trace, 1).slice(0, 2), [
      ['p:int*', 'nullptr:nullptr_t'],
      ['p:int*', '0:int*'],
    ]);
  });
});

describe('MismatchTests', () => {
  // A last statement whose value does not fit its slot is shown as a clash, not run.
  function clash(source: string): [ExecutionTrace, TraceStep] {
    const trace = traceTyped(source);
    const [written, last] = trace.steps.slice(-2);
    assert.equal(written.op, null);
    assert.equal(written.pane, last.pane);
    assert.equal(last.line, trace.source.length - 1);
    return [trace, last];
  }
  const fromTo = (step: TraceStep): [string, string] => {
    const op = step.op as ClashOperation;
    return [op.from, op.to];
  };

  test('a_declaration_with_the_wrong_pointer_depth', () => {
    const [trace, last] = clash('struct A { int f; }; A a{ 1 }; A* value{ &a }; A** p{ value };');
    assert.deepEqual(typed(last), ['A** p:A**!', 'value:A*']);
    assert.deepEqual(fromTo(last), ['A*', 'A**']);
    assert.equal(trace.source.at(-1), 'A** p{ value };');
    assert.deepEqual(new Set(trace.variables.map(v => v.name)), new Set(['a', 'value']));
    assert.deepEqual(last.values, trace.steps.at(-3)!.values);
  });

  test('an_initializer_after_the_equals_sign', () => {
    const [, last] = clash('int a = 5; int* p = a; return 0;');
    assert.deepEqual(typed(last), ['int* p:int*!', 'a:int']);
  });

  test('an_assignment', () => {
    const [, last] = clash('int a = 5; int* p = &a; *p = &a;');
    assert.deepEqual(typed(last), ['*p:int!', '&a:int*']);
  });

  test('unrelated_structs', () => {
    const [, last] = clash('struct A { int f; }; struct B { int f; }; A a{ 1 }; B b = a;');
    assert.deepEqual(typed(last), ['B b:B!', 'a:A']);
  });

  test('an_assignment_to_a_struct', () => {
    const cases: Record<string, string[]> = {
      'A* p{ &a }; A copy{}; copy = p;': ['copy:A!', 'p:A*'],
      'A copy{}; copy = &a;': ['copy:A!', '&a:A*'],
      'A* p{ &a }; *p = 8;': ['*p:A!', '8:int'],
    };
    for (const [source, expected] of Object.entries(cases)) {
      const [, last] = clash('struct A { int f; }; A a{ 5 }; ' + source);
      assert.deepEqual(typed(last), expected, source);
    }
  });

  test('aliases_keep_their_names', () => {
    const [, last] = clash('size_t count{ 3 }; int8_t* p{}; p = &count;');
    assert.deepEqual(typed(last), ['p:int8_t*!', '&count:size_t*']);
  });

  test('only_the_last_statement_may_fail', () => {
    for (const source of ['int a = 5; int* p = a; int b = 6;', 'int a = 5; int* p = b;', 'int* p = 5;']) {
      assert.throws(() => traceTyped(source), Unsupported, source);
    }
  });

  test('a_clash_must_match_the_typed_pane', () => {
    const [trace] = clash('int a = 5; int* p = a;');
    const edits: ((op: ClashOperation) => void)[] = [
      op => (op.to = 'int'),
      op => (op.span = [0, 1]),
      op => (op.from = 'int*'),
      op => (op.destination = [0, 3]),
    ];
    for (const edit of edits) {
      const broken = structuredClone(trace);
      edit(broken.steps.at(-1)!.op as ClashOperation);
      assert.throws(() => validate(broken), FormatError);
    }
    const broken = structuredClone(trace);
    broken.steps.push(structuredClone(broken.steps.at(-2)!));
    assert.throws(() => validate(broken), FormatError);
  });
});

describe('TypedFixtureTests', () => {
  // The player test draws this trace: a conversion that keeps its digits, one that does not,
  // and a last statement whose types do not fit.
  test('generated_typed_fixture_is_current', () => {
    const path = new URL('fixtures/types-generated.json', import.meta.url);
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as ExecutionTrace;
    assert.deepEqual(tracing.trace(fixture.source.join('\n'), { types: true }), fixture);
  });
});

describe('TypeValidationTests', () => {
  const trace = traceTyped('int a = 5; int b = a;');

  function broken(edit: (t: ExecutionTrace) => void): void {
    const copy = structuredClone(trace);
    edit(copy);
    assert.throws(() => validate(copy), FormatError);
  }

  test('rejects_malformed_typed_parts', () => {
    broken(t => t.steps[0].types!.reverse());
    broken(t => (t.steps[0].types![0].span = [0, 99]));
    broken(t => (t.steps[0].types![0].type = ''));
    broken(t => (t.steps[0].types![1].slot = true));
    broken(t => (t.steps[0].types = []));
    broken(t => ((t.variables[0] as unknown as { type: number }).type = 4));
  });

  test('types_are_optional', () => {
    const copy = structuredClone(trace);
    for (const step of copy.steps) delete step.types;
    for (const variable of copy.variables) delete (variable as { type?: string }).type;
    validate(copy);
  });
});

describe('TypesTagTests', () => {
  const SOURCE = 'int a{ 5 };';
  const document = (marker: string): string =>
    '```cpp\n' + SOURCE + '\n```\n<details>\n<summary>Trace</summary>\n\n' + marker + '\n\n</details>\n';

  test('the_types_attribute_alone_and_after_a_template', () => {
    const cases: [string, string | null, boolean][] = [
      ['<visualization>', null, false],
      ['<visualization types>', null, true],
      ['<visualization template="memory" types>', 'memory', true],
      ['<visualization\n  types >', null, true],
    ];
    for (const [opening, template, types] of cases) {
      const result = scanDocument(document(`<!-- ${opening} -->\n<!-- </visualization> -->`));
      assert.deepEqual(result.errors, [], opening);
      assert.deepEqual([result.tags[0].template, result.tags[0].flags], [template, types ? ['types'] : []], opening);
    }
  });

  test('a_misplaced_or_valued_types_attribute_is_an_error', () => {
    for (const opening of ['<visualization types template="a">', '<visualization types="yes">']) {
      const result = scanDocument(document(`<!-- ${opening} -->\n<!-- </visualization> -->`));
      assert.ok(result.errors.length > 0, opening);
    }
  });
});

describe('DiscoverTypesHintTests', () => {
  test('a_refused_tag_says_why_and_names_the_flag', () => {
    const repo = mkdtempSync(join(tmpdir(), 'discover-'));
    try {
      writeFileSync(join(repo, 'course-publishing.json'), JSON.stringify({ visualizations: { roots: ['labs'] } }));
      mkdirSync(join(repo, 'labs'));
      writeFileSync(join(repo, 'labs', 'a.md'), '# A\n\n```cpp\nint a = 5;\nint* p = a;\n```\n');
      assert.throws(
        () => discover(repo, { tag: ['labs/a.md:3'] }),
        (err: unknown) => err instanceof Error && /labs\/a\.md:3 \(.*\(--types\)/.test(err.message)
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('every_refused_tag_says_why', () => {
    const repo = mkdtempSync(join(tmpdir(), 'discover-'));
    try {
      writeFileSync(join(repo, 'course-publishing.json'), JSON.stringify({ visualizations: { roots: ['labs'] } }));
      mkdirSync(join(repo, 'labs'));
      writeFileSync(join(repo, 'labs', 'a.md'), '# A\n\n```cpp\nint a = 5;\nint b = a;\n```\n\n```python\na = 5\n```\n');
      const refusal = (line: number): RegExp => new RegExp(`labs/a\\.md:${line} \\(([^)]*)\\)`);
      const reason = (line: number): string => {
        try {
          discover(repo, { tag: [`labs/a.md:${line}`] });
        } catch (err) {
          return (err as Error).message.match(refusal(line))?.[1] ?? (err as Error).message;
        }
        return 'accepted';
      };
      assert.equal(reason(8), 'not a C++ fence');
      assert.equal(reason(1), 'no code fence starts on this line');
      assert.equal(reason(3), 'accepted');
      assert.equal(reason(3), 'already has a visualization tag');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
