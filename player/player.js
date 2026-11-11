/* Course visualization player.
 *
 * Steps through traces in the unified format (see README.md): source code on the left, memory
 * with pointer arcs and struct frames above an expression-evaluation pane on the right, and the
 * program output below. Every `div.course-visualization` holding a
 * `<script type="application/json">` trace becomes a player, lazily, once its `<details>` opens.
 * Plain browser JavaScript, no dependencies; the palette lives in player.css.
 */
(() => {
  'use strict';
  if (window.CourseVisualization) return;

  // Geometry, in SVG user units --------------------------------------------------------------
  const CHAR = 0.602;                       // monospace advance, in em
  const CODE_SIZE = 25, PANE_SIZE = 30;
  const CODE_CHAR = CODE_SIZE * CHAR, EVAL_CHAR = PANE_SIZE * CHAR;
  const LINE = 56, CELL = 64, MARGIN = 28;
  const MEMORY_WIDTH = 600, MAX_BYTE = 28;
  // A trace with one- or two-byte cells draws wider bytes, as far as memory has room: their
  // values must stay readable.
  const NARROW_BYTE = 48;
  // Struct frames hug their cells; neighbouring frames just touch.
  const FRAME = { side: 4, top: 36, bottom: 40, stroke: 2.5 };
  const GAP = 2 * FRAME.side + FRAME.stroke;
  // A struct holding a struct: the inner frame keeps NEST clear of its neighbours, and the
  // outer frame rises by RISE around it, leaving room below for the inner frame's name.
  const NEST = 10, RISE = { top: 10, bottom: 34 };
  // A reference is a second name: a tag under the name of what it is bound to. Tags of one
  // name stack `step` apart; those of a field sit inside the struct's frame, which grows.
  const TAG = { top: { size: 24, step: 40 }, field: { size: 19, step: 32 } };
  const STACK_BELOW = 600;                  // CSS pixels: narrower players stack code above memory
  const MAX_SCALE = 0.6;                    // CSS pixels per unit: short traces do not blow up
  const DIM = 0.5;                          // opacity of variables the statement does not involve
  const T = { prepare: 0.55, travel: 1.1, settle: 0.6, follow: 0.9, writeHold: 0.8,
    copyBegin: 0.15, copyTravel: 1.0, evaluate: 0.6, clash: 1.6 };
  const KEYWORDS = new Set(['int', 'std', 'cout', 'endl', 'struct', 'auto', 'const']);
  const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"';
  const PALETTE = ['bg', 'panel', 'pane', 'fg', 'muted', 'grey', 'context', 'read', 'read-fill',
    'write', 'write-fill', 'deref-fill', 'highlight', 'dead-fill', 'dead-stroke', 'gap-stroke',
    'tether', 'error', 'type-label'];
  const VARIABLE_COLOURS = 5, FIELD_COLOURS = 4, TYPE_COLOURS = 6;
  // Type labels: text sizes in the pane and under names, the room above the pane's text, the
  // step between rows of labels under names.
  const LABEL = { pane: 20, memory: 18, rise: 38, row: 30 };

  const STRINGS = {
    en: {
      play: 'Play', pause: 'Pause', back: 'Back', next: 'Next', replay: 'Replay step',
      reset: 'Reset', speed: 'Playback speed', scrub: 'Execution step', output: 'Output:',
      stage: 'Code, memory and expression evaluation', jump: 'Jump to line {line}: {code}',
      copy: 'Line {line}: {code}', read: 'Read {name}: {value}',
      addr: 'Take the address of {name}: {value}', deref: 'Follow the address in {via} to {target}',
      eval: 'Evaluate: {value}', write: 'Store {value} in {name}', print: 'Print {value}',
      bind: '{name} becomes another name for {target}', alias: '{name} is another name for {target}',
      blank: { '\n': 'Print a newline', '\t': 'Print a tab', ' ': 'Print a space' },
      convert: 'Convert {from} to {to}: {value}',
      clash: 'Does not compile: {value} is {from}, {slot} needs {to}',
      error: 'This visualization could not be loaded.',
    },
    ru: {
      play: 'Пуск', pause: 'Пауза', back: 'Назад', next: 'Далее', replay: 'Повторить шаг',
      reset: 'Сначала', speed: 'Скорость', scrub: 'Шаг выполнения', output: 'Вывод:',
      stage: 'Код, память и вычисление выражения', jump: 'Перейти к строке {line}: {code}',
      copy: 'Строка {line}: {code}', read: 'Чтение {name}: {value}',
      addr: 'Адрес {name}: {value}', deref: 'Переход по адресу из {via} к {target}',
      eval: 'Вычисление: {value}', write: 'Запись {value} в {name}', print: 'Вывод {value}',
      bind: '{name} становится ещё одним именем для {target}', alias: '{name} — другое имя для {target}',
      blank: { '\n': 'Вывод перевода строки', '\t': 'Вывод табуляции', ' ': 'Вывод пробела' },
      convert: 'Преобразование {from} в {to}: {value}',
      clash: 'Не компилируется: {value} имеет тип {from}, а для {slot} нужен {to}',
      error: 'Не удалось загрузить визуализацию.',
    },
  };
  const ICONS = {
    play: '<path d="M5 3.5v13l11-6.5z"/>',
    pause: '<path d="M5 3.5h3.5v13H5zM11.5 3.5H15v13h-3.5z"/>',
    back: '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    next: '<path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    replay: '<path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.8 2.6v4.6h-4.6z"/>',
    reset: '<path d="M4 4h2.2v12H4zM16 4v12l-8.5-6z"/>',
  };

  // Markup helpers ---------------------------------------------------------------------------
  const round = value => Math.round(value * 100) / 100;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;',
    '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  // Printed whitespace (`std::endl`) travels as a visible glyph.
  const glyphs = value => String(value).replace(/\n/g, '↵').replace(/\t/g, '⇥').replace(/ /g, '␣');
  const format = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  // textLength pins every glyph run to the advance the layout assumes, whatever the font.
  function text(x, y, value, size, color, anchor = 'start') {
    value = String(value);
    if (!value.trim()) return '';
    const length = value.length > 1
      ? ` textLength="${round(value.length * size * CHAR)}" lengthAdjust="spacing"` : '';
    return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${color}" `
      + `text-anchor="${anchor}" xml:space="preserve"${length}>${esc(value)}</text>`;
  }
  function rect(x, y, w, h, fill, stroke = 'none', radius = 8, width = 3) {
    return `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(0, w))}" `
      + `height="${round(h)}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
  }
  const show = at => `<set attributeName="opacity" to="1" begin="${round(at)}s" fill="freeze"/>`;
  const hide = at => `<set attributeName="opacity" to="0" begin="${round(at)}s" fill="freeze"/>`;
  const fade = (from, to, dur = 0.5, begin = 0) => `<animate attributeName="opacity" from="${from}" `
    + `to="${to}" dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;
  const animateAttr = (name, from, to, dur = 0.45, begin = 0) => `<animate attributeName="${name}" `
    + `from="${typeof from === 'number' ? round(from) : from}" to="${typeof to === 'number' ? round(to) : to}" `
    + `dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;
  const animated = (element, animations) => animations
    ? element.replace(/\/>$/, '>' + animations + '</' + element.match(/^<(\w+)/)[1] + '>') : element;
  const pulse = begin => `<animateTransform attributeName="transform" type="scale" values="1;1.14;1" `
    + `keyTimes="0;0.45;1" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" `
    + `begin="${round(begin)}s" dur="0.65s" fill="freeze"/>`;
  const markBox = (x, y, length, stroke, fill) => `<rect x="${round(x - 3)}" y="${round(y - 32)}" `
    + `width="${round(length * EVAL_CHAR + 6)}" height="42" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  // Starts `from` units right of its place and slides home after `begin`.
  const settle = (markup, from, begin) => from
    ? `<g transform="translate(${round(from)} 0)"><animateTransform attributeName="transform" `
      + `type="translate" from="${round(from)} 0" to="0 0" begin="${round(begin)}s" dur="0.3s" `
      + `${EASE} fill="freeze"/>${markup}</g>` : markup;
  const glide = (markup, dx, begin, dur) => dx
    ? `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${round(dx)} 0" `
      + `begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>${markup}</g>` : markup;
  // Scales markup about a point, from `from` to `to`, during [begin, begin + dur].
  const scaleAbout = (markup, x, y, from, to, begin, dur) => `<g transform="translate(${round(x)} ${round(y)})">`
    + `<g transform="scale(${from})"><animateTransform attributeName="transform" type="scale" `
    + `from="${from}" to="${to}" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>`
    + `<g transform="translate(${round(-x)} ${round(-y)})">${markup}</g></g></g>`;

  // Timing -----------------------------------------------------------------------------------
  const stores = op => op.kind === 'write' || op.kind === 'bind';
  const departure = op => stores(op) ? T.writeHold : op.kind === 'print' ? 0.2 : T.prepare;
  function arrival(op) {
    if (op.kind === 'deref') return T.prepare + T.follow;
    if (op.kind === 'eval' || op.kind === 'alias' || op.kind === 'convert') return T.evaluate;
    if (op.kind === 'clash') return T.clash;
    if (op.kind === 'print') return 0.9;
    return departure(op) + T.travel;
  }
  const opSeconds = op => arrival(op) + T.settle + (stores(op) ? 0.5 : 0);
  const copies = (steps, i) => !steps[i].op && (i === 0 || steps[i - 1].line !== steps[i].line);
  const copyBegin = (steps, i) => i > 0 ? 0.3 : T.copyBegin;
  function animationSeconds(steps, i) {
    const step = steps[i];
    if (step.op) return opSeconds(step.op);
    return copies(steps, i) ? copyBegin(steps, i) + T.copyTravel + 0.25 : 0;
  }
  const stepSeconds = (steps, i) => steps[i].hold + animationSeconds(steps, i);

  // Model: the trace's storage flattened into cells (leaves) and struct frames (groups) --------
  function prepare(trace) {
    if (!trace || trace.format !== 1) throw new Error('unsupported trace format ' + (trace && trace.format));
    const variables = [...trace.variables].sort((a, b) => a.address - b.address);
    const leaves = [], groups = [], tops = [];
    // A struct is a group of its fields, in address order; a struct field is a group within
    // it. `rise` counts the levels of frames a group holds.
    const struct = (item, name, address, variable, parent) => {
      const group = { name, label: item.name, type: item.type, address, size: item.size, color: variable.color,
        fieldColor: parent ? item.color : null, top: variable.name, parent, children: [], rise: 0 };
      groups.push(group);
      for (const field of item.fields) {
        const at = address + field.offset, path = name + '.' + field.name;
        if (field.kind === 'struct') {
          const inner = struct(field, path, at, variable, name);
          group.rise = Math.max(group.rise, inner.rise + 1);
          group.children.push(inner);
        } else {
          const leaf = { name: path, label: field.name, group: variable.name, address: at, size: field.size,
            kind: field.kind, color: variable.color, fieldColor: field.color };
          leaves.push(leaf);
          group.children.push(leaf);
        }
      }
      group.fields = group.children.map(child => child.name);
      return group;
    };
    for (const variable of variables) {
      if (variable.kind === 'struct') tops.push(struct(variable, variable.name, variable.address, variable, null));
      else {
        leaves.push({ ...variable, label: variable.name, group: null });
        tops.push(leaves[leaves.length - 1]);
      }
    }
    const top = variables.map(variable => variable.name);
    // A type's colour follows from its name, so it is the same in every example: `int` has
    // the first, and two types that would share one in a trace take neighbouring colours.
    // A trace without typed panes (a hand-written one) is drawn without any labels.
    const types = new Set(['int', ...variables.map(variable => variable.type),
      ...trace.steps.flatMap(step => (step.types || []).map(part => part.type))].filter(Boolean));
    const typeColours = new Map(), taken = new Set();
    for (const type of types) {
      let index = type === 'int' ? 0 : [...type].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 9973, 7) % TYPE_COLOURS;
      while (taken.has(index) && taken.size < TYPE_COLOURS) index = (index + 1) % TYPE_COLOURS;
      taken.add(index);
      typeColours.set(type, index);
    }
    const typed = trace.steps.some(step => step.types);
    return { typeColours, typed, trace, steps: trace.steps, source: trace.source, spans: trace.spans || [], types: trace.types || {},
      references: trace.references || [], leaves, groups, tops, top, rise: Math.max(0, ...groups.map(group => group.rise)) };
  }

  // Variables the current statement involves stay bright; the rest dim to half. A pointer's
  // target joins once evaluation reaches it.
  function activeVariables(m, i) {
    const line = m.steps[i].line, active = new Set();
    const refs = m.steps[i].refs || {};
    for (const token of m.source[line].match(/\b[A-Za-z_]\w*\b/g) || []) {
      if (m.top.includes(token)) active.add(token);
      // A bound reference on the line involves what it names as well.
      if (refs[token]) active.add(token).add(refs[token].split('.')[0]);
    }
    for (let j = i; j >= 0 && m.steps[j].line === line; j--) {
      for (const key of ['name', 'target', 'via']) {
        const op = m.steps[j].op;
        if (op && op[key]) active.add(op[key].split('.')[0]);
      }
    }
    return active;
  }

  // Layout -----------------------------------------------------------------------------------
  function links(g, step) {
    const list = g.leaves.filter(l => l.kind === 'ptr' && step.targets[l.name] && g.box(step.targets[l.name]))
      .map(l => ({ from: l, to: g.box(step.targets[l.name]) }));
    const centre = c => c.x + c.w / 2, ports = new Map();
    for (const l of list) {
      for (const [cell, other, key] of [[l.from, l.to, 'sx'], [l.to, l.from, 'ex']]) {
        if (!ports.has(cell.name)) ports.set(cell.name, { cell, ends: [] });
        ports.get(cell.name).ends.push({ l, key, other: centre(other) });
      }
    }
    // Ends leading left sit left of ends leading right; on each side the farther-reaching arc
    // sits nearer the centre and rises higher, so chains and shared pointees never cross.
    for (const { cell, ends } of ports.values()) {
      const side = end => end.other < centre(cell) ? 0 : 1;
      ends.sort((p, q) => side(p) - side(q) || q.other - p.other);
      const spread = 20 * (ends.length - 1);
      // Arc ends keep clear of the cell's address label.
      const low = g.isStruct(cell) ? cell.x + 12 : cell.x + 3 + labelWidth(cell) + 14, high = cell.x + cell.w - 12;
      const first = Math.min(Math.max(centre(cell) - spread / 2, low), Math.max(low, high - spread));
      ends.forEach((end, i) => { end.l[end.key] = first + i * 20; });
    }
    const range = l => [Math.min(l.sx, l.ex), Math.max(l.sx, l.ex)];
    for (const l of list) {
      const [a, b] = range(l);
      l.level = list.filter(o => o !== l && range(o)[0] >= a && range(o)[1] <= b).length;
      // An arc to a struct ends on its frame; an arc to a field passes through onto the field.
      const sy = l.from.y - 2, ey = g.isStruct(l.to) ? frameOf(l.to).y - 1 : l.to.y - 3;
      const apex = g.memY - FRAME.top - g.rise * RISE.top - 84 - l.level * 40;
      l.d = `M ${round(l.sx)} ${sy} C ${round(l.sx)} ${apex}, ${round(l.ex)} ${apex}, ${round(l.ex)} ${ey - 9}`;
      l.head = [l.ex, ey];
    }
    return list;
  }
  const frameOf = s => ({ x: s.x - FRAME.side, y: s.y - FRAME.top - s.rise * RISE.top, w: s.w + 2 * FRAME.side,
    h: s.h + FRAME.top + FRAME.bottom + s.rise * (RISE.top + RISE.bottom) + (s.drop || 0) });
  // The rows of reference tags under each name. A tag takes the first row where it fits
  // beside the tags of the neighbouring names on its level. `drop` is how far a struct's
  // frame grows to hold the tags of its fields.
  function tagRows(m, box) {
    const bound = m.steps[m.steps.length - 1].refs || {}, tags = [], rows = new Map(), drop = new Map();
    for (const r of m.references) {
      const target = bound[r.name];
      if (!target) continue;
      const item = box(target), style = target.includes('.') ? TAG.field : TAG.top;
      const w = Math.max(r.name.length * style.size * CHAR + 20, style.size + 18), cx = item.x + item.w / 2;
      const level = target.includes('.') ? target.slice(0, target.lastIndexOf('.')) : '';
      let row = 0;
      while (tags.some(t => t.level === level && t.row === row && Math.abs(t.cx - cx) < (t.w + w) / 2 + 6)) row++;
      tags.push({ ...r, target, style, w, cx, level, row });
      rows.set(target, Math.max(rows.get(target) || 0, row + 1));
    }
    const below = name => (rows.get(name) || 0) * (name.includes('.') ? TAG.field : TAG.top).step;
    const sink = item => {
      const inner = Math.max(0, ...(item.children || []).map(child => below(child.name) + sink(child)));
      drop.set(item.name, inner);
      return inner;
    };
    const height = Math.max(0, ...m.tops.map(item => sink(item) + below(item.name)));
    return { tags, drop, height };
  }
  // Where storage sits along the memory row, from its left end: bytes to scale, GAP between
  // variables, NEST on both sides of a nested frame. `gaps` are the unused bytes.
  function placement(m, byte) {
    const spans = new Map(), gaps = [];
    const unused = (x, bytes) => { if (bytes > 0) gaps.push([x, bytes * byte]); return Math.max(0, bytes) * byte; };
    const put = (item, x) => {
      let w = item.size * byte;
      if (item.children) {
        let address = item.address;
        w = 0;
        for (const child of item.children) {
          w += unused(x + w, child.address - address);
          const pad = child.children ? NEST : 0;
          w += pad + put(child, x + w + pad) + pad;
          address = child.address + child.size;
        }
        w += unused(x + w, item.address + item.size - address);
      }
      spans.set(item.name, [x, w]);
      return w;
    };
    let width = 0, address = null;
    for (const item of m.tops) {
      if (address !== null) width += unused(width, item.address - address) + GAP;
      width += put(item, width);
      address = item.address + item.size;
    }
    return { spans, gaps, width };
  }
  // The types under the names of top-level storage. A label takes the first row where it
  // clears the label before it, so a narrow cell's type drops below its neighbour's.
  function typeRows(m, box) {
    const labels = [], edge = [];
    for (const item of m.typed ? m.tops : []) {
      if (!item.type) continue;
      const at = box(item.name), cx = at.x + at.w / 2, half = typeLabelWidth(item.type, LABEL.memory) / 2;
      let row = 0;
      while (edge[row] !== undefined && cx - half < edge[row] + 6) row++;
      edge[row] = cx + half;
      labels.push({ name: item.name, type: item.type, cx, row });
    }
    return { labels, height: edge.length ? edge.length * LABEL.row + 6 : 0 };
  }
  const typeLabelWidth = (type, size) => type.length * size * CHAR + 14;
  const labelWidth = c => String(c.address).length * 16 * CHAR;
  const labelCentre = c => [c.x + 3 + labelWidth(c) / 2, c.y - 18];
  const valueCentre = c => [c.x + c.w / 2, c.y + 32];

  // Where a struct's definition pops out: its type name in the code, and each of its frames.
  function typeTargets(m, g) {
    const names = Object.keys(m.types);
    if (!names.length) return [];
    const word = new RegExp(`\\b(${names.join('|')})\\b`, 'g'), targets = [];
    m.source.forEach((source, i) => {
      for (const match of source.matchAll(word)) {
        targets.push({ type: match[1], underline: true, x: g.code.x + 62 + match.index * CODE_CHAR,
          y: g.lineY(i) - CODE_SIZE * 0.85, w: match[1].length * CODE_CHAR, h: CODE_SIZE * 1.2 });
      }
    });
    // Inner frames first: the pointer hits the innermost one.
    for (const s of [...g.groups].reverse()) if (m.types[s.type]) targets.push({ type: s.type, ...frameOf(s) });
    return targets;
  }

  // Labels centred under neighbouring boxes share one size, shrunk until the widest pair fits.
  function labelSize(boxes, label, size) {
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i], room = (b.x + b.w / 2) - (a.x + a.w / 2) - 8;
      const half = (label(a).length + label(b).length) * CHAR / 2;
      if (half * size > room) size = room / half;
    }
    return size;
  }

  function geometry(m, P, stacked) {
    const g = { stacked, isStruct: c => Boolean(c.fields) };
    const longest = Math.max(...m.source.map(line => line.length));
    let codeW = Math.max(300, 62 + longest * CODE_CHAR + 30);
    const codeH = 44 + m.source.length * LINE;
    // Memory: top-level variables sit GAP apart, so frames hug their cells and just touch.
    const first = m.tops[0], last = m.tops[m.tops.length - 1];
    const fixed = GAP * (m.tops.length - 1) + 2 * NEST * m.groups.filter(s => s.parent).length;
    const widest = m.leaves.some(leaf => leaf.size < 4) ? NARROW_BYTE : MAX_BYTE;
    const placed = placement(m, Math.min(widest, (MEMORY_WIDTH - fixed) / (last.address + last.size - first.address)));
    const memoryW = placed.width;
    g.rise = m.rise;
    const paneChars = Math.max(...m.steps.map(step => step.pane.length));
    const finalStdout = m.steps[m.steps.length - 1].stdout;
    // A lone trailing newline adds no visible line; output of only a newline still shows one.
    const outputLines = finalStdout ? finalStdout.replace(/\n$/, '').split('\n') : [];
    const outputChars = Math.max(0, ...outputLines.map(line => line.length));
    let columnW = Math.max(360, memoryW + 48, paneChars * EVAL_CHAR + 48,
      (P.outputLabel.length + 1) * 26 * CHAR + outputChars * EVAL_CHAR + 48);
    if (stacked) codeW = columnW = Math.max(codeW, columnW);

    // The right column, from its own top: arcs, memory, names, pane, output.
    const at = (memX, memY, c) => ({ ...c, x: memX + placed.spans.get(c.name)[0], y: memY,
      w: placed.spans.get(c.name)[1], h: CELL });
    // Arc room comes from the highest arc any step draws.
    const probe = { ...g, memY: 0, leaves: m.leaves.map(l => at(0, 0, l)), groups: m.groups.map(s => at(0, 0, s)) };
    probe.box = name => probe.groups.find(s => s.name === name) || probe.leaves.find(l => l.name === name);
    let level = -1;
    for (const step of m.steps) for (const l of links(probe, step)) level = Math.max(level, l.level);
    const structs = m.groups.length > 0;
    const room = (level >= 0 ? FRAME.top + 84 + level * 40 + 10 : (structs ? FRAME.top : 0) + 30) + g.rise * RISE.top;
    const tagged = tagRows(m, probe.box);
    const typeRow = typeRows(m, probe.box), rise = m.typed ? LABEL.rise : 0;
    const named = (structs ? CELL + FRAME.bottom + 32 : CELL + 34) + g.rise * RISE.bottom + tagged.height;
    const names = named + typeRow.height;
    const paneTop = room + names + 56, paneH = 76 + rise + (rise ? 6 : 0);
    const outputTop = paneTop + paneH + 60;
    const columnH = outputLines.length ? outputTop + (outputLines.length - 1) * 36 + 14 : paneTop + paneH;

    let codeX = MARGIN, codeY, columnX, columnY, width, height;
    if (stacked) {
      codeY = MARGIN;
      columnX = MARGIN;
      columnY = codeY + codeH + 24;
      width = MARGIN + columnW + 30 + MARGIN;
      height = columnY + columnH + MARGIN;
    } else {
      const content = Math.max(codeH, columnH);
      codeY = MARGIN + (content - codeH) / 2;
      columnX = codeX + codeW + 56;
      columnY = MARGIN + (content - columnH) / 2;
      width = columnX + columnW + MARGIN;
      height = MARGIN + content + MARGIN;
    }
    Object.assign(g, { width, height, code: { x: codeX, y: codeY, w: codeW, h: codeH },
      memX: columnX + 24, memY: columnY + room, pane: { x: columnX, y: columnY + paneTop, w: columnW, h: paneH },
      tx: columnX + 24, out: [columnX + 24, columnY + outputTop] });
    g.ty = g.pane.y + 38 + 11 + rise;
    g.below = g.pane.y - 56;
    g.lineY = i => g.code.y + 50 + i * LINE;
    g.gaps = placed.gaps.map(([x, w]) => [g.memX + x, w]);
    const colour = (list, i, count) => list[i % count];
    g.leaves = m.leaves.map(l => ({ ...at(g.memX, g.memY, l), color: colour(P.vars, l.color, VARIABLE_COLOURS),
      fieldColor: l.group ? colour(P.fields, l.fieldColor, FIELD_COLOURS) : null }));
    g.groups = m.groups.map(s => ({ ...at(g.memX, g.memY, s), color: colour(P.vars, s.color, VARIABLE_COLOURS),
      fieldColor: s.parent ? colour(P.fields, s.fieldColor, FIELD_COLOURS) : null, drop: tagged.drop.get(s.name) }));
    g.box = name => g.groups.find(s => s.name === name) || g.leaves.find(l => l.name === name);
    g.cellsOf = name => g.leaves.filter(l => l.name === name || l.name.startsWith(name + '.'));
    // Colouring of identifiers: variables keep their colour; a field takes its field's colour.
    // A tag hangs under the name of what it is bound to: `y` is its text's baseline.
    g.tags = tagged.tags.map(t => {
      const item = g.box(t.target), f = g.isStruct(item) ? frameOf(item) : null;
      const name = f ? f.y + f.h + (item.parent ? 24 : 32) : item.y + item.h + (item.group ? 28 : 34);
      return { ...t, cx: t.cx + g.memX, y: name + (t.row + 1) * t.style.step, color: colour(P.vars, t.color, VARIABLE_COLOURS) };
    });
    g.owner = token => g.groups.find(s => s.name === token) || g.leaves.find(l => !l.group && l.name === token)
      || g.tags.find(t => t.name === token);
    g.field = token => g.leaves.find(l => l.group && l.label === token)
      || g.groups.find(s => s.parent && s.label === token);
    g.typeLabels = typeRow.labels.map(l => ({ ...l, cx: l.cx + g.memX, top: g.memY + named + 8 + l.row * LABEL.row }));
    g.typeTargets = typeTargets(m, g);
    g.nameSize = labelSize([...g.groups.filter(s => !s.parent), ...g.leaves.filter(l => !l.group)], c => c.name, 26);
    g.fieldSize = labelSize(g.leaves.filter(l => l.group), c => c.label, 20);
    return g;
  }

  // Scene ------------------------------------------------------------------------------------
  // `c` carries one frame's inputs: model, geometry, palette, strings, steps and focus.
  function colored(c, x, y, value, size = PANE_SIZE, mute = true, member = false) {
    let out = '';
    for (const token of value.split(/(\b[A-Za-z_]\w*\b)/)) {
      if (!token) continue;
      const owner = !member && c.g.owner(token);
      const field = !owner && c.g.field(token);
      const color = owner ? owner.color : field ? field.fieldColor
        : mute && KEYWORDS.has(token) ? c.P.context : c.P.fg;
      out += text(x, y, token, size, color);
      member = /(\.|->)$/.test(token);
      x += token.length * size * CHAR;
    }
    return out;
  }
  // Types -----------------------------------------------------------------------------------
  // A type is a unit of measurement: one colour per type, on a label and under what it types.
  const typeColour = (c, type) => c.P.types[c.m.typeColours.get(type)];
  // A filled pill on the light palette, an outlined one on the dark (--cv-type-label).
  function typeLabel(c, cx, top, type, size, color) {
    const w = typeLabelWidth(type, size), h = size + 7;
    const label = fill => text(cx, top + size + 1, type, size, fill, 'middle');
    return c.P.typeLabel === 'fill' ? rect(cx - w / 2, top, w, h, color, 'none', h / 2) + label(c.P.bg)
      : rect(cx - w / 2, top, w, h, 'none', color, h / 2, 1.5) + label(color);
  }
  // One label per typed part of a pane starting at x. Neighbours of one type that would
  // collide share a label; neighbours of different types shrink until they fit.
  function paneLabels(step, x) {
    const labels = [];
    for (const part of step.types || []) {
      const cx = x + (part.span[0] + part.span[1]) / 2 * EVAL_CHAR, last = labels[labels.length - 1];
      const label = { type: part.type, cx, from: cx, size: LABEL.pane, slot: Boolean(part.slot), start: part.span[0] };
      const gap = () => label.cx - last.cx - 6 - (typeLabelWidth(last.type, last.size) + typeLabelWidth(label.type, label.size)) / 2;
      if (last && gap() < 0 && last.type === label.type && !last.slot) {
        last.cx = (last.from + cx) / 2;
        continue;
      }
      while (last && gap() < 0 && label.size > 11) last.size = label.size = Math.min(last.size, label.size) - 1;
      labels.push(label);
    }
    return labels;
  }
  const labelTop = (y, label) => y - 70 + (LABEL.pane - label.size) / 2;
  // The types of one step's pane, settled, with the pane's text starting at (x, y).
  function paneTypes(c, step, x, y) {
    const { P } = c, op = step.op || {}, clash = op.kind === 'clash';
    const labels = paneLabels(step, x), value = labels.find(label => !label.slot && label.start === (op.span || [])[0]);
    const slot = labels.find(label => label.slot);
    let out = '';
    for (const part of step.types || []) {
      out += `<path d="M ${round(x + part.span[0] * EVAL_CHAR)} ${y + 14} H ${round(x + part.span[1] * EVAL_CHAR)}" `
        + `stroke="${typeColour(c, part.type)}" stroke-width="3" stroke-linecap="round"/>`;
    }
    for (const label of labels) {
      const top = labelTop(y, label), middle = top + (label.size + 7) / 2;
      let mark = typeLabel(c, label.cx, top, label.type, label.size, typeColour(c, label.type));
      // A converted value's new unit pops; a unit that does not fit tries the slot and comes back.
      if (c.animate && step === c.step && label === value && op.kind === 'convert') {
        mark = `<g transform="translate(${round(label.cx)} ${round(middle)})"><g>${pulse(arrival(op) + 0.2)}`
          + `<g transform="translate(${round(-label.cx)} ${round(-middle)})">${mark}</g></g></g>`;
      }
      if (c.animate && step === c.step && label === value && clash && slot) {
        mark = `<g><animateMotion path="M 0 0 H ${round(slot.cx - label.cx)}" keyPoints="0;0.75;0" keyTimes="0;0.55;1" `
          + `calcMode="linear" begin="0.35s" dur="${T.clash - 0.4}s" fill="freeze"/>${mark}</g>`;
      }
      out += mark;
      if (clash && (label === value || label === slot)) {
        const w = typeLabelWidth(label.type, label.size), h = label.size + 7;
        out += rect(label.cx - w / 2 - 4, top - 4, w + 8, h + 8, 'none', P.error, h / 2 + 4, 2.5);
      }
    }
    if (clash && value && slot) out += text((slot.cx + value.cx) / 2, y - 48, '≠', 26, P.error, 'middle');
    return out;
  }

  // pane[a, b) drawn from x; outside the evaluated span (expr) the statement is muted context.
  function paneText(c, x, y, pane, a, b, expr) {
    const member = /(\.|->)$/.test(pane.slice(0, a));
    if (!expr) return colored(c, x, y, pane.slice(a, b), PANE_SIZE, true, member);
    const cuts = [a, Math.min(b, Math.max(a, expr[0])), Math.min(b, Math.max(a, expr[1])), b];
    let out = '';
    for (let i = 0; i < 3; i++) {
      const [from, to] = [cuts[i], cuts[i + 1]];
      if (from >= to) continue;
      const px = x + (from - a) * EVAL_CHAR, part = pane.slice(from, to);
      out += i === 1 ? colored(c, px, y, part, PANE_SIZE, true, /(\.|->)$/.test(pane.slice(0, from)))
        : text(px, y, part, PANE_SIZE, c.P.context);
    }
    return out;
  }
  // The evaluated span keeps the same background as its highlight in the code.
  function exprBackground(c, x, y, expr, from = null, begin = 0) {
    if (!expr || expr[0] === expr[1]) return '';
    const box = e => [x + e[0] * EVAL_CHAR - 4, (e[1] - e[0]) * EVAL_CHAR + 8];
    const [bx, bw] = box(expr);
    let anims = '';
    if (from && from[1] > from[0] && (from[0] !== expr[0] || from[1] !== expr[1])) {
      const [fx, fw] = box(from);
      anims = animateAttr('x', fx, bx, 0.3, begin) + animateAttr('width', fw, bw, 0.3, begin);
      return animated(rect(fx, y - 33, fw, 44, c.P.highlight, 'none', 6), anims);
    }
    return rect(bx, y - 33, bw, 44, c.P.highlight, 'none', 6);
  }
  const settledPane = (c, step, x, y) => exprBackground(c, x, y, step.expr)
    + paneText(c, x, y, step.pane, 0, step.pane.length, step.expr);
  function inContext(step, span) {
    return Boolean(step.expr) && (span[1] <= step.expr[0] || span[0] >= step.expr[1]);
  }

  function dim(c, name, markup) {
    const { focus } = c, on = focus.now.has(name), was = focus.before.has(name), to = on ? 1 : DIM;
    if (on === was) return to === 1 ? markup : `<g opacity="${DIM}">${markup}</g>`;
    return `<g opacity="${was ? 1 : DIM}"><animate attributeName="opacity" from="${was ? 1 : DIM}" `
      + `to="${to}" dur="0.35s" begin="${round(focus.begin.get(name) ?? 0)}s" ${EASE} fill="freeze"/>${markup}</g>`;
  }

  function code(c, oldLine) {
    const { m, g, P, step, op } = c, x = g.code.x;
    let out = rect(x, g.code.y, g.code.w, g.code.h, P.panel);
    const box = line => {
      const source = m.source[line], span = m.spans[line] || [0, source.replace(/;\s*$/, '').length];
      return [x + 62 + span[0] * CODE_CHAR - 3, g.lineY(line) - 30, (span[1] - span[0]) * CODE_CHAR + 6];
    };
    const y = g.lineY(step.line), [bx, by, bw] = box(step.line);
    const failed = step.op && step.op.kind === 'clash';
    let stripe = rect(x + 8, y - 32, 4, 44, failed ? P.error : op && op.kind === 'write' ? P.write : P.read, 'none', 0);
    let span = rect(bx, by, bw, 40, P.highlight, 'none', 6);
    if (oldLine !== null) {
      const [ox, oy, ow] = box(oldLine);
      stripe = animated(stripe, animateAttr('y', g.lineY(oldLine) - 32, y - 32));
      span = animated(span, animateAttr('x', ox, bx) + animateAttr('y', oy, by) + animateAttr('width', ow, bw));
    }
    out += stripe + span;
    m.source.forEach((source, i) => {
      out += text(x + 22, g.lineY(i), i + 1, 18, P.muted)
        + colored(c, x + 62, g.lineY(i), source, CODE_SIZE, /^\s*struct\b/.test(source));
    });
    // A faint dotted underline, like an IDE's hint, says the type name can be hovered.
    for (const t of g.typeTargets) {
      if (t.underline) out += `<path d="M ${round(t.x + 1)} ${round(t.y + t.h - 1)} h ${round(t.w - 2)}" `
        + `stroke="${P.muted}" stroke-width="1.6" stroke-dasharray="1.5 3.5" stroke-linecap="round" opacity="0.6"/>`;
    }
    return out;
  }
  function tether(c, oldLine) {
    const { g, P, step } = c, right = g.code.x + g.code.w, mid = g.pane.y + g.pane.h / 2;
    const path = line => g.stacked
      ? `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 18)} V ${mid} H ${round(g.pane.x + g.pane.w)}`
      : `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 28)} V ${mid} H ${round(g.pane.x)}`;
    const d = path(step.line);
    return animated(`<path d="${d}" fill="none" stroke="${P.tether}" stroke-width="2"/>`,
      oldLine !== null ? animateAttr('d', path(oldLine), d) : '');
  }
  // Code-line controls outlive every redraw, so keyboard focus stays on them; only their
  // placement follows the geometry.
  function lineTargets(m, S) {
    return m.source.map((source, i) => `<rect class="cv-line" data-line="${i}" tabindex="0" role="button" `
      + `aria-label="${esc(format(S.jump, { line: i + 1, code: source }))}" rx="6" height="48"/>`).join('');
  }
  function placeLineTargets(g, targets) {
    targets.forEach((target, i) => {
      target.setAttribute('x', g.code.x + 12);
      target.setAttribute('y', g.lineY(i) - 34);
      target.setAttribute('width', round(g.code.w - 24));
    });
  }

  function linkMarkup(c, l, { grow = null, fadeOut = null } = {}) {
    const [x, y] = l.head, color = l.from.color;
    const head = `<path d="M -11 -6.5 L 0 0 L -11 6.5 Z" fill="${color}" transform="translate(${round(x)} ${y}) rotate(90)"/>`;
    const growing = grow !== null ? ` data-grow="${round(grow)}"` : '';
    // A background halo keeps arcs legible where they pass address labels.
    return dim(c, l.from.name.split('.')[0], `<g>`
      + (fadeOut !== null ? fade(1, 0, 0.3, fadeOut) : '')
      + `<path d="${l.d}" fill="none" stroke="${c.P.bg}" stroke-width="9"${growing}/>`
      + `<path d="${l.d}" fill="none" stroke="${color}" stroke-width="2.5"${growing}/>`
      + (grow !== null ? `<g opacity="0">${fade(0, 1, 0.15, grow + 0.5)}${head}</g>` : head) + '</g>');
  }
  function arrows(c) {
    const { g, step, prev, op } = c, now = links(g, step);
    const writesPointer = op && op.kind === 'write' && g.cellsOf(op.name).some(l => l.kind === 'ptr');
    if (writesPointer) {
      // Redirecting fades the old arc as the new address arrives, then draws the new one.
      const at = arrival(op), changed = new Set(g.cellsOf(op.name).map(l => l.name));
      let out = '';
      for (const l of links(g, prev)) out += linkMarkup(c, l, changed.has(l.from.name) ? { fadeOut: at } : {});
      for (const l of now) if (changed.has(l.from.name)) out += linkMarkup(c, l, { grow: at + 0.1 });
      return out;
    }
    let out = now.map(l => linkMarkup(c, l)).join('');
    if (op && op.kind === 'deref') {
      // The followed arc brightens from pointer to pointee.
      const l = now.find(l => l.from.name === op.via);
      if (l) out += `<path d="${l.d}" fill="none" stroke="${l.from.color}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
    }
    return out;
  }
  // Highlights cover a struct's frame for struct operations and one cell for field operations.
  function outline(c, box, color) {
    if (c.g.isStruct(box)) {
      const f = frameOf(box);
      return rect(f.x + 3, f.y + 3, f.w - 6, f.h - 6, 'none', color, 8, 3);
    }
    return rect(box.x + 4.5, box.y + 4.5, box.w - 9, box.h - 9, 'none', color, 0, 3);
  }
  function memory(c) {
    const { g, P, step, prev, op } = c;
    const values = op && op.kind === 'write' ? prev.values : step.values, at = op ? arrival(op) : 0;
    const writing = new Set(op && op.kind === 'write' ? g.cellsOf(op.name).map(l => l.name) : []);
    const live = l => values[l.name] !== null || writing.has(l.name);
    let out = '';
    // Unused bytes (padding, gaps between variables) are dashed and unlabelled.
    for (const [x, w] of g.gaps) {
      out += `<rect x="${round(x + 3)}" y="${g.memY + 3}" width="${round(w - 6)}" `
        + `height="58" fill="none" stroke="${P.gapStroke}" stroke-dasharray="5 5"/>`;
    }
    for (const s of g.groups) {
      const on = g.cellsOf(s.name).some(live), f = frameOf(s);
      // A nested struct is a field: its frame and name take the field's colour, inside the outer frame.
      const color = on ? s.fieldColor || s.color : null;
      out += dim(c, s.top, rect(f.x, f.y, f.w, f.h, 'none', color || P.deadStroke, 6, FRAME.stroke)
        + (s.parent ? text(s.x + s.w / 2, f.y + f.h + 24, s.label, Math.min(g.fieldSize, 22), color || P.grey, 'middle')
          : text(s.x + s.w / 2, f.y + f.h + 32, s.name, g.nameSize, color || P.grey, 'middle')));
    }
    if (op && op.kind === 'addr') {
      // Taking an address reads the label above storage, not the value.
      const cell = g.cellsOf(op.name)[0], [lx, ly] = labelCentre(cell);
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.1)}`
        + rect(lx - labelWidth(cell) / 2 - 5, ly - 13, labelWidth(cell) + 10, 24, P.readFill, P.read, 5, 2) + '</g>';
    }
    for (const cell of g.leaves) {
      const on = live(cell), changing = writing.has(cell.name), color = cell.fieldColor || cell.color;
      let markup = text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
      markup += cell.group ? text(cell.x + cell.w / 2, cell.y + cell.h + 28, cell.label, g.fieldSize, on ? color : P.grey, 'middle')
        : text(cell.x + cell.w / 2, cell.y + cell.h + 34, cell.label, g.nameSize, on ? color : P.grey, 'middle');
      markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, 'none', 0);
      markup += rect(cell.x + 1.5, cell.y + 1.5, cell.w - 3, cell.h - 3, 'none', on ? color : P.deadStroke, 0, 3);
      if (on) {
        const shown = value => {
          const length = String(value).length, size = Math.min(30, (cell.w - Math.min(12, cell.w / 5)) / (length * CHAR));
          return text(0, size / 3 + 1, value, round(size), value === '?' ? P.grey : P.fg, 'middle');
        };
        markup += `<g transform="translate(${round(cell.x + cell.w / 2)} ${cell.y + cell.h / 2})"><g>` + (changing ? pulse(at - 0.2) : '');
        const before = prev ? prev.values[cell.name] : null, after = step.values[cell.name];
        // A hard cut on arrival: the old value never shows under the new one.
        if (changing && before !== after) {
          if (before !== null) markup += `<g>${hide(at)}${shown(before)}</g>`;
          markup += `<g opacity="0">${show(at)}${shown(after)}</g>`;
        } else markup += shown(changing ? after : values[cell.name]);
        markup += '</g></g>';
      }
      out += dim(c, cell.group || cell.name, markup);
    }
    if (op && (op.kind === 'read' || op.kind === 'write')) {
      out += `<g>${fade(1, 0, 0.35, at + 0.15)}${outline(c, g.box(op.name), op.kind === 'write' ? P.write : P.read)}</g>`;
    }
    // Dereference selects a location without reading it: a neutral outline.
    if (op && op.kind === 'deref') out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target), P.fg)}</g>`;
    // So does a reference: its name stands for the location it is bound to.
    if (op && op.kind === 'alias') out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target), P.fg)}</g>`;
    if (op && op.kind === 'bind') out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.5)}${outline(c, g.box(op.target), P.fg)}</g>`;
    for (const label of g.typeLabels) {
      const on = g.cellsOf(label.name).some(live);
      out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, LABEL.memory, on ? typeColour(c, label.type) : P.deadStroke));
    }
    return out + tags(c, at);
  }
  // A reference's tag shows once it is bound: it pops in as its name arrives, and glows
  // while its name is being replaced by what it stands for.
  function tags(c, at) {
    const { g, P, step, op } = c, bound = step.refs || {};
    let out = '';
    for (const t of g.tags) {
      if (!bound[t.name]) continue;
      const h = t.style.size + 10, x = t.cx - t.w / 2, y = t.y - t.style.size + 1, middle = y + h / 2;
      let markup = rect(x, y, t.w, h, P.panel, t.color, h / 2, 2);
      if (op && op.kind === 'alias' && op.name === t.name) {
        markup += `<g opacity="0">${fade(0, 0.45, 0.2)}${fade(0.45, 0, 0.5, at)}${rect(x, y, t.w, h, t.color, 'none', h / 2)}</g>`;
      }
      markup += text(t.cx, t.y, t.name, t.style.size, t.color, 'middle');
      if (op && op.kind === 'bind' && op.name === t.name) {
        markup = `<g opacity="0">${show(at)}<g transform="translate(${round(t.cx)} ${round(middle)})"><g>${pulse(at - 0.05)}`
          + `<g transform="translate(${round(-t.cx)} ${round(-middle)})">${markup}</g></g></g></g>`;
      }
      out += dim(c, t.name, markup);
    }
    return out;
  }
  function valueBox(c, value, color, path, begin, travel, end) {
    const half = Math.max(28, String(value).length * EVAL_CHAR / 2 + 12);
    return `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g>`
      + `<g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}`
      + rect(-half, -25, 2 * half, 50, c.P.panel, color, 9) + text(0, 11, value, PANE_SIZE, c.P.fg, 'middle')
      + `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
  }
  function transfers(c) {
    const { g, P, op } = c;
    if (!op) return '';
    const at = arrival(op), begin = departure(op), ty = g.ty - 11, below = g.below;
    const spanCentre = span => g.tx + (span[0] + span[1]) / 2 * EVAL_CHAR;
    const p = (...values) => values.map(round).join(' ');
    if (op.kind === 'read') {
      const [sx, sy] = valueCentre(g.box(op.name)), dx = spanCentre(op.span);
      return valueBox(c, op.value, P.read, `M ${p(sx, sy)} C ${p(sx, below)}, ${p(dx, below)}, ${p(dx, ty)}`, begin, T.travel, at);
    }
    if (op.kind === 'addr') {
      const cell = g.cellsOf(op.name)[0], [sx, sy] = labelCentre(cell), dx = spanCentre(op.span), side = cell.x - 20;
      return valueBox(c, op.value, P.read, `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, g.memY + CELL)}, ${p(side, below)} `
        + `C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`, begin, T.travel, at);
    }
    if (op.kind === 'write') {
      const sx = spanCentre(op.span), [ex, ey] = valueCentre(g.box(op.name));
      return valueBox(c, op.value, P.write, `M ${p(sx, ty)} C ${p(sx, below)}, ${p(ex, below)}, ${p(ex, ey)}`, begin, T.travel, at);
    }
    if (op.kind === 'bind') {
      // The name is what moves: it leaves the pane and becomes a tag under its variable.
      const tag = g.tags.find(t => t.name === op.name), sx = spanCentre(op.destination);
      const ey = tag.y - tag.style.size / 2 + 4;
      return valueBox(c, op.name, tag.color, `M ${p(sx, ty)} C ${p(sx, ty - 70)}, ${p(tag.cx, ey + 70)}, ${p(tag.cx, ey)}`, begin, T.travel, at);
    }
    return '';
  }
  // The pane, and over it the types of its parts: the old pane's give way to the new one's.
  function pane(c, copying) {
    const { g, step, prev, op, animate } = c, types = shown => paneTypes(c, shown, g.tx, g.ty);
    const out = paneBody(c, copying);
    if (!c.m.typed || !animate) return out + (c.m.typed ? types(step) : '');
    const appear = (at, shown) => `<g opacity="0">${fade(0, 1, 0.25, at)}${types(shown)}</g>`;
    if (copying) return out + appear(copyBegin(c.m.steps, c.index) + T.copyTravel, step);
    if (op && op.kind === 'clash') return out + appear(0.15, step);
    if (!op || stores(op) || op.kind === 'print') return out + types(step);
    return out + `<g>${fade(1, 0, 0.2, Math.max(0, arrival(op) - 0.35))}${types(prev)}</g>` + appear(arrival(op) + 0.2, step);
  }
  function paneBody(c, copying) {
    const { g, P, step, prev, op } = c, tx = g.tx, ty = g.ty;
    let out = rect(g.pane.x, g.pane.y, g.pane.w, g.pane.h, P.pane);
    if (copying) {
      // The statement lifts off its line in an opaque box and replaces the previous one.
      const sx = g.code.x + 62, sy = g.lineY(step.line), begin = copyBegin(c.m.steps, c.index), total = begin + T.copyTravel;
      if (prev && prev.line !== step.line) out += `<g>${fade(1, 0, 0.3, begin + 0.2)}${settledPane(c, prev, tx, ty)}</g>`;
      const scale = CODE_SIZE / PANE_SIZE;
      out += `<g><animateMotion dur="${round(total)}s" path="M ${round(sx)} ${sy} L ${tx} ${ty}" keyPoints="0;0;1" `
        + `keyTimes="0;${(begin / total).toFixed(4)};1" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1" fill="freeze"/>`
        + `<g transform="scale(${scale})"><animateTransform attributeName="transform" type="scale" from="${scale}" to="1" `
        + `begin="${begin}s" dur="${T.copyTravel}s" ${EASE} fill="freeze"/>`
        + `<g opacity="0">${fade(0, 1, 0.15, begin - 0.15)}${fade(1, 0, 0.12, total)}`
        + rect(-8, -36, step.pane.length * EVAL_CHAR + 16, 48, P.highlight, P.read, 7, 2) + '</g>'
        + settledPane(c, step, 0, 0) + '</g></g>';
      return out;
    }
    if (op && ['read', 'addr', 'deref', 'eval', 'alias', 'convert'].includes(op.kind)) {
      const before = prev.pane, [s, e] = op.span, length = step.pane.length - before.length + (e - s);
      const at = arrival(op), dx = (length - (e - s)) * EVAL_CHAR, sx = tx + s * EVAL_CHAR;
      const [stroke, fill] = op.kind === 'read' || op.kind === 'addr' ? [P.read, P.readFill]
        : op.kind === 'convert' ? [P.write, P.writeFill] : [P.fg, P.derefFill];
      out += exprBackground(c, tx, ty, step.expr, prev.expr, at + 0.1);
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at - 0.1)}${markBox(sx, ty, e - s, stroke, fill)}</g>`;
      out += paneText(c, tx, ty, before, 0, s, prev.expr);
      let old = paneText(c, sx, ty, before, s, e, prev.expr);
      let fresh = paneText(c, sx, ty, step.pane, s, s + length, step.expr);
      const middle = sx + (e - s) * EVAL_CHAR / 2;
      if (op.kind === 'eval' || op.kind === 'convert') {
        // The operands gather into the middle of their span; the result grows out of it.
        old = scaleAbout(old, middle, ty - 11, 1, 0.45, 0.15, at - 0.15);
        fresh = scaleAbout(fresh, sx + length * EVAL_CHAR / 2, ty - 11, 0.45, 1, at, 0.25);
      }
      out += `<g>${hide(at)}${old}</g>`;
      // The new value lands centred on the token it replaces, then settles into place while
      // the rest of the line slides with it, so the two never overlap.
      out += `<g opacity="0">${show(at)}${settle(fresh, (e - s - length) / 2 * EVAL_CHAR, at + 0.1)}</g>`;
      return out + glide(paneText(c, tx + e * EVAL_CHAR, ty, before, e, before.length, prev.expr), dx, at + 0.1, 0.3);
    }
    out += exprBackground(c, tx, ty, step.expr);
    if (op && op.kind === 'write') {
      const at = arrival(op), [vs, ve] = op.span, [ns, ne] = op.destination;
      // A name written right against its value (`a{ 1 }`): both boxes give way, so they do not overlap.
      const tight = ne === vs ? 4 : 0;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}`
        + rect(tx + vs * EVAL_CHAR - 3 + tight, ty - 32, (ve - vs) * EVAL_CHAR + 6 - tight, 42, P.writeFill, P.write, 6, 2) + '</g>';
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}`
        + rect(tx + ns * EVAL_CHAR - 3, ty - 32, (ne - ns) * EVAL_CHAR + 6 - tight, 42, 'none', P.write, 6, 2) + '</g>';
      out += paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
      // A muted destination takes its variable's colour while the value travels.
      if (inContext(step, op.destination)) {
        out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.15)}`
          + colored(c, tx + ns * EVAL_CHAR, ty, step.pane.slice(ns, ne)) + '</g>';
      }
      return out;
    }
    if (op && op.kind === 'bind') {
      // The name is boxed as it leaves; what it binds to is only pointed at.
      const at = arrival(op), [vs, ve] = op.span, [ns, ne] = op.destination;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}${markBox(tx + ns * EVAL_CHAR, ty, ne - ns, P.fg, P.derefFill)}</g>`;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}`
        + rect(tx + vs * EVAL_CHAR - 3, ty - 32, (ve - vs) * EVAL_CHAR + 6, 42, 'none', P.fg, 6, 2) + '</g>';
    }
    return out + paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
  }
  function output(c) {
    const { g, P, S, step, prev, op } = c;
    if (!step.stdout) return '';
    const [ox, oy] = g.out, label = S.output, vx = ox + (label.length + 1) * 26 * CHAR;
    const printing = op && op.kind === 'print', shown = printing ? prev.stdout : step.stdout;
    let out = (printing && !prev.stdout ? `<g opacity="0">${fade(0, 1, 0.25)}` : '<g>') + text(ox, oy, label, 26, P.muted) + '</g>';
    shown.split('\n').forEach((line, i) => { out += text(vx, oy + i * 36, line, PANE_SIZE, P.fg); });
    if (printing) {
      const lines = shown.split('\n'), x = vx + lines[lines.length - 1].length * EVAL_CHAR, y = oy + (lines.length - 1) * 36;
      const sx = g.tx + (op.span[0] + op.span[1]) / 2 * EVAL_CHAR, w = op.value.length * EVAL_CHAR;
      const p = (...values) => values.map(round).join(' ');
      out += valueBox(c, op.value.trim() ? op.value : glyphs(op.value), P.muted, `M ${p(sx, g.ty - 11)} C ${p(sx, y - 30)}, ${p(x + w / 2, g.ty + 20)}, ${p(x + w / 2, y - 11)}`, 0.2, 0.7, 0.9);
      out += `<g opacity="0">${show(0.9)}${text(x, y, op.value, PANE_SIZE, P.fg)}</g>`;
    }
    return out;
  }
  function scene(c) {
    const { step, prev, animate } = c;
    const lineChanged = animate && prev && prev.line !== step.line;
    const copying = animate && copies(c.m.steps, c.index);
    const oldLine = lineChanged ? prev.line : null;
    return code(c, oldLine) + tether(c, oldLine) + arrows(c) + memory(c) + pane(c, copying)
      + output(c) + transfers(c);
  }
  function describe(c) {
    const { m, S, step } = c, op = step.op;
    if (!op) return format(S.copy, { line: step.line + 1, code: m.source[step.line] });
    if (op.kind === 'print' && S.blank[op.value]) return S.blank[op.value];
    if (op.kind === 'clash') return format(S.clash, { ...op, value: step.pane.slice(...op.span), slot: step.pane.slice(...op.destination) });
    return format(S[op.kind], op);
  }

  // Player -----------------------------------------------------------------------------------
  const players = [];

  function themeName() {
    const theme = document.documentElement.dataset.theme;
    if (theme === 'light' || theme === 'dark') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function strings() {
    const lang = (document.documentElement.lang || 'en').toLowerCase().split('-')[0];
    return STRINGS[lang] || STRINGS.en;
  }
  function icon(name) {
    return `<svg class="cv-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="currentColor">${ICONS[name]}</svg>`;
  }

  class Player {
    constructor(host, trace) {
      this.host = host;
      this.m = prepare(trace);
      this.S = strings();
      this.index = 0;
      this.elapsed = 0;
      this.duration = 0;
      this.rate = 1;
      this.running = false;
      this.continuous = false;
      this.pristine = true;
      this.animated = false;
      this.frame = 0;
      this.build();
      this.theme();
      this.settle(0);
    }

    build() {
      const S = this.S, root = document.createElement('div');
      root.className = 'cv-player not-content';
      root.tabIndex = 0;
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', this.m.trace.title || S.stage);
      const button = (action, label, iconName, extra = '') => `<button type="button" class="cv-button${extra}" `
        + `data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}`
        + `<span class="cv-label">${esc(label)}</span></button>`;
      root.innerHTML = '<div class="cv-view">'
        // The drawing is redrawn on every step and hidden from assistive technology; the
        // line controls above it are stable elements, so a redraw never discards focus.
        + `<svg class="cv-stage" role="group" aria-label="${esc(S.stage)}" xmlns="http://www.w3.org/2000/svg">`
        + `<g class="cv-scene" aria-hidden="true"></g><g class="cv-lines">${lineTargets(this.m, S)}</g></svg>`
        + '<div class="cv-type" aria-hidden="true" hidden></div></div>'
        + '<div class="cv-controls"><div class="cv-transport">'
        + button('play', S.play, 'play', ' cv-primary') + button('back', S.back, 'back') + button('next', S.next, 'next')
        + button('replay', S.replay, 'replay', ' cv-icon-only')
        + `<select class="cv-speed" aria-label="${esc(S.speed)}" title="${esc(S.speed)}">`
        + [0.5, 1, 1.5, 2].map(v => `<option value="${v}"${v === 1 ? ' selected' : ''}>${v}×</option>`).join('') + '</select>'
        + button('reset', S.reset, 'reset', ' cv-reset') + '</div>'
        + `<div class="cv-progress"><input class="cv-scrub" type="range" min="0" max="${this.m.steps.length - 1}" value="0" `
        + `step="1" aria-label="${esc(S.scrub)}"><span class="cv-count"></span></div></div>`
        + '<div class="cv-status" aria-live="polite"></div>';
      this.host.append(root);
      this.root = root;
      this.svg = root.querySelector('.cv-stage');
      this.scene = root.querySelector('.cv-scene');
      this.lines = [...root.querySelectorAll('.cv-line')];
      this.playButton = root.querySelector('[data-action=play]');
      this.scrub = root.querySelector('.cv-scrub');
      this.count = root.querySelector('.cv-count');
      this.status = root.querySelector('.cv-status');
      root.querySelector('.cv-transport').addEventListener('click', event => {
        const target = event.target.closest('[data-action]');
        if (target) this[target.dataset.action]();
      });
      root.querySelector('.cv-speed').addEventListener('change', event => { this.rate = Number(event.target.value); });
      this.scrub.addEventListener('input', () => { this.pristine = false; this.settle(Number(this.scrub.value)); });
      this.svg.addEventListener('click', event => {
        const line = event.target.closest('[data-line]');
        if (line) this.line(Number(line.dataset.line));
      });
      root.addEventListener('keydown', event => this.key(event));
      this.typeBox = root.querySelector('.cv-type');
      this.svg.addEventListener('pointermove', event => this.hoverType(event));
      this.svg.addEventListener('pointerdown', event => this.hoverType(event));
      this.svg.addEventListener('pointerleave', () => this.hoverType(null));
      this.stacked = null;
      if (window.ResizeObserver) {
        new ResizeObserver(() => { if (this.arrangement() !== this.stacked) this.refresh(); }).observe(root);
      }
    }

    key(event) {
      const target = event.target;
      if (target.closest('[data-line]') && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        this.line(Number(target.closest('[data-line]').dataset.line));
        return;
      }
      if (target.matches('input, select, textarea')) return;
      const actions = { ArrowLeft: 'back', ArrowRight: 'next', Home: 'reset', End: 'end' };
      if (actions[event.key]) {
        event.preventDefault();
        this[actions[event.key]]();
      } else if (event.key === ' ' && !target.matches('button')) {
        event.preventDefault();
        this.play();
      }
    }

    // The definition of the struct under the pointer pops out above it, or below near the top.
    hoverType(event) {
      const targets = this.g ? this.g.typeTargets : [];
      let hit = null;
      if (event && targets.length) {
        const matrix = this.svg.getScreenCTM();
        if (matrix) {
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          hit = targets.find(t => point.x >= t.x && point.x <= t.x + t.w && point.y >= t.y && point.y <= t.y + t.h);
        }
      }
      this.svg.style.cursor = hit ? 'help' : '';
      if (!hit) { this.typeBox.hidden = true; this.shownType = null; return; }
      if (this.shownType !== hit) {
        this.shownType = hit;
        this.typeBox.innerHTML = '<pre>' + this.m.types[hit.type].split(/(\b[A-Za-z_]\w*\b)/).map(token => {
          const field = this.g.field(token);
          return field ? `<span style="color:${field.fieldColor}">${esc(token)}</span>`
            : KEYWORDS.has(token) ? `<span class="cv-type-keyword">${esc(token)}</span>` : esc(token);
        }).join('') + '</pre>';
        this.typeBox.hidden = false;
        const view = this.typeBox.parentElement.getBoundingClientRect(), stage = this.svg.getBoundingClientRect();
        const scale = stage.width / this.g.width, box = this.typeBox;
        const left = stage.left - view.left + (hit.x + hit.w / 2) * scale - box.offsetWidth / 2;
        const top = stage.top - view.top + hit.y * scale - box.offsetHeight - 6;
        box.style.left = `${Math.max(4, Math.min(view.width - box.offsetWidth - 4, left))}px`;
        box.style.top = `${top >= 4 ? top : stage.top - view.top + (hit.y + hit.h) * scale + 6}px`;
      }
    }

    arrangement() {
      const width = this.root.clientWidth;
      return width > 0 && width < STACK_BELOW;
    }

    // Palette from player.css custom properties, so the stylesheet owns every colour.
    theme() {
      this.root.dataset.cvTheme = themeName();
      const style = getComputedStyle(this.root), read = name => style.getPropertyValue('--cv-' + name).trim();
      const P = { outputLabel: this.S.output };
      for (const name of PALETTE) P[name.replace(/-(\w)/g, (_, ch) => ch.toUpperCase())] = read(name) || '#808080';
      P.vars = Array.from({ length: VARIABLE_COLOURS }, (_, i) => read('var-' + i) || '#808080');
      P.fields = Array.from({ length: FIELD_COLOURS }, (_, i) => read('field-' + i) || '#808080');
      P.types = Array.from({ length: TYPE_COLOURS }, (_, i) => read('type-' + i) || '#808080');
      this.P = P;
    }

    refresh() {
      this.theme();
      this.render(this.animated);
      if (this.animated) this.seek(this.elapsed);
    }

    render(animate) {
      this.stacked = this.arrangement();
      const steps = this.m.steps, step = steps[this.index], prev = this.index ? steps[this.index - 1] : null;
      const g = this.g = geometry(this.m, this.P, this.stacked);
      const now = activeVariables(this.m, this.index);
      const before = animate && this.index ? activeVariables(this.m, this.index - 1) : now;
      const begin = new Map();
      // A dereference target lights up just before the followed arc arrives.
      if (animate && step.op && step.op.kind === 'deref') begin.set(step.op.target.split('.')[0], arrival(step.op) - 0.15);
      const c = { m: this.m, g, P: this.P, S: this.S, index: this.index, step, prev, animate,
        op: animate ? step.op : null, focus: { now, before, begin } };
      this.animated = animate;
      this.svg.setAttribute('viewBox', `0 0 ${Math.ceil(g.width)} ${Math.ceil(g.height)}`);
      this.svg.style.maxWidth = `${Math.ceil(g.width * MAX_SCALE)}px`;
      this.scene.innerHTML = `<rect width="100%" height="100%" fill="${this.P.bg}"/>` + scene(c);
      placeLineTargets(g, this.lines);
      this.finishPaths();
      this.seek(0);
      this.update(describe(c));
    }

    // Growing and followed arcs animate their dash offset over their measured length.
    finishPaths() {
      for (const path of this.scene.querySelectorAll('[data-grow],[data-follow]')) {
        const length = path.getTotalLength(), grow = path.dataset.grow !== undefined;
        const begin = Number(grow ? path.dataset.grow : path.dataset.follow), dur = grow ? 0.6 : T.follow;
        path.setAttribute('stroke-dasharray', `${length} ${length}`);
        path.setAttribute('stroke-dashoffset', length);
        const add = attributes => {
          const animation = document.createElementNS(this.svg.namespaceURI, 'animate');
          for (const [key, value] of Object.entries(attributes)) animation.setAttribute(key, value);
          path.append(animation);
        };
        add({ attributeName: 'stroke-dashoffset', from: length, to: 0, begin: begin + 's', dur: dur + 's',
          calcMode: 'spline', keyTimes: '0;1', keySplines: '0.4 0 0.2 1', fill: 'freeze' });
        if (!grow) add({ attributeName: 'opacity', from: 1, to: 0, begin: (begin + dur + 0.25) + 's', dur: '0.4s', fill: 'freeze' });
      }
    }

    seek(seconds) {
      this.svg.pauseAnimations();
      this.svg.setCurrentTime(seconds);
    }

    update(description) {
      const last = this.m.steps.length - 1;
      this.playButton.querySelector('.cv-icon').outerHTML = icon(this.running ? 'pause' : 'play');
      const label = this.running ? this.S.pause : this.S.play;
      this.playButton.querySelector('.cv-label').textContent = label;
      this.playButton.setAttribute('aria-label', label);
      this.playButton.title = label;
      for (const [action, disabled] of [['back', this.index === 0], ['next', this.index === last]]) {
        const button = this.root.querySelector(`[data-action=${action}]`);
        // A focused button that becomes disabled would drop focus to the page; the player
        // keeps it, so the arrow keys still step.
        if (disabled && document.activeElement === button) this.root.focus({ preventScroll: true });
        button.disabled = disabled;
      }
      this.scrub.value = this.index;
      this.count.textContent = `${this.index + 1} / ${last + 1}`;
      if (description !== undefined && this.status.textContent !== description) this.status.textContent = description;
    }

    // Transport. Settled steps show their end state; started steps animate from their start.
    settle(index) {
      this.stop();
      this.continuous = false;
      this.index = Math.max(0, Math.min(this.m.steps.length - 1, index));
      this.elapsed = this.duration = 0;
      this.render(false);
    }
    start(index, autoplay = false) {
      this.stop();
      this.pristine = false;
      this.continuous = autoplay;
      this.index = index;
      this.elapsed = 0;
      // Steps always animate, whatever prefers-reduced-motion says: the motion is the lesson.
      this.duration = stepSeconds(this.m.steps, index);
      this.render(true);
      if (this.duration > 0) this.resume();
    }
    resume() {
      this.running = true;
      this.last = performance.now();
      this.update();
      if (!this.frame) this.frame = requestAnimationFrame(now => this.tick(now));
    }
    stop() {
      this.running = false;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    pause() {
      this.stop();
      this.update();
    }
    tick(now) {
      this.frame = 0;
      if (!this.running) return;
      this.elapsed = Math.min(this.duration, this.elapsed + (now - this.last) / 1000 * this.rate);
      this.last = now;
      if (this.animated) this.seek(this.elapsed);
      if (this.elapsed < this.duration) {
        this.frame = requestAnimationFrame(time => this.tick(time));
        return;
      }
      this.running = false;
      if (this.continuous && this.index < this.m.steps.length - 1) this.start(this.index + 1, true);
      else {
        this.continuous = false;
        this.render(false);
        this.elapsed = this.duration;
        this.update();
      }
    }
    get finished() { return this.elapsed >= this.duration; }

    play() {
      if (this.running) return this.pause();
      const last = this.m.steps.length - 1;
      if (this.pristine || (this.index === last && this.finished)) this.start(0, true);
      else if (this.finished) this.start(this.index + 1, true);
      else {
        this.continuous = true;
        this.resume();
      }
    }
    next() { if (this.index < this.m.steps.length - 1) this.start(this.index + 1); }
    back() { this.pristine = false; this.settle(this.index - 1); }
    replay() { this.start(this.index); }
    reset() { this.pristine = true; this.settle(0); }
    end() { this.pristine = false; this.settle(this.m.steps.length - 1); }
    // Jump to the start of a source line's execution: earlier writes and output are restored.
    line(line) {
      const index = this.m.steps.findIndex(step => step.line === line);
      if (index >= 0) {
        this.pristine = false;
        this.settle(index);
      }
    }
    // For tests and screenshots: show step `index` `seconds` into its animation, paused.
    inspect(index, seconds = null) {
      if (seconds === null) return this.settle(index);
      this.start(index);
      this.stop();
      this.continuous = false;
      if (this.animated) this.seek(seconds);
      this.elapsed = seconds;
      this.update();
    }
  }

  // Static layout: stable buttons preserve keyboard focus across theme changes.
  class Layout {
    constructor(host, trace) {
      if (trace.format !== 1 || !trace.records?.length) throw new Error('Invalid layout');
      this.host = host;
      this.root = document.createElement('div');
      this.root.className = 'cv-player cv-layout not-content';
      const ru = (document.documentElement.lang || '').startsWith('ru');
      const padding = ru ? 'Выравнивание' : 'Padding';
      this.root.innerHTML = trace.records.map((record, ri) => {
        const key = fi => `${ri}:${fi}`;
        // Every target toggles a locked selection, so each is a toggle button.
        const button = (fi, label, cls = '', description = '') => `<button type="button" class="cv-layout-target ${cls}"`
          + ` data-layout-key="${key(fi)}" aria-pressed="false"${description ? ` aria-label="${esc(description)}" title="${esc(description)}"` : ''}>${label}</button>`;
        const rows = button('all', esc(`struct ${record.name}`), 'cv-layout-row')
          + record.fields.map((f, fi) => button(fi,
            esc(`${f.type} ${f.name};`) + `<small>+${f.offset} · ${f.size} B</small>`,
            `cv-layout-row cv-field-${fi % FIELD_COLOURS}`)).join('')
          + button('all', esc(`sizeof(${record.name}) = ${record.size}`), 'cv-layout-row');
        const bytes = Array.from({ length: record.size }, (_, offset) => {
          const fi = record.fields.findIndex(f => offset >= f.offset && offset < f.offset + f.size);
          const label = fi < 0 ? padding : record.fields[fi].name;
          return button(fi < 0 ? 'pad' : fi,
            `<span aria-hidden="true">${offset}</span><small>${fi < 0 ? '▧' : esc(label)}</small>`,
            `cv-byte ${fi < 0 ? 'cv-padding' : `cv-field-${fi % FIELD_COLOURS}`}`,
            `+${offset}: ${label}`);
        }).join('');
        return `<section class="cv-layout-record" data-layout-record="${ri}">`
          + `<div class="cv-layout-code">${rows}</div><div class="cv-layout-bytes">`
          + `<p>alignof(${esc(record.name)}) = ${record.alignment}</p>`
          + `<div class="cv-layout-memory" style="--cv-slot:${record.alignment}">${bytes}</div>`
          + `<p>${esc(padding)}: ▧ · ${record.size - record.fields.reduce((sum, f) => sum + f.size, 0)} B</p></div></section>`;
      }).join('');
      host.append(this.root);
      this.lock(null);
      const target = event => event.target.closest('[data-layout-key]');
      this.root.addEventListener('pointerover', event => this.highlight(target(event)?.dataset.layoutKey));
      this.root.addEventListener('pointerleave', () => this.restore());
      this.root.addEventListener('focusin', event => this.highlight(target(event)?.dataset.layoutKey));
      this.root.addEventListener('focusout', () => queueMicrotask(() => this.restore()));
      this.root.addEventListener('click', event => {
        const key = target(event)?.dataset.layoutKey ?? null;
        this.lock(this.locked === key ? null : key);
        this.restore();
      });
      this.root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { this.lock(null); this.highlight(null); }
      });
      this.refresh();
    }
    lock(key) {
      this.locked = key;
      for (const element of this.root.querySelectorAll('[data-layout-key]')) {
        element.setAttribute('aria-pressed', String(element.dataset.layoutKey === key));
      }
    }
    restore() {
      this.highlight(this.locked || (this.root.contains(document.activeElement)
        ? document.activeElement.dataset.layoutKey : null));
    }
    highlight(key) {
      const [record, field] = (key || '').split(':');
      for (const section of this.root.querySelectorAll('[data-layout-record]')) {
        section.classList.toggle('cv-layout-active', section.dataset.layoutRecord === record);
      }
      for (const element of this.root.querySelectorAll('[data-layout-key]')) {
        const [r, f] = element.dataset.layoutKey.split(':');
        element.classList.toggle('cv-linked', r === record && (field === 'all' || f === field));
      }
    }
    refresh() { this.root.dataset.cvTheme = themeName(); }
    pause() {}
  }

  // Discovery --------------------------------------------------------------------------------
  const closedAncestor = element => element.parentElement && element.parentElement.closest('details:not([open])');
  function initialize(host) {
    if (host.dataset.cvState === 'ready' || host.dataset.cvState === 'error') return;
    try {
      const data = host.querySelector('script[type="application/json"]');
      const trace = JSON.parse(data.textContent);
      const player = trace.kind === 'layout' ? new Layout(host, trace) : new Player(host, trace);
      host.dataset.cvState = 'ready';
      host.cvPlayer = player;
      players.push(player);
    } catch (error) {
      host.dataset.cvState = 'error';
      const message = document.createElement('p');
      message.className = 'cv-error';
      message.textContent = strings().error;
      host.append(message);
      console.error('course visualization:', error);
    }
  }
  function scan(root = document) {
    for (const host of root.querySelectorAll('div.course-visualization')) {
      if (!host.dataset.cvState) host.dataset.cvState = 'waiting';
      if (host.dataset.cvState === 'waiting' && !closedAncestor(host)) initialize(host);
    }
  }
  // `toggle` does not bubble, but it can be captured: open players lazily, pause closed ones.
  // A player hidden during a theme change is redrawn when it shows again.
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (!details.open) {
      for (const player of players) if (details.contains(player.host)) player.pause();
      return;
    }
    scan(details);
    for (const player of players) {
      if (player.stale && !closedAncestor(player.host)) {
        player.stale = false;
        player.refresh();
      }
    }
  }, true);
  const restyle = () => {
    for (const player of players) {
      if (closedAncestor(player.host)) player.stale = true;
      else player.refresh();
    }
  };
  new MutationObserver(restyle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', restyle);
  document.addEventListener('astro:page-load', () => scan());

  window.CourseVisualization = { version: 1, players, scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan());
  else scan();
})();
