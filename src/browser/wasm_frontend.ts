// CompilerFrontend implementation backed by the trimmed Clang WASM binary.
import { type AstNode, type CompilerFrontend, Unsupported, illFormed } from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import type { Template, TraceSettings } from '../core/settings.ts';
import { type TraceOf, traceSnippet } from '../core/snippet.ts';
import { extractMainAstFromStdout } from '../core/tracing.ts';
import { runWasiModule } from './wasi.ts';


export function createWasmClangFrontend(module: WebAssembly.Module): CompilerFrontend {
  return {
    mainAst(program: string): AstNode {
      const result = runWasiModule(module, {
        args: [
          'clang-trace-frontend',
          '-Xclang',
          '-ast-dump=json',
          '-Xclang',
          '-ast-dump-filter=main',
          '-',
        ],
        stdin: program,
      });
      if (result.returncode !== 0) {
        throw illFormed(result.stderr, program);
      }
      return extractMainAstFromStdout(result.stdout, program);
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

/** Trace as `generate.mjs` would, without running the snippet: the browser has no GDB. */
export function traceWithWasmModule<T extends Template>(
  source: string,
  module: WebAssembly.Module,
  settings: TraceSettings & { template: T }
): TraceOf[T] {
  return traceSnippet(source, settings, { runtime: false, frontend: createWasmClangFrontend(module) });
}
