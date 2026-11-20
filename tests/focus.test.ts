// What each step lights: a struct's cells light only as the statement's operations reach them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trace } from '../src/node/tracing.ts';
import { T } from '../src/player/constants.ts';
import {
  type PreparedModel,
  type WalkingOperation,
  arrival,
  departure,
  prepare,
  stepFocus,
  walkOf,
} from '../src/player/model.ts';
import { memoryWalk, paneLevels } from '../src/player/storage_path.ts';

const model = (source: string): PreparedModel => prepare(trace(source));
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
  // The statement starts with the struct's cells dimmed; the walk lights the one it reads, and
  // the frame of the struct nested around it with it.
  assert.deepEqual(cells(focus.before), []);
  assert.deepEqual(cells(focus.now), ['s.in', 's.in.b']);
  assert.ok(focus.begin.get('s.in.b')! > 1);
  assert.equal(focus.begin.get('s.in'), focus.begin.get('s.in.b'));
});

test('a variable whose value went into the pane dims as the statement moves on', () => {
  const write = stepOf(m, 'write', 'y');
  assert.deepEqual(cells(stepFocus(m, write, true).now), []);
  assert.deepEqual(changes(m, write), { 's.in': 0, 's.in.b': 0 });
  assert.ok(!stepFocus(m, write, true).now.has('s'));
});

test('a write into a struct lights its cell only as the value lands', () => {
  const i = stepOf(m, 'write', 's.in.a');
  const at = arrival(m.steps[i].op!);
  assert.deepEqual(changes(m, i), { 's.in': at, 's.in.a': at });
  // Settled, without animation, the step shows its end.
  const still = stepFocus(m, i, false);
  assert.deepEqual(still.before, still.now);
  // The statement's first step dims what the last one lit.
  assert.deepEqual(cells(stepFocus(m, i - 1, true).now), []);
});

test('a whole struct read lights all of it', () => {
  const focus = stepFocus(m, stepOf(m, 'read', 's'), true);
  assert.deepEqual(cells(focus.now), ['s.in', 's.in.a', 's.in.b', 's.x']);
});

