// Compiler-backed tracer adapter consumed by course maintenance.
//
// `trace` prints one example's trace in the unified player format (`trace_format.ts`), run and
// verified under GDB; `probe` says, without running anything, whether an example is supported;
// `revision` versions every trace.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from '../core/json_format.ts';
import type { AnyTrace, ExecutionTrace, TraceVariable } from '../core/trace_format.ts';
import { trace as layoutTrace } from './layout.ts';
import { Unsupported, trace } from './tracing.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TEMPLATE = 'expression-timeline';
// Everything a trace's bytes depend on, besides the toolchain.
export const TRACER_SOURCES = [
  'generate.mjs',
  'src/node/generate.ts',
  'src/node/layout.ts',
  'src/node/tracing.ts',
  'src/node/execution.ts',
  'src/node/records.ts',
  'src/node/toolchain.ts',
  'src/core/errors.ts',
  'src/core/json_format.ts',
  'src/core/trace_format.ts',
  'src/core/records.ts',
  'src/core/layout.ts',
  'src/core/tracing.ts',
].map(name => join(ROOT, name));

// The memory row's legible capacity. Code, pane and output have no limit: the player's SVG
// scales to its content, so longer or wider snippets just draw smaller text.
export const MAX_VARIABLES = 5;
const DECLARATION = /^\s*(?:const\s+)?(?:int|auto)\b/;

function toolchainPin(): string[] {
  const host = resolve(ROOT, '..');
  const pinnedBy = existsSync(join(host, 'flake.lock')) ? host : ROOT;
  return [join(pinnedBy, 'flake.nix'), join(pinnedBy, 'flake.lock')];
}

export function revision(): string {
  const digest = createHash('sha256');
  for (const path of TRACER_SOURCES) {
    digest.update(relative(ROOT, path).split(sep).join('/'));
    digest.update(readFileSync(path));
  }
  for (const path of toolchainPin()) {
    digest.update(basename(path));
    digest.update(readFileSync(path));
  }
  return digest.digest('hex');
}

export function _storage_is_contiguous(variables: TraceVariable[]): void {
  const cells = [...variables].sort((a, b) => a.address - b.address);
  for (let i = 0; i < cells.length - 1; i++) {
    const lower = cells[i];
    const higher = cells[i + 1];
    const gap = higher.address - lower.address - lower.size;
    if (!(0 <= gap && gap < lower.size)) {
      throw new Unsupported('noncontiguous storage needs a separate memory-layout visualization');
    }
  }
}

const LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
const LITERAL_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/.*/g;

export function _spacing_survives(snippet: string): boolean {
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
  if (!_spacing_survives(snippet)) {
    throw new Unsupported('the trace would collapse spacing inside a statement');
  }
  const { variables, steps, source } = traceData;
  if (variables.length > MAX_VARIABLES) {
    throw new Unsupported(`the memory row holds at most ${MAX_VARIABLES} variables`);
  }
  _storage_is_contiguous(variables);
  const ops = steps.filter(s => s.op !== null && s.op !== undefined).map(s => s.op!);
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

export function main(
  argv: string[] = process.argv.slice(2),
  io: GenerateIo = { stdout: process.stdout, stderr: process.stderr }
): number {
  let operation: string | null = null;
  let sourcePath: string | null = null;
  let template = TEMPLATE;

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
    } else if (!arg.startsWith('-') && !operation) {
      operation = arg;
    } else {
      io.stderr.write(`error: unrecognized argument ${arg}\n`);
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
  try {
    if (template !== TEMPLATE && template !== 'layout') {
      throw new Unsupported(`unknown template '${template}'`);
    }
    const snippet = readFileSync(sourcePath, 'utf8');
    if (template === 'layout') {
      result = layoutTrace(snippet);
    } else {
      result = trace(snippet, { runtime: operation !== 'probe' });
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
    io.stdout.write(dumpsSorted({ supported: true, template }) + '\n');
  } else {
    io.stdout.write(dumpsSorted(result) + '\n');
  }
  return 0;
}
