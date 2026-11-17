// Trace a snippet with the settings it was asked for: the one entry point the command line and
// the browser share, whichever compiler front end and runtime they bring.
import type { CompilerFrontend } from './errors.ts';
import { traceLayout } from './layout.ts';
import { type Template, type TraceSettings, checkSettings } from './settings.ts';
import type { ExecutionTrace, LayoutTrace } from './trace_format.ts';
import { type RuntimeExecutor, traceWithFrontend } from './tracing.ts';

export interface TraceContext {
  frontend: CompilerFrontend;
  /** Run the snippet to check the predicted values (the default); `false` only predicts. */
  runtime?: boolean;
  executor?: RuntimeExecutor | null;
  directory?: string;
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
