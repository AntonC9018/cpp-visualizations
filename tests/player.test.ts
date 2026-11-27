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
    walkSeconds(step: number): number;
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

test('the instant speed jumps to each settled state, and playing holds each a moment', async () => {
  const player = (): Promise<{ index: number; animated: boolean; steps: number }> =>
    page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer as unknown as {
        index: number;
        animated: boolean;
        m: { steps: unknown[] };
      };
      return { index: p.index, animated: p.animated, steps: p.m.steps.length };
    });
  assert.deepEqual(
    await page.$$eval('.cv-speed option', options => options.map(o => o.textContent)),
    ['0.5×', '1×', '1.5×', '2×', '⚡']
  );
  assert.equal(await page.getAttribute('.cv-speed option[value=instant]', 'aria-label'), 'Instant');
  await page.selectOption('.cv-speed', 'instant');
  await page.click('[data-action=next]');
  assert.deepEqual(await player(), { ...(await player()), index: 1, animated: false });
  await page.click('[data-action=play]');
  await page.clock.runFor(500);
  assert.equal((await player()).index, 2, 'the next state shows at once');
  await page.clock.runFor(1000);
  assert.equal((await player()).index, 3, 'and holds before the one after');
  const { steps } = await player();
  await page.clock.runFor(steps * 1000);
  assert.equal((await player()).index, steps - 1);
});

test('instant holds in wall-clock time and settles a paused step without playing it', async () => {
  const player = (): Promise<{ index: number; animated: boolean; running: boolean }> =>
    page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer as unknown as {
        index: number;
        animated: boolean;
        running: boolean;
      };
      return { index: p.index, animated: p.animated, running: p.running };
    });
  // A word to find while the menu has focus, a glyph once chosen or left.
  await page.focus('.cv-speed');
  assert.equal(await page.textContent('.cv-speed option[value=instant]'), 'Instant ⚡');
  await page.focus('[data-action=next]');
  assert.equal(await page.textContent('.cv-speed option[value=instant]'), '⚡');

  await page.selectOption('.cv-speed', '2');
  await page.selectOption('.cv-speed', 'instant');
  await page.click('[data-action=play]');
  await page.clock.runFor(600);
  assert.equal((await player()).index, 0, 'a hold does not follow the 2× rate');
  await page.clock.runFor(400);
  assert.equal((await player()).index, 1);
  await page.click('[data-action=play]');

  await page.selectOption('.cv-speed', '1');
  await page.click('[data-action=next]');
  await page.clock.runFor(300);
  await page.click('[data-action=play]'); // pauses the step under way
  assert.deepEqual(await player(), { index: 2, animated: true, running: false });
  await page.selectOption('.cv-speed', 'instant');
  assert.deepEqual(await player(), { index: 2, animated: false, running: false }, 'settled, still paused');
  await page.click('[data-action=play]');
  await page.clock.runFor(100);
  assert.equal((await player()).index, 3, 'play goes on from the settled state');
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

// This fixture is emitted by the compiler-backed tracer from lesson 05, example 26.
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
  `);
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
  `);
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
    'std::array<uint8_t, 32> a; a[0] = 1; auto p = &a[1];'
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
    const typed = traceSource(source, { types: true });
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
  const bits = traceSource('int16_t a{ 0x1234 }; int64_t b{ a };', { bits: true });
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

