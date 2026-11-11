#!/usr/bin/env node
// CLI entrypoint for listing traceable C++ examples and tagging selected candidates.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CPP_LANGUAGES, discover, main, scanDocument } from './src/node/discover.ts';

export { CPP_LANGUAGES, discover, main, scanDocument };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
