// CompilerFrontend implementation backed by the trimmed Clang WASM binary.
import {
  type AstNode, type CompilerFrontend, type Macros, STANDARD_FLAGS, type Standard, Unsupported, illFormed,
} from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import type { Template, TraceSettings } from '../core/settings.ts';
import { type TraceOf, traceSnippet } from '../core/snippet.ts';
import { definedMacros, memo, parseAstDump, readTokens } from '../core/source.ts';
import { runWasiModule } from './wasi.ts';

/** Each module's macros by header list, which repeats across a page's traces. */
const macroCache = new WeakMap<WebAssembly.Module, (key: string, compute: () => Macros) => Macros>();

export function createWasmClangFrontend(module: WebAssembly.Module): CompilerFrontend {
  /** Run the frontend on `program` with the shared language options. */
  const clang = (program: string, args: string[], standard: Standard = 'c++20') =>
    runWasiModule(module, { args: ['clang-trace-frontend', ...STANDARD_FLAGS[standard], ...args, '-'], stdin: program });

  return {
    tokens(program, options) {
      const result = clang(program, ['-Xclang', '-dump-tokens']);
      if (result.returncode !== 0) throw illFormed(result.stderr, program);
      return readTokens(result.stderr, '/virtual/source.cpp', program, options);
    },

    macros(program) {
      let cache = macroCache.get(module);
      if (!cache) macroCache.set(module, cache = memo(16));
      return cache(program, () => {
        const result = clang(program, ['-E', '-dD']);
        if (result.returncode !== 0) throw illFormed(result.stderr, program);
        return definedMacros(result.stdout);
      });
    },

    astDump(program, filter, standard = 'c++20') {
      const result = clang(program, ['-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=' + filter], standard);
      if (result.returncode !== 0) throw illFormed(result.stderr, program);
      return parseAstDump(result.stdout);
    },

    recordLayoutsDump(program: string): string {
      const result = clang(program, ['-Xclang', '-fdump-record-layouts-complete']);
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not compute record layouts');
      }
      return result.stdout;
    },

    typeSizes(types: string[]): Record<string, number> {
      if (types.length === 0) return {};
      const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };\n`).join('');
      const result = clang(probe, ['-Xclang', '-ast-dump=json']);
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
