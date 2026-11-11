#!/usr/bin/env node
// CLI entrypoint for the compiler-backed tracer adapter consumed by course maintenance.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_VARIABLES,
  TEMPLATE,
  TRACER_SOURCES,
  _spacing_survives,
  _storage_is_contiguous,
  applicable,
  main,
  revision,
} from './src/node/generate.ts';

export {
  MAX_VARIABLES,
  TEMPLATE,
  TRACER_SOURCES,
  _spacing_survives,
  _storage_is_contiguous,
  applicable,
  main,
  revision,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
