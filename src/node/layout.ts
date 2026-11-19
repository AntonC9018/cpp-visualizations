// Node entrypoint for static struct layout traces.
import { traceLayout } from '../core/layout.ts';
import type { LayoutTrace } from '../core/trace_format.ts';
import { traceNatively } from './tracing.ts';

export { traceLayout };

export function trace(source: string): LayoutTrace {
  return traceNatively(source, { template: 'layout', flags: {} });
}
