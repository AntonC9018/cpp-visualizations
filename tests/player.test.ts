// Browser tests for the site player: keyboard focus survives every redraw.
// Run from the course root (see visualizations/README.md):
//   nix develop --command npm test --prefix visualizations
// Chromium comes from $CHROMIUM_EXECUTABLE (the default shell sets it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { type Browser, type Page, chromium } from 'playwright';

import type { ExecutionTrace, LayoutTrace } from '../src/core/trace_format.ts';
import { trace as traceSource } from '../src/node/tracing.ts';
import type {} from '../src/player/index.ts';
import type { Geometry } from '../src/player/geometry.ts';

const player = new URL('../player/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, player), 'utf8');
// Lines: int a = 5; int b = 6; int* p = &a; int** pp = &p; **pp = 7; …
const trace = read('fixtures/pointer-double.json').replace(/</g, '\\u003c');
const PAGE = `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
<style>${read('player.css')}</style>
<div class="course-visualization"><script type="application/json">${trace}</script></div>
<script>${read('player.js')}</script>`;

interface PlayerElement extends HTMLElement {
  cvPlayer: {
    index: number;
    m: { steps: unknown[] };
    svg: SVGSVGElement;
    g: Geometry;
    settle(step: number): void;
    inspect(step: number, progress: number): void;
    end(): void;
  };
}

let browser: Browser | undefined;
let page: Page;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
});
after(() => browser?.close());
beforeEach(async () => {
  page = await browser!.newPage({ viewport: { width: 1100, height: 900 } });
  // A fake clock drives requestAnimationFrame, so animations finish on demand.
  await page.clock.install();
  await page.setContent(PAGE);
});

const index = (): Promise<number> =>
  page.evaluate(
    () => (document.querySelector('.course-visualization') as PlayerElement).cvPlayer.index
  );
const focused = (): Promise<{
  inside: boolean;
  line: string | null;
  action: string | null;
  tag: string;
}> =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const root = document.querySelector('.cv-player')!;
    return {
      inside: root.contains(active),
      line: active?.dataset?.line ?? null,
      action: active?.dataset?.action ?? null,
      tag: active?.tagName ?? '',
    };
  });
const finishAnimation = (): Promise<void> => page.clock.runFor(20_000);
// The first step of each source line, from the trace.
const firstStep = (line: number): number =>
  (JSON.parse(read('fixtures/pointer-double.json')) as ExecutionTrace).steps.findIndex(
    s => s.line === line
  );

test('Enter on a code line keeps focus there and the arrow keys step', async () => {
  await page.focus('.cv-line[data-line="1"]');
  await page.keyboard.press('Enter');
  assert.equal(await index(), firstStep(1));
  assert.deepEqual(await focused(), { inside: true, line: '1', action: null, tag: 'rect' });

  await page.keyboard.press('ArrowRight');
  assert.equal(await index(), firstStep(1) + 1);
  // Mid-animation and after the closing redraw, focus is still on the line.
  await page.clock.runFor(300);
  assert.equal((await focused()).line, '1');
  await finishAnimation();
  assert.equal((await focused()).line, '1');
  await page.keyboard.press('ArrowRight');
  assert.equal(await index(), firstStep(1) + 2);
});

test('a theme change keeps focus', async () => {
  await page.focus('.cv-line[data-line="2"]');
  await page.keyboard.press(' ');
  const shown = await index();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForFunction(
      value => (document.querySelector('.cv-player') as HTMLElement).dataset.cvTheme === value,
      theme
    );
    assert.equal((await focused()).line, '2');
  }
  await page.keyboard.press('ArrowRight');
  assert.equal(await index(), shown + 1);
});

test('a theme change during an animation keeps focus', async () => {
  await page.focus('.cv-player [data-action="next"]');
  await page.keyboard.press('Enter');
  await page.clock.runFor(500);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForFunction(
    () => (document.querySelector('.cv-player') as HTMLElement).dataset.cvTheme === 'light'
  );
  assert.equal((await focused()).action, 'next');
  await finishAnimation();
  assert.equal((await focused()).action, 'next');
});

