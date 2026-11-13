// Browser tests for playground UI, Web Worker Clang WASM execution, Cache API persistence,
// and configurable wasmUrl.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYER_DIR = resolve(ROOT, 'player');
const REAL_WASM_PATH =
  process.env.CLANG_TRACE_WASM || resolve(PLAYER_DIR, 'clang-trace-frontend.wasm');
const HAS_REAL_WASM = existsSync(REAL_WASM_PATH);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let wasmFetchPaths: string[] = [];
let browser: Browser;

before(async () => {
  server = createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const cleanPath = reqPath === '/' ? '/playground.html' : reqPath;

    if (cleanPath === '/custom-clang.wasm' || cleanPath === '/clang-trace-frontend.wasm') {
      wasmFetchPaths.push(cleanPath);
      const targetPath = HAS_REAL_WASM
        ? REAL_WASM_PATH
        : resolve(PLAYER_DIR, 'clang-trace-frontend.wasm');
      if (!existsSync(targetPath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const data = readFileSync(targetPath);
      res.writeHead(200, {
        'Content-Type': 'application/wasm',
        'Content-Length': String(data.byteLength),
      });
      res.end(data);
      return;
    }

    if (cleanPath === '/tiny.wasm') {
      wasmFetchPaths.push(cleanPath);
      const tiny = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      res.writeHead(200, {
        'Content-Type': 'application/wasm',
        'Content-Length': String(tiny.byteLength),
      });
      res.end(tiny);
      return;
    }

    const safeRel = cleanPath.replace(/^\/+/, '');
    const filePath = resolve(PLAYER_DIR, safeRel);
    if (!filePath.startsWith(PLAYER_DIR) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>(resolveListen => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Expected TCP address');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
});

after(async () => {
  await browser?.close();
  await new Promise<void>(resolveClose => server?.close(() => resolveClose()));
});

test('playground respects configurable wasmUrl and caches in Cache API across reloads', async () => {
  wasmFetchPaths = [];
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/playground.html?wasm=./tiny.wasm`);
    await page.waitForSelector('.pg-clear-cache-btn');
    // tiny.wasm passes WASM compilation & Cache API storage, then fails on missing _start.
    await page.waitForSelector('.pg-error-box:not([hidden])');
    const cachedCount = await page.evaluate(async () => {
      const cache = await caches.open('clang-trace-frontend-v1');
      const keys = await cache.keys();
      return keys.map(req => new URL(req.url).pathname);
    });
    assert.deepEqual(wasmFetchPaths, ['/tiny.wasm']);
    assert.deepEqual(cachedCount, ['/tiny.wasm']);

    // Reloading uses the Cache API entry with zero additional network requests for /tiny.wasm.
    await page.reload();
    await page.waitForSelector('.pg-error-box:not([hidden])');
    assert.deepEqual(wasmFetchPaths, ['/tiny.wasm']);

    // Clearing cache removes the entry from Cache API.
    await page.click('.pg-clear-cache-btn');
    await page.waitForFunction(() => {
      const txt = document.querySelector('.pg-status-text')?.textContent || '';
      return /cleared/i.test(txt);
    });
    const keysAfterClear = await page.evaluate(async () => {
      const cache = await caches.open('clang-trace-frontend-v1');
      return (await cache.keys()).length;
    });
    assert.equal(keysAfterClear, 0);

    // Reloading after clear re-fetches /tiny.wasm from the network.
    await page.reload();
    await page.waitForSelector('.pg-error-box:not([hidden])');
    assert.deepEqual(wasmFetchPaths, ['/tiny.wasm', '/tiny.wasm']);
  } finally {
    await context.close();
  }
});

test(
  'playground runs Clang WASM in Web Worker, persists cache across reload, and renders trace + layout',
  { skip: !HAS_REAL_WASM },
  async () => {
    wasmFetchPaths = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    try {
      await page.goto(`${baseUrl}/playground.html`);

      // Wait for initial trace (`double-pointer` preset) to finish downloading + tracing.
      await page.waitForSelector('.pg-vis-host .cv-player svg.cv-stage');
      await page.waitForFunction(
        () =>
          (document.querySelector('.pg-wasm-status') as HTMLElement | null)?.dataset.state ===
          'ready'
      );

      assert.deepEqual(wasmFetchPaths, ['/clang-trace-frontend.wasm']);
      const initialStatus = (await page.locator('.pg-status-text').textContent()) ?? '';
      assert.match(initialStatus, /downloaded & cached/i);

      // Step to the end of the execution trace and verify rendered SVG text.
      await page.evaluate(() => {
        const host = document.querySelector('.pg-vis-host') as HTMLElement & {
          cvPlayer: { end(): void; m: { steps: Array<{ stdout: string }> } };
        };
        host.cvPlayer.end();
      });
      const svgText = (await page.locator('.pg-vis-host .cv-stage').textContent()) ?? '';
      assert.match(svgText, /pp/);
      assert.match(svgText, /7/);

      // Switch to struct-shallow-copy preset -> traces cleanly in Worker without re-downloading.
      await page.selectOption('.pg-preset-select', 'struct-shallow-copy');
      await page.waitForFunction(() => {
        const text = document.querySelector('.pg-vis-host .cv-stage')?.textContent || '';
        return text.includes('ptr') && text.includes('s');
      });
      assert.equal(wasmFetchPaths.length, 1);

      // Switch to Struct layout preset -> renders Layout grid cleanly.
      await page.selectOption('.pg-preset-select', 'layout-padding');
      await page.waitForSelector('.pg-vis-host .cv-layout-record');
      const layoutText = (await page.locator('.pg-vis-host .cv-layout-record').textContent()) ?? '';
      assert.match(layoutText, /struct Packet/);
      assert.match(layoutText, /Padding: ▧ · 6 B/);

      // Edit code with Ctrl+Enter to test live error reporting, then fix it.
      await page.fill('#pg-source', 'struct Bad { double x; };');
      await page.locator('#pg-source').press('Control+Enter');
      await page.waitForSelector('.pg-error-box:not([hidden])');
      assert.match((await page.locator('.pg-error-box').textContent()) ?? '', /Unsupported/);

      // Toggle theme and language on layout view.
      await page.fill('#pg-source', 'struct Ok { uint8_t a; int b; };');
      await page.click('.pg-run-btn');
      await page.waitForSelector('.pg-vis-host .cv-layout-record');
      await page.click('.pg-theme-btn');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
      await page.click('.pg-lang-btn');
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
      assert.match(
        (await page.locator('.pg-vis-host .cv-layout-record').textContent()) ?? '',
        /Выравнивание: ▧ · 3 B/
      );

      // Reload the page: custom code, mode, theme, and language persist AND WASM loads from Cache API with 0 fetches!
      await page.reload();
      await page.waitForSelector('.pg-vis-host .cv-layout-record');
      await page.waitForFunction(
        () =>
          (document.querySelector('.pg-wasm-status') as HTMLElement | null)?.dataset.state ===
          'ready'
      );
      assert.equal(await page.inputValue('#pg-source'), 'struct Ok { uint8_t a; int b; };');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'ru');
      const reloadStatus = (await page.locator('.pg-status-text').textContent()) ?? '';
      assert.match(reloadStatus, /кэша/i);
      assert.doesNotMatch(reloadStatus, /загружен/i);
      assert.deepEqual(
        wasmFetchPaths,
        ['/clang-trace-frontend.wasm'],
        'reload must not re-fetch clang-trace-frontend.wasm over HTTP'
      );

      // Navigating with ?code=... pre-fills the editor, runs trace immediately, and survives reload.
      const customSnippet = '#include <iostream>\nint main() {\n  int n = 10;\n  int* q = &n;\n  *q = 42;\n  std::cout << n << std::endl;\n}';
      const encoded = encodeURIComponent(customSnippet);
      await page.goto(`${baseUrl}/playground.html?code=${encoded}&theme=dark&lang=en`);
      await page.waitForSelector('.pg-vis-host .cv-player svg.cv-stage');
      assert.equal(await page.inputValue('#pg-source'), customSnippet);
      assert.equal(await page.locator('.pg-preset-select').inputValue(), '__custom__');
      await page.evaluate(() => {
        const host = document.querySelector('.pg-vis-host') as HTMLElement & {
          cvPlayer: { end(): void };
        };
        host.cvPlayer.end();
      });
      const customSvgText = (await page.locator('.pg-vis-host .cv-stage').textContent()) ?? '';
      assert.match(customSvgText, /42/);
      await page.reload();
      await page.waitForSelector('.pg-vis-host .cv-player svg.cv-stage');
      assert.equal(await page.inputValue('#pg-source'), customSnippet);

      // Load with a custom ?wasm=./custom-clang.wasm parameter.
      await page.goto(`${baseUrl}/playground.html?wasm=./custom-clang.wasm`);
      await page.waitForSelector('.pg-vis-host .cv-player svg.cv-stage');
      assert.deepEqual(wasmFetchPaths, ['/clang-trace-frontend.wasm', '/custom-clang.wasm']);

      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
);
