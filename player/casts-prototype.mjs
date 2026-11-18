// PROTOTYPE, throwaway (casts and bit-level representation, #58).
// Traces the Lab 3 cast/bits scenarios with the real compiler-backed tracer and writes
// `player/casts-prototype.html` referencing `player.css` and `casts-prototype.js`.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../src/core/trace_format.ts';
import { trace } from '../src/node/tracing.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const SCENARIOS = [
  {
    title: 'Truncation and implicit widening (#58 · Lab 3 §5)',
    source: 'uint32_t a{ 256 };\nuint8_t b{ static_cast<uint8_t>(a) };\nuint32_t c{ b };\n',
  },
  {
    title: 'Widening a negative signed number: sign-bit 1 copied (Lab 3 §4)',
    source: 'int8_t a{ -3 };\nint b{ static_cast<int>(a) };\n',
  },
  {
    title: 'Widening a positive signed number: sign-bit 0 copied',
    source: 'int8_t a{ 5 };\nint b{ static_cast<int>(a) };\n',
  },
  {
    title: 'Narrowing a negative number: sign flip (Lab 3 §6)',
    source: 'int c{ -200 };\nint8_t d{ static_cast<int8_t>(c) };\n',
  },
  {
    title: 'Bitwise NOT promotion, truncation, and unsigned zero-extension (Lab 3 §7)',
    source: 'uint8_t a{ 0 };\nuint8_t b{ static_cast<uint8_t>(~a) };\nint32_t c{ b };\n',
  },
];

const traces = SCENARIOS.map(({ title, source }) => {
  const t = trace(source, { runtime: false, types: true });
  t.title = title;
  validate(t);
  return t;
});

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PROTOTYPE · casts and bit-level representation (#58)</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="player.css">
<style>
  html[data-theme=dark] { --page: #0d1117; --ink: #e6e9f1; --soft: #a4abbb; --card: #161b22; --line: #30363d; }
  html[data-theme=light] { --page: #ffffff; --ink: #17202c; --soft: #4f5c6e; --card: #f6f8fa; --line: #d0d7de; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 28px 24px 140px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 28px 0 8px; }
  h3 { font-size: 17px; margin: 0 0 6px; }
  .note { color: var(--soft); margin: 0 0 18px; }
  pre { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow-x: auto; font-size: 14px; margin: 0 0 10px; }
  details { margin: 0 0 26px; }
  summary { cursor: pointer; font-weight: 600; margin-bottom: 8px; }
  kbd { padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; }
  #bar {
    position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 20;
    display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px;
    width: min(320px, calc(100vw - 24px));
    padding: 6px 10px; border-radius: 999px;
    background: #fff200; color: #111; box-shadow: 0 6px 24px rgba(0, 0, 0, .45);
    font: 600 14px system-ui, sans-serif; white-space: nowrap; box-sizing: border-box;
  }
  #bar button {
    font: inherit; color: #fff200; background: #111; border: 0;
    border-radius: 999px; padding: 5px 12px; cursor: pointer;
  }
  #bar button:hover { opacity: .88; }
  #bar .label { text-align: center; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
  @media (max-width: 640px) { #bar { font-size: 12.5px; gap: 6px; } #bar button { padding: 4px 10px; } }
</style>
</head>
<body>
<main>
  <h1>PROTOTYPE · Casts and bit-level representation</h1>
  <p class="note">
    Signed widening carries the sign bit into the new bytes; unsigned widening fills zeros.
    Memory shows the value and its bytes, ordered by the <strong>Little-endian / Big-endian</strong> switch in each player.
    Inside a player, <kbd>←</kbd>/<kbd>→</kbd> step as usual.
  </p>
  <div id="sections"></div>
</main>
<nav id="bar" aria-label="Prototype controls">
  <span class="label">#58 prototype</span>
  <button id="theme" type="button">theme</button>
</nav>
<script>
window.CastsPrototype = { traces: ${JSON.stringify(traces).replace(/</g, '\\u003c')} };
</script>
<script defer src="casts-prototype.js"></script>
</body>
</html>
`;

writeFileSync(join(HERE, 'casts-prototype.html'), html);
console.log('wrote', join(HERE, 'casts-prototype.html'));
