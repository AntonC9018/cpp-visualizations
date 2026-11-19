// What each step lights: a struct's cells light only as the statement's operations reach them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trace } from '../src/node/tracing.ts';
import { type PreparedModel, arrival, prepare, stepFocus } from '../src/player/model.ts';

const model = (source: string): PreparedModel => prepare(trace(source, { runtime: false }));
const stepOf = (m: PreparedModel, kind: string, name: string): number =>
  m.steps.findIndex(
    step => step.op?.kind === kind && ('name' in step.op ? step.op.name : 'target' in step.op ? step.op.target : '') === name
  );
const cells = (names: Set<string>, prefix = 's.'): string[] =>
  [...names].filter(name => name.startsWith(prefix)).sort();
/** The cells a step dims or lights, each with when it starts to. */
const changes = (m: PreparedModel, i: number, prefix = 's.'): Record<string, number> => {
  const focus = stepFocus(m, i, true);
  const changed = [...new Set([...focus.now, ...focus.before])].filter(
    name => name.startsWith(prefix) && focus.now.has(name) !== focus.before.has(name)
  );
  return Object.fromEntries(changed.sort().map(name => [name, focus.begin.get(name) ?? 0]));
};

const m = model(
  'struct In { int a; int b; }; struct S { int x; In in; }; S s{ 1, { 2, 3 } }; ' +
    'int y = s.in.b; s.in.a = 9; S t = s;'
);

test('a read into a struct lights only its cell, as the walk reaches it', () => {
  const i = stepOf(m, 'read', 's.in.b');
  const focus = stepFocus(m, i, true);
  // The statement starts with the struct's cells dimmed; the walk lights the one it reads.
  assert.deepEqual(cells(focus.before), []);
  assert.deepEqual(cells(focus.now), ['s.in.b']);
  assert.ok(focus.begin.get('s.in.b')! > 1);
});

test('cells stay as the statement reached them through its later steps', () => {
  const write = stepOf(m, 'write', 'y');
  assert.deepEqual(cells(stepFocus(m, write, true).now), ['s.in.b']);
  assert.deepEqual(changes(m, write), {});
});

test('a write into a struct lights its cell only as the value lands', () => {
  const i = stepOf(m, 'write', 's.in.a');
  assert.deepEqual(changes(m, i), { 's.in.a': arrival(m.steps[i].op!) });
  // Settled, without animation, the step shows its end.
  const still = stepFocus(m, i, false);
  assert.deepEqual(still.before, still.now);
  // The statement's first step dims what the last one lit.
  assert.deepEqual(cells(stepFocus(m, i - 1, true).now), []);
});

test('a whole struct read lights all of it', () => {
  const focus = stepFocus(m, stepOf(m, 'read', 's'), true);
  assert.deepEqual(cells(focus.now), ['s.in.a', 's.in.b', 's.x']);
});

test('copying a field lights the source as read and the destination as written', () => {
  const c = model(
    'struct In { int a; int b; }; struct S { int x; In in; }; S s{ 1, { 2, 3 } }; S u{ 4, { 5, 6 } }; ' +
      'u.in = s.in;'
  );
  const read = stepOf(c, 'read', 's.in');
  assert.deepEqual(cells(stepFocus(c, read, true).now, 'u.'), [], 'the destination waits for its value');
  const write = stepOf(c, 'write', 'u.in');
  const focus = stepFocus(c, write, true);
  assert.deepEqual(cells(focus.now), ['s.in.a', 's.in.b']);
  assert.deepEqual(changes(c, write, 'u.'), {
    'u.in.a': arrival(c.steps[write].op!),
    'u.in.b': arrival(c.steps[write].op!),
  });
});

test('a struct of one field dims it until the write lands', () => {
  const one = model('struct S { int a; }; S s{ 1 }; s.a = 5;');
  const write = stepOf(one, 'write', 's.a');
  assert.deepEqual(cells(stepFocus(one, write - 1, true).now), []);
  assert.deepEqual(changes(one, write), { 's.a': arrival(one.steps[write].op!) });
});

