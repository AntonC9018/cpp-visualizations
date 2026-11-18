var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const CHAR = 0.602;
  const CODE_SIZE = 25;
  const CODE_GUTTER = 62;
  const PANE_MAX = 30;
  const PANE_MIN = 24;
  const CODE_CHAR = CODE_SIZE * CHAR;
  const LINE = 56;
  const CELL = 64;
  const MARGIN = 28;
  const MEMORY_WIDTH = 600;
  const MAX_BYTE = 28;
  const NARROW_BYTE = 48;
  const FRAME = { side: 4, top: 36, bottom: 40, stroke: 2.5 };
  const GAP = 2 * FRAME.side + FRAME.stroke;
  const NEST = 10;
  const RISE = { top: 10, bottom: 34 };
  const TAG = {
    top: { size: 24, step: 40 },
    field: { size: 19, step: 32 }
  };
  const STACK_BELOW = 600;
  const MAX_SCALE = 0.6;
  const DIM = 0.5;
  const T = {
    prepare: 0.55,
    travel: 1.1,
    settle: 0.6,
    follow: 0.9,
    writeHold: 0.8,
    copyBegin: 0.15,
    copyTravel: 1,
    evaluate: 0.6,
    clash: 1.6
  };
  const KEYWORDS = /* @__PURE__ */ new Set(["int", "std", "cout", "endl", "struct", "auto", "const"]);
  const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"';
  const PALETTE = [
    "bg",
    "panel",
    "pane",
    "fg",
    "muted",
    "grey",
    "context",
    "read",
    "read-fill",
    "write",
    "write-fill",
    "deref-fill",
    "highlight",
    "dead-fill",
    "dead-stroke",
    "gap-stroke",
    "tether",
    "error",
    "type-label"
  ];
  const VARIABLE_COLOURS = 5;
  const FIELD_COLOURS = 4;
  const TYPE_COLOURS = 6;
  const LABEL = { pane: 20, memory: 18, rise: 38, row: 30 };
  const STRINGS = {
    en: {
      play: "Play",
      pause: "Pause",
      back: "Back",
      next: "Next",
      replay: "Replay step",
      reset: "Reset",
      speed: "Playback speed",
      scrub: "Execution step",
      output: "Output:",
      stage: "Code, memory and expression evaluation",
      jump: "Jump to line {line}: {code}",
      copy: "Line {line}: {code}",
      read: "Read {name}: {value}",
      addr: "Take the address of {name}: {value}",
      deref: "Follow the address in {via} to {target}",
      eval: "Evaluate: {value}",
      write: "Store {value} in {name}",
      print: "Print {value}",
      bind: "{name} becomes another name for {target}",
      alias: "{name} is another name for {target}",
      blank: { "\n": "Print a newline", "	": "Print a tab", " ": "Print a space" },
      convert: "Convert {from} to {to}: {value}",
      clash: "Does not compile: {value} is {from}, {slot} needs {to}",
      error: "This visualization could not be loaded."
    },
    ru: {
      play: "Пуск",
      pause: "Пауза",
      back: "Назад",
      next: "Далее",
      replay: "Повторить шаг",
      reset: "Сначала",
      speed: "Скорость",
      scrub: "Шаг выполнения",
      output: "Вывод:",
      stage: "Код, память и вычисление выражения",
      jump: "Перейти к строке {line}: {code}",
      copy: "Строка {line}: {code}",
      read: "Чтение {name}: {value}",
      addr: "Адрес {name}: {value}",
      deref: "Переход по адресу из {via} к {target}",
      eval: "Вычисление: {value}",
      write: "Запись {value} в {name}",
      print: "Вывод {value}",
      bind: "{name} становится ещё одним именем для {target}",
      alias: "{name} — другое имя для {target}",
      blank: { "\n": "Вывод перевода строки", "	": "Вывод табуляции", " ": "Вывод пробела" },
      convert: "Преобразование {from} в {to}: {value}",
      clash: "Не компилируется: {value} имеет тип {from}, а для {slot} нужен {to}",
      error: "Не удалось загрузить визуализацию."
    }
  };
  const ICONS = {
    play: '<path d="M5 3.5v13l11-6.5z"/>',
    pause: '<path d="M5 3.5h3.5v13H5zM11.5 3.5H15v13h-3.5z"/>',
    back: '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    next: '<path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    replay: '<path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.8 2.6v4.6h-4.6z"/>',
    reset: '<path d="M4 4h2.2v12H4zM16 4v12l-8.5-6z"/>'
  };
  function themeName() {
    const theme = document.documentElement.dataset.theme;
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function strings() {
    const lang = (document.documentElement.lang || "en").toLowerCase().split("-")[0];
    return STRINGS[lang] || STRINGS.en;
  }
  function icon(name) {
    return `<svg class="cv-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="currentColor">${ICONS[name]}</svg>`;
  }
  function wrapLine(source, columns) {
    var _a;
    if (source.length <= columns) return [{ start: 0, end: source.length, indent: 0 }];
    const breaks = [];
    let braces = 0;
    let templates = 0;
    const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<<|>>|->|::|\w+|[ \t]+|./g;
    for (const { 0: token, index } of source.matchAll(tokens)) {
      const at = index + token.length;
      if (token === "<") templates++;
      if (token === ">" || token === ">>") templates = Math.max(0, templates - token.length);
      if (token === "{") braces++;
      if (token === "}") braces = Math.max(0, braces - 1);
      if (!/^[ \t]+$|^[,<{]$/.test(token)) continue;
      if (/^\s*[;,)\]}]/.test(source.slice(at))) continue;
      const penalty = templates * 8 + Math.max(0, braces - 1) * 6 - (token === "{" && braces === 1 ? 6 : 0);
      breaks.push({ at, penalty });
    }
    const rows = [];
    let start = 0;
    while (start < source.length) {
      const indent = rows.length ? 2 : 0;
      const limit = start + columns - indent;
      let end = source.length;
      if (limit < source.length) {
        let best = -Infinity;
        end = ((_a = breaks.find((point) => point.at > limit)) == null ? void 0 : _a.at) ?? source.length;
        for (const point of breaks) {
          if (point.at <= start) continue;
          if (point.at > limit) break;
          const score = point.at - point.penalty;
          if (score >= best) {
            best = score;
            end = point.at;
          }
        }
      }
      const stop = start + source.slice(start, end).trimEnd().length;
      if (stop > start) rows.push({ start, end: stop, indent });
      start = end;
      while (source[start] === " " || source[start] === "	") start++;
    }
    return rows.length ? rows : [{ start: 0, end: 0, indent: 0 }];
  }
  const CONTINUATION = 33;
  const CODE_INSET = CODE_GUTTER + 30;
  function codeLayout(source, columns = Infinity) {
    const rows = source.map((line) => wrapLine(line, columns));
    const longest = Math.max(...rows.flatMap((line) => line.map((row) => row.end - row.start + row.indent)));
    const continuations = rows.reduce((count, line) => count + line.length - 1, 0);
    return {
      rows,
      width: Math.max(300, CODE_INSET + longest * CODE_CHAR),
      height: 44 + source.length * LINE + continuations * CONTINUATION
    };
  }
  function columnsForCode(width) {
    return Math.max(12, Math.floor((width - CODE_INSET) / CODE_CHAR));
  }
  function placeCodeRows(rows, firstY) {
    let y = firstY;
    return rows.map((line) => line.map((row, i) => {
      const placed = { ...row, y };
      y += i + 1 < line.length ? CONTINUATION : LINE;
      return placed;
    }));
  }
  const round = (value) => Math.round(value * 100) / 100;
  const ESC_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ESC_MAP[ch] ?? ch);
  const glyphs = (value) => String(value).replace(/\n/g, "↵").replace(/\t/g, "⇥").replace(/ /g, "␣");
  const format = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  function text(x, y, value, size, color, anchor = "start") {
    const str = String(value);
    if (!str.trim()) return "";
    const length = str.length > 1 ? ` textLength="${round(str.length * size * CHAR)}" lengthAdjust="spacing"` : "";
    return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${color}" text-anchor="${anchor}" xml:space="preserve"${length}>${esc(str)}</text>`;
  }
  function rect(x, y, w, h, fill, stroke = "none", radius = 8, width = 3) {
    return `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(0, w))}" height="${round(h)}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
  }
  const show = (at) => `<set attributeName="opacity" to="1" begin="${round(at)}s" fill="freeze"/>`;
  const hide = (at) => `<set attributeName="opacity" to="0" begin="${round(at)}s" fill="freeze"/>`;
  const fade = (from, to, dur = 0.5, begin = 0) => `<animate attributeName="opacity" from="${from}" to="${to}" dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;
  const animateAttr = (name, from, to, dur = 0.45, begin = 0) => `<animate attributeName="${name}" from="${typeof from === "number" ? round(from) : from}" to="${typeof to === "number" ? round(to) : to}" dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;
  const animated = (element, animations) => {
    if (!animations) return element;
    const tagMatch = element.match(/^<(\w+)/);
    const tag = tagMatch ? tagMatch[1] : "g";
    return element.replace(/\/>$/, ">" + animations + "</" + tag + ">");
  };
  const pulse = (begin) => `<animateTransform attributeName="transform" type="scale" values="1;1.14;1" keyTimes="0;0.45;1" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" begin="${round(begin)}s" dur="0.65s" fill="freeze"/>`;
  const markBox = (x, y, width, stroke, fill) => `<rect x="${round(x - 3)}" y="${round(y - 32)}" width="${round(width + 6)}" height="42" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const settle = (markup, from, begin) => from ? `<g transform="translate(${round(from)} 0)"><animateTransform attributeName="transform" type="translate" from="${round(from)} 0" to="0 0" begin="${round(begin)}s" dur="0.3s" ${EASE} fill="freeze"/>${markup}</g>` : markup;
  const glide = (markup, dx, begin, dur) => dx ? `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${round(dx)} 0" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>${markup}</g>` : markup;
  const scaleAbout = (markup, x, y, from, to, begin, dur) => `<g transform="translate(${round(x)} ${round(y)})"><g transform="scale(${from})"><animateTransform attributeName="transform" type="scale" from="${from}" to="${to}" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/><g transform="translate(${round(-x)} ${round(-y)})">${markup}</g></g></g>`;
  const frameOf = (s) => ({
    x: s.x - FRAME.side,
    y: s.y - FRAME.top - s.rise * RISE.top,
    w: s.w + 2 * FRAME.side,
    h: s.h + FRAME.top + FRAME.bottom + s.rise * (RISE.top + RISE.bottom) + (s.drop || 0)
  });
  const typeLabelWidth = (type, size) => type.length * size * CHAR + 14;
  const PANE_LABEL_LEFT = -16;
  const PANE_LABEL_MIN = 14;
  const PANE_LABEL_GAP = 6;
  const paneLabelWidth = (label) => typeLabelWidth(label.type, label.size);
  function paneLabels(step, paneChar) {
    const labels = [];
    const centres = [];
    for (const part of step.types ?? []) {
      const cx = (part.span[0] + part.span[1]) / 2 * paneChar;
      const last = labels[labels.length - 1];
      const label = {
        type: part.type,
        cx,
        size: LABEL.pane,
        slot: Boolean(part.slot),
        start: part.span[0],
        row: 0
      };
      const gap = () => label.cx - last.cx - PANE_LABEL_GAP - (paneLabelWidth(last) + paneLabelWidth(label)) / 2;
      if (last && gap() < 0 && last.type === label.type && !last.slot) {
        last.cx = (centres[centres.length - 1] + cx) / 2;
        continue;
      }
      if (last && gap() < 0) {
        const before = last.size;
        while (gap() < 0 && label.size > PANE_LABEL_MIN) {
          last.size = label.size = Math.min(last.size, label.size) - 1;
        }
        if (gap() < 0) [last.size, label.size] = [before, LABEL.pane];
      }
      labels.push(label);
      centres.push(cx);
    }
    const edges = [];
    for (const label of labels) {
      const half = paneLabelWidth(label) / 2;
      label.cx = Math.max(label.cx, PANE_LABEL_LEFT + half);
      let row = 0;
      while (edges[row] !== void 0 && label.cx - half < edges[row] + PANE_LABEL_GAP) row++;
      edges[row] = label.cx + half;
      label.row = row;
    }
    return labels;
  }
  function paneLabelExtent(m, paneChar) {
    let rows = 0;
    let right = 0;
    for (const step of m.typed ? m.steps : []) {
      for (const label of paneLabels(step, paneChar)) {
        rows = Math.max(rows, label.row + 1);
        right = Math.max(right, label.cx + paneLabelWidth(label) / 2);
      }
    }
    return { rows, right };
  }
  function typeRows(m, box) {
    const labels = [];
    const edge = [];
    for (const item of m.typed ? m.tops : []) {
      if (!item.type) continue;
      const at = box(item.name);
      const cx = at.x + at.w / 2;
      const half = typeLabelWidth(item.type, LABEL.memory) / 2;
      let row = 0;
      while (edge[row] !== void 0 && cx - half < edge[row] + 6) row++;
      edge[row] = cx + half;
      labels.push({ name: item.name, type: item.type, cx, row });
    }
    return { labels, height: edge.length ? edge.length * LABEL.row + 6 : 0 };
  }
  const labelWidth = (c) => String(c.address).length * 16 * CHAR;
  const labelCentre = (c) => [
    c.x + 3 + labelWidth(c) / 2,
    c.y - 18
  ];
  const valueCentre = (c) => [
    c.x + c.w / 2,
    c.y + c.h / 2
  ];
  function links(g, step) {
    const list = g.leaves.filter((l) => l.kind === "ptr" && step.targets[l.name] && g.box(step.targets[l.name])).map((l) => ({
      from: l,
      to: g.box(step.targets[l.name]),
      sx: 0,
      ex: 0,
      level: 0,
      d: "",
      head: [0, 0]
    }));
    const centre = (c) => c.x + c.w / 2;
    const ports = /* @__PURE__ */ new Map();
    for (const l of list) {
      for (const [cell, other, key] of [
        [l.from, l.to, "sx"],
        [l.to, l.from, "ex"]
      ]) {
        if (!ports.has(cell.name)) ports.set(cell.name, { cell, ends: [] });
        ports.get(cell.name).ends.push({ l, key, other: centre(other) });
      }
    }
    for (const { cell, ends } of ports.values()) {
      const side = (end) => end.other < centre(cell) ? 0 : 1;
      ends.sort((p, q) => side(p) - side(q) || q.other - p.other);
      const margin = Math.min(12, cell.w / 2);
      const left = cell.x + margin;
      const high = cell.x + cell.w - margin;
      const clearance = cell.x + 3 + labelWidth(cell) + 14;
      const intervals = ends.length - 1;
      const low = !g.isStruct(cell) && clearance + 20 * intervals <= high ? Math.max(left, clearance) : left;
      const spacing = intervals ? Math.min(20, (high - low) / intervals) : 0;
      const spread = spacing * intervals;
      const first = Math.min(Math.max(centre(cell) - spread / 2, low), high - spread);
      ends.forEach((end, i) => {
        end.l[end.key] = first + i * spacing;
      });
    }
    const range = (l) => [
      Math.min(l.sx, l.ex),
      Math.max(l.sx, l.ex)
    ];
    for (const l of list) {
      const [a, b] = range(l);
      l.level = list.filter((o) => o !== l && range(o)[0] >= a && range(o)[1] <= b).length;
      const sy = l.from.y - 2;
      const ey = g.isStruct(l.to) ? frameOf(l.to).y - 1 : l.to.y - 3;
      const apex = g.memY - FRAME.top - g.rise * RISE.top - 84 - l.level * 40;
      l.d = `M ${round(l.sx)} ${sy} C ${round(l.sx)} ${apex}, ${round(l.ex)} ${apex}, ${round(l.ex)} ${ey - 9}`;
      l.head = [l.ex, ey];
    }
    return list;
  }
  function tagRows(m, box) {
    const bound = m.steps[m.steps.length - 1].refs || {};
    const tags2 = [];
    const rows = /* @__PURE__ */ new Map();
    const drop = /* @__PURE__ */ new Map();
    for (const r of m.references) {
      const target = bound[r.name];
      if (!target) continue;
      const item = box(target);
      const style = target.includes(".") ? TAG.field : TAG.top;
      const w = Math.max(r.name.length * style.size * CHAR + 20, style.size + 18);
      const cx = item.x + item.w / 2;
      const level = target.includes(".") ? target.slice(0, target.lastIndexOf(".")) : "";
      let row = 0;
      while (tags2.some(
        (t) => t.level === level && t.row === row && Math.abs(t.cx - cx) < (t.w + w) / 2 + 6
      )) {
        row++;
      }
      tags2.push({ ...r, target, style, w, cx, level, row });
      rows.set(target, Math.max(rows.get(target) || 0, row + 1));
    }
    const below = (name) => (rows.get(name) || 0) * (name.includes(".") ? TAG.field : TAG.top).step;
    const sink = (item) => {
      const children = item.children || [];
      const inner = Math.max(0, ...children.map((child) => below(child.name) + sink(child)));
      drop.set(item.name, inner);
      return inner;
    };
    const height = Math.max(0, ...m.tops.map((item) => sink(item) + below(item.name)));
    return { tags: tags2, drop, height };
  }
  const WRAP_HEIGHT_FACTOR = 1.5;
  function placement(m, byte, rowOf) {
    const spans = /* @__PURE__ */ new Map();
    const gaps = [];
    let row = 0;
    const unused = (x2, bytes) => {
      if (bytes > 0) gaps.push([x2, bytes * byte, row]);
      return Math.max(0, bytes) * byte;
    };
    const put = (item, x2) => {
      let w = item.size * byte;
      if (item.children) {
        let address2 = item.address;
        w = 0;
        for (const child of item.children) {
          w += unused(x2 + w, child.address - address2);
          const pad = child.children ? NEST : 0;
          w += pad + put(child, x2 + w + pad) + pad;
          address2 = child.address + child.size;
        }
        w += unused(x2 + w, item.address + item.size - address2);
      }
      spans.set(item.name, [x2, w]);
      return w;
    };
    let width = 0;
    let x = 0;
    let address = null;
    for (const item of m.tops) {
      const r = (rowOf == null ? void 0 : rowOf.get(item.name)) ?? 0;
      if (r !== row) {
        row = r;
        x = 0;
        address = null;
      }
      if (address !== null) x += unused(x, item.address - address) + GAP;
      x += put(item, x);
      address = item.address + item.size;
      width = Math.max(width, x);
    }
    return { spans, gaps, width };
  }
  function typeTargets(m, g) {
    const names = Object.keys(m.types);
    if (!names.length) return [];
    const word = new RegExp(`\\b(${names.join("|")})\\b`, "g");
    const targets = [];
    m.source.forEach((source, i) => {
      for (const match of source.matchAll(word)) {
        const idx = match.index ?? 0;
        const row = g.codeRows[i].find((row2) => row2.start <= idx && idx < row2.end);
        if (!row) continue;
        targets.push({
          type: match[1],
          underline: true,
          x: g.code.x + CODE_GUTTER + (row.indent + idx - row.start) * CODE_CHAR,
          y: row.y - CODE_SIZE * 0.85,
          w: match[1].length * CODE_CHAR,
          h: CODE_SIZE * 1.2
        });
      }
    });
    for (const s of [...g.groups].reverse()) {
      if (m.types[s.type]) targets.push({ type: s.type, ...frameOf(s) });
    }
    return targets;
  }
  function labelSize(boxes, label, size) {
    const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
    let current = size;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (a.y !== b.y) continue;
      const room = b.x + b.w / 2 - (a.x + a.w / 2) - 8;
      const half = (label(a).length + label(b).length) * CHAR / 2;
      if (half * current > room) current = room / half;
    }
    return current;
  }
  const COLUMN_GAP = 56;
  const STACK_TETHER_WIDTH = 30;
  function geometry(m, P, stacked, viewport, options = {}) {
    const cellH = options.cellHeight ?? CELL;
    const extraMemBottom = options.extraMemBottom ?? 0;
    const extraPaneHeight = options.extraPaneHeight ?? 0;
    const minByteWidth = options.minByteWidth ?? 0;
    const isStruct = (c) => Boolean(c.fields);
    const unwrapped = codeLayout(m.source);
    const targetCodeSize = stacked ? 12 : 13;
    const canvasBudget = viewport > 0 ? viewport * CODE_SIZE / targetCodeSize : Infinity;
    const codeByColumns = /* @__PURE__ */ new Map();
    const fitCode = (budget) => {
      if (unwrapped.width <= budget + CODE_CHAR) return unwrapped;
      const columns = columnsForCode(budget);
      let layout = codeByColumns.get(columns);
      if (!layout) {
        layout = codeLayout(m.source, columns);
        codeByColumns.set(columns, layout);
      }
      return layout;
    };
    const stackedCodeBudget = canvasBudget - 2 * MARGIN - STACK_TETHER_WIDTH;
    const initialCode = stacked ? fitCode(stackedCodeBudget) : unwrapped;
    const widest = Math.max(minByteWidth, m.leaves.some((leaf) => leaf.size < 4) ? NARROW_BYTE : MAX_BYTE);
    const rise = m.rise;
    const structs = m.groups.length > 0;
    const paneChars = Math.max(...m.steps.map((step) => step.pane.length));
    const finalStdout = m.steps[m.steps.length - 1].stdout;
    const outputLines = finalStdout ? finalStdout.replace(/\n$/, "").split("\n") : [];
    const outputChars = Math.max(0, ...outputLines.map((line) => line.length));
    const canWrap = !stacked && !options.skipWrap && m.tops.length > 1 && !m.typed && m.references.length === 0 && m.steps.every((step) => Object.keys(step.targets).length === 0);
    const pitch = (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + extraMemBottom + rise * RISE.bottom + (structs ? FRAME.top : 0) + 30 + rise * RISE.top;
    const plan = (rows2) => {
      const rowOf2 = /* @__PURE__ */ new Map();
      rows2.forEach((row, r) => row.forEach((i) => rowOf2.set(m.tops[i].name, r)));
      const byteFor = (budget) => Math.max(
        minByteWidth,
        Math.min(
          widest,
          ...rows2.map((row) => {
            const items = row.map((i) => m.tops[i]);
            const bytes = items[items.length - 1].address + items[items.length - 1].size - items[0].address;
            const nested = m.groups.filter((s) => s.parent && rowOf2.get(s.top) === rowOf2.get(items[0].name));
            return Math.max(1, (budget - GAP * (items.length - 1) - 2 * NEST * nested.length) / bytes);
          })
        )
      );
      const natural = placement(m, byteFor(MEMORY_WIDTH), rowOf2).width;
      const paneSize = Math.max(
        PANE_MIN,
        Math.min(PANE_MAX, Math.floor((Math.max(360, natural + 48) - 48) / (paneChars * CHAR)))
      );
      const paneChar = paneSize * CHAR;
      const labelExtent2 = paneLabelExtent(m, paneChar);
      const others = Math.max(
        360,
        options.minColumnWidth ?? 0,
        paneChars * paneChar + 48,
        labelExtent2.right + 24 - PANE_LABEL_LEFT,
        (P.outputLabel.length + 1) * 26 * CHAR + outputChars * paneChar + 48,
        stacked ? initialCode.width : 0
      );
      const byte = byteFor(Math.max(MEMORY_WIDTH, others - 48));
      const placed2 = placement(m, byte, rowOf2);
      const columnW2 = Math.max(others, placed2.width + 48);
      const codeBudget = stacked ? Math.max(columnW2, stackedCodeBudget) : canvasBudget - (columnW2 + COLUMN_GAP + 2 * MARGIN);
      const code22 = fitCode(codeBudget);
      const width2 = code22.width + COLUMN_GAP + columnW2;
      return { rows: rows2, rowOf: rowOf2, code: code22, paneSize, paneChar, labelExtent: labelExtent2, placed: placed2, columnW: columnW2, width: width2, cell: byte / width2 };
    };
    const partitions = (n, count) => {
      if (count === 1) return [[Array.from({ length: n }, (_, i) => i)]];
      const out2 = [];
      const cut = (from, left, acc) => {
        if (left === 1) {
          out2.push([...acc, Array.from({ length: n - from }, (_, i) => from + i)]);
          return;
        }
        for (let to = from + 1; to <= n - left + 1; to++) {
          cut(to, left - 1, [...acc, Array.from({ length: to - from }, (_, i) => from + i)]);
        }
      };
      cut(0, count, []);
      return out2;
    };
    const single = plan(partitions(m.tops.length, 1)[0]);
    const baseH = (structs ? FRAME.top : 0) + 30 + rise * RISE.top + pitch + 132;
    const limit = Math.max(single.code.height, baseH) * WRAP_HEIGHT_FACTOR;
    let chosen = single;
    for (let count = 2; canWrap && count <= Math.min(3, m.tops.length); count++) {
      if (baseH + (count - 1) * pitch > limit) break;
      for (const rows2 of partitions(m.tops.length, count)) {
        const candidate = plan(rows2);
        if (candidate.width <= single.width + 1 && candidate.cell > chosen.cell * 1.1) chosen = candidate;
      }
    }
    const { labelExtent } = chosen;
    const placed = chosen.placed;
    const rowOf = chosen.rowOf;
    const extraRows = chosen.rows.length - 1;
    const rowY = (name) => (rowOf.get(name.split(".")[0]) ?? 0) * pitch;
    const { rows, height: codeH } = chosen.code;
    let codeW = chosen.code.width;
    let columnW = chosen.columnW;
    if (stacked) codeW = columnW = Math.max(codeW, columnW);
    const atLeaf = (memX2, memY2, c) => {
      const span = placed.spans.get(c.name);
      return {
        ...c,
        x: memX2 + span[0],
        y: memY2 + rowY(c.name),
        w: span[1],
        h: cellH,
        color: "",
        fieldColor: null
      };
    };
    const atGroup = (memX2, memY2, c) => {
      const span = placed.spans.get(c.name);
      return {
        ...c,
        x: memX2 + span[0],
        y: memY2 + rowY(c.name),
        w: span[1],
        h: cellH,
        color: "",
        fieldColor: null
      };
    };
    const probeLeaves = m.leaves.map((l) => atLeaf(0, 0, l));
    const probeGroups = m.groups.map((s) => atGroup(0, 0, s));
    const probe = {
      memY: 0,
      rise,
      leaves: probeLeaves,
      isStruct,
      box: (name) => probeGroups.find((s) => s.name === name) || probeLeaves.find((l) => l.name === name)
    };
    let level = -1;
    for (const step of m.steps) {
      for (const l of links(probe, step)) {
        level = Math.max(level, l.level);
      }
    }
    const room = (level >= 0 ? FRAME.top + 84 + level * 40 + 10 : (structs ? FRAME.top : 0) + 30) + rise * RISE.top;
    const tagged = tagRows(m, probe.box);
    const typeRow = typeRows(m, probe.box);
    const labelHeight = m.typed ? LABEL.rise + Math.max(0, labelExtent.rows - 1) * LABEL.row : 0;
    const labelRise = m.typed ? labelHeight + 6 : 0;
    const named = (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + extraMemBottom + rise * RISE.bottom + tagged.height;
    const names = named + typeRow.height;
    const paneTop = room + names + extraRows * pitch + 56;
    const paneH = 76 + labelRise + extraPaneHeight;
    const outputTop = paneTop + paneH + 60;
    const columnH = outputLines.length ? outputTop + (outputLines.length - 1) * 36 + 14 : paneTop + paneH;
    const codeX = MARGIN;
    let codeY;
    let columnX;
    let columnY;
    let width;
    let height;
    if (stacked) {
      codeY = MARGIN;
      columnX = MARGIN;
      columnY = codeY + codeH + 24;
      width = MARGIN + columnW + STACK_TETHER_WIDTH + MARGIN;
      height = columnY + columnH + MARGIN;
    } else {
      const content = Math.max(codeH, columnH);
      codeY = MARGIN + (content - codeH) / 2;
      columnX = codeX + codeW + COLUMN_GAP;
      columnY = MARGIN + (content - columnH) / 2;
      width = columnX + columnW + MARGIN;
      height = MARGIN + content + MARGIN;
    }
    const memX = columnX + 24;
    const memY = columnY + room;
    const pane2 = { x: columnX, y: columnY + paneTop, w: columnW, h: paneH };
    const tx = columnX + 24;
    const ty = pane2.y + 38 + 11 + labelHeight;
    const below = pane2.y - 56;
    const out = [columnX + 24, columnY + outputTop];
    const code2 = { x: codeX, y: codeY, w: codeW, h: codeH };
    const codeRows = placeCodeRows(rows, code2.y + 50);
    const lineY = (i) => codeRows[i][0].y;
    const gaps = placed.gaps.map(([x, w, row]) => [
      memX + x,
      w,
      memY + row * pitch
    ]);
    const colour = (list, i, count) => list[i % count];
    const leaves = m.leaves.map((l) => ({
      ...atLeaf(memX, memY, l),
      color: colour(P.vars, l.color, VARIABLE_COLOURS),
      fieldColor: l.group ? colour(P.fields, l.fieldColor ?? 0, FIELD_COLOURS) : null
    }));
    const groups = m.groups.map((s) => ({
      ...atGroup(memX, memY, s),
      color: colour(P.vars, s.color, VARIABLE_COLOURS),
      fieldColor: s.parent ? colour(P.fields, s.fieldColor ?? 0, FIELD_COLOURS) : null,
      drop: tagged.drop.get(s.name)
    }));
    const box = (name) => groups.find((s) => s.name === name) || leaves.find((l) => l.name === name);
    const cellsOf = (name) => leaves.filter((l) => l.name === name || l.name.startsWith(name + "."));
    const tags2 = tagged.tags.map((t) => {
      const item = box(t.target);
      let nameY;
      if (isStruct(item)) {
        const f = frameOf(item);
        nameY = f.y + f.h + (item.parent ? 24 : 32);
      } else {
        nameY = item.y + item.h + (item.group ? 28 : 34);
      }
      return {
        ...t,
        cx: t.cx + memX,
        y: nameY + (t.row + 1) * t.style.step,
        color: colour(P.vars, t.color, VARIABLE_COLOURS)
      };
    });
    const owner = (token) => groups.find((s) => s.name === token) || leaves.find((l) => !l.group && l.name === token) || tags2.find((t) => t.name === token);
    const field = (token) => leaves.find((l) => l.group && l.label === token) || groups.find((s) => s.parent && s.label === token);
    const g = {
      paneSize: chosen.paneSize,
      paneChar: chosen.paneChar,
      stacked,
      isStruct,
      rise,
      width,
      height,
      code: code2,
      memX,
      memY,
      pane: pane2,
      tx,
      ty,
      below,
      out,
      lineY,
      codeRows,
      gaps,
      leaves,
      groups,
      box,
      cellsOf,
      tags: tags2,
      owner,
      field,
      typeTargets: [],
      typeLabels: typeRow.labels.map(({ row, ...label }) => ({
        ...label,
        cx: label.cx + memX,
        top: memY + named + 8 + row * LABEL.row
      })),
      nameSize: labelSize(
        [...groups.filter((s) => !s.parent), ...leaves.filter((l) => !l.group)],
        (c) => c.name,
        26
      ),
      fieldSize: labelSize(
        leaves.filter((l) => l.group),
        (c) => c.label,
        20
      )
    };
    g.typeTargets = typeTargets(m, g);
    return g;
  }
  function arrayType(spelling) {
    var _a;
    const type = spelling.replace(/\b(?:struct|class) /g, "").replace(/^const /, "");
    const match = /^(?:std::)?array<(.+), (\d+)>$/.exec(type);
    if (!match) return null;
    const element = ((_a = arrayType(match[1])) == null ? void 0 : _a.name) ?? match[1];
    const count = Number(match[2]);
    return { name: `std::array<${element}, ${count}>`, element, count };
  }
  function codeName(path) {
    return path.replaceAll(".[", "[");
  }
  const CHAIN_STEP = 0.7;
  const CHAIN_LEAD = 0.35;
  function chainOf(name) {
    const parts = name.split(".");
    return parts.map((_, i) => parts.slice(0, i + 1).join("."));
  }
  function chainDelay(name) {
    const count = name ? chainOf(name).length : 1;
    return count > 1 ? (count - 1) * CHAIN_STEP + CHAIN_LEAD : 0;
  }
  function paneLevels(name, spelled) {
    const levels = chainOf(name).map(codeName);
    return levels.length > 1 && levels.every((level) => spelled.startsWith(level)) ? levels : null;
  }
  function walkWindows(count, end, offset = 0) {
    const start = count > 1 ? offset : 0;
    return Array.from({ length: count }, (_, k) => [
      start + k * CHAIN_STEP,
      k === count - 1 ? end : start + (k + 1) * CHAIN_STEP
    ]);
  }
  const stores = (op) => op.kind === "write" || op.kind === "bind";
  const departure = (op) => (stores(op) ? T.writeHold : op.kind === "print" ? 0.2 : T.prepare) + (op.kind === "read" || op.kind === "write" ? chainDelay(op.name) : 0);
  function arrival(op) {
    if (op.kind === "deref") return T.prepare + T.follow;
    if (op.kind === "eval" || op.kind === "alias" || op.kind === "convert") return T.evaluate;
    if (op.kind === "clash") return T.clash;
    if (op.kind === "print") return 0.9;
    return departure(op) + T.travel;
  }
  const opSeconds = (op) => arrival(op) + T.settle + (stores(op) ? 0.5 : 0);
  const copies = (steps, i) => !steps[i].op && (i === 0 || steps[i - 1].line !== steps[i].line);
  const copyBegin = (_steps, i) => i > 0 ? 0.3 : T.copyBegin;
  function animationSeconds(steps, i) {
    const step = steps[i];
    if (step.op) return opSeconds(step.op);
    return copies(steps, i) ? copyBegin(steps, i) + T.copyTravel + 0.25 : 0;
  }
  const stepSeconds = (steps, i) => steps[i].hold + animationSeconds(steps, i);
  function prepare(trace) {
    if (!trace || trace.format !== 1) {
      throw new Error("unsupported trace format " + (trace && trace.format));
    }
    const variables = [...trace.variables].sort((a, b) => a.address - b.address);
    const leaves = [];
    const groups = [];
    const tops = [];
    const struct = (item, name, address, variable, parent) => {
      const group = {
        name,
        label: item.name,
        type: "type" in item && item.type ? item.type : "",
        address,
        size: item.size,
        color: variable.color,
        fieldColor: parent ? item.color ?? null : null,
        top: variable.name,
        parent,
        children: [],
        fields: [],
        rise: 0
      };
      groups.push(group);
      const itemFields = "fields" in item && item.fields ? item.fields : [];
      for (const field of itemFields) {
        const at = address + field.offset;
        const path = name + "." + field.name;
        if (field.kind === "struct") {
          const inner = struct(field, path, at, variable, name);
          group.rise = Math.max(group.rise, inner.rise + 1);
          group.children.push(inner);
        } else {
          const leaf = {
            name: path,
            label: field.name,
            group: variable.name,
            address: at,
            size: field.size,
            kind: field.kind,
            color: variable.color,
            fieldColor: field.color
          };
          leaves.push(leaf);
          group.children.push(leaf);
        }
      }
      group.fields = group.children.map((child) => child.name);
      return group;
    };
    for (const variable of variables) {
      if (variable.kind === "struct") {
        tops.push(struct(variable, variable.name, variable.address, variable, null));
      } else {
        const leaf = {
          ...variable,
          label: variable.name,
          group: null,
          children: void 0,
          fields: void 0
        };
        leaves.push(leaf);
        tops.push(leaf);
      }
    }
    const top = variables.map((variable) => variable.name);
    return {
      trace,
      typeColours: typeColours(trace),
      typed: trace.steps.some((step) => step.types),
      steps: trace.steps,
      source: trace.source,
      spans: trace.spans || [],
      types: trace.types || {},
      references: trace.references || [],
      leaves,
      groups,
      tops,
      top,
      rise: Math.max(0, ...groups.map((group) => group.rise))
    };
  }
  function typeColours(trace) {
    const types = new Set(
      [
        "int",
        ...trace.variables.map((variable) => variable.type),
        ...trace.steps.flatMap((step) => (step.types ?? []).map((part) => part.type))
      ].filter((type) => Boolean(type))
    );
    const colours = /* @__PURE__ */ new Map();
    const taken = /* @__PURE__ */ new Set();
    for (const type of types) {
      let index = type === "int" ? 0 : [...type].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 9973, 7) % TYPE_COLOURS;
      while (taken.has(index) && taken.size < TYPE_COLOURS) index = (index + 1) % TYPE_COLOURS;
      taken.add(index);
      colours.set(type, index);
    }
    return colours;
  }
  function activeVariables(m, i) {
    const line = m.steps[i].line;
    const active = /* @__PURE__ */ new Set();
    const refs = m.steps[i].refs || {};
    for (const token of m.source[line].match(/\b[A-Za-z_]\w*\b/g) || []) {
      if (m.top.includes(token)) active.add(token);
      if (Object.prototype.hasOwnProperty.call(refs, token) && refs[token]) {
        active.add(token);
        active.add(refs[token].split(".")[0]);
      }
    }
    for (let j = i; j >= 0 && m.steps[j].line === line; j--) {
      const op = m.steps[j].op;
      if (!op) continue;
      for (const key of ["name", "target", "via"]) {
        if (key in op) {
          const val = op[key];
          if (val) active.add(val.split(".")[0]);
        }
      }
    }
    return active;
  }
  function colored(c, x, y, value, size = c.g.paneSize, mute = true, member = false) {
    let out = "";
    let cx = x;
    let isMember = member;
    for (const token of value.split(/(\b[A-Za-z_]\w*\b)/)) {
      if (!token) continue;
      const owner = !isMember ? c.g.owner(token) : void 0;
      const field = !owner ? c.g.field(token) : void 0;
      const color = owner ? owner.color : field ? field.fieldColor ?? c.P.fg : mute && KEYWORDS.has(token) ? c.P.context : c.P.fg;
      out += text(cx, y, token, size, color);
      isMember = /(\.|->)$/.test(token);
      cx += token.length * size * CHAR;
    }
    return out;
  }
  function paneText(c, x, y, pane2, a, b, expr) {
    const member = /(\.|->)$/.test(pane2.slice(0, a));
    if (!expr) return colored(c, x, y, pane2.slice(a, b), c.g.paneSize, true, member);
    const cuts = [a, Math.min(b, Math.max(a, expr[0])), Math.min(b, Math.max(a, expr[1])), b];
    let out = "";
    for (let i = 0; i < 3; i++) {
      const [from, to] = [cuts[i], cuts[i + 1]];
      if (from >= to) continue;
      const px = x + (from - a) * c.g.paneChar;
      const part = pane2.slice(from, to);
      out += i === 1 ? colored(c, px, y, part, c.g.paneSize, true, /(\.|->)$/.test(pane2.slice(0, from))) : text(px, y, part, c.g.paneSize, c.P.context);
    }
    return out;
  }
  function exprBackground(c, x, y, expr, from = null, begin = 0) {
    if (!expr || expr[0] === expr[1]) return "";
    const box = (e) => [
      x + e[0] * c.g.paneChar - 4,
      (e[1] - e[0]) * c.g.paneChar + 8
    ];
    const [bx, bw] = box(expr);
    if (from && from[1] > from[0] && (from[0] !== expr[0] || from[1] !== expr[1])) {
      const [fx, fw] = box(from);
      const anims = animateAttr("x", fx, bx, 0.3, begin) + animateAttr("width", fw, bw, 0.3, begin);
      return animated(rect(fx, y - 33, fw, 44, c.P.highlight, "none", 6), anims);
    }
    return rect(bx, y - 33, bw, 44, c.P.highlight, "none", 6);
  }
  const settledPane = (c, step, x, y) => exprBackground(c, x, y, step.expr) + paneText(c, x, y, step.pane, 0, step.pane.length, step.expr);
  function inContext(step, span) {
    return Boolean(step.expr) && (span[1] <= step.expr[0] || span[0] >= step.expr[1]);
  }
  function dim(c, name, markup) {
    const { focus } = c;
    const on = focus.now.has(name);
    const was = focus.before.has(name);
    const to = on ? 1 : DIM;
    if (on === was) return to === 1 ? markup : `<g opacity="${DIM}">${markup}</g>`;
    return `<g opacity="${was ? 1 : DIM}"><animate attributeName="opacity" from="${was ? 1 : DIM}" to="${to}" dur="0.35s" begin="${round(focus.begin.get(name) ?? 0)}s" ${EASE} fill="freeze"/>${markup}</g>`;
  }
  const typeColour = (c, type) => c.P.types[c.m.typeColours.get(type) ?? 0];
  function typeLabel(c, cx, top, type, size, color) {
    const w = typeLabelWidth(type, size);
    const h = size + 7;
    const label = (fill) => text(cx, top + size + 1, type, size, fill, "middle");
    return c.P.typeLabel === "fill" ? rect(cx - w / 2, top, w, h, color, "none", h / 2) + label(c.P.bg) : rect(cx - w / 2, top, w, h, "none", color, h / 2, 1.5) + label(color);
  }
  const labelTop = (y, label) => y - 70 - label.row * LABEL.row + (LABEL.pane - label.size) / 2;
  function paneTypes(c, step, x, y) {
    const { P } = c;
    const op = step.op;
    const clash = (op == null ? void 0 : op.kind) === "clash";
    const labels = paneLabels(step, c.g.paneChar).map((label) => ({ ...label, cx: x + label.cx }));
    const opStart = op && "span" in op ? op.span[0] : void 0;
    const value = labels.find((label) => !label.slot && label.start === opStart);
    const slot = labels.find((label) => label.slot);
    let out = "";
    for (const part of step.types ?? []) {
      out += `<path d="M ${round(x + part.span[0] * c.g.paneChar)} ${y + 14} H ${round(x + part.span[1] * c.g.paneChar)}" stroke="${typeColour(c, part.type)}" stroke-width="3" stroke-linecap="round"/>`;
    }
    for (const label of labels) {
      const top = labelTop(y, label);
      const middle = top + (label.size + 7) / 2;
      let mark = typeLabel(c, label.cx, top, label.type, label.size, typeColour(c, label.type));
      const current = c.animate && step === c.step && label === value;
      if (current && (op == null ? void 0 : op.kind) === "convert") {
        mark = `<g transform="translate(${round(label.cx)} ${round(middle)})"><g>${pulse(arrival(op) + 0.2)}<g transform="translate(${round(-label.cx)} ${round(-middle)})">${mark}</g></g></g>`;
      }
      if (current && clash && slot) {
        mark = `<g><animateMotion path="M 0 0 H ${round(slot.cx - label.cx)}" keyPoints="0;0.75;0" keyTimes="0;0.55;1" calcMode="linear" begin="0.35s" dur="${T.clash - 0.4}s" fill="freeze"/>${mark}</g>`;
      }
      out += `<g class="cv-pane-type">${mark}</g>`;
      if (clash && (label === value || label === slot)) {
        const w = typeLabelWidth(label.type, label.size);
        const h = label.size + 7;
        out += rect(label.cx - w / 2 - 4, top - 4, w + 8, h + 8, "none", P.error, h / 2 + 4, 2.5);
      }
    }
    if (clash && value && slot) out += text((slot.cx + value.cx) / 2, y - 48, "≠", 26, P.error, "middle");
    return out;
  }
  function code(c, oldLine) {
    const { m, g, P, step, op } = c;
    const x = g.code.x;
    let out = rect(x, g.code.y, g.code.w, g.code.h, P.panel);
    const boxes = (line) => {
      const source = m.source[line];
      const span = m.spans[line] || [0, source.replace(/;\s*$/, "").length];
      const rows = g.codeRows[line];
      const wrapped = rows.length > 1;
      return rows.flatMap((row) => {
        const start = Math.max(span[0], row.start);
        const end = Math.min(span[1], row.end);
        if (start >= end) return [];
        return [[
          x + CODE_GUTTER + (row.indent + start - row.start) * CODE_CHAR - 3,
          row.y - (wrapped ? 24 : 30),
          (end - start) * CODE_CHAR + 6,
          wrapped ? 31 : 40
        ]];
      });
    };
    const y = g.lineY(step.line);
    const spans = boxes(step.line);
    const stripeColour = (op == null ? void 0 : op.kind) === "clash" ? P.error : (op == null ? void 0 : op.kind) === "write" ? P.write : P.read;
    const continuationHeight = g.codeRows[step.line].at(-1).y - y;
    let stripe = rect(x + 8, y - 32, 4, 44 + continuationHeight, stripeColour, "none", 0);
    let highlight = spans.map(([x2, y2, w, h]) => rect(x2, y2, w, h, P.highlight, "none", 6)).join("");
    if (oldLine !== null) {
      const prev = boxes(oldLine);
      stripe = animated(stripe, animateAttr("y", g.lineY(oldLine) - 32, y - 32));
      if (prev.length === 1 && spans.length === 1) {
        const [ox, oy, ow, oh] = prev[0];
        const [nx, ny, nw, nh] = spans[0];
        highlight = animated(
          highlight,
          animateAttr("x", ox, nx) + animateAttr("y", oy, ny) + animateAttr("width", ow, nw) + animateAttr("height", oh, nh)
        );
      }
    }
    out += stripe + highlight;
    m.source.forEach((source, i) => {
      out += text(x + 22, g.lineY(i), i + 1, 18, P.muted);
      const definition = /^\s*struct\b/.test(source);
      for (const row of g.codeRows[i]) {
        out += colored(
          c,
          x + CODE_GUTTER + row.indent * CODE_CHAR,
          row.y,
          source.slice(row.start, row.end),
          CODE_SIZE,
          definition,
          /(?:\.|->)\s*$/.test(source.slice(0, row.start))
        );
      }
    });
    for (const t of g.typeTargets) {
      if (t.underline) {
        out += `<path d="M ${round(t.x + 1)} ${round(t.y + t.h - 1)} h ${round(t.w - 2)}" stroke="${P.muted}" stroke-width="1.6" stroke-dasharray="1.5 3.5" stroke-linecap="round" opacity="0.6"/>`;
      }
    }
    return out;
  }
  function tether(c, oldLine) {
    const { g, P, step } = c;
    const right = g.code.x + g.code.w;
    const mid = g.pane.y + g.pane.h / 2;
    const path = (line) => g.stacked ? `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 18)} V ${mid} H ${round(g.pane.x + g.pane.w)}` : `M ${round(right + 5)} ${g.lineY(line) - 10} H ${round(right + 28)} V ${mid} H ${round(g.pane.x)}`;
    const d = path(step.line);
    return animated(
      `<path d="${d}" fill="none" stroke="${P.tether}" stroke-width="2"/>`,
      oldLine !== null ? animateAttr("d", path(oldLine), d) : ""
    );
  }
  function lineTargets(m, S) {
    return m.source.map(
      (source, i) => `<rect class="cv-line" data-line="${i}" tabindex="0" role="button" aria-label="${esc(format(S.jump, { line: i + 1, code: source }))}" rx="6" height="48"/>`
    ).join("");
  }
  function placeLineTargets(g, targets) {
    targets.forEach((target, i) => {
      target.setAttribute("x", String(g.code.x + 12));
      target.setAttribute("y", String(g.lineY(i) - 34));
      target.setAttribute("width", String(round(g.code.w - 24)));
      target.setAttribute("height", String(48 + g.codeRows[i].at(-1).y - g.lineY(i)));
    });
  }
  function linkMarkup(c, l, { grow = null, fadeOut = null } = {}) {
    const [x, y] = l.head;
    const color = l.from.color;
    const head = `<path d="M -11 -6.5 L 0 0 L -11 6.5 Z" fill="${color}" transform="translate(${round(x)} ${y}) rotate(90)"/>`;
    const growing = grow !== null ? ` data-grow="${round(grow)}"` : "";
    return dim(
      c,
      l.from.name.split(".")[0],
      `<g>` + (fadeOut !== null ? fade(1, 0, 0.3, fadeOut) : "") + `<path d="${l.d}" fill="none" stroke="${c.P.bg}" stroke-width="9"${growing}/><path d="${l.d}" fill="none" stroke="${color}" stroke-width="2.5"${growing}/>` + (grow !== null ? `<g opacity="0">${fade(0, 1, 0.15, grow + 0.5)}${head}</g>` : head) + "</g>"
    );
  }
  function arrows(c) {
    const { g, step, prev, op } = c;
    const now = links(g, step);
    const writesPointer = op && op.kind === "write" && g.cellsOf(op.name).some((l) => l.kind === "ptr");
    if (writesPointer && prev) {
      const at = arrival(op);
      const changed = new Set(g.cellsOf(op.name).map((l) => l.name));
      let out2 = "";
      for (const l of links(g, prev)) {
        out2 += linkMarkup(c, l, changed.has(l.from.name) ? { fadeOut: at } : {});
      }
      for (const l of now) {
        if (changed.has(l.from.name)) out2 += linkMarkup(c, l, { grow: at + 0.1 });
      }
      return out2;
    }
    let out = now.map((l) => linkMarkup(c, l)).join("");
    if (op && op.kind === "deref") {
      const l = now.find((link) => link.from.name === op.via);
      if (l) {
        out += `<path d="${l.d}" fill="none" stroke="${l.from.color}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
      }
    }
    return out;
  }
  function outline(c, box, color) {
    if (c.g.isStruct(box)) {
      const f = frameOf(box);
      return rect(f.x + 3, f.y + 3, f.w - 6, f.h - 6, "none", color, 8, 3);
    }
    return rect(box.x + 4.5, box.y + 4.5, box.w - 9, box.h - 9, "none", color, 0, 3);
  }
  function tags(c, at) {
    const { g, P, step, op } = c;
    const bound = step.refs || {};
    let out = "";
    for (const t of g.tags) {
      if (!bound[t.name]) continue;
      const h = t.style.size + 10;
      const x = t.cx - t.w / 2;
      const y = t.y - t.style.size + 1;
      const middle = y + h / 2;
      let markup = rect(x, y, t.w, h, P.panel, t.color, h / 2, 2);
      if (op && op.kind === "alias" && op.name === t.name) {
        markup += `<g opacity="0">${fade(0, 0.45, 0.2)}${fade(0.45, 0, 0.5, at)}${rect(x, y, t.w, h, t.color, "none", h / 2)}</g>`;
      }
      markup += text(t.cx, t.y, t.name, t.style.size, t.color, "middle");
      if (op && op.kind === "bind" && op.name === t.name) {
        markup = `<g opacity="0">${show(at)}<g transform="translate(${round(t.cx)} ${round(middle)})"><g>${pulse(at - 0.05)}<g transform="translate(${round(-t.cx)} ${round(-middle)})">${markup}</g></g></g></g>`;
      }
      out += dim(c, t.name, markup);
    }
    return out;
  }
  function memory(c) {
    const { g, P, step, prev, op } = c;
    const values = op && op.kind === "write" && prev ? prev.values : step.values;
    const at = op ? arrival(op) : 0;
    const writing = new Set(op && op.kind === "write" ? g.cellsOf(op.name).map((l) => l.name) : []);
    const live = (l) => values[l.name] !== null || writing.has(l.name);
    let out = "";
    for (const [x, w, y] of g.gaps) {
      out += `<rect x="${round(x + 3)}" y="${y + 3}" width="${round(w - 6)}" height="58" fill="none" stroke="${P.gapStroke}" stroke-dasharray="5 5"/>`;
    }
    const arrays = new Set(g.groups.filter((s) => arrayType(s.type ?? "")).map((s) => s.name));
    const inArray = (name) => [...arrays].some((a) => name.startsWith(a + "."));
    const startsAt = (target, cell) => {
      var _a;
      return target === cell.name || cell.name.startsWith(target + ".") && ((_a = g.box(target)) == null ? void 0 : _a.address) === cell.address;
    };
    const pointed = (shown, cell) => Boolean(shown && Object.values(shown.targets).some((t) => startsAt(t, cell)));
    const taking = (i, cell) => {
      const steps = c.m.steps;
      for (let j = i; j >= 0 && steps[j].line === steps[Math.max(i, 0)].line; j--) {
        const o = steps[j].op;
        if ((o == null ? void 0 : o.kind) === "addr" && startsAt(o.name, cell)) return true;
      }
      return false;
    };
    const startsVariable = (cell) => {
      var _a;
      return ((_a = g.box(cell.name.split(".")[0])) == null ? void 0 : _a.address) === cell.address;
    };
    const addressOf = (cell, on) => {
      const label = text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
      if (startsVariable(cell)) return label;
      const now = pointed(step, cell) || taking(c.index, cell);
      const before = c.animate ? pointed(prev, cell) || taking(c.index - 1, cell) : now;
      if (now && before) return label;
      const appear = (op == null ? void 0 : op.kind) === "addr" ? 0 : at;
      if (now) return `<g opacity="0">${fade(0, 1, 0.3, appear)}${label}</g>`;
      if (before) return `<g>${fade(1, 0, 0.3, at)}${label}</g>`;
      return "";
    };
    for (const s of g.groups) {
      const on = g.cellsOf(s.name).some(live);
      const f = frameOf(s);
      const arrayGroup = arrays.has(s.name) || s.label.startsWith("[");
      const color = on ? arrayGroup ? s.color : s.fieldColor || s.color : null;
      out += dim(
        c,
        s.top,
        rect(f.x, f.y, f.w, f.h, "none", color || P.deadStroke, 6, FRAME.stroke) + (s.parent ? text(
          s.x + s.w / 2,
          f.y + f.h + 24,
          s.label,
          Math.min(g.fieldSize, 22),
          color || P.grey,
          "middle"
        ) : text(s.x + s.w / 2, f.y + f.h + 32, s.name, g.nameSize, color || P.grey, "middle"))
      );
    }
    if (op && op.kind === "addr") {
      const cell = g.cellsOf(op.name)[0];
      const [lx, ly] = labelCentre(cell);
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.1)}` + rect(lx - labelWidth(cell) / 2 - 5, ly - 13, labelWidth(cell) + 10, 24, P.readFill, P.read, 5, 2) + "</g>";
    }
    for (const cell of g.leaves) {
      const on = live(cell);
      const changing = writing.has(cell.name);
      const element = cell.label.startsWith("[") && inArray(cell.name);
      const color = element ? cell.color : cell.fieldColor || cell.color;
      let markup = inArray(cell.name) ? addressOf(cell, on) : text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
      markup += text(
        cell.x + cell.w / 2,
        cell.y + cell.h + (cell.group ? 28 : 34),
        cell.label,
        cell.group ? g.fieldSize : g.nameSize,
        on ? color : P.grey,
        "middle"
      );
      markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, "none", 0);
      markup += rect(
        cell.x + 1.5,
        cell.y + 1.5,
        cell.w - 3,
        cell.h - 3,
        "none",
        on ? color : P.deadStroke,
        0,
        3
      );
      if (on) {
        const shown = (value) => {
          const length = String(value).length;
          const size = Math.min(30, (cell.w - Math.min(12, cell.w / 5)) / (length * CHAR));
          return text(0, size / 3 + 1, value, round(size), value === "?" ? P.grey : P.fg, "middle");
        };
        markup += `<g transform="translate(${round(cell.x + cell.w / 2)} ${cell.y + cell.h / 2})"><g>` + (changing ? pulse(at - 0.2) : "");
        const before = prev ? prev.values[cell.name] : null;
        const after = step.values[cell.name];
        if (changing && before !== after) {
          if (before !== null) markup += `<g>${hide(at)}${shown(before)}</g>`;
          markup += `<g opacity="0">${show(at)}${shown(after)}</g>`;
        } else {
          markup += shown(changing ? after : values[cell.name]);
        }
        markup += "</g></g>";
      }
      out += dim(c, cell.group || cell.name, markup);
    }
    if (op && (op.kind === "read" || op.kind === "write")) {
      out += chainHighlight(c, op, at);
    }
    if (op && op.kind === "deref") {
      out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target), P.fg)}</g>`;
    }
    if (op && op.kind === "alias") {
      out += `<g opacity="0">${fade(0, 1, 0.2, at - 0.15)}${outline(c, g.box(op.target), P.fg)}</g>`;
    }
    if (op && op.kind === "bind") {
      out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.5)}${outline(c, g.box(op.target), P.fg)}</g>`;
    }
    for (const label of g.typeLabels) {
      const on = g.cellsOf(label.name).some(live);
      const color = on ? typeColour(c, label.type) : P.deadStroke;
      out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, LABEL.memory, color));
    }
    return out + tags(c, at);
  }
  function chainHighlight(c, op, at) {
    const { g, P } = c;
    const color = op.kind === "write" ? P.write : P.read;
    const levels = chainOf(op.name);
    const windows = walkWindows(levels.length, at + 0.15, CHAIN_LEAD);
    return levels.map((level, k) => {
      const box = g.box(level);
      if (!box) return "";
      const [begin, leave] = windows[k];
      const hidden = begin > 0;
      const appear = hidden ? fade(0, 1, 0.15, begin) : "";
      const r = g.isStruct(box) ? frameOf(box) : box;
      const wash = `<g opacity="${g.isStruct(box) ? 0.1 : 0.22}">${rect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, color, "none", g.isStruct(box) ? 8 : 0)}</g>`;
      return `<g opacity="${hidden ? 0 : 1}">${appear}${fade(1, 0, 0.25, leave)}${wash}${outline(c, box, color)}</g>`;
    }).join("");
  }
  function walkBoxes(levels, end, box, whole) {
    if (!levels) return whole;
    const windows = walkWindows(levels.length, end);
    return levels.map((level, k) => {
      const [begin, leave] = windows[k];
      return `<g opacity="0">${fade(0, 1, 0.15, begin)}${fade(1, 0, 0.2, leave)}${box(level.length)}</g>`;
    }).join("");
  }
  function valueBox(c, value, color, path, begin, travel, end) {
    const half = Math.max(28, String(value).length * c.g.paneChar / 2 + 12);
    return `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g><g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}` + rect(-half, -25, 2 * half, 50, c.P.panel, color, 9) + text(0, 11, value, c.g.paneSize, c.P.fg, "middle") + `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
  }
  function transfers(c) {
    const { g, P, op } = c;
    if (!op) return "";
    const at = arrival(op);
    const begin = departure(op);
    const ty = g.ty - 11;
    const below = g.below;
    const spanCentre = (span) => g.tx + (span[0] + span[1]) / 2 * c.g.paneChar;
    const p = (...values) => values.map(round).join(" ");
    if (op.kind === "read") {
      const [sx, sy] = valueCentre(g.box(op.name));
      const dx = spanCentre(op.span);
      return valueBox(
        c,
        op.value,
        P.read,
        `M ${p(sx, sy)} C ${p(sx, below)}, ${p(dx, below)}, ${p(dx, ty)}`,
        begin,
        T.travel,
        at
      );
    }
    if (op.kind === "addr") {
      const cell = g.cellsOf(op.name)[0];
      const [sx, sy] = labelCentre(cell);
      const dx = spanCentre(op.span);
      const side = cell.x - 20;
      return valueBox(
        c,
        op.value,
        P.read,
        `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, cell.y + CELL)}, ${p(side, below)} C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`,
        begin,
        T.travel,
        at
      );
    }
    if (op.kind === "write") {
      const sx = spanCentre(op.span);
      const [ex, ey] = valueCentre(g.box(op.name));
      return valueBox(
        c,
        op.value,
        P.write,
        `M ${p(sx, ty)} C ${p(sx, below)}, ${p(ex, below)}, ${p(ex, ey)}`,
        begin,
        T.travel,
        at
      );
    }
    if (op.kind === "bind") {
      const tag = g.tags.find((t) => t.name === op.name);
      const sx = spanCentre(op.destination);
      const ey = tag.y - tag.style.size / 2 + 4;
      return valueBox(
        c,
        op.name,
        tag.color,
        `M ${p(sx, ty)} C ${p(sx, ty - 70)}, ${p(tag.cx, ey + 70)}, ${p(tag.cx, ey)}`,
        begin,
        T.travel,
        at
      );
    }
    return "";
  }
  function pane(c, copying) {
    const { g, step, prev, op, animate } = c;
    const out = paneBody(c, copying);
    if (!c.m.typed) return out;
    const types = (shown) => paneTypes(c, shown, g.tx, g.ty);
    if (!animate) return out + types(step);
    const appear = (at, shown) => `<g opacity="0">${fade(0, 1, 0.25, at)}${types(shown)}</g>`;
    if (copying) return out + appear(copyBegin(c.m.steps, c.index) + T.copyTravel, step);
    if ((op == null ? void 0 : op.kind) === "clash") return out + appear(0.15, step);
    if (!op || !prev || stores(op) || op.kind === "print") return out + types(step);
    return out + `<g>${fade(1, 0, 0.2, Math.max(0, arrival(op) - 0.35))}${types(prev)}</g>` + appear(arrival(op) + 0.2, step);
  }
  function paneBody(c, copying) {
    const { g, P, step, prev, op } = c;
    const tx = g.tx;
    const ty = g.ty;
    let out = `<g class="cv-pane">${rect(g.pane.x, g.pane.y, g.pane.w, g.pane.h, P.pane)}</g>`;
    if (copying) {
      const sx = g.code.x + CODE_GUTTER;
      const sy = g.lineY(step.line);
      const begin = copyBegin(c.m.steps, c.index);
      const total = begin + T.copyTravel;
      if (prev && prev.line !== step.line) {
        out += `<g>${fade(1, 0, 0.3, begin + 0.2)}${settledPane(c, prev, tx, ty)}</g>`;
      }
      const scale = CODE_SIZE / c.g.paneSize;
      out += `<g><animateMotion dur="${round(total)}s" path="M ${round(sx)} ${sy} L ${tx} ${ty}" keyPoints="0;0;1" keyTimes="0;${(begin / total).toFixed(4)};1" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1" fill="freeze"/><g transform="scale(${scale})"><animateTransform attributeName="transform" type="scale" from="${scale}" to="1" begin="${begin}s" dur="${T.copyTravel}s" ${EASE} fill="freeze"/><g opacity="0">${fade(0, 1, 0.15, begin - 0.15)}${fade(1, 0, 0.12, total)}` + rect(-8, -36, step.pane.length * c.g.paneChar + 16, 48, P.highlight, P.read, 7, 2) + "</g>" + settledPane(c, step, 0, 0) + "</g></g>";
      return out;
    }
    if (op && prev && (op.kind === "read" || op.kind === "addr" || op.kind === "deref" || op.kind === "eval" || op.kind === "alias" || op.kind === "convert")) {
      const before = prev.pane;
      const [s, e] = op.span;
      const length = step.pane.length - before.length + (e - s);
      const at = arrival(op);
      const dx = (length - (e - s)) * c.g.paneChar;
      const sx = tx + s * c.g.paneChar;
      const [stroke, fill] = op.kind === "read" || op.kind === "addr" ? [P.read, P.readFill] : op.kind === "convert" ? [P.write, P.writeFill] : [P.fg, P.derefFill];
      out += exprBackground(c, tx, ty, step.expr, prev.expr, at + 0.1);
      out += walkBoxes(
        op.kind === "read" ? paneLevels(op.name, before.slice(s, e)) : null,
        at - 0.1,
        (chars) => markBox(sx, ty, chars * c.g.paneChar, stroke, fill),
        `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at - 0.1)}${markBox(sx, ty, (e - s) * c.g.paneChar, stroke, fill)}</g>`
      );
      out += paneText(c, tx, ty, before, 0, s, prev.expr);
      let old = paneText(c, sx, ty, before, s, e, prev.expr);
      let fresh = paneText(c, sx, ty, step.pane, s, s + length, step.expr);
      const middle = sx + (e - s) * c.g.paneChar / 2;
      if (op.kind === "eval" || op.kind === "convert") {
        old = scaleAbout(old, middle, ty - 11, 1, 0.45, 0.15, at - 0.15);
        fresh = scaleAbout(fresh, sx + length * c.g.paneChar / 2, ty - 11, 0.45, 1, at, 0.25);
      }
      out += `<g>${hide(at)}${old}</g>`;
      out += `<g opacity="0">${show(at)}${settle(fresh, (e - s - length) / 2 * c.g.paneChar, at + 0.1)}</g>`;
      return out + glide(
        paneText(c, tx + e * c.g.paneChar, ty, before, e, before.length, prev.expr),
        dx,
        at + 0.1,
        0.3
      );
    }
    out += exprBackground(c, tx, ty, step.expr);
    if (op && op.kind === "write") {
      const at = arrival(op);
      const [vs, ve] = op.span;
      const [ns, ne] = op.destination;
      const tight = ne === vs ? 4 : 0;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}` + rect(
        tx + vs * c.g.paneChar - 3 + tight,
        ty - 32,
        (ve - vs) * c.g.paneChar + 6 - tight,
        42,
        P.writeFill,
        P.write,
        6,
        2
      ) + "</g>";
      const destination = (chars) => rect(tx + ns * c.g.paneChar - 3, ty - 32, chars * c.g.paneChar + 6 - tight, 42, "none", P.write, 6, 2);
      out += walkBoxes(
        paneLevels(op.name, step.pane.slice(ns, ne)),
        at + 0.4,
        destination,
        `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}${destination(ne - ns)}</g>`
      );
      out += paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
      if (inContext(step, op.destination)) {
        out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.15)}` + colored(c, tx + ns * c.g.paneChar, ty, step.pane.slice(ns, ne)) + "</g>";
      }
      return out;
    }
    if (op && op.kind === "bind") {
      const at = arrival(op);
      const [vs, ve] = op.span;
      const [ns, ne] = op.destination;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}${markBox(tx + ns * c.g.paneChar, ty, (ne - ns) * c.g.paneChar, P.fg, P.derefFill)}</g>`;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}` + rect(tx + vs * c.g.paneChar - 3, ty - 32, (ve - vs) * c.g.paneChar + 6, 42, "none", P.fg, 6, 2) + "</g>";
    }
    return out + paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
  }
  function output(c) {
    const { g, P, S, step, prev, op } = c;
    if (!step.stdout) return "";
    const [ox, oy] = g.out;
    const label = S.output;
    const vx = ox + (label.length + 1) * 26 * CHAR;
    const printing = op && op.kind === "print";
    const shown = printing && prev ? prev.stdout : step.stdout;
    let out = (printing && (!prev || !prev.stdout) ? `<g opacity="0">${fade(0, 1, 0.25)}` : "<g>") + text(ox, oy, label, 26, P.muted) + "</g>";
    shown.split("\n").forEach((line, i) => {
      out += text(vx, oy + i * 36, line, c.g.paneSize, P.fg);
    });
    if (printing && op.kind === "print") {
      const lines = shown.split("\n");
      const x = vx + lines[lines.length - 1].length * c.g.paneChar;
      const y = oy + (lines.length - 1) * 36;
      const sx = g.tx + (op.span[0] + op.span[1]) / 2 * c.g.paneChar;
      const w = op.value.length * c.g.paneChar;
      const p = (...values) => values.map(round).join(" ");
      out += valueBox(
        c,
        op.value.trim() ? op.value : glyphs(op.value),
        P.muted,
        `M ${p(sx, g.ty - 11)} C ${p(sx, y - 30)}, ${p(x + w / 2, g.ty + 20)}, ${p(x + w / 2, y - 11)}`,
        0.2,
        0.7,
        0.9
      );
      out += `<g opacity="0">${show(0.9)}${text(x, y, op.value, c.g.paneSize, P.fg)}</g>`;
    }
    return out;
  }
  function scene(c) {
    const { step, prev, animate } = c;
    const lineChanged = animate && prev !== null && prev.line !== step.line;
    const copying = animate && copies(c.m.steps, c.index);
    const oldLine = lineChanged && prev ? prev.line : null;
    return code(c, oldLine) + tether(c, oldLine) + arrows(c) + memory(c) + pane(c, copying) + output(c) + transfers(c);
  }
  function describe(c) {
    const { m, S, step } = c;
    const op = step.op;
    if (!op) return format(S.copy, { line: step.line + 1, code: m.source[step.line] });
    if (op.kind === "print" && S.blank[op.value]) return S.blank[op.value];
    if (op.kind === "clash") {
      return format(S.clash, {
        ...op,
        value: step.pane.slice(...op.span),
        slot: step.pane.slice(...op.destination)
      });
    }
    return format(S[op.kind], op);
  }
  class Player {
    constructor(host, trace, hooks) {
      __publicField(this, "host");
      __publicField(this, "m");
      __publicField(this, "S");
      __publicField(this, "hooks");
      __publicField(this, "index");
      __publicField(this, "elapsed");
      __publicField(this, "duration");
      __publicField(this, "rate");
      __publicField(this, "running");
      __publicField(this, "continuous");
      __publicField(this, "pristine");
      __publicField(this, "animated");
      __publicField(this, "frame");
      __publicField(this, "last");
      __publicField(this, "stale");
      __publicField(this, "root");
      __publicField(this, "svg");
      __publicField(this, "scene");
      __publicField(this, "lines");
      __publicField(this, "playButton");
      __publicField(this, "scrub");
      __publicField(this, "count");
      __publicField(this, "status");
      __publicField(this, "typeBox");
      __publicField(this, "stacked");
      __publicField(this, "layoutWidth");
      __publicField(this, "observer", null);
      __publicField(this, "P");
      __publicField(this, "g");
      __publicField(this, "shownType");
      this.host = host;
      this.m = prepare(trace);
      this.S = strings();
      this.hooks = hooks;
      this.index = 0;
      this.elapsed = 0;
      this.duration = 0;
      this.rate = 1;
      this.running = false;
      this.continuous = false;
      this.pristine = true;
      this.animated = false;
      this.frame = 0;
      this.last = 0;
      this.stale = false;
      this.stacked = null;
      this.shownType = null;
      this.build();
      this.theme();
      this.settle(0);
    }
    build() {
      const S = this.S;
      const root = document.createElement("div");
      root.className = "cv-player not-content";
      root.tabIndex = 0;
      root.setAttribute("role", "group");
      root.setAttribute("aria-label", this.m.trace.title || S.stage);
      const button = (action, label, iconName, extra = "") => `<button type="button" class="cv-button${extra}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}<span class="cv-label">${esc(label)}</span></button>`;
      root.innerHTML = `<div class="cv-view"><svg class="cv-stage" role="group" aria-label="${esc(S.stage)}" xmlns="http://www.w3.org/2000/svg"><g class="cv-scene" aria-hidden="true"></g><g class="cv-lines">${lineTargets(this.m, S)}</g></svg><div class="cv-type" aria-hidden="true" hidden></div></div><div class="cv-controls"><div class="cv-transport">` + button("play", S.play, "play", " cv-primary") + button("back", S.back, "back") + button("next", S.next, "next") + button("replay", S.replay, "replay", " cv-icon-only") + `<select class="cv-speed" aria-label="${esc(S.speed)}" title="${esc(S.speed)}">` + [0.5, 1, 1.5, 2].map((v) => `<option value="${v}"${v === 1 ? " selected" : ""}>${v}×</option>`).join("") + "</select>" + button("reset", S.reset, "reset", " cv-reset") + `</div><div class="cv-progress"><input class="cv-scrub" type="range" min="0" max="${this.m.steps.length - 1}" value="0" step="1" aria-label="${esc(S.scrub)}"><span class="cv-count"></span></div></div><div class="cv-status" aria-live="polite"></div>`;
      this.host.append(root);
      this.root = root;
      this.svg = root.querySelector(".cv-stage");
      this.scene = root.querySelector(".cv-scene");
      this.lines = [...root.querySelectorAll(".cv-line")];
      this.playButton = root.querySelector("[data-action=play]");
      this.scrub = root.querySelector(".cv-scrub");
      this.count = root.querySelector(".cv-count");
      this.status = root.querySelector(".cv-status");
      root.querySelector(".cv-transport").addEventListener("click", (event) => {
        var _a;
        const target = (_a = event.target) == null ? void 0 : _a.closest("[data-action]");
        if (target && target.dataset.action) {
          this.invokeAction(target.dataset.action);
        }
      });
      root.querySelector(".cv-speed").addEventListener("change", (event) => {
        this.rate = Number(event.target.value);
      });
      this.scrub.addEventListener("input", () => {
        this.pristine = false;
        this.settle(Number(this.scrub.value));
      });
      this.svg.addEventListener("click", (event) => {
        var _a;
        const line = (_a = event.target) == null ? void 0 : _a.closest("[data-line]");
        if (line && line.dataset.line !== void 0) {
          this.line(Number(line.dataset.line));
        }
      });
      root.addEventListener("keydown", (event) => this.key(event));
      this.typeBox = root.querySelector(".cv-type");
      this.svg.addEventListener("pointermove", (event) => this.hoverType(event));
      this.svg.addEventListener("pointerdown", (event) => this.hoverType(event));
      this.svg.addEventListener("pointerleave", () => this.hoverType(null));
      this.stacked = null;
      if (window.ResizeObserver) {
        this.observer = new ResizeObserver(() => {
          if (this.root.clientWidth !== this.layoutWidth) this.refresh();
        });
        this.observer.observe(root);
      }
    }
    invokeAction(action) {
      switch (action) {
        case "play":
          this.play();
          break;
        case "back":
          this.back();
          break;
        case "next":
          this.next();
          break;
        case "replay":
          this.replay();
          break;
        case "reset":
          this.reset();
          break;
        case "end":
          this.end();
          break;
      }
    }
    key(event) {
      const target = event.target;
      if (!target) return;
      const lineEl = target.closest("[data-line]");
      if (lineEl && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.line(Number(lineEl.dataset.line));
        return;
      }
      if (target.matches("input, select, textarea")) return;
      const actions = {
        ArrowLeft: "back",
        ArrowRight: "next",
        Home: "reset",
        End: "end"
      };
      if (actions[event.key]) {
        event.preventDefault();
        this.invokeAction(actions[event.key]);
      } else if (event.key === " " && !target.matches("button")) {
        event.preventDefault();
        this.play();
      }
    }
    hoverType(event) {
      const targets = this.g ? this.g.typeTargets : [];
      let hit = null;
      if (event && targets.length) {
        const matrix = this.svg.getScreenCTM();
        if (matrix) {
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          hit = targets.find(
            (t) => point.x >= t.x && point.x <= t.x + t.w && point.y >= t.y && point.y <= t.y + t.h
          ) ?? null;
        }
      }
      this.svg.style.cursor = hit ? "help" : "";
      if (!hit) {
        this.typeBox.hidden = true;
        this.shownType = null;
        return;
      }
      if (this.shownType !== hit) {
        this.shownType = hit;
        this.typeBox.innerHTML = "<pre>" + this.m.types[hit.type].split(/(\b[A-Za-z_]\w*\b)/).map((token) => {
          const field = this.g.field(token);
          return field ? `<span style="color:${field.fieldColor}">${esc(token)}</span>` : KEYWORDS.has(token) ? `<span class="cv-type-keyword">${esc(token)}</span>` : esc(token);
        }).join("") + "</pre>";
        this.typeBox.hidden = false;
        const view = this.typeBox.parentElement.getBoundingClientRect();
        const stage = this.svg.getBoundingClientRect();
        const scale = stage.width / this.g.width;
        const box = this.typeBox;
        const left = stage.left - view.left + (hit.x + hit.w / 2) * scale - box.offsetWidth / 2;
        const top = stage.top - view.top + hit.y * scale - box.offsetHeight - 6;
        box.style.left = `${Math.max(4, Math.min(view.width - box.offsetWidth - 4, left))}px`;
        box.style.top = `${top >= 4 ? top : stage.top - view.top + (hit.y + hit.h) * scale + 6}px`;
      }
    }
    theme() {
      this.root.dataset.cvTheme = themeName();
      const style = getComputedStyle(this.root);
      const read = (name) => style.getPropertyValue("--cv-" + name).trim();
      const P = { outputLabel: this.S.output };
      for (const name of PALETTE) {
        const camel = name.replace(/-(\w)/g, (_, ch) => ch.toUpperCase());
        P[camel] = read(name) || "#808080";
      }
      P.vars = Array.from({ length: VARIABLE_COLOURS }, (_, i) => read("var-" + i) || "#808080");
      P.fields = Array.from({ length: FIELD_COLOURS }, (_, i) => read("field-" + i) || "#808080");
      P.types = Array.from({ length: TYPE_COLOURS }, (_, i) => read("type-" + i) || "#808080");
      this.P = P;
      this.layoutWidth = void 0;
    }
    refresh() {
      this.theme();
      this.render(this.animated);
      if (this.animated) this.seek(this.elapsed);
    }
    render(animate) {
      var _a, _b, _c, _d, _e;
      const width = this.root.clientWidth;
      if (width !== this.layoutWidth) {
        this.stacked = width > 0 && width < (((_a = this.hooks) == null ? void 0 : _a.stackBelow) ?? STACK_BELOW);
        this.g = ((_b = this.hooks) == null ? void 0 : _b.geometry) ? this.hooks.geometry(this.m, this.P, this.stacked, width) : geometry(this.m, this.P, this.stacked, width);
        this.layoutWidth = width;
        this.shownType = null;
        this.typeBox.hidden = true;
      }
      const steps = this.m.steps;
      const step = steps[this.index];
      const prev = this.index ? steps[this.index - 1] : null;
      const g = this.g;
      const now = activeVariables(this.m, this.index);
      const before = animate && this.index ? activeVariables(this.m, this.index - 1) : now;
      const begin = /* @__PURE__ */ new Map();
      if (animate && step.op && step.op.kind === "deref") {
        begin.set(step.op.target.split(".")[0], arrival(step.op) - 0.15);
      }
      const c = {
        m: this.m,
        g,
        P: this.P,
        S: this.S,
        index: this.index,
        step,
        prev,
        animate,
        op: animate ? step.op : null,
        focus: { now, before, begin }
      };
      this.animated = animate;
      this.svg.setAttribute("viewBox", `0 0 ${Math.ceil(g.width)} ${Math.ceil(g.height)}`);
      this.svg.style.maxWidth = `${Math.ceil(g.width * (((_c = this.hooks) == null ? void 0 : _c.maxScale) ?? MAX_SCALE))}px`;
      const body = ((_d = this.hooks) == null ? void 0 : _d.scene) ? this.hooks.scene(c) : scene(c);
      this.scene.innerHTML = `<rect width="100%" height="100%" fill="${this.P.bg}"/>` + body;
      placeLineTargets(g, this.lines);
      this.finishPaths();
      this.seek(0);
      this.update(((_e = this.hooks) == null ? void 0 : _e.describe) ? this.hooks.describe(c) : describe(c));
    }
    finishPaths() {
      for (const path of this.scene.querySelectorAll(
        "[data-grow],[data-follow]"
      )) {
        const length = path.getTotalLength();
        const grow = path.dataset.grow !== void 0;
        const begin = Number(grow ? path.dataset.grow : path.dataset.follow);
        const dur = grow ? 0.6 : T.follow;
        path.setAttribute("stroke-dasharray", `${length} ${length}`);
        path.setAttribute("stroke-dashoffset", String(length));
        const add = (attributes) => {
          const animation = document.createElementNS(this.svg.namespaceURI, "animate");
          for (const [key, value] of Object.entries(attributes)) {
            animation.setAttribute(key, String(value));
          }
          path.append(animation);
        };
        add({
          attributeName: "stroke-dashoffset",
          from: length,
          to: 0,
          begin: begin + "s",
          dur: dur + "s",
          calcMode: "spline",
          keyTimes: "0;1",
          keySplines: "0.4 0 0.2 1",
          fill: "freeze"
        });
        if (!grow) {
          add({
            attributeName: "opacity",
            from: 1,
            to: 0,
            begin: begin + dur + 0.25 + "s",
            dur: "0.4s",
            fill: "freeze"
          });
        }
      }
    }
    seek(seconds) {
      this.svg.pauseAnimations();
      this.svg.setCurrentTime(seconds);
    }
    update(description) {
      const last = this.m.steps.length - 1;
      this.playButton.querySelector(".cv-icon").outerHTML = icon(this.running ? "pause" : "play");
      const label = this.running ? this.S.pause : this.S.play;
      this.playButton.querySelector(".cv-label").textContent = label;
      this.playButton.setAttribute("aria-label", label);
      this.playButton.title = label;
      for (const [action, disabled] of [
        ["back", this.index === 0],
        ["next", this.index === last]
      ]) {
        const button = this.root.querySelector(`[data-action=${action}]`);
        if (disabled && document.activeElement === button) {
          this.root.focus({ preventScroll: true });
        }
        button.disabled = disabled;
      }
      this.scrub.value = String(this.index);
      this.count.textContent = `${this.index + 1} / ${last + 1}`;
      if (description !== void 0 && this.status.textContent !== description) {
        this.status.textContent = description;
      }
    }
    settle(index) {
      this.stop();
      this.continuous = false;
      this.index = Math.max(0, Math.min(this.m.steps.length - 1, index));
      this.elapsed = this.duration = 0;
      this.render(false);
    }
    start(index, autoplay = false) {
      var _a;
      this.stop();
      this.pristine = false;
      this.continuous = autoplay;
      this.index = index;
      this.elapsed = 0;
      this.duration = ((_a = this.hooks) == null ? void 0 : _a.stepSeconds) ? this.hooks.stepSeconds(this.m.steps, index) : stepSeconds(this.m.steps, index);
      this.render(true);
      if (this.duration > 0 || autoplay) this.resume();
    }
    resume() {
      this.running = true;
      this.last = performance.now();
      this.update();
      if (!this.frame) this.frame = requestAnimationFrame((now) => this.tick(now));
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
    disconnect() {
      var _a;
      this.pause();
      (_a = this.observer) == null ? void 0 : _a.disconnect();
      this.observer = null;
    }
    tick(now) {
      this.frame = 0;
      if (!this.running) return;
      this.elapsed = Math.min(
        this.duration,
        this.elapsed + (now - this.last) / 1e3 * this.rate
      );
      this.last = now;
      if (this.animated) this.seek(this.elapsed);
      if (this.elapsed < this.duration) {
        this.frame = requestAnimationFrame((time) => this.tick(time));
        return;
      }
      this.running = false;
      if (this.continuous && this.index < this.m.steps.length - 1) {
        this.start(this.index + 1, true);
      } else {
        this.continuous = false;
        this.render(false);
        this.elapsed = this.duration;
        this.update();
      }
    }
    get finished() {
      return this.elapsed >= this.duration;
    }
    play() {
      if (this.running) return this.pause();
      const last = this.m.steps.length - 1;
      if (this.pristine || this.index === last && this.finished) {
        this.start(0, true);
      } else if (this.finished) {
        this.start(this.index + 1, true);
      } else {
        this.continuous = true;
        this.resume();
      }
    }
    next() {
      if (this.index < this.m.steps.length - 1) this.start(this.index + 1);
    }
    back() {
      this.pristine = false;
      this.settle(this.index - 1);
    }
    replay() {
      this.start(this.index);
    }
    reset() {
      this.pristine = true;
      this.settle(0);
    }
    end() {
      this.pristine = false;
      this.settle(this.m.steps.length - 1);
    }
    line(line) {
      const index = this.m.steps.findIndex((step) => step.line === line);
      if (index >= 0) {
        this.pristine = false;
        this.settle(index);
      }
    }
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
  function typeInfo(typeName) {
    const clean = (typeName ?? "int").replace(/^const\s+/, "").replace(/^std::/, "").trim();
    const table = {
      int8_t: { bytes: 1, bits: 8, signed: true },
      "signed char": { bytes: 1, bits: 8, signed: true },
      uint8_t: { bytes: 1, bits: 8, signed: false },
      "unsigned char": { bytes: 1, bits: 8, signed: false },
      int16_t: { bytes: 2, bits: 16, signed: true },
      short: { bytes: 2, bits: 16, signed: true },
      "short int": { bytes: 2, bits: 16, signed: true },
      uint16_t: { bytes: 2, bits: 16, signed: false },
      "unsigned short": { bytes: 2, bits: 16, signed: false },
      int32_t: { bytes: 4, bits: 32, signed: true },
      int: { bytes: 4, bits: 32, signed: true },
      uint32_t: { bytes: 4, bits: 32, signed: false },
      "unsigned int": { bytes: 4, bits: 32, signed: false },
      unsigned: { bytes: 4, bits: 32, signed: false },
      int64_t: { bytes: 8, bits: 64, signed: true },
      long: { bytes: 8, bits: 64, signed: true },
      "long long": { bytes: 8, bits: 64, signed: true },
      uint64_t: { bytes: 8, bits: 64, signed: false },
      "unsigned long": { bytes: 8, bits: 64, signed: false },
      "unsigned long long": { bytes: 8, bits: 64, signed: false },
      size_t: { bytes: 8, bits: 64, signed: false }
    };
    return table[clean] ?? { bytes: 4, bits: 32, signed: true };
  }
  function toBytesMSB(value, bytes) {
    const unsigned = BigInt.asUintN(bytes * 8, BigInt(value));
    const out = [];
    for (let i = bytes - 1; i >= 0; i--) {
      out.push(Number(unsigned >> BigInt(i * 8) & 0xffn));
    }
    return out;
  }
  function toBytesLSB(value, bytes) {
    return toBytesMSB(value, bytes).reverse();
  }
  const hexByte = (b) => b.toString(16).toUpperCase().padStart(2, "0");
  const nibbles = (b) => [
    (b >> 4).toString(2).padStart(4, "0"),
    (b & 15).toString(2).padStart(4, "0")
  ];
  const fullHex = (value, bytes) => "0x" + toBytesMSB(value, bytes).map(hexByte).join("");
  function extractInt(fragment) {
    var _a;
    const inner = ((_a = fragment.match(/\(([^()]+)\)\s*$/)) == null ? void 0 : _a[1]) ?? fragment;
    const match = inner.match(/-?\d+/);
    return match ? Number.parseInt(match[0], 10) : null;
  }
  function activeBitAction(c) {
    var _a, _b, _c;
    const { step, prev, m } = c;
    const op = step.op;
    if ((op == null ? void 0 : op.kind) === "convert") {
      const beforeRaw = prev ? prev.pane.slice(...op.span) : op.value;
      const beforeVal = extractInt(beforeRaw) ?? Number.parseInt(op.value, 10);
      const afterVal = Number.parseInt(op.value, 10);
      const fromInfo = typeInfo(op.from);
      const toInfo = typeInfo(op.to);
      let kind = "reinterpret";
      if (toInfo.bytes < fromInfo.bytes) kind = "narrow";
      else if (toInfo.bytes > fromInfo.bytes) {
        kind = fromInfo.signed && beforeVal < 0 ? "sign-extend" : "zero-extend";
      }
      return { kind, fromType: op.from, toType: op.to, fromInfo, toInfo, beforeVal, afterVal };
    }
    if ((op == null ? void 0 : op.kind) === "eval" && prev) {
      const raw = prev.pane.slice(...op.span);
      if (/^\s*~\s*-?\d+\s*$/.test(raw)) {
        const beforeVal = extractInt(raw) ?? 0;
        const afterVal = Number.parseInt(op.value, 10);
        const type = ((_b = (_a = step.types) == null ? void 0 : _a.find((t) => !t.slot && t.span[0] === op.span[0])) == null ? void 0 : _b.type) ?? "int";
        return { kind: "invert", type, info: typeInfo(type), beforeVal, afterVal };
      }
    }
    if (op && (op.kind === "read" || op.kind === "write")) {
      const num = /^-?\d+$/.test(op.value) ? Number.parseInt(op.value, 10) : null;
      if (num !== null) {
        const variable = m.leaves.find((l) => l.name === op.name);
        const type = (variable == null ? void 0 : variable.type) ?? "int";
        return {
          kind: "value",
          label: op.kind === "write" ? `${op.name} = ${num}` : op.name,
          type,
          info: typeInfo(type),
          value: num
        };
      }
    }
    const lit = (_c = step.types) == null ? void 0 : _c.find((t) => !t.slot);
    if (lit) {
      const slice = step.pane.slice(...lit.span);
      if (/^-?\d+$/.test(slice)) {
        return {
          kind: "value",
          label: slice,
          type: lit.type,
          info: typeInfo(lit.type),
          value: Number.parseInt(slice, 10)
        };
      }
    }
    return null;
  }
  function isBitwiseInvert(steps, i) {
    var _a;
    const step = steps[i];
    if (((_a = step.op) == null ? void 0 : _a.kind) !== "eval" || i === 0) return false;
    return /^\s*~\s*-?\d+\s*$/.test(steps[i - 1].pane.slice(...step.op.span));
  }
  function castStepSeconds(steps, i) {
    var _a;
    const step = steps[i];
    if (((_a = step.op) == null ? void 0 : _a.kind) === "convert" || isBitwiseInvert(steps, i)) {
      return step.hold + 2.1;
    }
    return stepSeconds(steps, i);
  }
  function castDescribe(c) {
    var _a;
    const act = activeBitAction(c);
    if (act && ((_a = c.step.op) == null ? void 0 : _a.kind) === "convert") {
      if (act.kind === "narrow") {
        return `Narrow ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): drop high ${act.fromInfo.bytes - act.toInfo.bytes} bytes`;
      }
      if (act.kind === "zero-extend") {
        return `Widen ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): zero-extend upper bytes`;
      }
      if (act.kind === "sign-extend") {
        return `Widen ${act.fromType} (${fullHex(act.beforeVal, act.fromInfo.bytes)}) → ${act.toType} (${fullHex(act.afterVal, act.toInfo.bytes)}): sign-extend by duplicating bit 1`;
      }
    }
    return describe(c);
  }
  function drawTypeLabels(c, live) {
    const { g, P } = c;
    let out = "";
    for (const label of g.typeLabels) {
      const on = g.cellsOf(label.name).some(live);
      const color = on ? typeColour(c, label.type) : P.deadStroke;
      out += dim(c, label.name, typeLabel(c, label.cx, label.top, label.type, 18, color));
    }
    return out;
  }
  function memoryWithByteHex(c, style) {
    const { g, P, step, prev, op } = c;
    const values = op && op.kind === "write" && prev ? prev.values : step.values;
    const at = op ? arrival(op) : 0;
    const writing = new Set(op && op.kind === "write" ? g.cellsOf(op.name).map((l) => l.name) : []);
    const live = (l) => values[l.name] !== null || writing.has(l.name);
    let out = "";
    for (const cell of g.leaves) {
      const on = live(cell);
      const changing = writing.has(cell.name);
      const color = cell.fieldColor || cell.color;
      const before = prev ? prev.values[cell.name] : null;
      const after = step.values[cell.name];
      const shownVal = changing ? after : values[cell.name];
      let markup = "";
      markup += text(cell.x + 3, cell.y - 12, cell.address, 17, on ? P.muted : P.grey);
      if (style.littleEndian && cell.size > 1) {
        const bw2 = cell.w / cell.size;
        for (let i = 1; i < cell.size; i++) {
          markup += text(cell.x + i * bw2 + 6, cell.y - 12, cell.address + i, 15, P.grey);
        }
      }
      markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, "none", 0);
      const bw = cell.w / cell.size;
      const divStroke = on ? P.gapStroke : P.deadStroke;
      if (style.decimalBelow) {
        for (let i = 1; i < cell.size; i++) {
          const lx = round(cell.x + i * bw);
          markup += `<line x1="${lx}" y1="${cell.y + 3}" x2="${lx}" y2="${cell.y + cell.h - 3}" stroke="${divStroke}" stroke-width="1.3" stroke-dasharray="4 3"/>`;
        }
      } else {
        const splitY = cell.y + 56;
        markup += `<line x1="${cell.x + 2}" y1="${splitY}" x2="${cell.x + cell.w - 2}" y2="${splitY}" stroke="${divStroke}" stroke-width="1.3"/>`;
        for (let i = 1; i < cell.size; i++) {
          const lx = round(cell.x + i * bw);
          markup += `<line x1="${lx}" y1="${splitY}" x2="${lx}" y2="${cell.y + cell.h - 2}" stroke="${divStroke}" stroke-width="1.3"/>`;
        }
      }
      markup += rect(
        cell.x + 1.5,
        cell.y + 1.5,
        cell.w - 3,
        cell.h - 3,
        "none",
        on ? color : P.deadStroke,
        0,
        3
      );
      if (style.littleEndian && on && cell.size > 1) {
        const lsbY = style.decimalBelow ? cell.y + 16 : cell.y + 14;
        markup += text(cell.x + 7, lsbY, "LSB", 11.5, P.grey);
        markup += text(cell.x + cell.w - 7, lsbY, "MSB", 11.5, P.grey, "end");
      }
      if (on) {
        const bytesOf = (v) => style.littleEndian ? toBytesLSB(v, cell.size) : toBytesMSB(v, cell.size);
        const renderCellBody = (val) => {
          if (typeof val !== "number") {
            if (style.decimalBelow) {
              return text(cell.x + cell.w / 2, cell.y + cell.h / 2 + 10, String(val), 28, P.grey, "middle");
            }
            return text(cell.x + cell.w / 2, cell.y + 38, String(val), 28, P.grey, "middle");
          }
          const bytes = bytesOf(val);
          let body = "";
          if (!style.decimalBelow) {
            const dec = String(val);
            const decSize = Math.min(30, (cell.w - 14) / (dec.length * CHAR));
            body += text(cell.x + cell.w / 2, cell.y + 38, dec, round(decSize), P.fg, "middle");
          }
          const hexY = style.decimalBelow ? cell.y + cell.h / 2 + 9 : cell.y + 85;
          const hexSize = style.decimalBelow ? 24 : 20;
          for (let i = 0; i < cell.size; i++) {
            const bx = cell.x + i * bw + bw / 2;
            const b = bytes[i];
            body += text(bx, hexY, hexByte(b), hexSize, b !== 0 ? color : P.muted, "middle");
          }
          return body;
        };
        const cx = cell.x + cell.w / 2;
        const cy = cell.y + cell.h / 2;
        if (changing && before !== after) {
          markup += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(at - 0.2)}<g transform="translate(${round(-cx)} ${round(-cy)})">`;
          if (before !== null) markup += `<g>${hide(at)}${renderCellBody(before)}</g>`;
          markup += `<g opacity="0">${show(at)}${renderCellBody(after)}</g>`;
          markup += "</g></g></g>";
        } else {
          markup += renderCellBody(shownVal);
        }
      }
      markup += text(
        cell.x + cell.w / 2,
        cell.y + cell.h + 34,
        cell.label,
        g.nameSize,
        on ? color : P.grey,
        "middle"
      );
      if (style.decimalBelow) {
        const decLabel = on && typeof shownVal === "number" ? `= ${shownVal}` : on && shownVal === "?" ? "= ?" : "";
        if (decLabel) {
          markup += text(
            cell.x + cell.w / 2,
            cell.y + cell.h + 62,
            decLabel,
            20,
            on ? P.fg : P.grey,
            "middle"
          );
        }
      }
      out += dim(c, cell.group || cell.name, markup);
    }
    return out + drawTypeLabels(c, live);
  }
  const BYTE_W = 96;
  const BYTE_GAP = 16;
  const NIBBLE_W = 44;
  const NIB_GAP = 8;
  const BIT_FONT = 18;
  const BIT_STEP = BIT_FONT * CHAR;
  function drawLab3ByteColumn(x, yBits, yHex, byteVal, bitColor, hexColor, mutedColor, signBitHighlight) {
    const [hi, lo] = nibbles(byteVal);
    const hex = hexByte(byteVal);
    const hiCx = x + NIBBLE_W / 2;
    const loCx = x + NIBBLE_W + NIB_GAP + NIBBLE_W / 2;
    let bitsMarkup = "";
    if (signBitHighlight) {
      const signBitCx = hiCx - 1.55 * BIT_STEP;
      const restCx = hiCx + 0.55 * BIT_STEP;
      bitsMarkup += rect(signBitCx - 6.2, yBits - 18, 12.4, 23, signBitHighlight.fill, signBitHighlight.stroke, 3.5, 1.8) + text(signBitCx, yBits, hi[0], BIT_FONT, signBitHighlight.text, "middle") + text(restCx, yBits, hi.slice(1), BIT_FONT, hi === "0000" ? mutedColor : bitColor, "middle");
    } else {
      bitsMarkup += text(hiCx, yBits, hi, BIT_FONT, hi === "0000" ? mutedColor : bitColor, "middle");
    }
    return bitsMarkup + text(loCx, yBits, lo, BIT_FONT, lo === "0000" ? mutedColor : bitColor, "middle") + text(hiCx, yHex, hex[0], 20, hex[0] === "0" ? mutedColor : hexColor, "middle") + text(loCx, yHex, hex[1], 20, hex[1] === "0" ? mutedColor : hexColor, "middle");
  }
  function arrowheadDown(cx, tipY, color) {
    return `<polygon points="${round(cx)},${round(tipY)} ${round(cx - 4.5)},${round(tipY - 7)} ${round(cx + 4.5)},${round(tipY - 7)}" fill="${color}"/>`;
  }
  function workbenchClean(c, signExtStyle) {
    const act = activeBitAction(c);
    if (!act) return "";
    const { g, P, animate } = c;
    const cardX = g.tx - 6;
    const cardY = g.ty + 22;
    const cardW = g.pane.w - 36;
    const cardH = 104;
    const yBits = cardY + 50;
    const yHex = cardY + 82;
    const yRes = cardY + 64;
    const rightAnchor = cardX + 16 + 4 * BYTE_W + 3 * BYTE_GAP;
    const slotX = (bytesFromLSB) => rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;
    let out = rect(cardX, cardY, cardW, cardH, P.panel, P.gapStroke, 8, 1.5);
    if (act.kind === "narrow" || act.kind === "zero-extend" || act.kind === "sign-extend" || act.kind === "reinterpret") {
      const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.bytes);
      const toBytes = toBytesMSB(act.afterVal, act.toInfo.bytes);
      const fromCol = typeColour(c, act.fromType);
      const toCol = typeColour(c, act.toType);
      if (act.kind === "narrow") {
        const cutX = slotX(toBytes.length - 1) - BYTE_GAP / 2;
        for (let idx = 0; idx < fromBytes.length; idx++) {
          const lsbPos = fromBytes.length - 1 - idx;
          const bx = slotX(lsbPos);
          const dropped = lsbPos >= toBytes.length;
          if (dropped) {
            const settled = `<g opacity="0.48">` + drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.error, P.error, P.error) + `<line x1="${bx + 6}" y1="${yBits - 16}" x2="${bx + BYTE_W - 6}" y2="${yHex + 6}" stroke="${P.error}" stroke-width="2"/></g>`;
            if (animate) {
              out += `<g>${hide(0.55)}${drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, fromCol, P.muted)}</g><g opacity="0">${show(0.55)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="0.55s" dur="0.35s" fill="freeze"/>${settled}</g>`;
            } else {
              out += settled;
            }
          } else {
            out += drawLab3ByteColumn(bx, yBits, yHex, fromBytes[idx], P.fg, toCol, toCol);
          }
        }
        out += `<line x1="${round(cutX)}" y1="${cardY + 14}" x2="${round(cutX)}" y2="${cardY + cardH - 12}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`;
        out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
      } else if (act.kind === "sign-extend") {
        const srcTopPos = fromBytes.length - 1;
        const srcX = slotX(srcTopPos);
        const signBitCx = srcX + NIBBLE_W / 2 - 1.5 * BIT_STEP;
        for (let idx = 0; idx < fromBytes.length; idx++) {
          const lsbPos = fromBytes.length - 1 - idx;
          const bx = slotX(lsbPos);
          const isTopSrc = lsbPos === srcTopPos;
          const col = drawLab3ByteColumn(
            bx,
            yBits,
            yHex,
            fromBytes[idx],
            P.fg,
            toCol,
            P.muted,
            isTopSrc ? { fill: P.writeFill, stroke: P.write, text: P.write } : void 0
          );
          if (animate && isTopSrc) {
            const cx = signBitCx;
            const cy = yBits - 6;
            out += `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(0.1)}<g transform="translate(${round(-cx)} ${round(-cy)})">${col}</g></g></g>`;
          } else {
            out += col;
          }
        }
        for (let lsbPos = fromBytes.length; lsbPos < toBytes.length; lsbPos++) {
          const bx = slotX(lsbPos);
          const byteVal = toBytes[toBytes.length - 1 - lsbPos];
          const dstCx = bx + BYTE_W / 2;
          const k = lsbPos - fromBytes.length;
          const arcDelay = 0.25 + k * 0.24;
          const fillDelay = 0.58 + k * 0.24;
          const extByte = drawLab3ByteColumn(bx, yBits, yHex, byteVal, P.write, P.write, P.write);
          if (signExtStyle === "arcs") {
            const sy = yBits - 21;
            const apex = cardY + 9 + k * 2;
            const d = `M ${round(signBitCx)} ${sy} C ${round(signBitCx)} ${apex}, ${round(dstCx)} ${apex}, ${round(dstCx)} ${sy - 2}`;
            const arc = `<path d="${d}" fill="none" stroke="${P.write}" stroke-width="2" stroke-linecap="round"${animate ? ` data-grow="${round(arcDelay)}"` : ""}/>`;
            const head = arrowheadDown(dstCx, sy + 1, P.write);
            out += arc;
            out += animate ? `<g opacity="0">${show(fillDelay - 0.08)}${head}</g>` : head;
          } else {
            const prevOriginX = k === 0 ? signBitCx : slotX(lsbPos - 1) + NIBBLE_W / 2 - 1.5 * BIT_STEP;
            const dstLeftBitX = bx + NIBBLE_W / 2 - 1.5 * BIT_STEP;
            const yTop = cardY + 18;
            const d = `M ${round(prevOriginX)} ${yBits - 21} L ${round(prevOriginX)} ${yTop} L ${round(dstLeftBitX)} ${yTop} L ${round(dstLeftBitX)} ${yBits - 23}`;
            const link = `<path d="${d}" fill="none" stroke="${P.write}" stroke-width="2" stroke-linejoin="round"${animate ? ` data-grow="${round(arcDelay)}"` : ""}/>`;
            const head = arrowheadDown(dstLeftBitX, yBits - 20, P.write);
            out += link;
            out += animate ? `<g opacity="0">${show(fillDelay - 0.08)}${head}</g>` : head;
          }
          if (animate) {
            out += `<g opacity="0">${show(fillDelay)}<g transform="translate(${round(dstCx)} ${round(yBits + 10)})"><g>${pulse(fillDelay)}<g transform="translate(${round(-dstCx)} ${round(-(yBits + 10))})">${extByte}</g></g></g></g>`;
          } else {
            out += extByte;
          }
        }
        out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
      } else if (act.kind === "zero-extend") {
        for (let idx = 0; idx < toBytes.length; idx++) {
          const lsbPos = toBytes.length - 1 - idx;
          const bx = slotX(lsbPos);
          const isExt = lsbPos >= fromBytes.length;
          const isSignedPosTop = act.fromInfo.signed && lsbPos === fromBytes.length - 1;
          const block = drawLab3ByteColumn(
            bx,
            yBits,
            yHex,
            toBytes[idx],
            isExt ? P.grey : P.fg,
            isExt ? P.grey : toCol,
            P.muted,
            isSignedPosTop ? { fill: P.panel, stroke: P.muted, text: P.fg } : void 0
          );
          if (animate && isExt) {
            out += `<g opacity="0">${fade(0, 0.72, 0.35, 0.3)}${block}</g>`;
          } else if (isExt) {
            out += `<g opacity="0.72">${block}</g>`;
          } else {
            out += block;
          }
        }
        out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
      } else {
        for (let idx = 0; idx < toBytes.length; idx++) {
          const lsbPos = toBytes.length - 1 - idx;
          out += drawLab3ByteColumn(slotX(lsbPos), yBits, yHex, toBytes[idx], P.fg, toCol, P.muted);
        }
        out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, toCol);
      }
      return out;
    }
    if (act.kind === "invert") {
      const beforeBytes = toBytesMSB(act.beforeVal, act.info.bytes);
      const afterBytes = toBytesMSB(act.afterVal, act.info.bytes);
      for (let idx = 0; idx < afterBytes.length; idx++) {
        const bx = slotX(afterBytes.length - 1 - idx);
        const afterBlock = drawLab3ByteColumn(bx, yBits, yHex, afterBytes[idx], P.write, P.write, P.muted);
        if (animate) {
          out += `<g>${hide(0.45)}${drawLab3ByteColumn(bx, yBits, yHex, beforeBytes[idx], P.fg, P.fg, P.muted)}</g><g opacity="0">${show(0.45)}${afterBlock}</g>`;
        } else {
          out += afterBlock;
        }
      }
      out += text(rightAnchor + 22, yRes, `→ ${act.afterVal}`, 26, P.write);
      return out;
    }
    if (act.kind === "value") {
      const bytes = toBytesMSB(act.value, act.info.bytes);
      const col = typeColour(c, act.type);
      for (let idx = 0; idx < bytes.length; idx++) {
        const bx = slotX(bytes.length - 1 - idx);
        out += drawLab3ByteColumn(bx, yBits, yHex, bytes[idx], P.fg, col, P.muted);
      }
      out += text(rightAnchor + 22, yRes, `= ${act.value}`, 26, col);
    }
    return out;
  }
  function hooksFor(variant) {
    const memoryOpts = {
      A: { littleEndian: true, decimalBelow: false },
      B: { littleEndian: false, decimalBelow: false },
      C: { littleEndian: false, decimalBelow: true }
    };
    const geomOpts = {
      A: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 98, extraPaneHeight: 112, skipWrap: true },
      B: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 98, extraPaneHeight: 112, skipWrap: true },
      C: { minByteWidth: 66, minColumnWidth: 680, cellHeight: 78, extraMemBottom: 34, extraPaneHeight: 112, skipWrap: true }
    };
    return {
      stackBelow: 900,
      maxScale: 0.78,
      geometry: (m, P, stacked, width) => geometry(m, P, stacked, width, geomOpts[variant]),
      stepSeconds: castStepSeconds,
      describe: castDescribe,
      scene: (c) => {
        const { step, prev, animate } = c;
        const lineChanged = animate && prev !== null && prev.line !== step.line;
        const copying = animate && copies(c.m.steps, c.index);
        const oldLine = lineChanged && prev ? prev.line : null;
        return code(c, oldLine) + tether(c, oldLine) + arrows(c) + memoryWithByteHex(c, memoryOpts[variant]) + pane(c, copying) + workbenchClean(c, variant === "C" ? "cascade" : "arcs") + output(c) + transfers(c);
      }
    };
  }
  const VARIANTS = {
    A: {
      name: "Little-endian byte hex + arc sign-clone",
      claim: "Two-tier memory in true address order (LSB left at +0) paired with the clean binary/hex pane and sign-bit duplication arcs.",
      points: [
        "Memory shows overall decimal on top and consecutive address-ordered hex bytes (+0..+3) along the bottom.",
        "Pane keeps binary nibbles above hex digits with no caption clutter and no duplicate hex under the decimal result.",
        "Negative signed widening highlights the MSB `1` and clones it via warm arcs across upper bytes; positive/unsigned fills muted `0`s."
      ]
    },
    B: {
      name: "MSB-first byte hex + arc sign-clone",
      claim: "Two-tier memory in reading order (matching the binary/hex workbench left-to-right), clean pane, and sign-bit duplication arcs.",
      points: [
        "Memory shows overall decimal on top and per-byte hex compartments underneath (`00 | 00 | 01 | 00`).",
        "Pane drops the tiny text and duplicate hex under `→ val`, keeping binary nibbles paired with hex digits directly below.",
        "Sign extension highlights the highest `1` bit and draws cloning arcs filling `1111 1111` (`F F`) across upper bytes; positive/unsigned quietly zero-fills."
      ]
    },
    C: {
      name: "Hex cells + cascade sign-clone",
      claim: "Full-height byte-hex memory cells with `= decimal` below the variable name, plus stepped cascade cloning for sign extension.",
      points: [
        "Memory gives full box height to per-byte hex compartments and puts the overall `= decimal` cleanly under the variable name.",
        "Compare stepped byte-by-byte cascade cloning on negative sign extension against B’s curved arcs.",
        "Same clean binary/hex pane without caption text or duplicate hex under the decimal result."
      ]
    }
  };
  function boot() {
    var _a;
    const data = ((_a = window.CastsPrototype) == null ? void 0 : _a.traces) ?? [];
    const params = new URLSearchParams(location.search);
    const rawVar = (params.get("variant") || "B").toUpperCase();
    const state = {
      variant: rawVar === "A" || rawVar === "B" || rawVar === "C" ? rawVar : "B"
    };
    document.documentElement.dataset.theme = params.get("theme") || "dark";
    const about = document.getElementById("about");
    const sections = document.getElementById("sections");
    const label = document.getElementById("label");
    const players = [];
    sections.innerHTML = data.map(
      (t, i) => `<section class="proto-case"><h2>${i + 1}. ${esc(t.title ?? "")}</h2><pre><code>${esc(t.source.join("\n"))}</code></pre><details data-case="${i}"${i <= 1 || params.get("open") === "all" ? " open" : ""}><summary>Execution trace</summary><div class="slot"></div></details></section>`
    ).join("");
    function mount() {
      const savedIndices = /* @__PURE__ */ new Map();
      for (const details of sections.querySelectorAll("details")) {
        const idx = Number(details.dataset.case);
        const old = players[idx];
        if (old) {
          savedIndices.set(idx, old.index);
          old.disconnect();
        }
      }
      players.length = 0;
      for (const details of sections.querySelectorAll("details")) {
        const idx = Number(details.dataset.case);
        const slot = details.querySelector(".slot");
        slot.innerHTML = '<div class="course-visualization"></div>';
        const host = slot.firstElementChild;
        const player = new Player(host, data[idx], hooksFor(state.variant));
        const want = savedIndices.get(idx);
        if (want) {
          player.pristine = false;
          player.settle(want);
        }
        players[idx] = player;
      }
      const meta = VARIANTS[state.variant];
      label.textContent = `${state.variant} · ${meta.name}`;
      about.innerHTML = `<h3>${state.variant}. ${esc(meta.name)}</h3><p>${esc(meta.claim)}</p><ul>${meta.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
      const url = new URL(location.href);
      url.searchParams.set("variant", state.variant);
      url.searchParams.set("theme", document.documentElement.dataset.theme || "dark");
      history.replaceState(null, "", url);
    }
    sections.addEventListener(
      "toggle",
      (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.open) return;
        const idx = Number(details.dataset.case);
        requestAnimationFrame(() => {
          var _a2;
          return (_a2 = players[idx]) == null ? void 0 : _a2.refresh();
        });
      },
      true
    );
    const cycle = (delta) => {
      const keys = ["A", "B", "C"];
      state.variant = keys[(keys.indexOf(state.variant) + delta + keys.length) % keys.length];
      mount();
    };
    document.getElementById("prev").onclick = () => cycle(-1);
    document.getElementById("next").onclick = () => cycle(1);
    document.getElementById("theme").onclick = () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      for (const p of players) p.refresh();
      const url = new URL(location.href);
      url.searchParams.set("theme", root.dataset.theme);
      history.replaceState(null, "", url);
    };
    document.addEventListener("keydown", (event) => {
      var _a2;
      if ((_a2 = event.target) == null ? void 0 : _a2.matches("input, textarea, select, [contenteditable]")) return;
      if (event.key === "[") cycle(-1);
      if (event.key === "]") cycle(1);
    });
    mount();
  }
  if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})();
