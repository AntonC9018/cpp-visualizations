#!/usr/bin/env node
// Compiler-backed tracer adapter consumed by course maintenance.
//
// `trace` prints one example's trace in the unified player format (`trace_format.mjs`), run and
// verified under GDB; `probe` says, without running anything, whether an example is supported;
// `revision` versions every trace.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from './json_format.mjs';
import { trace as layoutTrace } from './layout.mjs';
import { Unsupported, trace } from './tracing.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE = 'expression-timeline';
// Everything a trace's bytes depend on, besides the toolchain.
export const TRACER_SOURCES = [
  'generate.mjs',
  'tracing.mjs',
  'execution.mjs',
  'records.mjs',
  'toolchain.mjs',
  'trace_format.mjs',
  'layout.mjs',
  'json_format.mjs',
].map(name => join(ROOT, name));

// The memory row's legible capacity. Code, pane and output have no limit: the player's SVG
// scales to its content, so longer or wider snippets just draw smaller text.
export const MAX_VARIABLES = 5;
const DECLARATION = /^\s*(?:const\s+)?(?:int|auto)\b/;

function toolchainPin() {
  const host = resolve(ROOT, '..');
  const pinnedBy = existsSync(join(host, 'flake.lock')) ? host : ROOT;
  return [join(pinnedBy, 'flake.nix'), join(pinnedBy, 'flake.lock')];
}

export function revision() {
  const digest = createHash('sha256');
  for (const path of [...TRACER_SOURCES, ...toolchainPin()]) {
    digest.update(basename(path));
    digest.update(readFileSync(path));
  }
  return digest.digest('hex');
}

export function _storage_is_contiguous(variables) {
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
const COMMENT = /\/\/.*/g;

export function _spacing_survives(snippet) {
  return !snippet
    .split(/\r?\n/)
    .some(line => /\S[ \t]{2,}\S/.test(line.replace(LITERAL, '""').replace(COMMENT, '').trim()));
}

export function applicable(traceData, snippet) {
  if (!_spacing_survives(snippet)) {
    throw new Unsupported('the trace would collapse spacing inside a statement');
  }
  const { variables, steps, source } = traceData;
  if (variables.length > MAX_VARIABLES) {
    throw new Unsupported(`the memory row holds at most ${MAX_VARIABLES} variables`);
  }
  _storage_is_contiguous(variables);
  const ops = steps.filter(s => s.op).map(s => s.op);
  const writes = steps.filter(s => s.op && s.op.kind === 'write');
  const reads = ops.filter(op => ['read', 'addr', 'deref', 'bind'].includes(op.kind));
  const emptyInit = source.some(line => line.replace(/ /g, '').includes('{}'));
  const assignments = writes.filter(step => !DECLARATION.test(source[step.line]));
  if (reads.length === 0 && writes.length <= 1 && assignments.length === 0) {
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

export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let operation = null;
  let sourcePath = null;
  let template = TEMPLATE;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') {
      sourcePath = argv[++i];
    } else if (arg.startsWith('--source=')) {
      sourcePath = arg.slice('--source='.length);
    } else if (arg === '--template') {
      template = argv[++i];
    } else if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length);
    } else if (!arg.startsWith('-') && !operation) {
      operation = arg;
    } else {
      io.stderr.write(`error: unrecognized argument ${arg}\n`);
      return 2;
    }
  }

  if (!['probe', 'trace', 'revision'].includes(operation)) {
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

  let result;
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
    io.stderr.write(`error: ${exc.message}\n`);
    return 1;
  }
  if (operation === 'probe') {
    io.stdout.write(dumpsSorted({ supported: true, template }) + '\n');
  } else {
    io.stdout.write(dumpsSorted(result) + '\n');
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
