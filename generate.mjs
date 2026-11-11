#!/usr/bin/env node
// CLI entrypoint for the compiler-backed tracer adapter consumed by course maintenance.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE = 'expression-timeline';
export const MAX_VARIABLES = 5;
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

function toolchainPin() {
  const host = resolve(ROOT, '..');
  const pinnedBy = existsSync(join(host, 'flake.lock')) ? host : ROOT;
  return [join(pinnedBy, 'flake.nix'), join(pinnedBy, 'flake.lock')];
}

export function revision() {
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

const isCli = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isCli && process.argv.length === 3 && process.argv[2] === 'revision') {
  process.stdout.write(revision() + '\n');
  process.exit(0);
}

const {
  _spacing_survives,
  _storage_is_contiguous,
  applicable,
  main,
} = await import('./src/node/generate.ts');

export {
  _spacing_survives,
  _storage_is_contiguous,
  applicable,
  main,
};

if (isCli) {
  process.exitCode = main();
}

