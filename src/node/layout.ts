// Node entrypoint for static struct layout traces.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { traceLayout } from '../core/layout.ts';
import type { LayoutTrace } from '../core/trace_format.ts';
import { createClangFrontend } from './toolchain.ts';

export { traceLayout };

export function trace(source: string): LayoutTrace {
  const directory = mkdtempSync(join(tmpdir(), 'layout-'));
  try {
    return traceLayout(source, createClangFrontend(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
