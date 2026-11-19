// CompilerFrontend implementation backed by the trimmed Clang WASM binary.
import { type AstNode, type CompilerFrontend, Unsupported, illFormed } from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import type { Template, TraceSettings } from '../core/settings.ts';
import { type TraceOf, traceSnippet } from '../core/snippet.ts';
import { parseAstDump, readTokens, requireMain } from '../core/source.ts';
import { ARRAY_PREAMBLE } from './array_header.ts';
import { runWasiModule } from './wasi.ts';


export function createWasmClangFrontend(module: WebAssembly.Module): CompilerFrontend {
  return {
    arrayPreamble: ARRAY_PREAMBLE,
    tokens(program) {
      const result = runWasiModule(module, {
        args: ['clang-trace-frontend', '-Xclang', '-dump-tokens', '-'],
        stdin: program,
      });
      if (result.returncode !== 0) throw illFormed(result.stderr, program);
      return readTokens(result.stderr, '/virtual/source.cpp', program);
    },

    astDump(program, filter, standard = 'c++20') {
      const result = runWasiModule(module, {
        args: [
          'clang-trace-frontend', '-std=' + standard,
          '-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=' + filter, '-',
        ],
        stdin: program,
      });
      if (result.returncode !== 0) throw illFormed(result.stderr, program);
      return parseAstDump(result.stdout);
    },

    mainAst(program) {
      return requireMain(this.astDump(program, 'main'));
    },

    recordLayoutsDump(program: string): string {
      const result = runWasiModule(module, {
        args: ['clang-trace-frontend', '-Xclang', '-fdump-record-layouts-complete', '-'],
        stdin: program,
      });
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not compute record layouts');
      }
      return result.stdout;
    },

    typeSizes(types: string[]): Record<string, number> {
      if (types.length === 0) return {};
      const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };\n`).join('');
      const result = runWasiModule(module, {
        args: ['clang-trace-frontend', '-Xclang', '-ast-dump=json', '-'],
        stdin: probe,
      });
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
