// Browser Cache API loader for the Clang WASM compiler module.
// Caches the ~17 MB WASM binary across reloads with streaming download progress
// and concurrent load deduplication.

export const DEFAULT_CACHE_NAME = 'clang-trace-frontend-v1';
export const DEFAULT_WASM_URL = './clang-trace-frontend.wasm';

export type WasmLoadPhase = 'checking-cache' | 'downloading' | 'compiling' | 'ready';

export interface WasmLoadProgress {
  phase: WasmLoadPhase;
  loadedBytes?: number;
  totalBytes?: number;
  fromCache?: boolean;
}

export interface WasmLoadOptions {
  cacheName?: string;
  onProgress?: (progress: WasmLoadProgress) => void;
  fetchImpl?: typeof fetch;
  cachesImpl?: CacheStorage | null;
}

export interface WasmLoadResult {
  module: WebAssembly.Module;
  wasmUrl: string;
  cacheName: string;
  fromCache: boolean;
  byteLength: number;
  elapsedMs: number;
}

const inFlight = new Map<string, Promise<WasmLoadResult>>();

export function resolveWasmUrl(wasmUrl: string): string {
  try {
    const base =
      typeof globalThis.location?.href === 'string'
        ? globalThis.location.href
        : 'http://localhost/';
    return new URL(wasmUrl, base).href;
  } catch {
    return wasmUrl;
  }
}

export function isValidWasmBytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d
  );
}

function getCacheStorage(explicit?: CacheStorage | null): CacheStorage | null {
  if (explicit !== undefined) return explicit;
  return typeof globalThis.caches !== 'undefined' ? globalThis.caches : null;
}

async function openCacheSafe(storage: CacheStorage | null, cacheName: string): Promise<Cache | null> {
  if (!storage) return null;
  try {
    return await storage.open(cacheName);
  } catch {
    return null;
  }
}

async function readResponseWithProgress(
  response: Response,
  onProgress?: (progress: WasmLoadProgress) => void
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get('Content-Length');
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;
  const total = totalBytes && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined;

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    onProgress?.({
      phase: 'downloading',
      loadedBytes: bytes.byteLength,
      totalBytes: total ?? bytes.byteLength,
      fromCache: false,
    });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  onProgress?.({
    phase: 'downloading',
    loadedBytes: 0,
    totalBytes: total,
    fromCache: false,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress?.({
        phase: 'downloading',
        loadedBytes,
        totalBytes: total,
        fromCache: false,
      });
    }
  }

  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function hasCachedWasm(
  wasmUrl: string = DEFAULT_WASM_URL,
  options: Pick<WasmLoadOptions, 'cacheName' | 'cachesImpl'> = {}
): Promise<boolean> {
  const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
  const storage = getCacheStorage(options.cachesImpl);
  const cache = await openCacheSafe(storage, cacheName);
  if (!cache) return false;
  const resolved = resolveWasmUrl(wasmUrl);
  try {
    const match = await cache.match(resolved);
    return match !== undefined;
  } catch {
    return false;
  }
}

export async function clearWasmCache(
  options: { wasmUrl?: string; cacheName?: string; cachesImpl?: CacheStorage | null } = {}
): Promise<boolean> {
  const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
  const storage = getCacheStorage(options.cachesImpl);
  if (!storage) return false;
  if (options.wasmUrl !== undefined) {
    const cache = await openCacheSafe(storage, cacheName);
    if (!cache) return false;
    try {
      return await cache.delete(resolveWasmUrl(options.wasmUrl));
    } catch {
      return false;
    }
  }
  try {
    return await storage.delete(cacheName);
  } catch {
    return false;
  }
}

export function loadWasmModule(
  wasmUrl: string = DEFAULT_WASM_URL,
  options: WasmLoadOptions = {}
): Promise<WasmLoadResult> {
  const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
  const resolvedUrl = resolveWasmUrl(wasmUrl);
  const key = `${cacheName}::${resolvedUrl}`;
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<WasmLoadResult> => {
    const start = performance.now();
    const { onProgress } = options;
    const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const storage = getCacheStorage(options.cachesImpl);

    onProgress?.({ phase: 'checking-cache' });
    const cache = await openCacheSafe(storage, cacheName);

    let bytes: Uint8Array | null = null;
    let fromCache = false;

    if (cache) {
      try {
        const cached = await cache.match(resolvedUrl);
        if (cached) {
          const cachedBytes = new Uint8Array(await cached.arrayBuffer());
          if (isValidWasmBytes(cachedBytes)) {
            bytes = cachedBytes;
            fromCache = true;
          } else {
            await cache.delete(resolvedUrl);
          }
        }
      } catch {
        // Ignore Cache API read errors and fall back to network fetch.
      }
    }

    if (!bytes) {
      const response = await fetchFn(resolvedUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Clang WASM from ${resolvedUrl} (${response.status} ${response.statusText})`
        );
      }
      const downloaded = await readResponseWithProgress(response, onProgress);
      if (!isValidWasmBytes(downloaded)) {
        throw new Error(`Invalid WASM binary received from ${resolvedUrl}`);
      }
      bytes = downloaded;

      if (cache) {
        try {
          const cacheBody = new Uint8Array(bytes.byteLength);
          cacheBody.set(bytes);
          await cache.put(
            resolvedUrl,
            new Response(cacheBody, {
              status: 200,
              headers: {
                'Content-Type': 'application/wasm',
                'Content-Length': String(cacheBody.byteLength),
              },
            })
          );
        } catch {
          // Cache storage quota or private mode may reject put(); execution can still continue.
        }
      }
    }

    onProgress?.({
      phase: 'compiling',
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      fromCache,
    });

    const wasmBuffer = new Uint8Array(bytes.byteLength);
    wasmBuffer.set(bytes);
    const module = await WebAssembly.compile(wasmBuffer);
    const elapsedMs = Math.round(performance.now() - start);

    onProgress?.({
      phase: 'ready',
      loadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
      fromCache,
    });

    return {
      module,
      wasmUrl: resolvedUrl,
      cacheName,
      fromCache,
      byteLength: bytes.byteLength,
      elapsedMs,
    };
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}
