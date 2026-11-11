// The unified trace format: validation, the committed fixtures and the trace command.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from '../json_format.mjs';
import * as fixtures from '../player/fixtures.mjs';
import { FORMAT, FormatError, scalar, validate } from '../trace_format.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function replaceText(steps, oldText, newText) {
  for (const step of steps) {
    const at = step.pane.indexOf(oldText);
    step.pane = step.pane.replace(oldText, newText);
    const op = step.op || {};
    if (Object.hasOwn(op, 'value')) {
      op.value = op.value.replace(oldText, newText);
    }
    if (op.kind === 'write' || op.kind === 'print') {
      for (const key of ['span', 'destination']) {
        if (Object.hasOwn(op, key) && op[key][1] > at) {
          op[key] = [op[key][0], op[key][1] + newText.length - oldText.length];
        }
      }
    }
  }
}

describe('FixtureTests', () => {
  test('committed_fixtures_are_current_and_valid', () => {
    const rendered = fixtures.render();
    const files = readdirSync(fixtures.FIXTURES)
      .filter(f => f.endsWith('.json'))
      .sort();
    assert.deepEqual(Object.keys(rendered).sort(), files);
    for (const [name, content] of Object.entries(rendered)) {
      assert.equal(
        readFileSync(join(fixtures.FIXTURES, name), 'utf8'),
        content,
        'run node visualizations/player/fixtures.mjs'
      );
      validate(JSON.parse(content));
    }
  });

  test('pointer_chain_reduces_in_lesson_notation', () => {
    const trace = fixtures.double_pointer();
    const panes = trace.steps.filter(step => step.line === 4).map(step => step.pane);
    assert.deepEqual(panes, [
      '**pp = 7',
      '**72 = 7',
      '*p = 7',
      '*64 = 7',
      'a = 7',
      'a = 7',
    ]);
    assert.deepEqual(trace.steps[trace.steps.length - 1].targets, { p: 'b', pp: 'p' });
  });

  test('struct_copy_copies_pointer_targets', () => {
    const trace = fixtures.shallow_copy();
    const copied = trace.steps.find(step => step.op && step.op.name === 's2');
    assert.deepEqual(copied.targets, { 's1.pa': 's1.a', 's2.pa': 's1.a' });
    assert.equal(trace.steps[1].values['s1.pa'], 0);
  });
});

describe('ValidationTests', () => {
  function rejects(baseTrace, message, change) {
    const broken = structuredClone(baseTrace);
    change(broken);
    assert.throws(
      () => validate(broken),
      err => err instanceof FormatError && new RegExp(message).test(err.message)
    );
  }

  test('accepts_a_fixture', () => {
    validate(fixtures.write_through());
  });

  test('rejects_other_versions_and_unknown_keys', () => {
    const trace = fixtures.write_through();
    rejects(trace, 'format', t => {
      t.format = 2;
    });
    rejects(trace, 'unknown', t => {
      t.colour = 'red';
    });
    rejects(trace, 'unknown', t => {
      t.steps[0].extra = 1;
    });
  });

  test('rejects_inconsistent_storage', () => {
    const trace = fixtures.write_through();
    rejects(trace, 'overlap', t => {
      t.variables[1].address = 66;
    });
    rejects(trace, 'expected exactly', t => {
      delete t.steps[2].values.b;
    });
    rejects(trace, 'only a write', t => {
      for (const s of t.steps.slice(3)) {
        s.values.a = 9;
      }
    });
    rejects(trace, 'only pointers', t => {
      t.steps[t.steps.length - 1].targets.a = 'b';
    });
  });

  test('rejects_operations_that_disagree_with_the_pane', () => {
    const trace = fixtures.write_through();
    const read = trace.steps.findIndex(s => s.op?.kind === 'read');
    rejects(trace, 'replacement', t => {
      t.steps[read].op.value = '3';
    });
    rejects(trace, 'replace', t => {
      t.steps[read].op.span = [0, 2];
    });
    const deref = read + 1;
    rejects(trace, 'pointer', t => {
      t.steps[deref].op.via = 'a';
    });
    rejects(trace, 'first step', t => {
      t.steps[0].op = { kind: 'eval' };
    });
  });

  test('rejects_output_without_print', () => {
    const trace = fixtures.write_through();
    rejects(trace, 'only a print', t => {
      t.steps[t.steps.length - 1].op = null;
    });
  });

  function withNewline(baseTrace, spelling, printed = '\n') {
    const trace = structuredClone(baseTrace);
    const pane = 'std::cout << ' + spelling;
    const last = trace.steps[trace.steps.length - 1];
    const span = [13, pane.length];
    trace.source.push(pane + ';');
    const shown = {
      ...last,
      line: last.line + 1,
      pane,
      op: null,
      expr: span,
      hold: 1,
    };
    trace.steps.push(shown, {
      ...shown,
      stdout: last.stdout + printed,
      op: { kind: 'print', value: printed, span },
    });
    return trace;
  }

  test('whitespace_output_prints_as_it_is_spelled', () => {
    const base = fixtures.write_through();
    for (const [spelling, printed] of [
      ['std::endl', '\n'],
      ["'\\n'", '\n'],
      ["' '", ' '],
    ]) {
      validate(withNewline(base, spelling, printed));
    }
    for (const [spelling, printed] of [
      ['std::endl', ' '],
      ['std::flush', '\n'],
      ['"\\n"', '\n'],
    ]) {
      assert.throws(
        () => validate(withNewline(base, spelling, printed)),
        err => err instanceof FormatError && /does not cover/.test(err.message)
      );
    }
    const nlTrace = withNewline(base, 'std::endl');
    rejects(nlTrace, 'stdout must grow', t => {
      t.steps[t.steps.length - 1].stdout = t.steps[t.steps.length - 2].stdout + ' ';
    });
  });
});

