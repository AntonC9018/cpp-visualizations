import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applicable } from '../src/node/generate.ts';
import { Unsupported, trace } from '../src/node/tracing.ts';

test('array initialization and assignment zero-fill with the same compact braces', () => {
  const result = trace(`
    std::array<int, 3> a{ 4 };
    a[1] = 7;
    std::array<int, 3> b = a;
    a = { };
    std::cout << b[1] << ' ';
    std::cout << a.size();
  `);
  const last = result.steps.at(-1)!;
  assert.deepEqual(last.values, {
    'a.[0]': 0, 'a.[1]': 0, 'a.[2]': 0,
    'b.[0]': 4, 'b.[1]': 7, 'b.[2]': 0,
  });
  assert.equal(last.stdout, '7 3');
  assert.equal(result.steps[0].pane, 'std::array<int, 3> a = {4}');
  assert.equal(result.steps.find(step => step.line === 3)?.pane, 'a = {}');
});

test('a temporary on the stack does not split the drawn storage', () => {
  const source = `
    std::array<int, 2> arr{ 1, 2 };
    std::array<int, 2>* p{ &arr };
    *p = { 3, 4 };
    std::cout << arr[1];
  `;
  const result = trace(source);
  applicable(result, source);
  assert.deepEqual(
    result.variables.map(v => [v.name, v.address]),
    [['p', 64], ['arr', 72]]
  );
  assert.equal(result.steps.at(-1)!.stdout, '4');
});

test('a whole-array reference and an indexed reference preserve storage identity', () => {
  const result = trace(`
    std::array<int, 3> arr{1, 2, 3};
    auto& row{arr};
    int i{2};
    auto& last{row[i]};
    auto p{&last};
    row[0] = 7;
    last = 9;
    *p = 12;
  `);
  const last = result.steps.at(-1)!;
  assert.deepEqual(last.refs, { row: 'arr', last: 'arr.[2]' });
  assert.equal(last.targets.p, 'arr.[2]');
  assert.deepEqual([last.values['arr.[0]'], last.values['arr.[2]']], [7, 12]);
  assert.ok(result.steps.some(s => s.op?.kind === 'bind' && s.pane.endsWith('arr[2]')));
  assert.ok(result.steps.some(s => s.op?.kind === 'alias' && s.pane === 'arr[2] = 9'));
  assert.ok(result.steps.some(s => s.op?.kind === 'deref' && s.pane === 'arr[2] = 12'));
});

test('deduced arrays can be referenced and addressed', () => {
  const result = trace(`
    std::array a{1, 2};
    auto& ref = a;
    auto p{&ref};
    (*p)[1] = 8;
  `);
  const last = result.steps.at(-1)!;
  assert.equal(last.refs?.ref, 'a');
  assert.equal(last.targets.p, 'a');
  assert.equal(last.values['a.[1]'], 8);
});

test('an array field of pointers has compiler-verified element offsets and targets', () => {
  const result = trace(`
    struct Box { int guard; std::array<int*, 2> ptrs; };
    int n;
    Box b{.guard = 6, .ptrs = {&n}};
    auto p = b.ptrs.data();
    **p = 11;
  `);
  const box = result.variables.find(v => v.name === 'b');
  assert.equal(box?.kind, 'struct');
  if (box.kind !== 'struct') return;
  assert.equal(box.fields[1].offset, 8);
  assert.deepEqual(result.steps.at(-1)?.targets, { 'b.ptrs.[0]': 'n', p: 'b.ptrs.[0]' });
  assert.equal(result.steps.at(-1)?.values.n, 11);
});

test('array fields use canonical types for aliases and computed extents', () => {
  const result = trace(`
    struct Bytes { array<uint8_t, 1 + 1> elements; };
    Bytes bytes{};
    bytes.elements[1] = 7;
  `);
  assert.equal(result.steps.at(-1)?.values['bytes.elements.[1]'], 7);
});

