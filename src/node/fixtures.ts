// Write the manual pointer and struct traces into `fixtures/` in the unified format.
//
// They exercise pointer arcs, struct frames and dereference chains in the player until the
// tracer supports pointers (#75) and structs (#76). Ints and fields take 4 bytes, pointers 8,
// and addresses start at 64; struct layouts were checked against Clang's record layouts.
// Run from the course root: node visualizations/player/fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from '../core/json_format.ts';
import {
  Builder,
  type ExecutionTrace,
  type TraceField,
  field,
  scalar,
  struct,
} from '../core/trace_format.ts';

export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../player/fixtures');
// Colours by name, as in the pointer study: a teal, b amber, p violet, pp pink, q green.
const [A, B, P, PP, Q] = [0, 1, 2, 3, 4];

export function write_through(): ExecutionTrace {
  const t = new Builder(
    ['int a{ 1 };', 'int* b{ &a };', '*b = 2;', 'std::cout << a;'],
    [scalar('a', 64, 4, 'int', A), scalar('b', 72, 8, 'ptr', B)],
    'Write through a pointer'
  );
  t.statement(0).write('a');
  t.statement(1).address('a').write('b');
  t.statement(2).read('b').deref('*64', 'a', 'b').write('a');
  t.statement(3).print('a');
  return t.build();
}

export function reassign(): ExecutionTrace {
  const t = new Builder(
    [
      'int a = 5;',
      'int* p = &a;',
      '*p = 6;',
      'int b = 7;',
      'p = &b;',
      '*p = 8;',
      'std::cout << a << std::endl;',
      'std::cout << b << std::endl;',
    ],
    [scalar('a', 64, 4, 'int', A), scalar('b', 68, 4, 'int', B), scalar('p', 72, 8, 'ptr', P)],
    'Reassigning a pointer'
  );
  t.statement(0).write('a');
  t.statement(1).address('a').write('p');
  t.statement(2).read('p').deref('*64', 'a', 'p').write('a');
  t.statement(3).write('b');
  t.statement(4).address('b').write('p', 1.6);
  t.statement(5).read('p').deref('*68', 'b', 'p').write('b');
  t.statement(6).print('a');
  t.statement(7).print('b');
  return t.build();
}

export function double_pointer(): ExecutionTrace {
  const t = new Builder(
    [
      'int a = 5;',
      'int b = 6;',
      'int* p = &a;',
      'int** pp = &p;',
      '**pp = 7;',
      '*pp = &b;',
      '**pp = 8;',
      'std::cout << a << std::endl;',
      'std::cout << b << std::endl;',
    ],
    [
      scalar('a', 64, 4, 'int', A),
      scalar('b', 68, 4, 'int', B),
      scalar('p', 72, 8, 'ptr', P),
      scalar('pp', 80, 8, 'ptr', PP),
    ],
    'Pointer to a pointer'
  );
  t.statement(0).write('a');
  t.statement(1).write('b');
  t.statement(2).address('a').write('p');
  t.statement(3).address('p').write('pp');
  t.statement(4).read('pp').deref('*72', 'p', 'pp').read('p').deref('*64', 'a', 'p').write('a');
  t.statement(5).address('b').read('pp').deref('*72', 'p', 'pp').write('p', 1.6);
  t.statement(6).read('pp').deref('*72', 'p', 'pp').read('p').deref('*68', 'b', 'p').write('b');
  t.statement(7).print('a');
  t.statement(8).print('b');
  return t.build();
}

export function shared_target(): ExecutionTrace {
  const t = new Builder(
    ['int a = 5;', 'int* p = &a;', 'int* q = p;', '*q = 6;', 'std::cout << *p << std::endl;'],
    [scalar('a', 64, 4, 'int', A), scalar('p', 72, 8, 'ptr', P), scalar('q', 80, 8, 'ptr', Q)],
    'Two pointers to one variable'
  );
  t.statement(0).write('a');
  t.statement(1).address('a').write('p');
  t.statement(2).read('p').write('q');
  t.statement(3).read('q').deref('*64', 'a', 'q').write('a');
  t.statement(4).read('p').deref('*64', 'a', 'p').print('a');
  return t.build();
}

const [F1, F2] = [0, 1];

function twoInts(): TraceField[] {
  return [field('f1', 0, 4, 'int', F1), field('f2', 4, 4, 'int', F2)];
}

export function adjacent_copy(): ExecutionTrace {
  const t = new Builder(
    [
      'struct A { int f; };',
      'A a{ 1 };',
      'A b{ a };',
      'a.f = 2;',
      'std::cout << a.f << std::endl;',
      'std::cout << b.f << std::endl;',
    ],
    [struct('a', 'A', 64, 4, [field('f', 0)], 0), struct('b', 'A', 68, 4, [field('f', 0)], 1)],
    'Initializing a structure from another'
  );
  t.statement(1, 'a = {1}').write('a');
  t.statement(2).read('a').write('b', 1.6);
  t.statement(3).write('a.f');
  t.statement(4).print('a.f');
  t.statement(5).print('b.f');
  return t.build();
}

