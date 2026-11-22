import assert from 'node:assert/strict';
import test from 'node:test';
import { Unsupported } from '../src/core/errors.ts';
import {
  hasLargerPointerAccess,
  punningMinEndAddress,
  simulatePunningTrace,
} from '../src/core/punning.ts';
import { FormatError, type ExecutionTrace, validate } from '../src/core/trace_format.ts';
import { trace as traceSource } from '../src/node/tracing.ts';
import { colorPoisonHexInSvg } from '../src/player/byte_memory.ts';

test('punning write into alignment padding updates target and keeps neighbor intact', () => {
  const trace = traceSource(
    `
      uint8_t a{ 5 };
      int c{ 10 };
      int* b = reinterpret_cast<int*>(&a);
      *b = 300;
    `,
    { punning: true }
  );
  assert.equal(trace.punning, true);
  assert.deepEqual(
    trace.variables.map(v => [v.name, v.address, v.size, v.type]),
    [
      ['a', 64, 1, 'uint8_t'],
      ['c', 68, 4, 'int'],
      ['b', 72, 8, 'int*'],
    ]
  );

  const derefStep = trace.steps.find(s => s.op?.kind === 'deref');
  assert.ok(derefStep?.op?.kind === 'deref' && derefStep.op.pun);
  assert.deepEqual(derefStep.op.pun, { type: 'int', size: 4, via: 'b' });
  assert.equal(derefStep.pane, '*64 = 300');

  const writeStep = trace.steps.at(-1)!;
  assert.ok(writeStep.op?.kind === 'write' && writeStep.op.pun);
  assert.equal(writeStep.values.a, 44);
  assert.equal(writeStep.values.c, 10);

  // Simulator: LE vs BE
  const le = simulatePunningTrace(trace, trace.steps.length - 1, true);
  assert.equal(le.varAfter.get('a')?.text, '44');
  assert.equal(le.varAfter.get('c')?.text, '10');
  assert.equal(le.corruptedVars.size, 0);
  assert.equal(le.bytes[1].corrupted, true); // padding byte 65
  assert.equal(le.bytes[1].after, 0x01);

  const be = simulatePunningTrace(trace, trace.steps.length - 1, false);
  assert.equal(be.varAfter.get('a')?.text, '0');
  assert.equal(be.bytes[3].after, 0x2c); // 300 = 00 00 01 2C in BE
});

test('punning write corrupts adjacent neighbor variable and supports C-style and void* casts', () => {
  for (const ptrInit of [
    'int* b = reinterpret_cast<int*>(&a);',
    'int* b = (int*)&a;',
    'void* vp = &a; int* b = static_cast<int*>(vp);',
  ]) {
    const trace = traceSource(
      `
        uint8_t a{ 5 };
        uint8_t c{ 26 };
        ${ptrInit}
        *b = 300;
      `,
      { punning: true }
    );
    const last = trace.steps.at(-1)!;
    assert.equal(last.values.a, 44);
    assert.equal(last.values.c, 1);

    const le = simulatePunningTrace(trace, trace.steps.length - 1, true);
    assert.ok(le.corruptedVars.has('c'));
    assert.equal(le.varAfter.get('c')?.text, '1');

    const be = simulatePunningTrace(trace, trace.steps.length - 1, false);
    assert.ok(be.corruptedVars.has('c'));
    assert.equal(be.varAfter.get('a')?.text, '0');
    assert.equal(be.varAfter.get('c')?.text, '0');
  }
});