test('a dereference dims the siblings at once and lights its target as the arrow arrives', () => {
  const d = model('struct S { int a; int b; }; S s{ 1, 2 }; S* p = &s; int r = s.b; int q = p->a;');
  const deref = stepOf(d, 'deref', 's.a');
  const at = arrival(d.steps[deref].op!) - 0.15;
  assert.deepEqual(changes(d, deref), { 's.a': at });
  // The read of s.b lit it; the next statement dims it straight away.
  assert.deepEqual(changes(d, statementOf(d, deref)), { 's.b': 0 });
});

test('an address lights its cell with the highlight, from the start', () => {
  const a = model('struct S { int a; int b; }; S s{ 1, 2 }; int* p = &s.a;');
  assert.deepEqual(changes(a, stepOf(a, 'addr', 's.a')), { 's.a': 0 });
});

function statementOf(mm: PreparedModel, i: number): number {
  let start = i;
  while (start > 0 && mm.steps[start - 1].line === mm.steps[i].line) start--;
  return start;
}

test('a dereferenced struct the statement goes into lights only the field, as the value lands', () => {
  const d = model('struct S { int a; int b; }; S s{ 1, 2 }; S* p = &s; (*p).a = 3;');
  const deref = stepOf(d, 'deref', 's');
  assert.deepEqual(cells(stepFocus(d, deref, true).now), []);
  const write = stepOf(d, 'write', 's.a');
  assert.deepEqual(changes(d, write), { 's.a': arrival(d.steps[write].op!) });
  assert.deepEqual(cells(stepFocus(d, write, true).now), ['s.a']);
});

test('a field read elsewhere in the statement leaves a whole dereferenced struct lit', () => {
  const t = model('struct S { int a; int b; }; struct T { S v; int i; }; S s{ 1, 2 }; S* p = &s; T t{ *p, s.a };');
  const deref = stepOf(t, 'deref', 's');
  assert.deepEqual(cells(stepFocus(t, deref, true).now), ['s.a', 's.b']);
  const w = model('struct S { int a; int b; }; S s{ 1, 2 }; S* p = &s; *p = S{ s.a, 4 };');
  const target = stepOf(w, 'deref', 's');
  assert.deepEqual(cells(stepFocus(w, target, true).now), ['s.a', 's.b']);
});

test('a field reached through parentheses, spaces or a reference chain lights alone', () => {
  const setup = 'struct S { int a; int b; }; S s{ 1, 2 }; S* p = &s; ';
  for (const [statement, kind] of [
    ['(*p) . a += 3;', 'read'],
    ['(*p) . a = 3;', 'write'],
    ['int x = ((*p).a);', 'read'],
    ['S& r = s; S& q = r; int x = (q).a;', 'read'],
    ['((*p).a) = 3;', 'write'],
    ['((*p).a) += 3;', 'read'],
    ['S& r = s; (r).a = 3;', 'write'],
    ['int& r = ((*p).a);', 'bind'],
    ['int& r = (*p) . a;', 'bind'],
  ] as const) {
    const t = model(setup + statement);
    const last = t.steps.length - 1;
    const first = statementOf(t, last);
    for (let i = first; i <= last; i++) {
      const lit = cells(stepFocus(t, i, true).now);
      assert.ok(!lit.includes('s.b'), `${statement}: s.b lit at step ${i}`);
    }
    const reach = t.steps.findIndex(
      (step, i) =>
        i >= first &&
        step.op?.kind === kind &&
        (step.op.kind === 'bind' ? step.op.target : 'name' in step.op ? step.op.name : '') === 's.a'
    );
    assert.deepEqual(cells(stepFocus(t, reach, true).now), ['s.a'], statement);
  }
});