test('a bits trace keeps the value in the workbench while printing it', async () => {
  const bits = traceSource('int a{ 7 }; std::cout << a;', { bits: true });
  await page.setContent(PAGE.replace(trace, JSON.stringify(bits).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const print = bits.steps.findIndex(step => step.op?.kind === 'print');
  const shown = await page.locator('.course-visualization').evaluate((h: PlayerElement, step) => {
    h.cvPlayer.settle(step);
    return [...h.cvPlayer.svg.querySelectorAll('.cv-bit-byte')].map(g => g.getAttribute('data-bits')!);
  }, print);
  assert.deepEqual(shown, ['00000000', '00000000', '00000000', '00000111']);
});

test('a bits trace lays variables flush on the byte grid, hatches padding, and pulses only changed bytes', async () => {
  const bits = traceSource('int8_t a{ 5 }; int b; b = 5; b = 2;', { bits: true });
  await page.setContent(PAGE.replace(trace, JSON.stringify(bits).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const write2 = bits.steps.findIndex(step => step.op?.kind === 'write' && step.op.value === '2');
  const uninitStep = bits.steps.findIndex(step => step.values.b === '?');
  const report = await page.locator('.course-visualization').evaluate((h: PlayerElement, { write2, uninitStep }) => {
    const g = h.cvPlayer.g;
    const base = Math.min(...g.leaves.map(l => l.address));
    const bLeaf = g.leaves.find(l => l.name === 'b')!;
    const aligned = g.leaves.every(
      l => Math.abs(l.x - (g.memX + (l.address - base) * g.byteWidth)) < 0.01 &&
           Math.abs(l.w - l.size * g.byteWidth) < 0.01
    );
    h.cvPlayer.settle(uninitStep);
    const uninitHex = h.cvPlayer.svg.querySelector('.cv-byte-hex[data-name="b"]')?.textContent ?? '';
    const paddingCount = h.cvPlayer.svg.querySelectorAll('.cv-byte-padding').length;
    h.cvPlayer.inspect(write2, 1.5);
    const lePulseGs = [...h.cvPlayer.svg.querySelectorAll('.cv-byte-hex[data-name="b"] animateTransform[type="scale"]')].map(
      el => el.parentElement!.parentElement!.getAttribute('transform') ?? ''
    );
    return { aligned, uninitHex, paddingCount, lePulseGs, bx: bLeaf.x, bw: g.byteWidth };
  }, { write2, uninitStep });
  await page.getByRole('button', { name: 'Big-endian' }).click();
  const bePulseGs = await page.locator('.course-visualization').evaluate((h: PlayerElement, step) => {
    h.cvPlayer.inspect(step, 1.5);
    return [...h.cvPlayer.svg.querySelectorAll('.cv-byte-hex[data-name="b"] animateTransform[type="scale"]')].map(
      el => el.parentElement!.parentElement!.getAttribute('transform') ?? ''
    );
  }, write2);
  const pulseX = (t: string): number => Number(t.match(/translate\(([-\d.]+)/)?.[1]);
  assert.equal(report.aligned, true);
  assert.equal(report.uninitHex, '????????');
  assert.equal(report.paddingCount, 1);
  // Only the modified byte pulses: byte 0 (leftmost) in LE, byte 3 (rightmost) in BE.
  assert.equal(report.lePulseGs.length, 1);
  assert.equal(bePulseGs.length, 1);
  assert.ok(Math.abs(pulseX(report.lePulseGs[0]) - (report.bx + report.bw / 2)) < 0.5);
  assert.ok(Math.abs(pulseX(bePulseGs[0]) - (report.bx + 3.5 * report.bw)) < 0.5);
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

// `a += b` opens into `a = 5 + b` as the old value of a arrives at the operator.
test('a compound assignment reads into its operator in both languages', async () => {
  const generated = traceSource('struct P { int x; int y; }; P s{1, 2}; s.x += 4;');
  const read = generated.steps.findIndex(step => step.op?.kind === 'read');
  assert.equal(generated.steps[read].pane, 's.x = 1 + 4');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [lang, theme, status] of [
    ['en', 'dark', 'Read s.x: 1; s.x += … becomes s.x = 1 + …'],
    ['ru', 'light', 'Чтение s.x: 1; s.x += … превращается в s.x = 1 + …'],
  ] as const) {
    await page.setContent(
      PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')).replace(
        'lang="en" data-theme="dark"',
        `lang="${lang}" data-theme="${theme}"`
      )
    );
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const texts = await page.evaluate(stepIndex => {
      const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      const shown: string[][] = [];
      for (const progress of [0.1, 3]) {
        playerEl.inspect(stepIndex, progress);
        if (/NaN|undefined/.test(playerEl.svg.innerHTML)) throw new Error('invalid geometry');
        shown.push([...playerEl.svg.querySelectorAll('text')].map(element => element.textContent ?? ''));
      }
      return shown;
    }, read);
    assert.ok(texts[0].join('').includes('s.x += 4'), 'the pane reads as written until the value arrives');
    assert.ok(texts[1].join('').includes('= 1 +'), 'then the pane reads s.x = 1 + 4');
    assert.equal(await page.locator('.cv-status').textContent(), status);
  }
  assert.deepEqual(errors, []);
});

// The bundled player shows floats as the tracer does: the shortest decimal that reads back.
test('memory cells show the short float display', async () => {
  const generated = traceSource('float f = 0.1f; double d = 1e20;');
  await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const texts = await page.evaluate(() => {
    const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
    playerEl.end();
    return [...playerEl.svg.querySelectorAll('text')].map(element => element.textContent ?? '');
  });
  assert.ok(texts.includes('0.1') && texts.includes('1e+20'), texts.join(' | '));
  assert.ok(!texts.some(text => text.includes('0.100000001')), 'no float noise digits');
});

test('walkSeconds reports multi-level storage walk time per step', async () => {
  const generated = traceSource('struct Inner { int x; }; struct Outer { Inner i; }; Outer o{{3}}; o.i.x += 2;');
  await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
  await page.evaluate(() => window.CourseVisualization!.scan());
  await page.waitForSelector('.cv-player');
  const walks = await page.evaluate(() => {
    const playerEl = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
    return playerEl.m.steps.map((_, i) => playerEl.walkSeconds(i));
  });
  const readIndex = generated.steps.findIndex(step => step.op?.kind === 'read');
  const writeIndex = generated.steps.findIndex(
    (step, i) => i > readIndex && step.op?.kind === 'write'
  );
  assert.equal(walks[0], 0);
  assert.ok(Math.abs(walks[readIndex] - 1.75) < 1e-12, `3-level walk on read: ${walks[readIndex]}`);
  assert.equal(walks[writeIndex], 0, 'compound assignment write stays where read arrived');
});

test('punning view renders write UB, HUD reticle, and live endian switch in both themes', async () => {
  const generated = traceSource(
    `
      uint8_t a{ 5 };
      uint8_t c{ 26 };
      int* b = reinterpret_cast<int*>(&a);
      *b = 300;
    `,
    { punning: true }
  );
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    for (const theme of ['dark', 'light'] as const) {
      await page.setContent(
        PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')).replace(
          'data-theme="dark"',
          `data-theme="${theme}"`
        )
      );
      await page.evaluate(() => window.CourseVisualization!.scan());
      await page.waitForSelector('.cv-player');
      const le = await page.evaluate(() => {
        const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
        for (let i = 0; i < p.m.steps.length; i++) {
          p.settle(i);
          if (/NaN|undefined/.test(p.svg.innerHTML)) throw new Error(`invalid SVG at step ${i}`);
        }
        return {
          reticles: p.svg.querySelectorAll('.cv-pun-reticle').length,
          ubBadges: p.svg.querySelectorAll('.cv-ub-badge').length,
          texts: [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? ''),
        };
      });
      assert.equal(le.reticles, 1);
      assert.equal(le.ubBadges, 1);
      assert.ok(le.texts.includes('44') && le.texts.includes('1') && le.texts.includes('2C'));
      assert.ok(le.texts.includes('⚠ UB'));

      // Flip to Big-endian live
      await page.getByRole('button', { name: 'Big-endian' }).click();
      const beTexts = await page.evaluate(() => {
        const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
        if (/NaN|undefined/.test(p.svg.innerHTML)) throw new Error('invalid BE SVG');
        return [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? '');
      });
      assert.ok(!beTexts.includes('44'), 'LE value 44 disappears in BE');
      assert.ok(beTexts.includes('0') && beTexts.includes('2C'));
    }
    assert.deepEqual(errors, []);
  } finally {
    page.off('pageerror', onError);
  }
});

test('punning view updates poisoned hex reads live across LE and BE and routes 1-byte clean store to number', async () => {
  const poisoned = traceSource(
    `
      uint8_t a{ 42 };
      int c{ 10 };
      int* b = reinterpret_cast<int*>(&a);
      int x = *b;
    `,
    { punning: true }
  );
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.setContent(PAGE.replace(trace, JSON.stringify(poisoned).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const readLe = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      p.end();
      return {
        texts: [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? ''),
        tspans: [...p.svg.querySelectorAll('tspan')].map(el => el.textContent ?? ''),
      };
    });
    assert.ok(readLe.texts.includes('0x??????2A'));
    assert.ok(readLe.tspans.includes('??????'));

    await page.getByRole('button', { name: 'Big-endian' }).click();
    const readBe = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      return {
        texts: [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? ''),
        tspans: [...p.svg.querySelectorAll('tspan')].map(el => el.textContent ?? ''),
        status: document.querySelector('.cv-status')?.textContent ?? '',
      };
    });
    assert.ok(readBe.texts.includes('0x2A??????'));
    assert.ok(readBe.tspans.includes('??????'));
    assert.ok(readBe.status.includes('0x2A??????'), `status bar updates to BE: ${readBe.status}`);

    // Settled render on an endian-patched read step must stay settled (showing BE value, not animated t=0 old expression)
    const readIdx = poisoned.steps.findIndex(s => s.op?.kind === 'read' && s.op.pun);
    const settledBeRead = await page.evaluate(idx => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      p.settle(idx);
      return {
        texts: [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? '').join(' '),
        status: document.querySelector('.cv-status')?.textContent ?? '',
      };
    }, readIdx);
    assert.ok(settledBeRead.texts.includes('0x2A??????'));
    assert.ok(!settledBeRead.texts.includes('*64'));
    assert.ok(settledBeRead.status.includes('0x2A??????'));

    // Varying-length LE/BE static_cast<int>(*p) (`0` -> `255`) must animate cleanly without garbled pane text
    const castVarLen = traceSource(
      `
        int a{ -16777216 };
        uint8_t* p = reinterpret_cast<uint8_t*>(&a);
        int x = static_cast<int>(*p);
      `,
      { punning: true }
    );
    await page.setContent(PAGE.replace(trace, JSON.stringify(castVarLen).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    await page.getByRole('button', { name: 'Big-endian' }).click();
    const evalIdx = castVarLen.steps.findIndex(s => s.op?.kind === 'eval' && s.line === 2);
    const castBe = await page.evaluate(idx => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      p.inspect(idx, 1.5);
      const texts = [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? '');
      // Check that `op.span` on the eval step shifted to cover all of `static_cast<int>(255)` with no leftover `5)`
      const hasGarbledSuffix = texts.some(t => t === '5)' || t === 'static_cast<int>(25');
      p.end();
      const endText = [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? '');
      return { hasGarbledSuffix, endText };
    }, evalIdx);
    assert.equal(castBe.hasGarbledSuffix, false, 'old cast wrapper is replaced whole in BE');
    assert.ok(castBe.endText.includes('255'));

    // Clean 1-byte store (`uint8_t x = *b;`) uses native scalar transfer into x's number center, not a byte tile at y+70
    const smaller = traceSource(
      `
        int a{ 131077 };
        uint8_t* b = reinterpret_cast<uint8_t*>(&a);
        uint8_t x = *b;
      `,
      { punning: true }
    );
    await page.setContent(PAGE.replace(trace, JSON.stringify(smaller).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const motion = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      const last = p.m.steps.length - 1;
      p.inspect(last, 0.8);
      const paths = [...p.svg.querySelectorAll('animateMotion')].map(el => el.getAttribute('path') ?? '');
      const xBox = p.g.box('x')!;
      return { paths, targetY: xBox.y + xBox.h / 2, byteRowY: xBox.y + 70 };
    });
    assert.equal(motion.paths.length, 1);
    assert.ok(
      motion.paths[0].endsWith(` ${motion.targetY}`),
      `expected flight to number center y=${motion.targetY}, got ${motion.paths[0]}`
    );
    assert.ok(!motion.paths[0].endsWith(` ${motion.byteRowY}`));
    assert.deepEqual(errors, []);
  } finally {
    page.off('pageerror', onError);
  }
});

