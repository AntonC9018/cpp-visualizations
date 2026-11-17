// CompilerFrontend implementation backed by the trimmed Clang WASM binary.
import { type AstNode, type CompilerFrontend, Unsupported, illFormed } from '../core/errors.ts';
import { traceLayout } from '../core/layout.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import type { AnyTrace } from '../core/trace_format.ts';
import { extractMainAstFromStdout, traceWithFrontend } from '../core/tracing.ts';
import { runWasiModule } from './wasi.ts';

export type TraceMode = 'trace' | 'layout';

/** How to trace a snippet; `types` applies to execution traces only, as the tag's attribute. */
export interface TraceRequestOptions {
  mode?: TraceMode;
  types?: boolean;
}

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

export function traceWithWasmModule(
  source: string,
  module: WebAssembly.Module,
  { mode = 'trace', types = false }: TraceRequestOptions = {}
): AnyTrace {
  const frontend = createWasmClangFrontend(module);
  if (mode === 'layout') {
    return traceLayout(source, frontend);
  }
  return traceWithFrontend(source, { runtime: false, types, frontend });
}
