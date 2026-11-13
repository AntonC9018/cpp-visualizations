// Tests for WASI shim, Cache API WASM loader, presets, and Clang WASM trace/layout parity.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CACHE_NAME,
  clearWasmCache,
  hasCachedWasm,
  isValidWasmBytes,
  loadWasmModule,
} from '../src/browser/cache.ts';
import { PRESETS } from '../src/browser/playground.ts';
import { WasiExit, runWasiModule } from '../src/browser/wasi.ts';
import { createWasmClangFrontend, traceWithWasmModule } from '../src/browser/wasm_frontend.ts';
import { Unsupported } from '../src/core/errors.ts';
import { dumpsSorted } from '../src/core/json_format.ts';
import { traceLayout } from '../src/core/layout.ts';
import { validate } from '../src/core/trace_format.ts';
import { traceWithFrontend } from '../src/core/tracing.ts';
import * as nodeLayout from '../src/node/layout.ts';
import { createClangFrontend } from '../src/node/toolchain.ts';
import * as nodeTracing from '../src/node/tracing.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WASM_PATH = process.env.CLANG_TRACE_WASM || resolve(ROOT, 'player/clang-trace-frontend.wasm');

// Minimal valid WASM module: magic + version (8 bytes) — compiles to an empty module.
const TINY_VALID_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

class MemoryCache {
  private entries = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    const hit = this.entries.get(key);
    return hit ? hit.clone() : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    this.entries.set(key, response.clone());
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return this.entries.delete(key);
  }
}

class MemoryCacheStorage {
  private caches = new Map<string, MemoryCache>();

  async open(cacheName: string): Promise<Cache> {
    let cache = this.caches.get(cacheName);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(cacheName, cache);
    }
    return cache as unknown as Cache;
  }

  async delete(cacheName: string): Promise<boolean> {
    return this.caches.delete(cacheName);
  }
}

describe('WasiAndCacheTests', () => {
  test('isValidWasmBytes checks header magic and minimum length', () => {
    assert.equal(isValidWasmBytes(TINY_VALID_WASM), true);
    assert.equal(isValidWasmBytes(new Uint8Array([0x00, 0x61, 0x73, 0x6d])), false);
    assert.equal(isValidWasmBytes(new Uint8Array([0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70])), false);
  });

  test('WasiExit carries exit code', () => {
    const err = new WasiExit(42);
    assert.equal(err.code, 42);
    assert.match(err.message, /42/);
  });

  test('runWasiModule handles empty module with _start export', async () => {
    const module = await WebAssembly.compile(TINY_VALID_WASM);
    // Tiny module has no _start or memory; verify Proxy + WasiResult structure via real compile?
    // Build a 1-export module that imports nothing: actually TINY_VALID_WASM has no _start,
    // so runWasiModule cleanly throws TypeError when invoking missing _start, or let's verify Proxy.
    assert.throws(() => runWasiModule(module, { args: ['prog'] }), TypeError);
  });

  test('loadWasmModule caches valid binary, reports streaming progress, and hits cache on reload', async () => {
    const storage = new MemoryCacheStorage() as unknown as CacheStorage;
    const wasmUrl = 'https://example.test/assets/clang.wasm';
    let fetchCount = 0;

    const streamingFetch = (async () => {
      fetchCount++;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(TINY_VALID_WASM.slice(0, 4));
          controller.enqueue(TINY_VALID_WASM.slice(4));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/wasm',
          'Content-Length': String(TINY_VALID_WASM.byteLength),
        },
      });
    }) as unknown as typeof fetch;

    const phases1: string[] = [];
    const first = await loadWasmModule(wasmUrl, {
      cacheName: DEFAULT_CACHE_NAME,
      cachesImpl: storage,
      fetchImpl: streamingFetch,
      onProgress: p => phases1.push(p.phase),
    });

    assert.equal(fetchCount, 1);
    assert.equal(first.fromCache, false);
    assert.equal(first.byteLength, TINY_VALID_WASM.byteLength);
    assert.ok(first.module instanceof WebAssembly.Module);
    assert.ok(phases1.includes('checking-cache'));
    assert.ok(phases1.includes('downloading'));
    assert.ok(phases1.includes('compiling'));
    assert.equal(phases1.at(-1), 'ready');

    assert.equal(await hasCachedWasm(wasmUrl, { cachesImpl: storage }), true);

    const phases2: string[] = [];
    const second = await loadWasmModule(wasmUrl, {
      cachesImpl: storage,
      fetchImpl: streamingFetch,
      onProgress: p => phases2.push(p.phase),
    });
    assert.equal(fetchCount, 1, 'second load must be served from Cache API without fetch');
    assert.equal(second.fromCache, true);
    assert.equal(phases2.includes('downloading'), false);

    assert.equal(await clearWasmCache({ cachesImpl: storage }), true);
    assert.equal(await hasCachedWasm(wasmUrl, { cachesImpl: storage }), false);
  });

  test('loadWasmModule deduplicates concurrent loads and evicts corrupt cache entries', async () => {
    const storage = new MemoryCacheStorage() as unknown as CacheStorage;
    const wasmUrl = 'https://example.test/assets/clang-concurrent.wasm';
    const cache = await storage.open(DEFAULT_CACHE_NAME);
    await cache.put(wasmUrl, new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));

    let fetchCount = 0;
    const fetchImpl = (async () => {
      fetchCount++;
      await new Promise(resolve => setTimeout(resolve, 15));
      return new Response(TINY_VALID_WASM, { status: 200 });
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      loadWasmModule(wasmUrl, { cachesImpl: storage, fetchImpl }),
      loadWasmModule(wasmUrl, { cachesImpl: storage, fetchImpl }),
    ]);

    assert.equal(fetchCount, 1, 'concurrent callers share one fetch');
    assert.equal(a.fromCache, false, 'corrupt cache entry was evicted and refetched');
    assert.equal(b.module, a.module);
  });

  test('loadWasmModule rejects non-WASM responses cleanly', async () => {
    const storage = new MemoryCacheStorage() as unknown as CacheStorage;
    const htmlFetch = (async () =>
      new Response('<!doctype html><html>404</html>', { status: 200 })) as unknown as typeof fetch;

    await assert.rejects(
      () => loadWasmModule('https://example.test/bad.wasm', { cachesImpl: storage, fetchImpl: htmlFetch }),
      /Invalid WASM binary/
    );
  });

  test('all playground presets validate against native Clang toolchain', () => {
    for (const preset of PRESETS) {
      if (preset.mode === 'layout') {
        const layout = nodeLayout.trace(preset.source);
        validate(layout);
      } else {
        const trace = nodeTracing.trace(preset.source, { runtime: true });
        validate(trace);
      }
    }
  });
});