test('punning view renders direct uninitialized reads with UB badge and red poisoned hex', async () => {
  const generated = traceSource('int a;\nint b = a;\nstd::cout << b << std::endl;', { punning: true });
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.setContent(PAGE.replace(trace, JSON.stringify(generated).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const summary = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      for (let i = 0; i < p.m.steps.length; i++) {
        p.settle(i);
        if (/NaN|undefined/.test(p.svg.innerHTML)) throw new Error(`invalid SVG at step ${i}`);
      }
      return {
        ubBadges: p.svg.querySelectorAll('.cv-ub-badge').length,
        texts: [...p.svg.querySelectorAll('text')].map(el => el.textContent ?? ''),
        tspans: [...p.svg.querySelectorAll('tspan')].map(el => el.textContent ?? ''),
      };
    });
    assert.ok(summary.ubBadges >= 1);
    assert.ok(summary.texts.includes('⚠ UB'));
    assert.ok(summary.texts.includes('0x????????'));
    assert.ok(summary.tspans.includes('????????'));
    assert.deepEqual(errors, []);
  } finally {
    page.off('pageerror', onError);
  }
});

test('static layout renders array fields with element alignment and C-array syntax', async () => {
  const arrLayout: LayoutTrace = {
    format: 1,
    kind: 'layout',
    records: [
      {
        name: 'B',
        size: 16,
        alignment: 4,
        fields: [
          { name: 'tag', type: 'uint8_t', offset: 0, size: 1, kind: 'int' },
          { name: 'vals', type: 'int[2]', offset: 4, size: 8, kind: 'int', alignment: 4, count: 2 },
          { name: 'end', type: 'uint8_t', offset: 12, size: 1, kind: 'int' },
        ],
      },
    ],
  };
  await showLayout(arrLayout, 760);
  const text = (await page.locator('.cv-layout-record').textContent()) ?? '';
  assert.match(text, /int vals\[2\];/);
  assert.match(text, /alignof = max\(1, 4, 1\) = 4/);
  assert.match(text, /padding 6 B/);
  assert.equal(await page.locator('.cv-byte.cv-byte-elem').count(), 1);
  await page.locator('.cv-layout-fact[data-layout-key="0:widest"]').hover();
  assert.equal(await linkedBytes(), 8);
});

