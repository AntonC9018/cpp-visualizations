// Node entrypoint for compiler-backed C++ tracing with Clang and GDB.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecutionTrace } from '../core/trace_format.ts';
import {
  Cell,
  Execution,
  INTEGERS,
  IllFormed,
  Integer,
  Pointer,
  REFERENCE,
  type Reduction,
  type State,
  Statement,
  type StructValue,
  Unsupported,
  snippetBody,
  pointerDepth,
  normalizeAddresses,
  observeExecution,
  analyzeWithFrontend,
  storeResult,
  hooks,
  traceWithFrontend,
  type Value,
} from '../core/tracing.ts';
import { execute as defaultExecute } from './execution.ts';
import { createClangFrontend } from './toolchain.ts';

hooks.execute = defaultExecute;

export {
  Cell,
  Execution,
  INTEGERS,
  IllFormed,
  Integer,
  Pointer,
  REFERENCE,
  type Reduction,
  type State,
  Statement,
  type StructValue,
  Unsupported,
  snippetBody,
  pointerDepth,
  normalizeAddresses,
  observeExecution,
  analyzeWithFrontend,
  storeResult,
  hooks,
  traceWithFrontend,
  type Value,
};

export function trace(
  source: string,
  { runtime = true, types = false }: { runtime?: boolean; types?: boolean } = {}
): ExecutionTrace {
  const directory = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    const frontend = createClangFrontend(directory);
    return traceWithFrontend(source, {
      runtime,
      types,
      frontend,
      executor: hooks.execute ?? defaultExecute,
      directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
