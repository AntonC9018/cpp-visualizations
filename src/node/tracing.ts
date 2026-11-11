// Node entrypoint for compiler-backed C++ tracing with Clang and GDB.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AstNode } from '../core/errors.ts';
import type { ExecutionTrace } from '../core/trace_format.ts';
import {
  Cell,
  Execution,
  Pointer,
  REFERENCE,
  Reduction,
  Statement,
  Unsupported,
  _after,
  _body,
  _depth,
  _flatten,
  _normalize,
  _observed,
  analyzeWithFrontend,
  defaultAfter,
  hooks,
  traceWithFrontend,
} from '../core/tracing.ts';
import { execute as defaultExecute } from './execution.ts';
import { createClangFrontend } from './toolchain.ts';

hooks.execute = defaultExecute;

export {
  Cell,
  Execution,
  Pointer,
  REFERENCE,
  Reduction,
  Statement,
  Unsupported,
  _after,
  _body,
  _depth,
  _flatten,
  _normalize,
  _observed,
  analyzeWithFrontend,
  defaultAfter,
  hooks,
  traceWithFrontend,
};

export function _main_ast(program: string, directory: string): AstNode {
  return createClangFrontend(directory).mainAst(program);
}

export function trace(
  source: string,
  { runtime = true }: { runtime?: boolean } = {}
): ExecutionTrace {
  const directory = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    const frontend = createClangFrontend(directory);
    return traceWithFrontend(source, {
      runtime,
      frontend,
      executor: hooks.execute ?? defaultExecute,
      directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
