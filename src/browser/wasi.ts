// Minimal in-memory WASI preview1 shim for running single-shot Clang WASM invocations
// synchronously in both Node and browser Web Workers (zero host filesystem needed).

const EBADF = 8;
const ENOENT = 44;
const ENOSYS = 52;
const ESPIPE = 70;

const FILETYPE_CHARACTER_DEVICE = 2;

export class WasiExit extends Error {
  code: number;

  constructor(code: number) {
    super(`WASI proc_exit(${code})`);
    this.name = 'WasiExit';
    this.code = code;
  }
}

export interface WasiRunOptions {
  args: string[];
  stdin?: string | Uint8Array;
  env?: Record<string, string>;
}

export interface WasiRunResult {
  returncode: number;
  stdout: string;
  stderr: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function runWasiModule(module: WebAssembly.Module, options: WasiRunOptions): WasiRunResult {
  const args = options.args;
  const argBytes = args.map(arg => encoder.encode(`${arg}\0`));
  const envEntries = Object.entries(options.env ?? {}).map(([key, value]) =>
    encoder.encode(`${key}=${value}\0`)
  );
  const stdinBytes =
    typeof options.stdin === 'string'
      ? encoder.encode(options.stdin)
      : (options.stdin ?? new Uint8Array(0));
  let stdinOffset = 0;

  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  let memory!: WebAssembly.Memory;
  const view = (): DataView => new DataView(memory.buffer);
  const bytes = (): Uint8Array => new Uint8Array(memory.buffer);

  const wasi_snapshot_preview1: Record<string, WebAssembly.ImportValue> = {
    args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
      const dv = view();
      dv.setUint32(argcPtr, argBytes.length, true);
      let total = 0;
      for (const arg of argBytes) total += arg.length;
      dv.setUint32(argvBufSizePtr, total, true);
      return 0;
    },

    args_get(argvPtr: number, argvBufPtr: number): number {
      const dv = view();
      const mem = bytes();
      let bufOffset = argvBufPtr;
      for (let i = 0; i < argBytes.length; i++) {
        dv.setUint32(argvPtr + i * 4, bufOffset, true);
        mem.set(argBytes[i], bufOffset);
        bufOffset += argBytes[i].length;
      }
      return 0;
    },

    environ_sizes_get(countPtr: number, bufSizePtr: number): number {
      const dv = view();
      dv.setUint32(countPtr, envEntries.length, true);
      let total = 0;
      for (const entry of envEntries) total += entry.length;
      dv.setUint32(bufSizePtr, total, true);
      return 0;
    },

    environ_get(environPtr: number, environBufPtr: number): number {
      const dv = view();
      const mem = bytes();
      let bufOffset = environBufPtr;
      for (let i = 0; i < envEntries.length; i++) {
        dv.setUint32(environPtr + i * 4, bufOffset, true);
        mem.set(envEntries[i], bufOffset);
        bufOffset += envEntries[i].length;
      }
      return 0;
    },

    clock_res_get(_id: number, resPtr: number): number {
      view().setBigUint64(resPtr, 1_000_000n, true);
      return 0;
    },

    clock_time_get(_id: number, _precision: bigint, timePtr: number): number {
      const ns = BigInt(Date.now()) * 1_000_000n;
      view().setBigUint64(timePtr, ns, true);
      return 0;
    },

    random_get(bufPtr: number, bufLen: number): number {
      const slice = bytes().subarray(bufPtr, bufPtr + bufLen);
      globalThis.crypto.getRandomValues(slice);
      return 0;
    },

    fd_prestat_get(_fd: number, _bufPtr: number): number {
      return EBADF;
    },

    fd_prestat_dir_name(_fd: number, _pathPtr: number, _pathLen: number): number {
      return EBADF;
    },

    fd_fdstat_get(fd: number, statPtr: number): number {
      if (fd < 0 || fd > 2) return EBADF;
      const dv = view();
      bytes().fill(0, statPtr, statPtr + 24);
      dv.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
      dv.setBigUint64(statPtr + 8, 0xffff_ffff_ffff_ffffn, true);
      dv.setBigUint64(statPtr + 16, 0xffff_ffff_ffff_ffffn, true);
      return 0;
    },

    fd_fdstat_set_flags(fd: number, _flags: number): number {
      return fd >= 0 && fd <= 2 ? 0 : EBADF;
    },

    fd_filestat_get(fd: number, statPtr: number): number {
      if (fd < 0 || fd > 2) return EBADF;
      const dv = view();
      bytes().fill(0, statPtr, statPtr + 64);
      dv.setBigUint64(statPtr + 8, BigInt(fd), true);
      dv.setUint8(statPtr + 16, FILETYPE_CHARACTER_DEVICE);
      dv.setBigUint64(statPtr + 24, 1n, true);
      dv.setBigUint64(statPtr + 32, fd === 0 ? BigInt(stdinBytes.length) : 0n, true);
      return 0;
    },

    fd_seek(_fd: number, _offset: bigint, _whence: number, _newOffsetPtr: number): number {
      return ESPIPE;
    },

    fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
      if (fd !== 0) return EBADF;
      const dv = view();
      const mem = bytes();
      let totalRead = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovsPtr + i * 8, true);
        const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
        const available = Math.min(len, stdinBytes.length - stdinOffset);
        if (available > 0) {
          mem.set(stdinBytes.subarray(stdinOffset, stdinOffset + available), ptr);
          stdinOffset += available;
          totalRead += available;
        }
        if (available < len) break;
      }
      dv.setUint32(nreadPtr, totalRead, true);
      return 0;
    },

    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
      if (fd !== 1 && fd !== 2) return EBADF;
      const dv = view();
      const mem = bytes();
      const target = fd === 1 ? stdoutChunks : stderrChunks;
      let totalWritten = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = dv.getUint32(iovsPtr + i * 8, true);
        const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
        if (len > 0) {
          target.push(mem.slice(ptr, ptr + len));
          totalWritten += len;
        }
      }
      dv.setUint32(nwrittenPtr, totalWritten, true);
      return 0;
    },

    fd_close(fd: number): number {
      return fd >= 0 && fd <= 2 ? 0 : EBADF;
    },

    fd_sync(fd: number): number {
      return fd >= 0 && fd <= 2 ? 0 : EBADF;
    },

    fd_datasync(fd: number): number {
      return fd >= 0 && fd <= 2 ? 0 : EBADF;
    },

    fd_readdir(): number {
      return EBADF;
    },

    path_open(): number {
      return ENOENT;
    },

    path_filestat_get(): number {
      return ENOENT;
    },

    sched_yield(): number {
      return 0;
    },

    poll_oneoff(): number {
      return ENOSYS;
    },

    proc_exit(code: number): never {
      throw new WasiExit(code);
    },
  };

  // Provide tolerant stubs for any additional preview1 imports that might appear.
  const proxy = new Proxy(wasi_snapshot_preview1, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) {
        return target[prop];
      }
      return () => ENOSYS;
    },
  });

  const instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: proxy,
  });
  memory = instance.exports.memory as WebAssembly.Memory;

  let returncode = 0;
  try {
    const start = instance.exports._start as () => void;
    start();
  } catch (err) {
    if (err instanceof WasiExit) {
      returncode = err.code;
    } else {
      throw err;
    }
  }

  return {
    returncode,
    stdout: concatUtf8(stdoutChunks),
    stderr: concatUtf8(stderrChunks),
  };
}

function concatUtf8(chunks: Uint8Array[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return decoder.decode(chunks[0]);
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(out);
}