describe('OperationValueTests', () => {
  function rejects(trace, message, change) {
    const broken = structuredClone(trace);
    change(broken.steps);
    assert.throws(
      () => validate(broken),
      err => err instanceof FormatError && new RegExp(message).test(err.message)
    );
  }

  test('rejects_a_write_that_memory_contradicts', () => {
    const trace = {
      format: 1,
      source: ['int a = 5;'],
      variables: [scalar('a', 64)],
      steps: [
        {
          line: 0,
          pane: 'int a = 5',
          values: { a: null },
          targets: {},
          stdout: '',
          hold: 1,
          op: null,
        },
        {
          line: 0,
          pane: 'int a = 5',
          values: { a: 999 },
          targets: {},
          stdout: '',
          hold: 1,
          op: { kind: 'write', name: 'a', value: '5', span: [8, 9], destination: [4, 5] },
        },
      ],
    };
    rejects(trace, 'a holds 999 after the write, not .5.', () => {});
    trace.steps[1].values.a = 5;
    validate(trace);
  });

  test('rejects_a_struct_copy_that_memory_contradicts_field_by_field', () => {
    const trace = fixtures.copy_assignment();
    const write = trace.steps.findIndex(s => s.op?.name === 'b');
    rejects(trace, 'b holds \\{5, 9\\} after the write, not .\\{5, 6\\}.', steps => {
      for (const step of steps.slice(write)) {
        step.values['b.f2'] = 9;
      }
    });
    rejects(trace, 'a holds \\{5, 6\\} before the read, not .\\{5\\}.', steps => {
      replaceText(steps.slice(write - 1, write + 1), '{5, 6}', '{5}');
    });
  });

  test('null_pointers_are_stored_as_zero', () => {
    const trace = fixtures.shallow_copy();
    assert.equal(trace.steps[1].op.value, '{nullptr, 1}');
    assert.equal(trace.steps[1].values['s1.pa'], 0);
    rejects(trace, 's1 holds \\{\\?, 1\\} after the write, not .\\{nullptr, 1\\}.', steps => {
      steps[1].values['s1.pa'] = '?';
    });
  });

  test('rejects_text_that_is_not_a_value', () => {
    const trace = fixtures.write_through();
    rejects(trace, 'is not a value', steps => {
      replaceText(steps.slice(0, 2), '1', 'one');
    });
  });

  test('rejects_a_read_that_memory_contradicts', () => {
    const trace = fixtures.write_through();
    const read = 6;
    assert.equal(trace.steps[read].op.kind, 'read');
    rejects(trace, 'b holds 64 before the read, not .68.', steps => {
      replaceText(steps.slice(read, read + 1), '64', '68');
    });
  });

  test('rejects_a_wrong_address', () => {
    const trace = fixtures.write_through();
    const addr = 3;
    assert.equal(trace.steps[addr].op.kind, 'addr');
    rejects(trace, 'the address of a is 64, not .68.', steps => {
      replaceText(steps.slice(addr, addr + 1), '64', '68');
    });
  });

  test('rejects_a_dereference_to_somewhere_else', () => {
    const trace = fixtures.reassign();
    const deref = trace.steps.findIndex(s => s.op?.kind === 'deref');
    rejects(trace, 'p does not point to b', steps => {
      steps[deref].op.target = 'b';
      steps[deref].pane = steps[deref].pane.replace('a', 'b');
    });
  });

  test('rejects_targets_that_disagree_with_pointer_values', () => {
    const trace = fixtures.write_through();
    rejects(trace, 'b holds 68, but a is at 64', steps => {
      for (const step of steps.slice(4)) {
        step.values.b = 68;
      }
    });
    rejects(trace, 'b holds the address 64 but points nowhere', steps => {
      for (const step of steps.slice(4)) {
        step.targets = {};
      }
    });
    rejects(trace, 'only pointers', steps => {
      steps[steps.length - 1].targets.a = 'b';
    });
  });
});

