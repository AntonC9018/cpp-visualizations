import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { renderDemoHtml } from './src/node/demo.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

interface BuildEntry {
  entry: string;
  name: string;
  fileName: string;
}

const BUILD_ENTRIES: Record<string, BuildEntry> = {
  production: {
    entry: resolve(ROOT, 'src/player/index.ts'),
    name: 'CourseVisualizationBundle',
    fileName: 'player.js',
  },
  worker: {
    entry: resolve(ROOT, 'src/browser/worker.ts'),
    name: 'ClangTraceWorkerBundle',
    fileName: 'clang-worker.js',
  },
  playground: {
    entry: resolve(ROOT, 'src/browser/playground.ts'),
    name: 'CoursePlaygroundBundle',
    fileName: 'playground.js',
  },
};

export default defineConfig(({ mode }) => {
  const target = BUILD_ENTRIES[mode] ?? BUILD_ENTRIES.production;

  return {
    root: ROOT,
    build: {
      outDir: resolve(ROOT, 'player'),
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: target.entry,
        name: target.name,
        formats: ['iife'],
        fileName: () => target.fileName,
      },
    },
    plugins: [
      {
        name: 'course-visualization-dev',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0] ?? '/';
            if (
              url === '/' ||
              url === '/index.html' ||
              url === '/demo.html' ||
              url === '/player/demo.html'
            ) {
              const demoPath = resolve(ROOT, 'player/demo.html');
              const rawHtml = existsSync(demoPath)
                ? readFileSync(demoPath, 'utf8')
                : renderDemoHtml({ runtime: false });
              const devHtml = rawHtml
                .replace('href="player.css"', 'href="/player/player.css"')
                .replace(
                  '<script defer src="player.js"></script>',
                  '<script type="module" src="/src/player/index.ts"></script>'
                );
              server
                .transformIndexHtml(url, devHtml)
                .then(html => {
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'text/html; charset=utf-8');
                  res.end(html);
                })
                .catch(next);
              return;
            }
            if (url === '/playground.html' || url === '/player/playground.html') {
              const rawHtml = readFileSync(resolve(ROOT, 'player/playground.html'), 'utf8');
              const devConfig =
                '<script>window.CoursePlaygroundConfig = Object.assign({ workerUrl: "/src/browser/worker.ts", workerType: "module", wasmUrl: "/player/clang-trace-frontend.wasm" }, window.CoursePlaygroundConfig || {});</script>\n';
              const devHtml = rawHtml
                .replace('href="player.css"', 'href="/player/player.css"')
                .replace('href="playground.css"', 'href="/player/playground.css"')
                .replace(
                  '<script defer src="playground.js"></script>',
                  `${devConfig}<script type="module" src="/src/browser/playground.ts"></script>`
                );
              server
                .transformIndexHtml(url, devHtml)
                .then(html => {
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'text/html; charset=utf-8');
                  res.end(html);
                })
                .catch(next);
              return;
            }
            next();
          });
        },
      },
    ],
  };
});
