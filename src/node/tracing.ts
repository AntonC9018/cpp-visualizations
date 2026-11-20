// Node entrypoint for compiler-backed C++ tracing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Flags, Template, TraceSettings } from '../core/settings.ts';
import { type TraceContext, type TraceOf, traceSnippet } from '../core/snippet.ts';
import type { ExecutionTrace } from '../core/trace_format.ts';
import {
  INTEGERS,
  IllFormed,
  Integer,
  NeedsFlag,
  Pointer,
  type Reduction,
  type State,
  Statement,
  type StructValue,
  Unsupported,
  pointerDepth,
  normalizeAddresses,
  analyzeWithFrontend,
  storeResult,
  hooks,
  traceWithFrontend,
  type Value,
} from '../core/tracing.ts';
import { createClangFrontend } from './toolchain.ts';

export {
  INTEGERS,
  IllFormed,
  Integer,
  NeedsFlag,
  Pointer,
  type Reduction,
  type State,
  Statement,
  type StructValue,
  Unsupported,
  pointerDepth,
  normalizeAddresses,
  analyzeWithFrontend,
  storeResult,
  hooks,
  traceWithFrontend,
  type Value,
};

type NativeContext = Partial<TraceContext>;

/** Trace with the pinned native Clang, or with `frontend` when the caller shares one. */
export function traceNatively<T extends Template>(
  source: string,
  settings: TraceSettings & { template: T },
  { accept, frontend }: NativeContext = {}
): TraceOf[T] {
  if (frontend) return traceSnippet(source, settings, { accept, frontend });
  const directory = mkdtempSync(join(tmpdir(), 'trace-'));
  try {
    return traceSnippet(source, settings, {
      accept,
      frontend: createClangFrontend(directory),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** An execution trace, with flags given as options. */
export function trace(
  source: string,
  { accept, frontend, ...flags }: NativeContext & Flags = {}
): ExecutionTrace {
  return traceNatively(source, { template: 'expression-timeline', flags }, { accept, frontend });
}
