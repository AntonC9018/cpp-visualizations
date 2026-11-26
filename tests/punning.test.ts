import assert from 'node:assert/strict';
import test from 'node:test';
import { NeedsFlag, Unsupported } from '../src/core/errors.ts';
import {
  hasLargerPointerAccess,
  hasUninitializedRead,
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
  const adjReadIdx = adjacent.steps.findIndex(s => s.op?.kind === 'read' && s.op.pun);
  const adjReadBe = simulatePunningTrace(adjacent, adjReadIdx, false);
  assert.ok(adjReadBe.readForeignVars.has('c'));
  const adjBe = simulatePunningTrace(adjacent, adjacent.steps.length - 1, false);
  assert.equal(adjBe.varAfter.get('x')?.text, '327682');
  assert.equal(adjBe.readForeignVars.size, 0);

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

  // Address substring spoofing (*164 and *640 must not pass for address 64)
  const badAddr = structuredClone(writeTrace);
  const derefIdx = badAddr.steps.findIndex(s => s.op?.kind === 'deref');
  // Keep the preceding read consistent by placing the spoofed *164 right on the deref step (and its prior pane via op: null)
  badAddr.steps[derefIdx - 1] = {
    ...badAddr.steps[derefIdx - 1],
    pane: '*164 = 300',
    expr: [0, 10],
    op: null,
  };
  badAddr.steps[derefIdx] = {
    ...badAddr.steps[derefIdx],
    pane: '*164 = 300',
    expr: [0, 10],
    op: { ...(badAddr.steps[derefIdx].op as Record<string, unknown>), span: [0, 4] } as typeof badAddr.steps[number]['op'],
  };
  assert.throws(() => validate(badAddr), err => err instanceof FormatError && /does not cover \*64/.test(err.message));

  // Trailing digit outside span (*64 sliced out of *640 = 300) must also fail
  const badDigitBoundary = structuredClone(writeTrace);
  badDigitBoundary.steps[derefIdx - 1] = {
    ...badDigitBoundary.steps[derefIdx - 1],
    pane: '*640 = 300',
    expr: [0, 10],
    op: null,
  };
  badDigitBoundary.steps[derefIdx] = {
    ...badDigitBoundary.steps[derefIdx],
    pane: '*640 = 300',
    expr: [0, 10],
    op: { ...(badDigitBoundary.steps[derefIdx].op as Record<string, unknown>), span: [0, 3] } as typeof badDigitBoundary.steps[number]['op'],
  };
  assert.throws(
    () => validate(badDigitBoundary),
    err => err instanceof FormatError && /does not cover \*64/.test(err.message)
  );

  // Poisoned hex width mismatch and half-poisoned byte pairs (`0xA?`)
  const readTrace = traceSource(
    'uint8_t a{ 42 }; int c{ 10 }; int* b = reinterpret_cast<int*>(&a); int x = *b;',
    { punning: true }
  );
  const rIdx = readTrace.steps.findIndex(s => s.op?.kind === 'read' && s.op.pun);
  const badReadHex = structuredClone(readTrace);
  (badReadHex.steps[rIdx].op as { value: string }).value = '0x??2A';
  badReadHex.steps[rIdx].pane = badReadHex.steps[rIdx].pane.replace('0x??????2A', '0x??2A');
  assert.throws(() => validate(badReadHex), FormatError);

  const halfByte = structuredClone(readTrace);
  (halfByte.steps[rIdx].op as { value: string }).value = '0x000000?A';
  halfByte.steps[rIdx].pane = halfByte.steps[rIdx].pane.replace('0x??????2A', '0x000000?A');
  assert.throws(() => validate(halfByte), FormatError);

  // Punned read with arbitrary wrong value (`123`) must be rejected against actual bytes
  const wrongReadVal = structuredClone(readTrace);
  (wrongReadVal.steps[rIdx].op as { value: string }).value = '123';
  wrongReadVal.steps[rIdx].pane = wrongReadVal.steps[rIdx].pane.replace('0x??????2A', '123');
  wrongReadVal.steps[rIdx].expr = [8, 11];
  assert.throws(() => validate(wrongReadVal), err => err instanceof FormatError && /yields '0x\?\?\?\?\?\?2A'/.test(err.message));

  // Punned write with out-of-range value (`300` through `uint8_t*`) must fail
  const narrowWrite = traceSource(
    'int a{ 5 }; uint8_t* b = reinterpret_cast<uint8_t*>(&a); *b = 10;',
    { punning: true }
  );
  const nwIdx = narrowWrite.steps.length - 1;
  const oobWriteVal = structuredClone(narrowWrite);
  for (const s of oobWriteVal.steps) {
    if (s.line === narrowWrite.steps[nwIdx].line) {
      s.pane = s.pane.replace('10', '300');
      if (s.expr) s.expr = [s.expr[0], s.expr[1] + 1];
    }
  }
  const nwOp = oobWriteVal.steps[nwIdx].op as { value: string; span: [number, number] };
  nwOp.value = '300';
  nwOp.span = [nwOp.span[0], nwOp.span[0] + 3];
  oobWriteVal.steps[nwIdx].values.a = 44;
  assert.throws(() => validate(oobWriteVal), err => err instanceof FormatError && /does not fit in uint8_t/.test(err.message));

  // Punned write must not authorize mutating an undeclared (`null`) overlapping variable
  const lateDecl = traceSource(
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
  const ldWriteIdx = lateDecl.steps.findIndex(s => s.op?.kind === 'write' && s.op.pun);
  const badLateDecl = structuredClone(lateDecl);
  badLateDecl.steps[ldWriteIdx].values.d = 1;
  assert.throws(() => validate(badLateDecl), FormatError);
});

