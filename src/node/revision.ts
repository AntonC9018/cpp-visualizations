// The tracer revision: a digest of every source a trace's bytes depend on and of the toolchain
// pin. It imports only Node builtins, so `node generate.mjs revision` stays fast and never
// loads the tracer.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Everything a trace's bytes depend on, besides the toolchain.
export const TRACER_SOURCES = [
  'generate.mjs',
  'src/node/revision.ts',
  'src/node/generate.ts',
  'src/node/layout.ts',
  'src/node/tracing.ts',
  'src/node/execution.ts',
  'src/node/records.ts',
  'src/node/toolchain.ts',
  'src/core/arrays.ts',
  'src/core/errors.ts',
  'src/core/floats.ts',
  'src/core/integers.ts',
  'src/core/json_format.ts',
  'src/core/trace_format.ts',
  'src/core/records.ts',
  'src/core/layout.ts',
  'src/core/tracing.ts',
  'src/core/settings.ts',
  'src/core/snippet.ts',
].map(name => join(ROOT, name));

/** The flake that pins the toolchain: the course's when this is its submodule, else ours. */
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