test('a button disabled under focus hands focus to the player', async () => {
  await page.click('.cv-player [data-action="next"]');
  await page.focus('.cv-player [data-action="back"]');
  // Back returns to the first step, which disables the focused Back button.
  await page.keyboard.press('Enter');
  assert.equal(await index(), 0);
  assert.deepEqual(await focused(), { inside: true, line: null, action: null, tag: 'DIV' });
  await page.keyboard.press('ArrowRight');
  assert.equal(await index(), 1);
});

// This fixture is emitted by the compiler/GDB tracer from lesson 05, example 26.
// Its copied pointer still points into s1, while s2.a keeps the old integer value.
test('a generated struct trace plays shallow copies in both themes', async () => {
  const generated = JSON.parse(
    readFileSync(new URL('fixtures/struct-generated.json', import.meta.url), 'utf8')
  ) as ExecutionTrace;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['dark', 'light']) {
    const html = PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')).replace(
      'data-theme="dark"',
      `data-theme="${theme}"`
    );
    await page.setContent(html);
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    await page.evaluate(() => {
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      for (let step = 0; step < playerEl.m.steps.length; step++) {
        playerEl.settle(step);
        if (/NaN|undefined/.test(playerEl.svg.innerHTML)) throw new Error('invalid struct geometry');
      }
      playerEl.end();
    });
    await finishAnimation();
    const shown = (await page.locator('.cv-stage').textContent()) ?? '';
    assert.match(shown, /s1/);
    assert.match(shown, /s2/);
    assert.equal(generated.steps.at(-1)!.values['s1.a'], 2);
    assert.equal(generated.steps.at(-1)!.values['s2.a'], 1);
    assert.equal(generated.steps.at(-1)!.targets['s2.pa'], 's1.a');
  }
  assert.deepEqual(errors, []);
});

// Lesson 04, example 3: a bare `std::cout << std::endl;` prints a newline and no value.
test('a bare std::endl prints a visible newline glyph in both languages and themes', async () => {
  const generated = JSON.parse(
    readFileSync(new URL('fixtures/endl-generated.json', import.meta.url), 'utf8')
  ) as ExecutionTrace;
  const last = generated.steps.length - 1;
  assert.deepEqual(generated.steps[last].op, { kind: 'print', value: '\n', span: [13, 22] });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [lang, theme, status] of [
    ['en', 'dark', 'Print a newline'],
    ['ru', 'light', 'Вывод перевода строки'],
  ] as const) {
    await page.setContent(
      PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')).replace(
        'lang="en" data-theme="dark"',
        `lang="${lang}" data-theme="${theme}"`
      )
    );
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const midPrint = await page.evaluate(stepIndex => {
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      for (let step = 0; step <= stepIndex; step++) {
        playerEl.settle(step);
        if (/NaN|undefined/.test(playerEl.svg.innerHTML)) {
          throw new Error(`invalid geometry at step ${step}`);
        }
      }
      playerEl.inspect(stepIndex, 0.5);
      return [...playerEl.svg.querySelectorAll('text')].map(element => element.textContent);
    }, last);
    // The newline travels as a glyph from `std::endl` and lands as a line break.
    assert.ok(midPrint.includes('↵'), 'the travelling newline is visible');
    assert.equal(await page.locator('.cv-status').textContent(), status);
    await page.evaluate(() =>
      (document.querySelector('.course-visualization') as PlayerElement).cvPlayer.end()
    );
    const settled = await page.evaluate(() =>
      [...document.querySelectorAll('.cv-player svg text')].map(element => element.textContent)
    );
    assert.ok(!settled.includes('↵'), 'no glyph stays in the output');
    assert.ok(settled.includes('2'), 'the earlier output stays');
  }
  assert.deepEqual(errors, []);
});

