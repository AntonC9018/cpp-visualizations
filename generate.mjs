#!/usr/bin/env node
// CLI entrypoint for the compiler-backed tracer adapter consumed by course maintenance.
// `revision` loads only the digest, not the tracer; everything else lives in src/node.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isCli = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isCli && process.argv.length === 3 && process.argv[2] === 'revision') {
  const { revision } = await import('./src/node/revision.ts');
  process.stdout.write(revision() + '\n');
  process.exit(0);
}

const generate = await import('./src/node/generate.ts');
export const {
  MAX_VARIABLES,
  TEMPLATE,
  TRACER_SOURCES,
  applicable,
  checkContiguousStorage,
  main,
  revision,
  spacingSurvives,
} = generate;

if (isCli) {
  process.exitCode = main();
}