test('a matrix has indexed rows that can be copied or written through a pointer', () => {
  const result = trace(`
    std::array<std::array<int, 2>, 2> matrix{std::array{1, 2}, {3}};
    auto p = &matrix;
    std::array<int, 2> copy{(*p)[1]};
    (*p)[1][0] = 8;
    matrix[0] = {9, 10};
  `);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.steps.at(-1)!.values).filter(([name]) => name !== 'p')),
    { 'copy.[0]': 3, 'copy.[1]': 0, 'matrix.[0].[0]': 9, 'matrix.[0].[1]': 10,
      'matrix.[1].[0]': 8, 'matrix.[1].[1]': 0 }
  );
  assert.ok(result.steps.some(s => s.op?.kind === 'write' && s.op.name === 'matrix.[1].[0]' &&
    s.pane === 'matrix[1][0] = 8'));
});

test('a long array type stays in the source and in the optional pane label', () => {
  const source = 'std::array<std::array<int, 2>, 2> matrix{}; matrix[1][0] = 7;';
  const untyped = trace(source);
  const typed = trace(source, { types: true });
  assert.match(untyped.source[0], /^std::array<std::array<int, 2>, 2> matrix/);
  assert.equal(untyped.steps[0].pane, 'matrix = {}');
  assert.equal(typed.steps[0].pane, 'matrix = {}');
  const slot = typed.steps[0].types?.find(part => part.slot);
  assert.match(slot?.type ?? '', /^array<std::array<int, 2>, 2>$/);
});

test('an array of structs supports aggregate writes and independent copies', () => {
  const result = trace(`
    struct Item { int a; int b; };
    std::array<Item, 2> items{};
    items[0] = Item{4, 5};
    Item copy = items[0];
    items[0].b = 8;
  `);
  const last = result.steps.at(-1)!;
  assert.equal(last.values['items.[0].b'], 8);
  assert.equal(last.values['items.[1].b'], 0);
  assert.equal(last.values['copy.b'], 5);
});

test('arrays of floats, doubles, narrow integers and void pointers', () => {
  const result = trace(`
    int x = 9;
    std::array<float, 2> f{ 1.5f, 2.25f };
    std::array<uint8_t, 2> u{ 3, 4 };
    std::array<double, 2> d{ f[0], f[1] };
    std::array<void*, 2> vp{ &x, nullptr };
    double sum = d[0] + d[1] + u[0];
    std::cout << sum << std::endl;
  `);
  const last = result.steps.at(-1)!;
  assert.equal(last.values['f.[0]'], 1.5);
  assert.equal(last.values['u.[0]'], 3);
  assert.equal(last.values['d.[0]'], 1.5);
  assert.equal(last.values['d.[1]'], 2.25);
  assert.equal(last.values.sum, 6.75);
  assert.equal(last.targets['vp.[0]'], 'x');
  assert.equal(last.stdout, '6.75\n');
});

test('a struct may hold a pointer to std::array without a separate array variable', () => {
  const result = trace(`
    struct S { std::array<int, 2>* p; };
    S s{ nullptr };
  `);
  assert.equal(result.steps.at(-1)?.values['s.p'], 0);
});

test('unqualified array pointers normalize before dereference checks', () => {
  const result = trace(`
    using namespace std;
    array<int, 2> a{ 1, 2 };
    array<int, 2>* p = &a;
    int x = (*p)[1];
  `);
  assert.equal(result.steps.at(-1)?.values.x, 2);
});

test('the tracer rejects invalid array operations before execution', () => {
  for (const [source, reason] of [
    ['std::array<int, 2> a{}; a[2] = 1;', /index 2 is out of bounds/],
    ['std::array<int, 2> a{}; a[-1] = 1;', /index -1 is out of bounds/],
    ['std::array<int, 2> a; int b = a[1];', /reading uninitialized/],
    ['std::array<int, 0> a{};', /requires 1–32 elements/],
    ['std::array<std::array<int, 9>, 9> a{};', /at most 64 scalar cells/],
    ['std::array<char, 2> a{};', /unsupported std::array element type/],
  ] as const) {
    assert.throws(() => trace(source), { name: Unsupported.name, message: reason });
  }
});
