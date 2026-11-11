#!/usr/bin/env node
// Write `demo.html`: the player inside a lesson-like page, for checking the engine locally.
//
// It traces a few examples from `en/labs/cpp/02_variables.md` and `04_pointer.md` with the
// compiler-backed tracer and adds the pointer and struct fixtures. Each player sits in a
// collapsed `<details>`, as on the site; the buttons in the header switch `<html data-theme>`
// and `lang`, as Starlight does.
// Run from the course root, inside the default shell (Clang and GDB):
//   nix develop --command node visualizations/player/demo.mjs
// Then open player/demo.html (git-ignored).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dumpsSorted } from '../json_format.mjs';
import { validate } from '../trace_format.mjs';
import { trace } from '../tracing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const EXAMPLES = {
  'Assigning one variable to another':
    'int a = 5;\nint b = 6;\na = b;\nb = 7;\nstd::cout << a << std::endl;\n',
  'Literals, variables and operators are expressions':
    'int a = 5;\nint b = a;\nint c = a + 6;\nstd::cout << b << std::endl;\nstd::cout << c << std::endl;\n',
  'Empty initialization': 'int a{};\nstd::cout << a << std::endl;\n',
  'Swapping variables':
    'int a { 1 };\nint b { 2 };\na = b;\nb = a;\nstd::cout << a << std::endl;\nstd::cout << b << std::endl;\n',
};

const POINTER_EXAMPLES = {
  'auto deduces a pointer type':
    'int value{ 5 };\nauto p{ &value };\n*p = 8;\nstd::cout << value << std::endl;\n',
  'Copying a pointer and the value it points to':
    'int value{ 5 };\nint* p{ &value };\nauto copy{ p };\nauto copiedValue{ *p };\n' +
    '*copy = 8;\nstd::cout << value << std::endl;\nstd::cout << copiedValue << std::endl;\n',
  'A pointer to a pointer':
    'int value{ 5 };\nint* p{ &value };\nauto pp{ &p };\n**pp = 9;\nstd::cout << value << std::endl;\n',
  'Two pointers to one variable':
    'int x{ 0 };\nint* px{ &x };\nint y{ x };\nint* py{ px };\n*px = 1;\n' +
    'std::cout << x << std::endl;\nstd::cout << y << std::endl;\n' +
    'std::cout << *px << std::endl;\nstd::cout << *py << std::endl;\n',
  'Null pointer initialization':
    'int a = 5;\nint* p{};\np = &a;\n*p = 6;\nstd::cout << a << std::endl;\n',
};

const PAGE = `<!doctype html>
<html lang="en" data-theme="dark">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Player demo</title>
<script>
// Starlight sets these before paint; ?theme= and ?lang= let screenshots pick them.
const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme = query.get('theme') || 'dark';
document.documentElement.lang = query.get('lang') || 'en';
</script>
<link rel="stylesheet" href="player.css">
<script defer src="player.js"></script>
<style>
:root {color-scheme: dark; --page: #17181c; --text: #dfe3ea; --muted: #9aa1ae; --code: #23262e;
 --line: #353945}
:root[data-theme=light] {color-scheme: light; --page: #ffffff; --text: #23262f; --muted: #5d6573;
 --code: #f4f5f8; --line: #dde1e8}
* {box-sizing: border-box}
body {margin: 0; background: var(--page); color: var(--text);
 font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif}
header {position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center;
 padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--page)}
header strong {margin-right: auto}
header button {font: inherit; font-size: 14px; color: inherit; background: var(--code);
 border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer}
main {max-width: 45rem; margin: 0 auto; padding: 1rem 1rem 4rem}
h2 {font-size: 1.35rem; margin: 2.2rem 0 .8rem}
pre {background: var(--code); border: 1px solid var(--line); border-radius: 6px;
 padding: .8rem 1rem; overflow-x: auto; font-size: .875rem}
details {border-left: 3px solid var(--line); padding: .2rem 0 .2rem 1rem; margin: 1rem 0}
summary {cursor: pointer; font-weight: 600}
p {color: var(--muted)}
</style>
<header><strong>Player demo</strong>
 <button id="theme" type="button">Theme</button><button id="lang" type="button">Language</button></header>
<main>
<p>Compiler-traced examples from lessons 2 and 4, then the manual pointer and struct fixtures.
The first trace is already open; the others initialize when opened.</p>
__SECTIONS__
</main>
<script>
document.getElementById('theme').onclick = () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
};
document.getElementById('lang').onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set('lang', document.documentElement.lang === 'en' ? 'ru' : 'en');
  url.searchParams.set('theme', document.documentElement.dataset.theme);
  location.href = url;
};
</script>
</html>
`;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function section(index, title, data, opened) {
  validate(data);
  const payload = dumpsSorted(data).replace(/</g, '\\u003c');
  const source = escapeHtml(data.source.join('\n'));
  return (
    `<h2 id="trace-${index}">${index}. ${escapeHtml(title)}</h2>\n<pre><code>${source}</code></pre>\n` +
    `<details${opened ? ' open' : ''}><summary>Execution trace</summary>\n` +
    `<div class="course-visualization"><script type="application/json">${payload}</script></div>\n` +
    `</details>`
  );
}

export function main() {
  const traces = [];
  for (const [title, source] of Object.entries({ ...EXAMPLES, ...POINTER_EXAMPLES })) {
    traces.push([title, trace(source)]);
  }
  const fixturesDir = join(HERE, 'fixtures');
  const files = readdirSync(fixturesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
    traces.push([data.title ?? basename(file, '.json'), data]);
  }
  const sections = traces.map(([title, data], i) => section(i + 1, title, data, i === 0));
  const target = join(HERE, 'demo.html');
  writeFileSync(target, PAGE.replace('__SECTIONS__', sections.join('\n\n')));
  console.log(target);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
