// References: a second name for storage, bound once and drawn without storage of its own.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Cell } from '../execution.mjs';
import * as generate from '../generate.mjs';
import { FormatError, validate } from '../trace_format.mjs';
import * as tracing from '../tracing.mjs';
import { Unsupported } from '../tracing.mjs';

const SOURCE = `struct A { int f; };
int a = 5; int b{1}; int& c = a; auto& d{ c }; c = b; int* p = &c; int& e = *p;
A s{1}; A& rs = s; int& rf = rs.f; rf = 4; int*& rp = p; *rp = 3; const int& k = a;
b = k + c; std::cout << d;`;

function panes(result, line) {
  return result.steps
    .filter(step => step.line === line)
    .map(step => [step.pane, step.op?.kind ?? null]);
}

describe('ReferenceTraceTests', () => {
  const result = tracing.trace(SOURCE);

  test('a_reference_has_no_storage_and_is_bound_once', () => {
    generate.applicable(result, SOURCE);
    assert.deepEqual(
      result.references.map(item => item.name),
      ['c', 'd', 'e', 'rs', 'rf', 'rp', 'k']
    );
    assert.deepEqual(
      result.variables.map(v => [v.name, v.address]),
      [
        ['s', 68],
        ['p', 72],
        ['b', 80],
        ['a', 84],
      ]
    );
    const last = result.steps[result.steps.length - 1];
    assert.deepEqual(last.refs, {
      c: 'a',
      d: 'a',
      e: 'a',
      rs: 's',
      rf: 's.f',
      rp: 'p',
      k: 'a',
    });
    assert.equal(last.stdout, '3');
    assert.ok(!Object.hasOwn(last.values, 'c'));
  });

  test('one_variable_and_its_reference_are_worth_showing', () => {
    const source = 'int a{ 5 }; int& b{ a }; std::cout << b;';
    generate.applicable(tracing.trace(source), source);
  });

  test('binding_resolves_the_initializer_to_storage', () => {
    assert.deepEqual(panes(result, 2), [
      ['int& c = a', null],
      ['int& c = a', 'bind'],
    ]);
    assert.deepEqual(panes(result, 3), [
      ['auto& d = c', null],
      ['auto& d = a', 'alias'],
      ['auto& d = a', 'bind'],
    ]);
    assert.deepEqual(panes(result, 6), [
      ['int& e = *p', null],
      ['int& e = *84', 'read'],
      ['int& e = a', 'deref'],
      ['int& e = a', 'bind'],
    ]);
    assert.deepEqual(panes(result, 9).slice(1), [
      ['int& rf = s.f', 'alias'],
      ['int& rf = s.f', 'bind'],
    ]);
  });

  test('a_used_reference_becomes_the_name_it_stands_for', () => {
    assert.deepEqual(panes(result, 4), [
      ['c = b', null],
      ['a = b', 'alias'],
      ['a = 1', 'read'],
      ['a = 1', 'write'],
    ]);
    assert.deepEqual(panes(result, 5).slice(1, 3), [
      ['int* p = &a', 'alias'],
      ['int* p = 84', 'addr'],
    ]);
    assert.deepEqual(panes(result, 10), [
      ['rf = 4', null],
      ['s.f = 4', 'alias'],
      ['s.f = 4', 'write'],
    ]);
    assert.deepEqual(panes(result, 12).slice(1), [
      ['*p = 3', 'alias'],
      ['*84 = 3', 'read'],
      ['a = 3', 'deref'],
      ['a = 3', 'write'],
    ]);
  });

  test('the_left_side_is_renamed_before_the_right_side_is_read', () => {
    const source =
      'struct A { int f; }; int b = 1; A s{2}; A& rs = s; int* p = &b; int*& rp = p; rs.f = b; *rp = s.f;';
    const res = tracing.trace(source);
    assert.deepEqual(panes(res, 5), [
      ['rs.f = b', null],
      ['s.f = b', 'alias'],
      ['s.f = 1', 'read'],
      ['s.f = 1', 'write'],
    ]);
    assert.deepEqual(panes(res, 6), [
      ['*rp = s.f', null],
      ['*p = s.f', 'alias'],
      ['*p = 1', 'read'],
      ['*76 = 1', 'read'],
      ['b = 1', 'deref'],
      ['b = 1', 'write'],
    ]);
  });

  test('unsupported_references_never_execute', () => {
    const cases = {
      'int&& r = 1; int a = r;': /rvalue references/,
      'const int& r = 5; int a = r;': /unsupported assignable expression/,
      'int a = 1; int& r = a; int r2 = 2; int& a2 = r2; int& r = r2;': /error/,
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

  test('a_reference_observed_elsewhere_is_fatal', () => {
    const original = tracing.hooks.execute;
    tracing.hooks.execute = (...args) => {
      const execution = original(...args);
      for (const row of execution.checkpoints) {
        for (const [name, cell] of Object.entries(row)) {
          if (cell.reference) {
            row[name] = new Cell({ ...cell, address: cell.address + 4 });
          }
        }
      }
      return execution;
    };
    try {
      assert.throws(
        () => tracing.trace('int a = 1; int& c = a; c = 2;'),
        err => err instanceof Unsupported && /the reference c disagrees/.test(err.message)
      );
    } finally {
      tracing.hooks.execute = original;
    }
  });
});

describe('ReferenceFormatTests', () => {
  const step = {
    line: 0,
    pane: 'int a = 1',
    values: { a: null },
    targets: {},
    stdout: '',
    hold: 1,
    op: null,
    refs: {},
  };
  const baseTrace = {
    format: 1,
    source: ['int a = 1;', 'int& c = a;', 'c = 2;'],
    variables: [{ name: 'a', address: 64, size: 4, kind: 'int', color: 0 }],
    references: [{ name: 'c', color: 1 }],
    steps: [
      step,
      {
        ...step,
        values: { a: 1 },
        op: { kind: 'write', name: 'a', value: '1', span: [8, 9], destination: [4, 5] },
      },
      { ...step, line: 1, pane: 'int& c = a', values: { a: 1 } },
      {
        ...step,
        line: 1,
        pane: 'int& c = a',
        values: { a: 1 },
        refs: { c: 'a' },
        op: { kind: 'bind', name: 'c', target: 'a', span: [9, 10], destination: [5, 6] },
      },
      { ...step, line: 2, pane: 'c = 2', values: { a: 1 }, refs: { c: 'a' } },
      {
        ...step,
        line: 2,
        pane: 'a = 2',
        values: { a: 1 },
        refs: { c: 'a' },
        op: { kind: 'alias', name: 'c', target: 'a', span: [0, 1] },
      },
      {
        ...step,
        line: 2,
        pane: 'a = 2',
        values: { a: 2 },
        refs: { c: 'a' },
        op: { kind: 'write', name: 'a', value: '2', span: [4, 5], destination: [0, 1] },
      },
    ],
  };

  function rejects(message, change) {
    const broken = structuredClone(baseTrace);
    change(broken);
    assert.throws(
      () => validate(broken),
      err => err instanceof FormatError && new RegExp(message).test(err.message)
    );
  }

  test('accepts_bind_and_alias', () => {
    validate(baseTrace);
  });

  test('rejects_inconsistent_references', () => {
    rejects('only a bind changes', t => {
      t.steps[2].refs = { c: 'a' };
    });
    rejects('only a bind changes', t => {
      t.steps[5].refs = {};
    });
    rejects('unknown reference', t => {
      t.steps[3].op.name = 'a';
    });
    rejects('unknown variable', t => {
      t.steps[3].op.target = 'b';
    });
    rejects("does not cover 'c'", t => {
      t.steps[3].op.destination = [0, 3];
    });
    rejects('does not cover the name', t => {
      t.steps[5].op.span = [2, 3];
    });
    rejects('duplicate name', t => {
      t.references.push({ name: 'a', color: 2 });
    });
  });
});