test('punning read through larger pointer produces poisoned hex and flips cleanly in BE', () => {
  const trace = traceSource(
    `
      uint8_t a{ 42 };
      int c{ 10 };
      int* b = reinterpret_cast<int*>(&a);
      int x = *b;
      int y = x;
    `,
    { punning: true }
  );
  const readIdx = trace.steps.findIndex(s => s.op?.kind === 'read' && s.op.pun);
  assert.ok(readIdx > 0);
  const readStep = trace.steps[readIdx];
  assert.equal(readStep.op?.kind === 'read' ? readStep.op.value : null, '0x??????2A');
  assert.equal(trace.steps.at(-1)!.values.x, '0x??????2A');
  assert.equal(trace.steps.at(-1)!.values.y, '0x??????2A');

  const le = simulatePunningTrace(trace, readIdx, true);
  assert.equal(le.activePun?.readResult?.text, '0x??????2A');
  assert.equal(le.activePun?.readResult?.poisoned, true);

  const be = simulatePunningTrace(trace, readIdx, false);
  assert.equal(be.activePun?.readResult?.text, '0x2A??????');
  assert.deepEqual(be.paneReadReplacement, {
    stepIndex: readIdx,
    span: [8, 18],
    originalValue: '0x??????2A',
    resolvedValue: '0x2A??????',
  });
  const beEnd = simulatePunningTrace(trace, trace.steps.length - 1, false);
  assert.equal(beEnd.varAfter.get('x')?.text, '0x2A??????');
  assert.equal(beEnd.varAfter.get('y')?.text, '0x2A??????');
});

test('punning read across adjacent known bytes and smaller pointer read flip accurately in LE/BE', () => {
  const adjacent = traceSource(
    `
      uint16_t a{ 5 };
      uint16_t c{ 2 };
      int* b = reinterpret_cast<int*>(&a);
      int x = *b;
    `,
    { punning: true }
  );
  assert.equal(adjacent.steps.at(-1)!.values.x, 131077);
  assert.equal(hasLargerPointerAccess(adjacent), true);
  const adjBe = simulatePunningTrace(adjacent, adjacent.steps.length - 1, false);
  assert.equal(adjBe.varAfter.get('x')?.text, '327682');
  assert.ok(adjBe.readForeignVars.has('c'));

  const smaller = traceSource(
    `
      int a{ 131077 };
      uint8_t* b = reinterpret_cast<uint8_t*>(&a);
      uint8_t x = *b;
    `,
    { punning: true }
  );
  assert.equal(smaller.steps.at(-1)!.values.x, 5);
  assert.equal(hasLargerPointerAccess(smaller), false);
  const smallBe = simulatePunningTrace(smaller, smaller.steps.length - 1, false);
  assert.equal(smallBe.varAfter.get('x')?.text, '0');
});

test('smaller pointer write modifies only the low/high byte depending on endianness', () => {
  const trace = traceSource(
    `
      int a{ 5 };
      uint8_t* b = reinterpret_cast<uint8_t*>(&a);
      *b = 10;
    `,
    { punning: true }
  );
  assert.equal(trace.steps.at(-1)!.values.a, 10);
  const be = simulatePunningTrace(trace, trace.steps.length - 1, false);
  // In BE, 5 is 00 00 00 05; writing 0x0A to byte 0 produces 0x0A000005 = 167772165
  assert.equal(be.varAfter.get('a')?.text, '167772165');
});

test('punning traces combine cleanly with --types', () => {
  const trace = traceSource(
    `
      uint8_t a{ 5 };
      int* b = reinterpret_cast<int*>(&a);
      *b = 300;
    `,
    { punning: true, types: true }
  );
  assert.equal(trace.punning, true);
  assert.ok(trace.steps.some(s => s.op?.kind === 'convert'));
  validate(trace);
});

test('punningMinEndAddress reserves trailing padding when pointer targets the last variable', () => {
  const trace = traceSource(
    `
      int* b = nullptr;
      uint8_t a{ 5 };
      b = reinterpret_cast<int*>(&a);
      *b = 300;
    `,
    { punning: true }
  );
  const a = trace.variables.find(v => v.name === 'a')!;
  assert.equal(punningMinEndAddress(trace), a.address + 4);
});

test('punning rejects unsupported constructs and invalid combinations', () => {
  assert.throws(
    () => traceSource('uint8_t a{ 5 };', { bits: true, punning: true }),
    Unsupported
  );
  assert.throws(
    () => traceSource('struct S { int x; }; S s{ 1 };', { punning: true }),
    Unsupported
  );
  assert.throws(
    () => traceSource('float f = 1.0f;', { punning: true }),
    Unsupported
  );
  assert.throws(
    () => traceSource('int a = 1; int& r = a;', { punning: true }),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 5 }; int* b = reinterpret_cast<int*>(&a); *b += 1;',
        { punning: true }
      ),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 5 }; int c{ 10 }; int* b = reinterpret_cast<int*>(&a); int x = *b + 1;',
        { punning: true }
      ),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 5 }; int c{ 10 }; int* b = reinterpret_cast<int*>(&a); std::cout << *b;',
        { punning: true }
      ),
    Unsupported
  );
});

