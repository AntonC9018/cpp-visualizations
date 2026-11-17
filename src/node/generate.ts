// Compiler-backed tracer adapter consumed by course maintenance.
//
// `trace` prints one example's trace in the unified player format (`trace_format.ts`), run and
// verified under GDB; `probe` says, without running anything, whether an example is supported;
// `revision` versions every trace. The template and flags come from `../core/settings.ts`.
import { readFileSync } from 'node:fs';

import { dumpsSorted } from '../core/json_format.ts';
import { type AnyTrace, type ExecutionTrace, type TraceVariable, contiguous } from '../core/trace_format.ts';
import {
  DEFAULT_TEMPLATE,
  FLAG_NAMES,
  TEMPLATE_NAMES,
  type TraceSettings,
  isFlag,
  parseSettings,
} from '../core/settings.ts';
import { revision } from './revision.ts';
import { Unsupported, traceNatively } from './tracing.ts';

export const TEMPLATE = DEFAULT_TEMPLATE;
export { TRACER_SOURCES, revision } from './revision.ts';

// The memory row's legible capacity. Code, pane and output have no limit: the player's SVG
// scales to its content, so longer or wider snippets just draw smaller text.
export const MAX_VARIABLES = 5;
const DECLARATION = /^\s*(?:const\s+)?(?:int|auto)\b/;

export function checkContiguousStorage(variables: TraceVariable[]): void {
  if (!contiguous(variables)) {
    throw new Unsupported('noncontiguous storage needs a separate memory-layout visualization');
  }
}

const LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const LITERAL_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/.*/g;

export function spacingSurvives(snippet: string): boolean {
  const stripped = snippet.replace(LITERAL_OR_COMMENT, match =>
    match.startsWith('"') || match.startsWith("'")
      ? '""'
      : match.startsWith('/*')
        ? match.replace(/[^\r\n]/g, '')
        : ''
  );
  return !stripped
    .split(/\r?\n/)
    .some(line => /\S[ \t]{2,}\S/.test(line.trim()));
}

export function applicable(traceData: ExecutionTrace, snippet: string): void {
  if (!spacingSurvives(snippet)) {
    throw new Unsupported('the trace would collapse spacing inside a statement');
  }
  const { variables, steps, source } = traceData;
  if (variables.length > MAX_VARIABLES) {
    throw new Unsupported(`the memory row holds at most ${MAX_VARIABLES} variables`);
  }
  checkContiguousStorage(variables);
  const ops = steps.filter(s => s.op !== null && s.op !== undefined).map(s => s.op!);
  if (ops.some(op => op.kind === 'clash')) {
    // Types that do not fit are the point, however little memory is involved.
    return;
  }
  const writes = steps.filter(s => s.op && s.op.kind === 'write');
  const reads = ops.filter(op => ['read', 'addr', 'deref', 'bind'].includes(op.kind));
  const emptyInit = source.some(line => line.replace(/ /g, '').includes('{}'));
  const assignments = writes.filter(step => !DECLARATION.test(source[step.line]));
  if (reads.length === 0 && writes.length <= 1 && assignments.length === 0 && !emptyInit) {
    throw new Unsupported('a lone memory cell without a copy or state change needs no visualization');
  }
  const binds = ops.some(op => op.kind === 'bind');
  if (
    variables.length === 1 &&
    writes.length === 1 &&
    !emptyInit &&
    assignments.length === 0 &&
    !binds
  ) {
    throw new Unsupported('a lone literal-initialized cell and print need no visualization');
  }
}

export interface GenerateIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

/** The usage line's options, from the settings registry. */
export function settingsUsage(): string {
  const templates = TEMPLATE_NAMES.join('|');
  const flags = FLAG_NAMES.map(flag => ` [--${flag}]`).join('');
  return `--source PATH [--template ${templates}]${flags}`;
}

export function main(
  argv: string[] = process.argv.slice(2),
  io: GenerateIo = { stdout: process.stdout, stderr: process.stderr }
): number {
  let operation: string | null = null;
  let sourcePath: string | null = null;
  let template: string | null = null;
  const flags: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') {
      sourcePath = argv[++i] ?? null;
    } else if (arg.startsWith('--source=')) {
      sourcePath = arg.slice('--source='.length);
    } else if (arg === '--template') {
      template = argv[++i] ?? '';
    } else if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length);
    } else if (arg.startsWith('--') && isFlag(arg.slice(2))) {
      // A tag's attribute, passed through by maintenance: see settings.ts.
      flags.push(arg.slice(2));
    } else if (!arg.startsWith('-') && !operation) {
      operation = arg;
    } else {
      io.stderr.write(`error: unrecognized argument ${arg}\nusage: trace|probe ${settingsUsage()}\n`);
      return 2;
    }
  }

  if (!operation || !['probe', 'trace', 'revision'].includes(operation)) {
    io.stderr.write('error: operation must be probe, trace or revision\n');
    return 2;
  }
  if (operation === 'revision') {
    io.stdout.write(revision() + '\n');
    return 0;
  }
  if (!sourcePath) {
    io.stderr.write('error: --source is required\n');
    return 2;
  }

  let result: AnyTrace;
  let settings: TraceSettings;
  try {
    settings = parseSettings(template, flags);
    const snippet = readFileSync(sourcePath, 'utf8');
    result = traceNatively(snippet, settings, { runtime: operation !== 'probe' });
    if (result.kind !== 'layout') {
      applicable(result, snippet);
    }
  } catch (exc) {
    if (exc instanceof Unsupported) {
      if (operation === 'probe') {
        io.stdout.write(dumpsSorted({ supported: false, reason: exc.message }) + '\n');
        return 0;
      }
      io.stderr.write(`unsupported: ${exc.message}\n`);
      return 1;
    }
    const message = exc instanceof Error ? exc.message : String(exc);
    io.stderr.write(`error: ${message}\n`);
    return 1;
  }
  if (operation === 'probe') {
    io.stdout.write(dumpsSorted({ supported: true, template: settings.template }) + '\n');
  } else {
    io.stdout.write(dumpsSorted(result) + '\n');
  }
  return 0;
}