test('punning handles 64-bit BE values above MAX_SAFE_INTEGER, all-poisoned reads, long-vs-long-long, float* rejection, and widening --types', () => {
  // 64-bit BE read > 2^53 - 1 into *q = *p must not fall back to LE
  const big64 = traceSource(
    `
      uint32_t a{ 268435456 };
      uint32_t c{ 0 };
      uint32_t d{ 0 };
      uint32_t e{ 0 };
      uint64_t* p = reinterpret_cast<uint64_t*>(&a);
      uint64_t* q = reinterpret_cast<uint64_t*>(&d);
      *q = *p;
    `,
    { punning: true }
  );
  const bigBe = simulatePunningTrace(big64, big64.steps.length - 1, false);
  assert.equal(bigBe.varAfter.get('d')?.text, '268435456');
  assert.equal(bigBe.varAfter.get('e')?.text, '0');

  // All-indeterminate punned read stays `0x????????` (poisoned), never collapsing to `?`
  const allPoison = traceSource(
    `
      uint8_t a;
      int* b = reinterpret_cast<int*>(&a);
      int x = *b;
      int y = x;
    `,
    { punning: true }
  );
  assert.equal(allPoison.steps.at(-1)!.values.x, '0x????????');
  const allPoisonLe = simulatePunningTrace(allPoison, allPoison.steps.length - 1, true);
  assert.equal(allPoisonLe.varAfter.get('x')?.text, '0x????????');
  assert.equal(allPoisonLe.varAfter.get('x')?.poisoned, true);
  assert.equal(allPoisonLe.varAfter.get('y')?.text, '0x????????');
  assert.equal(allPoisonLe.paneReadReplacement, null);

  // Distinct canonical types with same width/signedness (`long long*` to `long`) still get a reticle
  const longPun = traceSource(
    `
      long a{ 5 };
      long long* b = reinterpret_cast<long long*>(&a);
      *b = 7;
    `,
    { punning: true }
  );
  const longSim = simulatePunningTrace(longPun, longPun.steps.length - 1, true);
  assert.equal(longSim.punPointers.length, 1);
  assert.equal(longSim.punPointers[0].ptrName, 'b');

  // Widening convert with `--punning --types` downgrades directRead so storeAfterPunRead does not index past pun.size
  const widenedTyped = traceSource(
    `
      uint8_t a{ 1 };
      uint8_t c{ 2 };
      uint16_t* p = reinterpret_cast<uint16_t*>(&a);
      int x = *p;
    `,
    { punning: true, types: true }
  );
  const wtEnd = simulatePunningTrace(widenedTyped, widenedTyped.steps.length - 1, false);
  assert.equal(wtEnd.storeAfterPunRead, null);
  assert.equal(wtEnd.varAfter.get('x')?.text, '258');

  // float* is rejected upfront in --punning mode
  assert.throws(
    () => traceSource('int a{ 5 }; float* fp = reinterpret_cast<float*>(&a);', { punning: true }),
    Unsupported
  );

  // Repeated OOB writes only set ubTriggeredNow on the first write and track corruptedBefore on the second
  const repeated = traceSource(
    `
      uint8_t a{ 5 };
      int c{ 10 };
      int* b = reinterpret_cast<int*>(&a);
      *b = 300;
      *b = 400;
    `,
    { punning: true }
  );
  const writeIndices = repeated.steps
    .map((s, i) => (s.op?.kind === 'write' && s.op.pun ? i : -1))
    .filter(i => i >= 0);
  assert.equal(writeIndices.length, 2);
  const firstWrite = simulatePunningTrace(repeated, writeIndices[0], true);
  assert.equal(firstWrite.punPointers[0].ubTriggeredNow, true);
  assert.equal(firstWrite.bytes[1].corruptedBefore, false);
  const secondWrite = simulatePunningTrace(repeated, writeIndices[1], true);
  assert.equal(secondWrite.punPointers[0].ubTriggeredNow, false);
  assert.equal(secondWrite.bytes[1].corruptedBefore, true);
});