export function copy_assignment(): ExecutionTrace {
  const t = new Builder(
    [
      'struct A { int f1; int f2; };',
      'A a;',
      'a.f1 = 5;',
      'a.f2 = 6;',
      'A b;',
      'b.f1 = 7;',
      'b = a;',
      'std::cout << b.f1 << std::endl;',
      'std::cout << b.f2 << std::endl;',
    ],
    [struct('a', 'A', 64, 8, twoInts(), 0), struct('b', 'A', 72, 8, twoInts(), 1)],
    'Assigning a structure'
  );
  t.statement(1).declare('a');
  t.statement(2).write('a.f1');
  t.statement(3).write('a.f2');
  t.statement(4).declare('b');
  t.statement(5).write('b.f1');
  t.statement(6).read('a').write('b', 1.6);
  t.statement(7).print('b.f1');
  t.statement(8).print('b.f2');
  return t.build();
}

export function arrow_operator(): ExecutionTrace {
  const t = new Builder(
    [
      'struct A { int f1; int f2; };',
      'A a;',
      'a.f1 = 5;',
      'A* pa = &a;',
      '(*pa).f2 = 6;',
      'pa->f1 = 7;',
      'std::cout << a.f1 << std::endl;',
      'std::cout << a.f2 << std::endl;',
    ],
    [struct('a', 'A', 64, 8, twoInts(), 0), scalar('pa', 72, 8, 'ptr', 1)],
    'The -> operator'
  );
  t.statement(1).declare('a');
  t.statement(2).write('a.f1');
  t.statement(3).address('a').write('pa');
  t.statement(4).read('pa').deref('(*64)', 'a', 'pa').write('a.f2');
  t.statement(5).read('pa').deref('64->f1', 'a.f1', 'pa').write('a.f1');
  t.statement(6).print('a.f1');
  t.statement(7).print('a.f2');
  return t.build();
}

export function copy_through_pointer(): ExecutionTrace {
  const t = new Builder(
    [
      'struct A { int f1; int f2; };',
      'A a;',
      'a.f1 = 5;',
      'a.f2 = 6;',
      'A* pa = &a;',
      'a.f1 = 7;',
      'A b = *pa;',
      'std::cout << b.f1 << std::endl;',
    ],
    [
      struct('a', 'A', 64, 8, twoInts(), 0),
      scalar('pa', 72, 8, 'ptr', 1),
      struct('b', 'A', 80, 8, twoInts(), 2),
    ],
    'Copying through a structure address'
  );
  t.statement(1).declare('a');
  t.statement(2).write('a.f1');
  t.statement(3).write('a.f2');
  t.statement(4).address('a').write('pa');
  t.statement(5).write('a.f1');
  t.statement(6).read('pa').deref('*64', 'a', 'pa').read('a').write('b', 1.6);
  t.statement(7).print('b.f1');
  return t.build();
}

export function field_address(): ExecutionTrace {
  const t = new Builder(
    [
      'struct A { int f1; int f2; };',
      'A a{};',
      'int* b = &a.f2;',
      '*b = 5;',
      'std::cout << a.f2 << std::endl;',
    ],
    [struct('a', 'A', 64, 8, twoInts(), 0), scalar('b', 72, 8, 'ptr', 1)],
    'Field addresses'
  );
  t.statement(1, 'a = {0, 0}').write('a');
  t.statement(2).address('a.f2').write('b');
  t.statement(3).read('b').deref('*68', 'a.f2', 'b').write('a.f2');
  t.statement(4).print('a.f2');
  return t.build();
}

export function shallow_copy(): ExecutionTrace {
  const fields = (): TraceField[] => [field('pa', 0, 8, 'ptr', 0), field('a', 8, 4, 'int', 1)];
  const t = new Builder(
    [
      'struct A { int* pa; int a; };',
      'A s1 { .pa = nullptr, .a = 1 };',
      's1.pa = &s1.a;',
      'A s2 { s1 };',
      '*s2.pa = 2;',
      'std::cout << s1.a << std::endl;',
      'std::cout << s2.a << std::endl;',
    ],
    [struct('s1', 'A', 64, 16, fields(), 0), struct('s2', 'A', 80, 16, fields(), 1)],
    'Copying a structure with a pointer field'
  );
  t.statement(1, 's1 = {nullptr, 1}').write('s1');
  t.statement(2).address('s1.a').write('s1.pa');
  t.statement(3).read('s1').write('s2', 1.6);
  t.statement(4).read('s2.pa').deref('*72', 's1.a', 's2.pa').write('s1.a');
  t.statement(5).print('s1.a');
  t.statement(6).print('s2.a');
  return t.build();
}

export const TRACES: Record<string, () => ExecutionTrace> = {
  'pointer-write-through': write_through,
  'pointer-reassign': reassign,
  'pointer-double': double_pointer,
  'pointer-shared-target': shared_target,
  'struct-adjacent-copy': adjacent_copy,
  'struct-copy-assignment': copy_assignment,
  'struct-arrow': arrow_operator,
  'struct-copy-through-pointer': copy_through_pointer,
  'struct-field-address': field_address,
  'struct-shallow-copy': shallow_copy,
};

export function render(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, build] of Object.entries(TRACES)) {
    result[`${name}.json`] = dumpsSorted(build(), 1) + '\n';
  }
  return result;
}

export function writeFixtures(): void {
  mkdirSync(FIXTURES, { recursive: true });
  for (const [name, content] of Object.entries(render())) {
    const target = join(FIXTURES, name);
    writeFileSync(target, content);
    console.log(target);
  }
}
