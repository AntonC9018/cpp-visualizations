// Dedicated Web Worker running Clang WASM compilation, Cache API loading, and AST tracing off-thread.
import type { AnyTrace } from '../core/trace_format.ts';
import {
  DEFAULT_CACHE_NAME,
  DEFAULT_WASM_URL,
  type WasmLoadProgress,
  type WasmLoadResult,
  clearWasmCache,
  loadWasmModule,
  resolveWasmUrl,
} from './cache.ts';
import { type TraceMode, traceWithWasmModule } from './wasm_frontend.ts';

export type WasmLoadMetadata = Omit<WasmLoadResult, 'module'>;

export type WorkerRequest =
  | { id: number; type: 'init'; wasmUrl?: string; cacheName?: string }
  | {
      id: number;
      type: 'trace';
      source: string;
      mode?: TraceMode;
      wasmUrl?: string;
      cacheName?: string;
    }
  | { id: number; type: 'clear-cache'; wasmUrl?: string; cacheName?: string };

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: WasmLoadProgress }
  | { id: number; type: 'init-ok'; load: WasmLoadMetadata }
  | { id: number; type: 'trace-ok'; trace: AnyTrace; durationMs: number; load: WasmLoadMetadata }
  | { id: number; type: 'clear-ok'; cleared: boolean }
  | { id: number; type: 'error'; error: { name: string; message: string } };

interface WorkerGlobalScopeLike {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void
  ): void;
}

const workerSelf = self as unknown as WorkerGlobalScopeLike;

let activeKey: string | null = null;
let activeModule: WebAssembly.Module | null = null;
let activeMeta: WasmLoadMetadata | null = null;
let queue: Promise<void> = Promise.resolve();

async function ensureLoaded(
  id: number,
  wasmUrl: string = DEFAULT_WASM_URL,
  cacheName: string = DEFAULT_CACHE_NAME
): Promise<{ module: WebAssembly.Module; meta: WasmLoadMetadata }> {
  const resolvedUrl = resolveWasmUrl(wasmUrl);
  const key = `${cacheName}::${resolvedUrl}`;
  if (activeModule && activeMeta && activeKey === key) {
    return { module: activeModule, meta: activeMeta };
  }

  const loaded = await loadWasmModule(resolvedUrl, {
    cacheName,
    onProgress(progress) {
      workerSelf.postMessage({ id, type: 'progress', progress });
    },
  });

  const meta: WasmLoadMetadata = {
    wasmUrl: loaded.wasmUrl,
    cacheName: loaded.cacheName,
    fromCache: loaded.fromCache,
    byteLength: loaded.byteLength,
    elapsedMs: loaded.elapsedMs,
  };
  activeKey = key;
  activeModule = loaded.module;
  activeMeta = meta;
  return { module: loaded.module, meta };
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      const { meta } = await ensureLoaded(request.id, request.wasmUrl, request.cacheName);
      workerSelf.postMessage({ id: request.id, type: 'init-ok', load: meta });
      return;
    }

    if (request.type === 'clear-cache') {
      const cleared = await clearWasmCache({
        wasmUrl: request.wasmUrl,
        cacheName: request.cacheName,
      });
      if (!request.wasmUrl || resolveWasmUrl(request.wasmUrl) === activeMeta?.wasmUrl) {
        activeKey = null;
        activeModule = null;
        activeMeta = null;
      }
      workerSelf.postMessage({ id: request.id, type: 'clear-ok', cleared });
      return;
    }

    if (request.type === 'trace') {
      const { module, meta } = await ensureLoaded(request.id, request.wasmUrl, request.cacheName);
      const start = performance.now();
      const trace = traceWithWasmModule(request.source, module, {
        mode: request.mode ?? 'trace',
      });
      const durationMs = Math.round(performance.now() - start);
      workerSelf.postMessage({
        id: request.id,
        type: 'trace-ok',
        trace,
        durationMs,
        load: meta,
      });
      return;
    }
  } catch (err) {
    const error =
      err instanceof Error
        ? { name: err.name || 'Error', message: err.message }
        : { name: 'Error', message: String(err) };
    workerSelf.postMessage({ id: request.id, type: 'error', error });
  }
}

workerSelf.addEventListener('message', event => {
  const request = event.data;
  queue = queue.then(() => handleRequest(request));
});