test('punning traces direct and same-type pointer uninitialized reads, conversions, and cout', () => {
  // Direct read + copy + same-type pointer deref + overwrite clearing UB
  const direct = traceSource(
    `
      int a;
      int b = a;
      int* p = &a;
      int c = *p;
      a = 7;
    `,
    { punning: true }
  );
  assert.equal(hasUninitializedRead(direct), true);
  assert.equal(hasLargerPointerAccess(direct), false);
  const readIdx = direct.steps.findIndex(s => s.op?.kind === 'read' && s.op.name === 'a');
  assert.ok(readIdx > 0);
  assert.equal(direct.steps[readIdx].op?.kind === 'read' ? direct.steps[readIdx].op.value : null, '0x????????');
  assert.equal(direct.steps[readIdx].op?.kind === 'read' ? direct.steps[readIdx].op.pun : 'x', undefined);

  const onRead = simulatePunningTrace(direct, readIdx, true);
  assert.equal(onRead.activePoisonRead?.varName, 'a');
  assert.equal(onRead.activePoisonRead?.readResult.text, '0x????????');
  assert.ok(onRead.uninitUbVars.has('a'));
  assert.ok(onRead.uninitUbTriggeredNow.has('a'));
  assert.equal(onRead.paneReadReplacement, null);

  const afterWriteB = simulatePunningTrace(direct, readIdx + 1, true);
  assert.equal(afterWriteB.varAfter.get('b')?.text, '0x????????');
  assert.equal(afterWriteB.varAfter.get('b')?.poisoned, true);
  assert.equal(afterWriteB.storeAfterPoisonRead?.destVar.name, 'b');

  const atEnd = simulatePunningTrace(direct, direct.steps.length - 1, true);
  assert.equal(atEnd.varAfter.get('a')?.text, '7');
  assert.equal(atEnd.uninitUbVars.has('a'), false);
  assert.equal(atEnd.varAfter.get('b')?.text, '0x????????');
  assert.equal(atEnd.varAfter.get('c')?.text, '0x????????');

  // Printing an uninitialized int (endian-independent 0x????????)
  const printed = traceSource('int a;\nstd::cout << a << std::endl;', { punning: true });
  assert.equal(printed.steps.at(-1)!.stdout, '0x????????\n');

  // Unsigned widening (`uint8_t` -> `int` = `0x000000??`), signed widening (`int8_t` -> `int` = `0x????????`), narrowing (`int` -> `uint8_t` = `0x??`)
  for (const typed of [false, true]) {
    const conv = traceSource(
      `
        uint8_t u;
        int w = u;
        int8_t s;
        int sw = s;
        uint8_t n = static_cast<uint8_t>(sw);
      `,
      { punning: true, types: typed }
    );
    const last = conv.steps.at(-1)!;
    assert.equal(last.values.w, '0x000000??');
    assert.equal(last.values.sw, '0x????????');
    assert.equal(last.values.n, '0x??');
    const leEnd = simulatePunningTrace(conv, conv.steps.length - 1, true);
    const beEnd = simulatePunningTrace(conv, conv.steps.length - 1, false);
    assert.equal(leEnd.varAfter.get('w')?.text, '0x000000??');
    assert.equal(beEnd.varAfter.get('w')?.text, '0x000000??');
    assert.equal(beEnd.varAfter.get('sw')?.text, '0x????????');
    assert.equal(beEnd.varAfter.get('n')?.text, '0x??');
  }

  // Copying an uninitialized pointer works; dereferencing it is still rejected
  const uninitPtr = traceSource('int* p;\nint* q = p;', { punning: true });
  assert.equal(uninitPtr.steps.at(-1)!.values.q, '0x????????????????');
  assert.throws(() => traceSource('int* p;\nint x = *p;', { punning: true }), Unsupported);
});

