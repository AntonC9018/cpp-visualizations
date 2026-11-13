// Main-thread RPC client wrapping the Clang WASM Web Worker.
import { Unsupported } from '../core/errors.ts';
import type { AnyTrace } from '../core/trace_format.ts';
import { DEFAULT_CACHE_NAME, DEFAULT_WASM_URL, type WasmLoadProgress } from './cache.ts';
import type { TraceMode } from './wasm_frontend.ts';
import type { WasmLoadMetadata, WorkerRequest, WorkerResponse } from './worker.ts';

export interface ClangWasmClientOptions {
  wasmUrl?: string;
  workerUrl?: string | URL;
  workerType?: WorkerType;
  cacheName?: string;
  onProgress?: (progress: WasmLoadProgress) => void;
}

export interface ClientTraceResult {
  trace: AnyTrace;
  durationMs: number;
  load: WasmLoadMetadata;
}

interface PendingCall {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WasmLoadProgress) => void;
}

export class ClangWasmClient {
  wasmUrl: string;
  workerUrl: string | URL;
  workerType: WorkerType;
  cacheName: string;
  onProgress?: (progress: WasmLoadProgress) => void;

  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  constructor(options: ClangWasmClientOptions = {}) {
    this.wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
    this.workerUrl = options.workerUrl ?? new URL('./clang-worker.js', import.meta.url);
    this.workerType = options.workerType ?? 'classic';
    this.cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
    this.onProgress = options.onProgress;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerUrl, { type: this.workerType });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const call = this.pending.get(response.id);
      if (!call) return;

      if (response.type === 'progress') {
        call.onProgress?.(response.progress);
        this.onProgress?.(response.progress);
        return;
      }

      this.pending.delete(response.id);
      if (response.type === 'error') {
        const err =
          response.error.name === 'Unsupported'
            ? new Unsupported(response.error.message)
            : new Error(response.error.message);
        err.name = response.error.name;
        call.reject(err);
        return;
      }
      call.resolve(response);
    });

    worker.addEventListener('error', event => {
      const err = new Error(event.message || 'Clang Web Worker failed');
      this.rejectAll(err);
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  private rejectAll(error: Error): void {
    for (const call of this.pending.values()) {
      call.reject(error);
    }
    this.pending.clear();
  }

  private call(
    request:
      | { type: 'init'; wasmUrl?: string; cacheName?: string }
      | { type: 'trace'; source: string; mode?: TraceMode; wasmUrl?: string; cacheName?: string }
      | { type: 'clear-cache'; wasmUrl?: string; cacheName?: string },
    onProgress?: (progress: WasmLoadProgress) => void
  ): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const fullRequest = { ...request, id } as WorkerRequest;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage(fullRequest);
    });
  }

  async init(onProgress?: (progress: WasmLoadProgress) => void): Promise<WasmLoadMetadata> {
    const response = await this.call(
      {
        type: 'init',
        wasmUrl: this.wasmUrl,
        cacheName: this.cacheName,
      },
      onProgress
    );
    if (response.type !== 'init-ok') {
      throw new Error(`Unexpected worker response: ${response.type}`);
    }
    return response.load;
  }

  async trace(
    source: string,
    options: { mode?: TraceMode; onProgress?: (progress: WasmLoadProgress) => void } = {}
  ): Promise<ClientTraceResult> {
    const response = await this.call(
      {
        type: 'trace',
        source,
        mode: options.mode ?? 'trace',
        wasmUrl: this.wasmUrl,
        cacheName: this.cacheName,
      },
      options.onProgress
    );
    if (response.type !== 'trace-ok') {
      throw new Error(`Unexpected worker response: ${response.type}`);
    }
    return {
      trace: response.trace,
      durationMs: response.durationMs,
      load: response.load,
    };
  }

  async clearCache(): Promise<boolean> {
    const response = await this.call({
      type: 'clear-cache',
      wasmUrl: this.wasmUrl,
      cacheName: this.cacheName,
    });
    if (response.type !== 'clear-ok') {
      throw new Error(`Unexpected worker response: ${response.type}`);
    }
    return response.cleared;
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.rejectAll(new Error('ClangWasmClient terminated'));
  }
}