test('generated array frames show an element address only when used', async () => {
  const generated = traceSource(`
    std::array<int, 3> a{1, 2, 3};
    auto& row = a;
    int& last = row[2];
    int* p = &row[2];
    last = 7;
    p = nullptr;
  `, { runtime: false });
  const start = generated.variables.find(v => v.name === 'a')!.address;
  const address = start + 8;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    const snapshots = await page.evaluate(({ address, start }) => {
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      return playerEl.m.steps.map((_, index) => {
        playerEl.settle(index);
        if (/NaN|undefined/.test(playerEl.svg.innerHTML)) {
          throw new Error(`invalid geometry at step ${index}`);
        }
        const labels = [...playerEl.svg.querySelectorAll('text')];
        const addresses = labels.filter(label => label.getAttribute('font-size') === '16');
        return {
          start: addresses.some(label => label.textContent === String(start)),
          element: addresses.some(label => label.textContent === String(address)),
          lastIndex: labels.some(label => label.textContent === '[2]'),
        };
      });
    }, { address, start });
    const addressTaken = generated.steps.findIndex(s => s.op?.kind === 'addr');
    const writing = generated.steps.findIndex(s => s.line === 4 && s.op?.kind === 'write');
    assert.deepEqual(snapshots[0], { start: true, element: false, lastIndex: true });
    assert.equal(snapshots[addressTaken].element, true);
    assert.equal(snapshots[writing].element, true);
    assert.equal(snapshots.at(-1)?.element, false);
  }
  assert.deepEqual(errors, []);
});

test('the player wraps a long statement only as its available width shrinks', async () => {
  const generated = traceSource(`
    std::array<std::array<int, 2>, 3> arr{
        std::array{1, 2}, {3, 4}, {5, 6},
    };
    arr[2][1] = 8;
  `, { runtime: false });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.evaluate(() => {
    const root = document.querySelector('.course-visualization') as PlayerElement;
    root.cvPlayer.end();
  });

  const rowCount = () => page.evaluate(() => {
    const root = document.querySelector('.course-visualization') as PlayerElement;
    return root.cvPlayer.g.codeRows[0].length;
  });
  assert.equal(await rowCount(), 1);

  // Both widths use the side-by-side layout. Wrapping must still respond to the resize.
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForFunction(() => {
    const { g } = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
    return !g.stacked && g.codeRows[0].length > 1;
  });
  const spacing = await page.evaluate(() => {
    const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
    const rows = p.g.codeRows[0];
    return {
      continuation: rows[1].y - rows[0].y,
      nextStatement: p.g.lineY(1) - rows.at(-1)!.y,
      valid: !/NaN|undefined/.test(p.svg.innerHTML),
    };
  });
  assert.ok(spacing.continuation < spacing.nextStatement);
  assert.ok(spacing.valid);
  assert.equal(await index(), generated.steps.length - 1);
  await page.focus('.cv-line[data-line="0"]');
  await page.keyboard.press('Enter');
  assert.equal(await index(), 0);
});

