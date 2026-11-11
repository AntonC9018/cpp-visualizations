import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { renderDemoHtml } from './src/node/demo.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: ROOT,
  build: {
    outDir: resolve(ROOT, 'player'),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(ROOT, 'src/player/index.ts'),
      name: 'CourseVisualizationBundle',
      formats: ['iife'],
      fileName: () => 'player.js',
    },
  },
  plugins: [
    {
      name: 'course-visualization-demo',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] ?? '/';
          if (url === '/' || url === '/index.html' || url === '/player/demo.html') {
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
          next();
        });
      },
    },
  ],
});
