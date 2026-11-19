// Node entrypoint for compiler-backed C++ tracing with Clang and GDB.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Flags, Template, TraceSettings } from '../core/settings.ts';
import { type TraceOf, traceSnippet } from '../core/snippet.ts';
import type { ExecutionTrace } from '../core/trace_format.ts';
import {
  Cell,
  Execution,
  INTEGERS,
  IllFormed,
  Integer,
  NeedsFlag,
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
  NeedsFlag,
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

/** Trace with the pinned native Clang, running the snippet under GDB unless `runtime` is off. */
export function traceNatively<T extends Template>(
  source: string,
  settings: TraceSettings & { template: T },
  { runtime = true }: { runtime?: boolean } = {}
): TraceOf[T] {
  const directory = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    return traceSnippet(source, settings, {
      runtime,
      frontend: createClangFrontend(directory),
      executor: hooks.execute ?? defaultExecute,
      directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** An execution trace, with flags given as options. */
export function trace(
  source: string,
  { runtime = true, ...flags }: { runtime?: boolean } & Flags = {}
): ExecutionTrace {
  return traceNatively(source, { template: 'expression-timeline', flags }, { runtime });
}