test('stacked bits view expands small memory, wraps long lines, and centers the workbench card', async () => {
  const narrowBits = traceSource(
    [
      'int8_t peace{ -1 };',
      'uint8_t rage = static_cast<uint8_t>(peace);',
      'std::cout << static_cast<int>(rage) << std::endl;',
    ].join('\n'),
    { bits: true }
  );
  const signExtBits = traceSource(
    ['int8_t temp{ -5 };', 'int16_t forecast = temp;', 'std::cout << forecast << std::endl;'].join('\n'),
    { bits: true }
  );
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    for (const width of [496, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [label, bitsTrace] of [
        ['narrow', narrowBits],
        ['sign-ext', signExtBits],
      ] as const) {
        await page.setContent(PAGE.replace(trace, JSON.stringify(bitsTrace).replace(/</g, '\\u003c')));
        await page.evaluate(() => window.CourseVisualization!.scan());
        await page.waitForSelector('.cv-player');
        const report = await page.evaluate(() => {
          const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
          const g = p.g;
          const outOfPane: string[] = [];
          let checkedSteps = 0;
          for (let step = 0; step < p.m.steps.length; step++) {
            p.settle(step);
            if (/NaN|undefined/.test(p.svg.innerHTML)) throw new Error(`invalid SVG at step ${step}`);
            const bytes = [...p.svg.querySelectorAll('.cv-bit-byte')];
            if (bytes.length > 0) {
              checkedSteps++;
              const paneBox = p.svg.querySelector('.cv-pane rect')!.getBoundingClientRect();
              for (const b of bytes) {
                const box = b.getBoundingClientRect();
                if (box.left < paneBox.left - 0.5 || box.right > paneBox.right + 0.5) {
                  outOfPane.push(`step ${step}`);
                }
              }
            }
          }
          // Verify workbench card is horizontally centered inside the pane on a 1-byte step.
          const oneByteStep = p.m.steps.findIndex(s => {
            p.settle(p.m.steps.indexOf(s));
            return p.svg.querySelectorAll('.cv-bit-byte').length === 1;
          });
          let cardCenterDelta: number | null = null;
          if (oneByteStep >= 0) {
            p.settle(oneByteStep);
            const paneRect = p.svg.querySelector('.cv-pane rect')!;
            const cardRect = [...p.svg.querySelectorAll('rect')].find(
              r => r.getAttribute('rx') === '8' && Number(r.getAttribute('y')) > g.ty
            );
            if (cardRect) {
              const px = Number(paneRect.getAttribute('x'));
              const pw = Number(paneRect.getAttribute('width'));
              const cx = Number(cardRect.getAttribute('x'));
              const cw = Number(cardRect.getAttribute('width'));
              cardCenterDelta = Math.abs(cx + cw / 2 - (px + pw / 2));
            }
          }
          return {
            stacked: g.stacked,
            byteWidth: g.byteWidth,
            cellH: g.leaves[0].h,
            lastLineRows: g.codeRows.at(-1)!.length,
            outOfPane,
            checkedSteps,
            cardCenterDelta,
          };
        });
        assert.equal(report.stacked, true, `${label}@${width}`);
        assert.ok(report.byteWidth > 100, `${label}@${width}: byteWidth=${report.byteWidth}`);
        assert.ok(report.cellH > 88, `${label}@${width}: cellH=${report.cellH}`);
        assert.ok(report.checkedSteps > 0, `${label}@${width}: checked workbench steps`);
        assert.deepEqual(report.outOfPane, [], `${label}@${width}: bytes stay inside pane`);
        assert.ok(
          report.cardCenterDelta !== null && report.cardCenterDelta < 1,
          `${label}@${width}: card centered (delta=${report.cardCenterDelta})`
        );
        if (label === 'narrow') {
          assert.ok(report.lastLineRows > 1, `long std::cout line wraps at width=${width}`);
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    page.off('pageerror', onError);
  }
});

test('wrapped stacked punning splits cross-row access overlays and routes arrows around siblings', async () => {
  const crossRowAccess = traceSource(
    `
      int a{ 1 };
      int b{ 2 };
      int c{ 3 };
      int d{ 4 };
      int64_t* p = reinterpret_cast<int64_t*>(&c);
      *p = 300;
    `,
    { punning: true }
  );
  const siblingPtrs = traceSource(
    `
      int a{ 1 };
      int b{ 2 };
      int* p1 = &a;
      int* p2 = &a;
    `,
    { punning: true }
  );
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({ width: 496, height: 900 });

    // 1. Cross-row access `[68, 76)` wraps across row 0 `[64, 72)` and row 1 `[72, 80)`.
    await page.setContent(PAGE.replace(trace, JSON.stringify(crossRowAccess).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const accessReport = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      p.end();
      const g = p.g;
      const reticle = p.svg.querySelector('.cv-pun-reticle[data-ptr="p"]')!;
      const rects = [...reticle.querySelectorAll('rect')].map(r => ({
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
        w: Number(r.getAttribute('width')),
      }));
      const row0Right = g.memX + (g.flushRows[0].endAddress - g.flushRows[0].startAddress) * g.byteWidth + 4;
      return {
        rowCount: g.flushRows.length,
        rectCount: rects.length,
        rowYs: rects.map(r => Math.round(r.y)),
        maxRight: Math.max(...rects.map(r => r.x + r.w)),
        row0Right,
        ubBadges: p.svg.querySelectorAll('.cv-ub-badge').length,
      };
    });
    assert.equal(accessReport.rowCount, 2);
    assert.equal(accessReport.rectCount, 2, 'reticle splits into one segment per flush row');
    assert.ok(accessReport.rowYs[1] > accessReport.rowYs[0] + 80, 'second reticle segment sits on row 1');
    assert.ok(accessReport.maxRight <= accessReport.row0Right + 1, 'reticle stays inside row bounds');
    assert.equal(accessReport.ubBadges, 1);

    // 2. Second pointer on row 1 (`p2`, right of `p1`) exits upward instead of cutting across `p1`.
    await page.setContent(PAGE.replace(trace, JSON.stringify(siblingPtrs).replace(/</g, '\\u003c')));
    await page.evaluate(() => window.CourseVisualization!.scan());
    await page.waitForSelector('.cv-player');
    const arrowReport = await page.evaluate(() => {
      const p = (document.querySelector('.course-visualization') as PlayerElement).cvPlayer;
      p.end();
      const g = p.g;
      const p2 = g.leaves.find(l => l.name === 'p2')!;
      const paths = [...p.svg.querySelectorAll('path[stroke-width="2.6"]')].map(el => el.getAttribute('d') ?? '');
      const starts = paths.map(d => {
        const m = /^M\s+([-\d.]+)\s+([-\d.]+)/.exec(d);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
      });
      return { p2Top: p2.y, p2CenterX: p2.x + p2.w / 2, starts };
    });
    const p2Start = arrowReport.starts.find(
      s => s && Math.abs(s.x - arrowReport.p2CenterX) < 1 && Math.abs(s.y - (arrowReport.p2Top - 2)) < 1
    );
    assert.ok(p2Start, `expected p2 arrow to exit from top center, got ${JSON.stringify(arrowReport.starts)}`);
    assert.deepEqual(errors, []);
  } finally {
    page.off('pageerror', onError);
  }
});