test('a pointer to a narrow array element lands on its cell', async () => {
  const generated = traceSource(
    'std::array<uint8_t, 32> a; a[0] = 1; auto p = &a[1];',
    { runtime: false }
  );
  await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  const landing = await page.evaluate(() => {
    const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
    playerEl.end();
    const cell = playerEl.g.box('a.[1]')!;
    const arrow = playerEl.svg.querySelector('path[d="M -11 -6.5 L 0 0 L -11 6.5 Z"]')!;
    const transform = arrow.getAttribute('transform')!;
    return { x: Number(/^translate\(([^ ]+)/.exec(transform)![1]), left: cell.x, right: cell.x + cell.w };
  });
  assert.ok(landing.left <= landing.x && landing.x <= landing.right, JSON.stringify(landing));
});

// A typed trace: two conversions, then a statement whose types do not fit.
test('a typed trace labels types and shows a mismatch in both languages and themes', async () => {
  const generated = JSON.parse(
    readFileSync(new URL('fixtures/types-generated.json', import.meta.url), 'utf8')
  ) as ExecutionTrace;
  const last = generated.steps.length - 1;
  assert.equal(generated.steps[last].op?.kind, 'clash');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [lang, theme, status] of [
    ['en', 'dark', 'Does not compile: b is uint8_t, int* p needs int*'],
    ['ru', 'light', 'Не компилируется: b имеет тип uint8_t, а для int* p нужен int*'],
  ] as const) {
    await page.setContent(
      PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')).replace(
        'lang="en" data-theme="dark"',
        `lang="${lang}" data-theme="${theme}"`
      )
    );
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const labels = await page.evaluate(stepIndex => {
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      for (let step = 0; step <= stepIndex; step++) {
        playerEl.settle(step);
        if (/NaN|undefined/.test(playerEl.svg.innerHTML)) {
          throw new Error(`invalid geometry at step ${step}`);
        }
      }
      playerEl.inspect(stepIndex, 0.5);
      return [...playerEl.svg.querySelectorAll('text')].map(element => element.textContent);
    }, last);
    for (const label of ['uint32_t', 'uint8_t', 'int*', '≠']) {
      assert.ok(labels.includes(label), `${label} is drawn`);
    }
    assert.equal(await page.locator('.cv-status').textContent(), status);
  }
  assert.deepEqual(errors, []);
});

