// CompilerFrontend implementation backed by the trimmed Clang WASM binary.
import {
  type AstNode,
  type AstRangeEndpoint,
  type CompilerFrontend,
  IllFormed,
  type Macros,
  STANDARD_FLAGS,
  type Standard,
  Unsupported,
  illFormed,
} from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import type { Template, TraceSettings } from '../core/settings.ts';
import { type TraceOf, traceSnippet } from '../core/snippet.ts';
import { definedMacros, memo, parseAstDump, readTokens, stripTokenDump } from '../core/source.ts';
import { runWasiModule } from './wasi.ts';

/** Each module's macros by header list, which repeats across a page's traces. */
const macroCache = new WeakMap<WebAssembly.Module, (key: string, compute: () => Macros) => Macros>();
/** Whether a loaded WASM binary's virtual `<cstddef>` lacks `std::byte`. */
const needsByteShimCache = new WeakMap<WebAssembly.Module, boolean>();

const BYTE_PRELUDE =
  'namespace std { enum class byte : unsigned char {}; ' +
  'template<class T> constexpr T to_integer(byte b) noexcept { return static_cast<T>(b); } }\n' +
  '#line 1 "/virtual/source.cpp"\n';

function shiftAstOffsets(node: AstNode, delta: number, inSource = true): void {
  let current = inSource;
  const shift = (place: (AstRangeEndpoint & { file?: string }) | undefined): void => {
    if (!place) return;
    if (place.file !== undefined) current = place.file === '/virtual/source.cpp';
    if (current && typeof place.offset === 'number' && place.offset >= -delta) {
      place.offset += delta;
    }
  };
  shift(node.loc as (AstRangeEndpoint & { file?: string }) | undefined);
  shift(node.range?.begin as (AstRangeEndpoint & { file?: string }) | undefined);
  shift(node.range?.end as (AstRangeEndpoint & { file?: string }) | undefined);
  for (const child of [...(node.inner ?? []), ...(node.array_filler ?? [])]) {
    shiftAstOffsets(child, delta, current);
  }
}

export function createWasmClangFrontend(module: WebAssembly.Module): CompilerFrontend {
  /** Run the frontend on `program` with the shared language options. */
  const clang = (program: string, args: string[], standard: Standard = 'c++20') =>
    runWasiModule(module, { args: ['clang-trace-frontend', ...STANDARD_FLAGS[standard], ...args, '-'], stdin: program });

  const needsByteShim = (): boolean => {
    let missing = needsByteShimCache.get(module);
    if (missing === undefined) {
      const check = clang('#include <cstddef>\nusing __course_byte_check = std::byte;\n', []);
      missing = check.returncode !== 0;
      needsByteShimCache.set(module, missing);
    }
    return missing;
  };

  const withByteShim = (program: string): { text: string; shift: number } => {
    if (/\bbyte\b/.test(program) && needsByteShim()) {
      return { text: BYTE_PRELUDE + program, shift: BYTE_PRELUDE.length };
    }
    return { text: program, shift: 0 };
  };

  return {
    tokens(program, options) {
      const result = clang(program, ['-Xclang', '-dump-tokens']);
      if (result.returncode !== 0) throw illFormed(stripTokenDump(result.stderr), program, { locatedOnly: true });
      return readTokens(result.stderr, '/virtual/source.cpp', program, options);
    },

    macros(program) {
      let cache = macroCache.get(module);
      if (!cache) macroCache.set(module, cache = memo(16));
      return cache(program, () => {
        const result = clang(program, ['-E', '-dM']);
        if (result.returncode !== 0) throw illFormed(result.stderr, program);
        return definedMacros(result.stdout);
      });
    },

    astDump(program, filter, standard = 'c++20') {
      const { text, shift } = withByteShim(program);
      const result = clang(text, ['-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=' + filter], standard);
      if (result.returncode !== 0) {
        const err = illFormed(result.stderr, text);
        if (!shift) throw err;
        throw new IllFormed(err.message, err.offset !== null && err.offset >= shift ? err.offset - shift : null);
      }
      const nodes = parseAstDump(result.stdout);
      if (shift) {
        for (const node of nodes) shiftAstOffsets(node, -shift);
      }
      return nodes;
    },

    recordLayoutsDump(program: string): string {
      const { text } = withByteShim(program);
      const result = clang(text, ['-Xclang', '-fdump-record-layouts-complete']);
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not compute record layouts');
      }
      return result.stdout;
    },

    typeSizes(types: string[]): Record<string, number> {
      if (types.length === 0) return {};
      const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };\n`).join('');
      const { text } = withByteShim(probe);
      const result = clang(text, ['-Xclang', '-ast-dump=json']);
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not obtain field sizes');
      }
      return extractEnumConstantSizes(JSON.parse(result.stdout) as AstNode, types);
    },
  };
}

/** Trace with the same constant-evaluation pipeline as the CLI. */
export function traceWithWasmModule<T extends Template>(
  source: string,
  module: WebAssembly.Module,
  settings: TraceSettings & { template: T }
): TraceOf[T] {
  return traceSnippet(source, settings, { frontend: createWasmClangFrontend(module) });
}