describe('LayoutValidationTests', () => {
  function layout(size, alignment, ...fields) {
    return {
      format: FORMAT,
      kind: 'layout',
      records: [
        {
          name: 'A',
          size,
          alignment,
          fields: fields.map(([name, offset, width]) => ({
            name,
            offset,
            size: width,
            kind: 'int',
            type: width === 4 ? 'int' : 'uint8_t',
          })),
        },
      ],
    };
  }

  test('accepts_exact_padding', () => {
    validate(layout(12, 4, ['a', 0, 1], ['b', 4, 4], ['c', 8, 1]));
  });

  test('rejects_impossible_padding', () => {
    const cases = {
      leading: [layout(8, 4, ['x', 4, 4]), 'must start at offset 0'],
      internal: [layout(12, 4, ['a', 0, 1], ['b', 8, 4]), 'must start at offset 4'],
      trailing: [layout(12, 4, ['x', 0, 4]), 'size must be 4'],
      alignment: [layout(8, 8, ['a', 0, 4], ['b', 4, 4]), 'alignment must be 4'],
    };
    for (const [, [trace, message]] of Object.entries(cases)) {
      assert.throws(
        () => validate(trace),
        err => err instanceof FormatError && new RegExp(message).test(err.message)
      );
    }
  });
});

describe('GenerateCommandTests', () => {
  function runGenerate(operation, source) {
    const tmp = mkdtempSync(join(tmpdir(), 'course-gen-cmd-'));
    try {
      const path = join(tmp, 'test.cpp');
      writeFileSync(path, source);
      return execFileSync(process.execPath, [join(ROOT, 'generate.mjs'), operation, '--source', path], {
        encoding: 'utf8',
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  test('trace_prints_the_unified_format_deterministically', () => {
    const output = runGenerate(
      'trace',
      'int a = 5;\nint b = a + 6;\na = 7;\nstd::cout << b << std::endl;\n'
    );
    const trace = JSON.parse(output);
    validate(trace);
    assert.equal(output.trim(), dumpsSorted(trace));
    assert.equal(trace.steps[trace.steps.length - 1].stdout, '11\n');
  });

  test('pointer_traces_are_byte_identical', () => {
    const source = 'int a = 5;\nint* p = &a;\nint* q = p;\n*q = 6;\nstd::cout << *p << std::endl;\n';
    const first = runGenerate('trace', source);
    const second = runGenerate('trace', source);
    assert.equal(first, second);
    const parsed = JSON.parse(first);
    assert.deepEqual(parsed.steps[parsed.steps.length - 1].targets, { p: 'a', q: 'a' });
  });

  test('probe_names_the_reason', () => {
    const supported = JSON.parse(runGenerate('probe', 'int a{1};\nint* p{&a};\n*p = 2;\n'));
    assert.deepEqual(supported, { supported: true, template: 'expression-timeline' });
    const rejected = JSON.parse(
      runGenerate('probe', 'int a{1};\nint* p{&a};\nint* q = p + 1;\n')
    );
    assert.deepEqual(rejected, {
      supported: false,
      reason: 'pointer arithmetic and comparison are not supported',
    });
  });
});