test('punning supports std::byte as a 1-byte unsigned type', () => {
  const trace = traceSource(
    `
      int a{ 261 };
      std::byte* p = reinterpret_cast<std::byte*>(&a);
      std::byte low = *p;
      *p = std::byte{ 9 };
    `,
    { punning: true }
  );
  assert.equal(trace.steps.at(-1)!.values.low, 5);
  assert.equal(trace.steps.at(-1)!.values.a, 265);
  const be = simulatePunningTrace(trace, trace.steps.length - 1, false);
  assert.equal(be.varAfter.get('low')?.text, '0');
  // In BE, 261 is 00 00 01 05; writing 0x09 to byte 0 gives 0x09000105 = 150995205
  assert.equal(be.varAfter.get('a')?.text, '150995205');
});

test('regular tracing raises NeedsFlag(punning) when punning mode would succeed', () => {
  for (const source of [
    'uint8_t a{ 5 }; int* b = reinterpret_cast<int*>(&a); *b = 300;',
    'uint8_t a{ 5 }; int* b = (int*)&a; *b = 300;',
    'uint8_t a{ 5 }; void* vp = &a; int* b = static_cast<int*>(vp); *b = 300;',
    'int a; int b = a;',
    'int a; std::cout << a << std::endl;',
  ]) {
    assert.throws(
      () => traceSource(source),
      (err: unknown) =>
        err instanceof NeedsFlag &&
        err.flag === 'punning' &&
        err.causeName === 'Unsupported' &&
        /\(--punning\)/.test(err.message),
      source
    );
  }

  // Respects accept() callback: if caller refuses the punning trace, do not raise NeedsFlag
  assert.throws(
    () =>
      traceSource('int a; int b = a;', {
        accept: () => {
          throw new Unsupported('rejected by caller');
        },
      }),
    (err: unknown) => err instanceof Unsupported && !(err instanceof NeedsFlag)
  );

  // Snippets that also fail in punning mode do not suggest punning
  assert.throws(
    () => traceSource('struct S { int x; }; S a; int b = a.x;'),
    (err: unknown) => err instanceof Unsupported && !(err instanceof NeedsFlag)
  );
});