test('long pane type labels neither overlap nor leave the pane', async () => {
  for (const source of [
    'unsigned long long a{ 1 }; unsigned long b{ 2 }; unsigned long long c = a + b;',
    'auto a = 1ull; std::cout << a;',
    'int a{ 5 }; int& r{ a };',
  ]) {
    const typed = traceSource(source, { runtime: false, types: true });
    await page.setContent(PAGE.replace(trace, JSON.stringify(typed).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const problems = await page.evaluate(steps => {
      type Box = { x: number; y: number; w: number; h: number };
      const box = (rect: Element): Box => {
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(a => Number(rect.getAttribute(a)));
        return { x, y, w, h };
      };
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      const found: string[] = [];
      for (let step = 0; step < steps; step++) {
        playerEl.settle(step);
        const pane = box(playerEl.svg.querySelector('.cv-pane rect')!);
        const labels = [...playerEl.svg.querySelectorAll('.cv-pane-type')].map(g => ({
          text: g.querySelector('text')!.textContent,
          ...box(g.querySelector('rect')!),
        }));
        labels.forEach((a, i) => {
          if (a.x < pane.x || a.x + a.w > pane.x + pane.w || a.y < pane.y || a.y + a.h > pane.y + pane.h) {
            found.push(`step ${step}: ${a.text} leaves the pane`);
          }
          for (const b of labels.slice(i + 1)) {
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            if (!apart) found.push(`step ${step}: ${a.text} overlaps ${b.text}`);
          }
        });
      }
      return found;
    }, typed.steps.length);
    assert.deepEqual(problems, [], source);
  }
});

test('a bits trace draws bytes in either order and copies the sign bit, in both themes', async () => {
  const bits = traceSource('int8_t a{ -3 }; int b{ static_cast<int>(a) }; uint8_t c{ 253 }; int d{ c };', {
    runtime: false,
    bits: true,
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(PAGE.replace(trace, JSON.stringify(bits).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const host = page.locator('.course-visualization');
  const bytesOf = (name: string): Promise<string> =>
    page.evaluate(
      name => (document.querySelector(`.cv-byte-hex[data-name="${name}"]`)?.textContent ?? '').replace(/(..)/g, '$1 ').trim(),
      name
    );
  const convertFrom = (type: string): number =>
    bits.steps.findIndex(step => step.op?.kind === 'convert' && step.op.from === type);
  const workbench = (step: number): Promise<string[]> =>
    host.evaluate((h: PlayerElement, step) => {
      h.cvPlayer.settle(step);
      return [...h.cvPlayer.svg.querySelectorAll('.cv-bit-byte')].map(g => g.getAttribute('data-bits')!);
    }, step);

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
    await page.getByRole('button', { name: 'Little-endian' }).click();
    await host.evaluate((h: PlayerElement) => h.cvPlayer.end());
    assert.equal(await bytesOf('b'), 'FD FF FF FF');
    assert.equal(await bytesOf('d'), 'FD 00 00 00');
    await page.getByRole('button', { name: 'Big-endian' }).click();
    assert.equal(await page.getByRole('button', { name: 'Big-endian' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await bytesOf('b'), 'FF FF FF FD');

    const signed = await workbench(convertFrom('int8_t'));
    assert.deepEqual([...signed].sort(), ['11111101', '11111111', '11111111', '11111111']);
    const unsigned = await workbench(convertFrom('uint8_t'));
    assert.deepEqual([...unsigned].sort(), ['00000000', '00000000', '00000000', '11111101']);
  }
  assert.deepEqual(errors, []);
});

test('a bits trace reads hex literals and fits eight bytes in a narrow player', async () => {
  const bits = traceSource('int16_t a{ 0x1234 }; int64_t b{ a };', { runtime: false, bits: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 391, height: 900 });
  await page.setContent(PAGE.replace(trace, JSON.stringify(bits).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const host = page.locator('.course-visualization');
  const converts = bits.steps.flatMap((step, i) => (step.op?.kind === 'convert' ? [i] : []));
  const workbench = (step: number) =>
    host.evaluate((h: PlayerElement, step) => {
      h.cvPlayer.settle(step);
      const stage = h.cvPlayer.svg.getBoundingClientRect();
      return [...h.cvPlayer.svg.querySelectorAll('.cv-bit-byte')].map(g => {
        const box = g.getBoundingClientRect();
        return { bits: g.getAttribute('data-bits')!, inside: box.left >= stage.left && box.right <= stage.right };
      });
    }, step);

  const narrowed = await workbench(converts[0]);
  assert.deepEqual(narrowed.map(b => b.bits).slice(-2), ['00010010', '00110100']);
  const widened = await workbench(converts[1]);
  assert.equal(widened.length, 8);
  assert.deepEqual(widened.filter(b => !b.inside), []);
  assert.deepEqual(errors, []);
});

test('a trace without bits has no byte order switch', async () => {
  await page.waitForSelector('.cv-player');
  assert.equal(await page.locator('.cv-endian').count(), 0);
});

// `struct A { uint8_t f1; int f2; uint8_t f3; }`: padding after f1 and after f3.
const PADDED_LAYOUT: LayoutTrace = {
  format: 1,
  kind: 'layout',
  records: [
    {
      name: 'A',
      size: 12,
      alignment: 4,
      fields: [
        { name: 'f1', type: 'uint8_t', offset: 0, size: 1, kind: 'int' },
        { name: 'f2', type: 'int', offset: 4, size: 4, kind: 'int' },
        { name: 'f3', type: 'uint8_t', offset: 8, size: 1, kind: 'int' },
      ],
    },
  ],
};

// `struct A { int a; int b; }`: no padding, so no alignment either.
const PLAIN_LAYOUT: LayoutTrace = {
  format: 1,
  kind: 'layout',
  records: [
    {
      name: 'A',
      size: 8,
      alignment: 4,
      fields: [
        { name: 'a', type: 'int', offset: 0, size: 4, kind: 'int' },
        { name: 'b', type: 'int', offset: 4, size: 4, kind: 'int' },
      ],
    },
  ],
};

const linkedBytes = (): Promise<number> => page.locator('.cv-byte.cv-linked').count();

test('static layout links fields, padding and bytes in both themes and initializes lazily', async () => {
  await page.close();
  page = await browser!.newPage({ viewport: { width: 1100, height: 900 } });
  await page.setContent(`<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
    <style>${read('player.css')}</style><details><summary>Answer</summary>
    <div class="course-visualization"><script type="application/json">${JSON.stringify(PADDED_LAYOUT)}</script>
    </div></details><script>${read('player.js')}</script>`);
  await page.evaluate(() => window.CourseVisualization!.scan());
  assert.equal(await page.locator('.cv-layout').count(), 0);
  await page.locator('summary').click();
  await page.waitForSelector('.cv-layout');
  const text = (await page.locator('.cv-layout-record').textContent()) ?? '';
  assert.match(text, /padding ×3.*padding ×3/);
  assert.match(text, /alignof = max\(1, 4, 1\) = 4/);
  assert.match(text, /padding 6 B/);
  const row = page.locator('.cv-layout-row[data-layout-key="0:1"]');
  const bytes = page.locator('.cv-byte[data-layout-key="0:1"]');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForFunction(
      value => (document.querySelector('.cv-player') as HTMLElement).dataset.cvTheme === value,
      theme
    );
    await page.mouse.move(1000, 800);
    await page.locator('.cv-layout').screenshot({ path: `/tmp/layout-${theme}-idle.png` });
    await row.hover();
    assert.equal(await linkedBytes(), 4);
    await page.locator('.cv-layout').screenshot({ path: `/tmp/layout-${theme}-hover.png` });
    await bytes.first().hover();
    assert.equal(await row.evaluate(e => e.classList.contains('cv-linked')), true);
    await row.focus();
    await page.keyboard.press('Enter');
    assert.equal(await linkedBytes(), 4);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.mouse.move(1000, 800);
    await page.locator('summary').focus();
  }
  await row.focus();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  assert.equal(await row.evaluate(e => e === document.activeElement), true);
  await page.locator('[data-layout-key="0:all"]').first().hover();
  assert.equal(await linkedBytes(), 12);
  // One padding row links its own run; the padding total links every padding byte.
  await page.locator('.cv-layout-padding').first().hover();
  assert.equal(await linkedBytes(), 3);
  await page.locator('.cv-layout-fact[data-layout-key="0:pad"]').hover();
  assert.equal(await linkedBytes(), 6);
  // alignof links the widest field.
  await page.locator('.cv-layout-fact[data-layout-key="0:widest"]').hover();
  assert.equal(await linkedBytes(), 4);
  assert.equal(await row.evaluate(e => e.classList.contains('cv-linked')), true);
  assert.equal(await page.locator('.cv-controls').count(), 0);
});

// `struct A { int a; int* p; }`: 8 bytes are the widest field the layout view draws.
const POINTER_LAYOUT: LayoutTrace = {
  format: 1,
  kind: 'layout',
  records: [
    {
      name: 'A',
      size: 16,
      alignment: 8,
      fields: [
        { name: 'a', type: 'int', offset: 0, size: 4, kind: 'int' },
        { name: 'p', type: 'int *', offset: 8, size: 8, kind: 'ptr' },
      ],
    },
  ],
};
// A fresh page without the fake clock, which would hold back lazy initialization.
const showLayout = async (layout: LayoutTrace, width: number): Promise<void> => {
  await page.close();
  page = await browser!.newPage({ viewport: { width: 1100, height: 900 } });
  await page.setContent(`<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
    <style>${read('player.css')}</style>
    <div class="course-visualization" style="width:${width}px">
    <script type="application/json">${JSON.stringify(layout)}</script></div>
    <script>${read('player.js')}</script>`);
  await page.waitForSelector('.cv-layout');
};

test('static layout shows alignment only when it inserted padding', async () => {
  await showLayout(PLAIN_LAYOUT, 760);
  const text = (await page.locator('.cv-layout-record').textContent()) ?? '';
  assert.doesNotMatch(text, /alignof|padding/);
  assert.equal(await page.locator('.cv-byte-slot').count(), 0);
  // Offsets mark where each field starts, and the end.
  assert.deepEqual(await page.locator('.cv-layout-tick').allTextContents(), ['0', '4', '8']);

  await showLayout(PADDED_LAYOUT, 760);
  assert.equal(await page.locator('.cv-byte-slot').count(), 3);
  assert.deepEqual(await page.locator('.cv-layout-tick').allTextContents(), ['0', '4', '8', '12']);
});

test('static layout exposes the locked selection as pressed toggle buttons', async () => {
  await showLayout(POINTER_LAYOUT, 760);
  const pressed = (): Promise<Array<string | undefined>> =>
    page
      .locator('[aria-pressed="true"]')
      .evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.layoutKey));
  const row = page.locator('.cv-layout-row[data-layout-key="0:1"]');
  assert.equal(await page.locator('.cv-layout-target:not([aria-pressed="false"])').count(), 0);
  await row.click();
  assert.deepEqual(await pressed(), ['0:1']);
  assert.equal(await linkedBytes(), 8);
  await row.click();
  assert.deepEqual(await pressed(), []);
  // Clicking a byte locks its field, and the field's row shows as pressed.
  await page.locator('.cv-byte[data-layout-key="0:0"]').first().click();
  assert.deepEqual(await pressed(), ['0:0']);
  await page.keyboard.press('Escape');
  assert.deepEqual(await pressed(), []);
  assert.equal(await page.locator('.cv-linked').count(), 0);
});

test('static layout fits the tape and field names in a narrow host without clipping', async () => {
  const node: LayoutTrace = {
    format: 1,
    kind: 'layout',
    records: [
      {
        name: 'Node',
        size: 32,
        alignment: 8,
        fields: [
          { name: 'tag', type: 'uint8_t', offset: 0, size: 1, kind: 'int' },
          { name: 'id', type: 'uint64_t', offset: 8, size: 8, kind: 'int' },
          { name: 'flags', type: 'uint8_t', offset: 16, size: 1, kind: 'int' },
          { name: 'count', type: 'int', offset: 20, size: 4, kind: 'int' },
          { name: 'next', type: 'Node *', offset: 24, size: 8, kind: 'ptr' },
        ],
      },
    ],
  };
  for (const [name, layout, width] of [
    ['pointer-narrow', POINTER_LAYOUT, 224],
    ['node-narrow', node, 300],
    ['node-desktop', node, 760],
  ] as const) {
    await showLayout(layout, width);
    const problems = await page.evaluate(() => {
      const host = document.querySelector('.course-visualization')!.getBoundingClientRect();
      const outside = [
        ...document.querySelectorAll('.cv-layout-target, .cv-layout-label > b, .cv-layout-tick'),
      ].filter(element => {
        const box = element.getBoundingClientRect();
        return box.left < host.left - 0.5 || box.right > host.right + 0.5;
      });
      const overflowing = [...document.querySelectorAll('.cv-player')].filter(
        element => element.scrollWidth > element.clientWidth
      );
      // Field names sharing a row must not touch.
      const names = [...document.querySelectorAll<HTMLElement>('.cv-layout-label')];
      const overlapping = names.filter((label, i) =>
        names.slice(i + 1).some(other => {
          if (other.style.gridRow !== label.style.gridRow) return false;
          const a = label.firstElementChild!.getBoundingClientRect();
          const b = other.firstElementChild!.getBoundingClientRect();
          return a.right > b.left && b.right > a.left;
        })
      );
      return [...outside, ...overflowing, ...overlapping].map(element =>
        element.outerHTML.slice(0, 80)
      );
    });
    assert.deepEqual(problems, [], `${name}: clipped, overflowing or overlapping elements`);
    await page.locator('.course-visualization').screenshot({ path: `/tmp/layout-${name}.png` });
  }
});