test('punning rejects overwriting a live pointer variable through an overlapping punned write', () => {
  assert.throws(
    () =>
      traceSource(
        `
          uint32_t a{ 1 };
          uint32_t pad{ 2 };
          int64_t* b = reinterpret_cast<int64_t*>(&pad);
          *b = 99;
        `,
        { punning: true }
      ),
    Unsupported
  );
});

test('validate rejects malformed punning traces and colorPoisonHexInSvg skips non-hex ?', () => {
  const valid = traceSource(
    'uint8_t a{ 42 }; int c{ 10 }; int* b = reinterpret_cast<int*>(&a); int x = *b;',
    { punning: true }
  );
  const badBits: ExecutionTrace = { ...valid, bits: true };
  assert.throws(() => validate(badBits), FormatError);

  const badLen: ExecutionTrace = structuredClone(valid);
  badLen.steps[badLen.steps.length - 1].values.x = '0x??2A';
  assert.throws(() => validate(badLen), FormatError);

  // colorPoisonHexInSvg only colors ? inside 0x... hex literals, never ternary or standalone ?
  const sample =
    '<text>int x = 0x??????2A</text><text>a ? b : c</text><text>?</text>';
  const colored = colorPoisonHexInSvg(sample, '#ff0000');
  assert.equal(
    colored,
    '<text>int x = 0x<tspan fill="#ff0000">??????</tspan>2A</text><text>a ? b : c</text><text>?</text>'
  );
});

test('punning derives clean copies, widenings, and punned-to-punned writes accurately in LE and BE', () => {
  // Widening read (uint8_t* -> int): LE gets 4, BE gets 1
  const widened = traceSource(
    `
      int a{ 16909060 };
      uint8_t* p = reinterpret_cast<uint8_t*>(&a);
      int x = *p;
    `,
    { punning: true }
  );
  assert.equal(widened.steps.at(-1)!.values.x, 4);
  const widBe = simulatePunningTrace(widened, widened.steps.length - 1, false);
  assert.equal(widBe.varAfter.get('x')?.text, '1');

  // Clean punned read copied to another variable: LE 513 -> 513, BE 258 -> 258
  const copied = traceSource(
    `
      uint8_t a{ 1 };
      uint8_t c{ 2 };
      uint16_t* p = reinterpret_cast<uint16_t*>(&a);
      uint16_t x = *p;
      uint16_t y = x;
    `,
    { punning: true }
  );
  assert.equal(copied.steps.at(-1)!.values.y, 513);
  const copyBe = simulatePunningTrace(copied, copied.steps.length - 1, false);
  assert.equal(copyBe.varAfter.get('x')?.text, '258');
  assert.equal(copyBe.varAfter.get('y')?.text, '258');

  // Punned read directly into punned write (*q = *p): LE copies 513, BE copies 258
  const punToPun = traceSource(
    `
      uint8_t a{ 1 };
      uint8_t c{ 2 };
      uint8_t d{ 0 };
      uint8_t e{ 0 };
      uint16_t* p = reinterpret_cast<uint16_t*>(&a);
      uint16_t* q = reinterpret_cast<uint16_t*>(&d);
      *q = *p;
    `,
    { punning: true }
  );
  const p2pLe = simulatePunningTrace(punToPun, punToPun.steps.length - 1, true);
  assert.equal(p2pLe.varAfter.get('d')?.text, '1');
  assert.equal(p2pLe.varAfter.get('e')?.text, '2');
  const p2pBe = simulatePunningTrace(punToPun, punToPun.steps.length - 1, false);
  assert.equal(p2pBe.varAfter.get('d')?.text, '1');
  assert.equal(p2pBe.varAfter.get('e')?.text, '2');
});