test('copying a field lights the source as read and the destination as written', () => {
  const c = model(
    'struct In { int a; int b; }; struct S { int x; In in; }; S s{ 1, { 2, 3 } }; S u{ 4, { 5, 6 } }; ' +
      'u.in = s.in;'
  );
  const read = stepOf(c, 'read', 's.in');
  assert.deepEqual(cells(stepFocus(c, read, true).now, 'u.'), [], 'the destination waits for its value');
  const write = stepOf(c, 'write', 'u.in');
  assert.deepEqual(cells(stepFocus(c, read, true).now), ['s.in', 's.in.a', 's.in.b']);
  // The source dims as its value leaves the pane for the destination.
  assert.deepEqual(cells(stepFocus(c, write, true).now), []);
  assert.deepEqual(changes(c, write, 'u.'), {
    'u.in': arrival(c.steps[write].op!),
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
  // The read of s.b lit it; the write of its value dims it straight away.
  assert.deepEqual(changes(d, stepOf(d, 'write', 'r')), { 's.b': 0 });
});

test('an address walks to its cell and lights it as the walk lands', () => {
  const a = model('struct S { int a; int b; }; S s{ 1, 2 }; int* p = &s.a;');
  const i = stepOf(a, 'addr', 's.a');
  const op = a.steps[i].op as WalkingOperation;
  assert.deepEqual(walkOf(op), ['s', 's.a']);
  assert.ok(departure(op) > T.prepare);
  assert.deepEqual(changes(a, i), { 's.a': memoryWalk(['s', 's.a'], arrival(op)).at(-1)![0] });
});

test('the address of a struct lights none of its fields', () => {
  const a = model('struct N { int f; int g; }; struct S { int x; N n; }; S s{ 1, { 2, 3 } }; N* p = &s.n;');
  const i = stepOf(a, 'addr', 's.n');
  assert.deepEqual(walkOf(a.steps[i].op as WalkingOperation), ['s', 's.n']);
  // Its frame lights whole, its cells stay dim.
  assert.deepEqual(cells(stepFocus(a, i, true).now), ['s.n']);
  assert.ok(stepFocus(a, i, true).now.has('s'));
  const through = model(
    'struct N { int f; int g; }; struct S { int x; N n; }; S s{ 1, { 2, 3 } }; S* p = &s; N* q = &p->n;'
  );
  for (let k = stepOf(through, 'deref', 's.n'); k <= stepOf(through, 'addr', 's.n'); k++) {
    assert.deepEqual(cells(stepFocus(through, k, true).now).filter(name => name !== 's.n'), [], `step ${k}`);
  }
});

test('what a read reached dims as the statement moves on, what it writes back stays', () => {
  const r = model('struct S { int a; int b; }; S s{ 1, 2 }; int t = 3; s.b = s.a + t;');
  assert.deepEqual(changes(r, stepOf(r, 'read', 't')), { 's.a': 0 });
  const c = model('struct S { int a; int b; }; S s{ 1, 2 }; s.a += 3;');
  const eval_ = c.steps.findIndex(step => step.op?.kind === 'eval');
  assert.deepEqual(cells(stepFocus(c, eval_, true).now), ['s.a']);
  // The write lands where the read already walked.
  assert.deepEqual(walkOf(c.steps[stepOf(c, 'write', 's.a')].op as WalkingOperation), ['s.a']);
});

test('a variable the pane names until the step rewrites it dims as the rewrite lands', () => {
  const z = model('struct S { int a; int b; }; S s{ 1, 2 }; int z = sizeof(s);');
  const i = z.steps.findIndex(step => step.op?.kind === 'eval');
  const focus = stepFocus(z, i, true);
  assert.ok(focus.before.has('s') && !focus.now.has('s'));
  assert.equal(focus.begin.get('s'), arrival(z.steps[i].op!));
});

test('an address the pane does not spell with & does not walk', () => {
  const d = model('#include <array>\nstd::array<int, 3> a{ 1, 2, 3 };\nint* r = a.data();');
  const addr = d.steps.find(step => step.op?.kind === 'addr')!.op as WalkingOperation;
  assert.deepEqual(walkOf(addr), [addr.name]);
});

test('a field after -> is not a variable of that name', () => {
  const f = model('struct S { int x; int y; }; S s{ 1, 2 }; int x = 5; S* p = &s; p->x = 3;');
  const read = stepOf(f, 'read', 'p');
  assert.ok(!stepFocus(f, read, true).now.has('x'));
});

test('a chain a dereference arrived at walks only from where it arrived', () => {
  const d = model(
    'struct N { int f; int g; }; struct A { N n; int f; }; A b{ { 1, 2 }, 3 }; N* q = &b.n; ' +
      'q->g = 9; int x = (*q).f;'
  );
  const write = d.steps[stepOf(d, 'write', 'b.n.g')].op as WalkingOperation;
  assert.deepEqual(walkOf(write), ['b.n.g']);
  assert.equal(departure(write), T.writeHold);
  const read = d.steps[stepOf(d, 'read', 'b.n.f')].op as WalkingOperation;
  assert.deepEqual(walkOf(read), ['b.n', 'b.n.f']);
  // So does a compound assignment's write, through a pointer or a reference.
  for (const statement of ['N* q = &b.n; q->g += 4;', 'int& t = b.n.g; t += 1;']) {
    const c = model('struct N { int f; int g; }; struct A { N n; int f; }; A b{ { 1, 2 }, 3 }; ' + statement);
    const write = c.steps.findLast(step => step.op?.kind === 'write')!.op as WalkingOperation;
    assert.deepEqual(walkOf(write), ['b.n.g'], statement);
  }
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

test('the pane box of a walk ends where each level ends, however the chain is spaced', () => {
  const walk = ['a', 'a.n', 'a.n.g'];
  assert.deepEqual(paneLevels(walk, 'p = &a.n.g;', 4), [2, 4, 6]);
  assert.deepEqual(paneLevels(walk, 'p = & a.n.g;', 4), [3, 5, 7]);
  assert.deepEqual(paneLevels(walk, 'p = &(a).n.g;', 4), [3, 6, 8]);
  assert.deepEqual(paneLevels(walk, 'a.n. g += 1', 0), [1, 3, 6]);
  assert.deepEqual(paneLevels(['a', 'a.f', 'a.f.[0]'], 'a.f[ 0 ]', 0), [1, 3, 8]);
  assert.equal(paneLevels(walk, 'a.n.gx', 0), null);
  assert.equal(paneLevels(['a'], 'a', 0), null);
});
