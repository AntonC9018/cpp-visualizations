#!/usr/bin/env node
// CLI entrypoint for writing player/demo.html.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main, renderDemoHtml } from '../src/node/demo.ts';

export { main, renderDemoHtml };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
