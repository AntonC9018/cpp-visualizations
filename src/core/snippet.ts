// Trace a snippet with the settings it was asked for: the one entry point the command line and
// the browser share across compiler frontends.
import type { CompilerFrontend } from './errors.ts';
import { traceLayout } from './layout.ts';
import { type Template, type TraceSettings, checkSettings } from './settings.ts';
import type { ExecutionTrace, LayoutTrace } from './trace_format.ts';
import { traceWithFrontend } from './tracing.ts';

export interface TraceContext {
  frontend: CompilerFrontend;
  /** The caller's own checks, which throw: a flag is suggested only for a trace they accept. */
  accept?: (trace: ExecutionTrace) => void;
}

/** The trace each template makes. */
export interface TraceOf {
  'expression-timeline': ExecutionTrace;
  layout: LayoutTrace;
}

export function traceSnippet<T extends Template>(
  source: string,
  settings: TraceSettings & { template: T },
  context: TraceContext
): TraceOf[T] {
  const { template, flags } = checkSettings(settings);
  const traces: { [K in Template]: () => TraceOf[K] } = {
    layout: () => traceLayout(source, context.frontend),
    'expression-timeline': () => traceWithFrontend(source, { ...context, ...flags }),
  };
  return traces[template as T]();
}