test('punning rejects arithmetic, narrowing conversions, and cout on endian-dependent punned values', () => {
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 1 }; uint8_t c{ 2 }; uint16_t* p = reinterpret_cast<uint16_t*>(&a); uint16_t x = *p + 1;',
        { punning: true }
      ),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 1 }; uint8_t c{ 2 }; uint16_t* p = reinterpret_cast<uint16_t*>(&a); std::cout << *p;',
        { punning: true }
      ),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'int a{ 16909060 }; uint8_t* p = reinterpret_cast<uint8_t*>(&a); int8_t x = *p;',
        { punning: true }
      ),
    Unsupported
  );
  assert.throws(
    () =>
      traceSource(
        'uint8_t a{ 5 }; int* b = reinterpret_cast<int*>(&a); *b = 300; int y = a + 1;',
        { punning: true }
      ),
    Unsupported
  );
});

test('simulator does not corrupt undeclared variables written before their declaration', () => {
  const trace = traceSource(
    `
      uint8_t a{ 1 };
      int* b = reinterpret_cast<int*>(&a);
      uint8_t c{ 2 };
      b = reinterpret_cast<int*>(&c);
      *b = 300;
      uint8_t d{ 3 };
    `,
    { punning: true }
  );
  const writeIdx = trace.steps.findIndex(s => s.op?.kind === 'write' && s.op.pun);
  assert.ok(writeIdx > 0);
  const beforeDecl = simulatePunningTrace(trace, writeIdx, true);
  assert.equal(beforeDecl.varAfter.get('d'), null);
  assert.equal(beforeDecl.corruptedVars.has('d'), false);

  const afterDecl = simulatePunningTrace(trace, trace.steps.length - 1, true);
  assert.equal(afterDecl.varAfter.get('d')?.text, '3');
  assert.equal(afterDecl.corruptedVars.has('d'), false);
});

test('validate rejects mutated punning traces (wrong via, target, type, byte values, or address substring)', () => {
  const writeTrace = traceSource(
    `
      uint8_t a{ 5 };
      uint8_t c{ 26 };
      int* b = reinterpret_cast<int*>(&a);
      int* q = reinterpret_cast<int*>(&c);
      *b = 300;
    `,
    { punning: true }
  );
  const wIdx = writeTrace.steps.length - 1;

  // Wrong pun.via pointing to a different target
  const wrongVia = structuredClone(writeTrace);
  (wrongVia.steps[wIdx].op as { pun: { via: string } }).pun.via = 'q';
  assert.throws(() => validate(wrongVia), FormatError);

  // Wrong op.name not matching via's target
  const wrongName = structuredClone(writeTrace);
  (wrongName.steps[wIdx].op as { name: string }).name = 'c';
  assert.throws(() => validate(wrongName), FormatError);

  // Mismatched pun.type vs pointer's declared type
  const wrongType = structuredClone(writeTrace);
  (wrongType.steps[wIdx].op as { pun: { type: string; size: number } }).pun = {
    type: 'uint8_t',
    size: 1,
    via: 'b',
  } as unknown as { type: string; size: number };
  assert.throws(() => validate(wrongType), FormatError);

  // Inconsistent stored value after punning write
  const wrongValue = structuredClone(writeTrace);
  wrongValue.steps[wIdx].values.a = 99;
  assert.throws(() => validate(wrongValue), FormatError);

  // Address substring spoofing (*164 must not pass for address 64)
  const badAddr = structuredClone(writeTrace);
  const derefIdx = badAddr.steps.findIndex(s => s.op?.kind === 'deref');
  badAddr.steps[derefIdx - 1].pane = '*164 = 300';
  badAddr.steps[derefIdx].pane = '*164 = 300';
  (badAddr.steps[derefIdx].op as { span: [number, number] }).span = [0, 4];
  assert.throws(() => validate(badAddr), FormatError);

  // Poisoned hex width mismatch on punning read
  const readTrace = traceSource(
    'uint8_t a{ 42 }; int c{ 10 }; int* b = reinterpret_cast<int*>(&a); int x = *b;',
    { punning: true }
  );
  const rIdx = readTrace.steps.findIndex(s => s.op?.kind === 'read' && s.op.pun);
  const badReadHex = structuredClone(readTrace);
  (badReadHex.steps[rIdx].op as { value: string }).value = '0x??2A';
  badReadHex.steps[rIdx].pane = badReadHex.steps[rIdx].pane.replace('0x??????2A', '0x??2A');
  assert.throws(() => validate(badReadHex), FormatError);
});