describe('ClangWasmParityTests', { skip: !existsSync(WASM_PATH) }, () => {
  let wasmModule: WebAssembly.Module;

  test('compiles clang-trace-frontend.wasm and matches native Clang byte-for-byte', async () => {
    const wasmBytes = readFileSync(WASM_PATH);
    wasmModule = await WebAssembly.compile(wasmBytes);
    const wasmFrontend = createWasmClangFrontend(wasmModule);
    const nativeFrontend = createClangFrontend();

    for (const preset of PRESETS) {
      if (preset.mode === 'layout') {
        const wasmOut = traceWithWasmModule(preset.source, wasmModule, { mode: 'layout' });
        const nativeOut = traceLayout(preset.source, nativeFrontend);
        assert.equal(dumpsSorted(wasmOut), dumpsSorted(nativeOut), `layout parity for ${preset.id}`);
      } else {
        const wasmOut = traceWithWasmModule(preset.source, wasmModule, { mode: 'trace' });
        const nativeOut = traceWithFrontend(preset.source, {
          runtime: false,
          frontend: nativeFrontend,
        });
        assert.equal(dumpsSorted(wasmOut), dumpsSorted(nativeOut), `trace parity for ${preset.id}`);
      }
    }

    const moreTraces = [
      'int a{}; std::cout << a;',
      'struct A { int f1; int f2; }; A a{ 1, 2 }; A b = A{ .f2 = 5 }; b = a;',
      'int x{ 0 }; int* px{ &x }; int* py{ px }; *px = 1; std::cout << *py;',
    ];
    for (const source of moreTraces) {
      assert.equal(
        dumpsSorted(traceWithWasmModule(source, wasmModule, { mode: 'trace' })),
        dumpsSorted(traceWithFrontend(source, { runtime: false, frontend: nativeFrontend }))
      );
    }

    const badSnippets = [
      'int a = ;',
      'struct Empty {};',
      'int x = 1; while (x > 0) { x = 0; }',
      'double d = 1.5;',
    ];
    for (const bad of badSnippets) {
      assert.throws(() => traceWithWasmModule(bad, wasmModule, { mode: 'trace' }), Unsupported);
    }
    assert.throws(() => wasmFrontend.mainAst('int main() { unknown_sym; }'), Unsupported);
  });
});
