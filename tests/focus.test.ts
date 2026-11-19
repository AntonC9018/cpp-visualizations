// What each step lights: a walk into part of a struct dims the rest of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trace } from '../src/node/tracing.ts';
import { prepare, stepFocus } from '../src/player/model.ts';

const SOURCE = 'struct In { int a; int b; }; struct S { int x; In in; }; S s{ 1, { 2, 3 } }; int y = s.in.b; s.in.a = 9; S t = s;';
const m = prepare(trace(SOURCE, { runtime: false }));
const stepOf = (kind: string, name: string): number =>
  m.steps.findIndex(step => step.op?.kind === kind && 'name' in step.op && step.op.name === name);
const cells = (names: Set<string>): string[] => [...names].filter(name => name.startsWith('s.')).sort();

test('a read into a struct lights only its cell, as the walk reaches it', () => {
  const i = stepOf('read', 's.in.b');
  const focus = stepFocus(m, i, true);
  assert.deepEqual(cells(focus.now), ['s.in.b']);
  assert.deepEqual(cells(focus.before), ['s.in.a', 's.in.b', 's.x']);
  // Lit before the walk, dimmed while it walks, lit again when it lands.
  assert.deepEqual([...focus.dip], ['s.in.b']);
  assert.ok(focus.begin.get('s.in.b')! > 1);
});

test('a write into a struct lights its cell only as the value lands', () => {
  const i = stepOf('write', 's.in.a');
  const read = stepFocus(m, stepOf('read', 's.in.b'), true).begin.get('s.in.b')!;
  const focus = stepFocus(m, i, true);
  assert.deepEqual(cells(focus.now), ['s.in.a']);
  assert.ok(focus.begin.get('s.in.a')! > read, 'a write lands after its walk');
  // Settled, without animation, the step shows its end.
  const still = stepFocus(m, i, false);
  assert.deepEqual(still.before, still.now);
});

test('a whole struct read lights all of it', () => {
  const focus = stepFocus(m, stepOf('read', 's'), true);
  assert.deepEqual(cells(focus.now), ['s.in.a', 's.in.b', 's.x']);
  assert.equal(focus.dip.size, 0);
});
