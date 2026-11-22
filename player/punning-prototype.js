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
    // How long an operator shows lit before the first of its operands' conversions starts.
    operator: 0.6,
    clash: 1.6,
    // Instant playback: how long each settled state shows before the next.
    instantHold: 0.8
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
      instant: "Instant",
      byteOrder: "Memory byte order",
      littleEndian: "Little-endian (least significant byte first)",
      bigEndian: "Big-endian (most significant byte first)",
      littleEndianShort: "Little-endian",
      bigEndianShort: "Big-endian",
      scrub: "Execution step",
      output: "Output:",
      stage: "Code, memory and expression evaluation",
      jump: "Jump to line {line}: {code}",
      copy: "Line {line}: {code}",
      read: "Read {name}: {value}",
      compound: "Read {name}: {value}; {name} {compound}= … becomes {name} = {value} {compound} …",
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
      instant: "Мгновенно",
      byteOrder: "Порядок байтов в памяти",
      littleEndian: "Little-endian (младший байт первым)",
      bigEndian: "Big-endian (старший байт первым)",
      littleEndianShort: "Little-endian",
      bigEndianShort: "Big-endian",
      scrub: "Шаг выполнения",
      output: "Вывод:",
      stage: "Код, память и вычисление выражения",
      jump: "Перейти к строке {line}: {code}",
      copy: "Строка {line}: {code}",
      read: "Чтение {name}: {value}",
      compound: "Чтение {name}: {value}; {name} {compound}= … превращается в {name} = {value} {compound} …",
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
    const str = Object.is(value, -0) ? "-0" : String(value);
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
  const labelWidth$1 = (c) => String(c.address).length * 16 * CHAR;
  const labelCentre = (c) => [
    c.x + 3 + labelWidth$1(c) / 2,
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
      const clearance = cell.x + 3 + labelWidth$1(cell) + 14;
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
    const gaps2 = [];
    let row = 0;
    const unused = (x2, bytes) => {
      if (bytes > 0) gaps2.push([x2, bytes * byte, row]);
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
    return { spans, gaps: gaps2, width };
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
    const besideCode = stacked || !Number.isFinite(canvasBudget) ? 0 : canvasBudget - unwrapped.width - COLUMN_GAP - 2 * MARGIN;
    const widest = Math.max(minByteWidth, m.leaves.some((leaf) => leaf.size < 4) ? NARROW_BYTE : MAX_BYTE);
    const rise = m.rise;
    const structs = m.groups.length > 0;
    const paneChars = Math.max(...m.steps.map((step) => step.pane.length));
    const finalStdout = m.steps[m.steps.length - 1].stdout;
    const outputLines = finalStdout ? finalStdout.replace(/\n$/, "").split("\n") : [];
    const outputChars = Math.max(0, ...outputLines.map((line) => line.length));
    const canWrap = !stacked && !options.skipWrap && m.tops.length > 1 && !m.typed && m.references.length === 0 && m.steps.every((step) => Object.keys(step.targets).length === 0);
    const pitch = (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + rise * RISE.bottom + (structs ? FRAME.top : 0) + 30 + rise * RISE.top;
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
      const byte = byteFor(Math.max(MEMORY_WIDTH, others - 48, besideCode - 48));
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
    const named = (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + rise * RISE.bottom + tagged.height + (options.extraMemBottom ?? 0);
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
    const gaps2 = placed.gaps.map(([x, w, row]) => [
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
      gaps: gaps2,
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
  function chainDelay(levels) {
    return levels.length > 1 ? (levels.length - 1) * CHAIN_STEP + CHAIN_LEAD : 0;
  }
  function paneLevels(walk, pane2, from) {
    if (walk.length < 2) return null;
    const tokens = (level) => codeName(level).match(/\w+|\S/g) ?? [];
    const spelled = tokens(walk.at(-1));
    const ends = [];
    let at = pane2[from] === "&" ? from + 1 : from;
    let k = 0;
    for (const level of walk) {
      for (const count = tokens(level).length; k < count; k++) {
        while (/[\s()]/.test(pane2[at] ?? "")) at++;
        if (!pane2.startsWith(spelled[k], at)) return null;
        at += spelled[k].length;
      }
      ends.push(at - from);
    }
    return /\w/.test(pane2[at] ?? "") ? null : ends;
  }
  const memoryWalk = (levels, at) => walkWindows(levels.length, at + 0.15, CHAIN_LEAD);
  function walkWindows(count, end, offset = 0) {
    const start = count > 1 ? offset : 0;
    return Array.from({ length: count }, (_, k) => [
      start + k * CHAIN_STEP,
      k === count - 1 ? end : start + (k + 1) * CHAIN_STEP
    ]);
  }
  const stores = (op) => op.kind === "write" || op.kind === "bind";
  const walks = (op) => op.kind === "read" || op.kind === "write" || op.kind === "addr";
  const shortWalks = /* @__PURE__ */ new WeakMap();
  const walkOf = (op) => shortWalks.get(op) ?? chainOf(op.name);
  const landing = (op) => memoryWalk(walkOf(op), arrival(op)).at(-1)[0];
  const opening = /* @__PURE__ */ new WeakSet();
  const lead = (op) => opening.has(op) ? T.operator : 0;
  function continuesOperator(steps, i) {
    var _a, _b;
    const op = (_a = steps[i]) == null ? void 0 : _a.op;
    const last = (_b = steps[i - 1]) == null ? void 0 : _b.op;
    if ((op == null ? void 0 : op.kind) !== "convert" || !op.operator || (last == null ? void 0 : last.kind) !== "convert" || !last.operator || i < 2) return false;
    const shift = last.operator[0] >= last.span[1] ? steps[i - 1].pane.length - steps[i - 2].pane.length : 0;
    return op.operator[0] === last.operator[0] + shift;
  }
  const departure = (op) => (stores(op) ? T.writeHold : op.kind === "print" ? 0.2 : T.prepare) + (walks(op) ? chainDelay(walkOf(op)) : 0);
  function stepWalkSeconds(steps, i) {
    var _a;
    const op = (_a = steps[i]) == null ? void 0 : _a.op;
    return op && walks(op) ? chainDelay(walkOf(op)) : 0;
  }
  function arrival(op) {
    if (op.kind === "deref") return T.prepare + T.follow;
    if (op.kind === "eval" || op.kind === "alias" || op.kind === "convert") return lead(op) + T.evaluate;
    if (op.kind === "clash") return T.clash;
    if (op.kind === "print") return 0.9;
    return departure(op) + T.travel;
  }
  const opSeconds = (op) => arrival(op) + T.settle + (stores(op) ? 0.5 : 0);
  const opensStatement = (steps, i) => i === 0 || !steps[i].op || steps[i - 1].line !== steps[i].line;
  function statementSteps(steps, i) {
    let start = i;
    while (!opensStatement(steps, start)) start--;
    let end = i;
    while (end + 1 < steps.length && !opensStatement(steps, end + 1)) end++;
    return Array.from({ length: end - start + 1 }, (_, k) => start + k);
  }
  const copies = (steps, i) => !steps[i].op;
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
            fieldColor: field.color,
            ...field.floating ? { floating: true } : {}
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
    const model = {
      trace,
      typeColours: typeColours(trace),
      typed: trace.steps.some((step) => step.types),
      // Each step's own operation, which its walk is recorded by.
      steps: trace.steps.map((step) => step.op ? { ...step, op: { ...step.op } } : step),
      source: trace.source,
      spans: trace.spans || [],
      types: trace.types || {},
      references: trace.references || [],
      leaves,
      groups,
      tops,
      top,
      rise: Math.max(0, ...groups.map((group) => group.rise)),
      reach: []
    };
    const continuations = model.steps.map((_, j) => continuation(model, j));
    recordShortWalks(model, continuations);
    model.steps.forEach((step, i) => {
      var _a;
      if (((_a = step.op) == null ? void 0 : _a.kind) === "convert" && step.op.operator && !continuesOperator(model.steps, i)) opening.add(step.op);
    });
    model.reach = model.steps.map((_, j) => reachedIn(model, j, continuations[j]));
    return model;
  }
  function recordShortWalks(m, continuations) {
    m.steps.forEach((step, j) => {
      var _a, _b;
      const op = step.op;
      if (!op) return;
      const next = (_a = m.steps[continuations[j]]) == null ? void 0 : _a.op;
      if ((op.kind === "deref" || op.kind === "alias") && next && walks(next)) {
        shortWalks.set(next, chainOf(next.name).slice(chainOf(op.target).length - 1));
      }
      if (op.kind === "read" && op.compound) {
        const write = statementSteps(m.steps, j).find((k) => {
          var _a2;
          return k > j && ((_a2 = m.steps[k].op) == null ? void 0 : _a2.kind) === "write";
        });
        const written = write === void 0 ? null : m.steps[write].op;
        if ((written == null ? void 0 : written.kind) === "write" && written.name === op.name) shortWalks.set(written, [op.name]);
      }
      if (op.kind === "addr" && ((_b = m.steps[j - 1]) == null ? void 0 : _b.pane[op.span[0]]) !== "&") shortWalks.set(op, [op.name]);
    });
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
    const step = m.steps[i];
    const active = paneVariables(m, step);
    const op = step.op;
    for (const name of [op == null ? void 0 : op.name, op == null ? void 0 : op.target, op == null ? void 0 : op.via]) {
      if (name) active.add(name.split(".")[0]);
    }
    return active;
  }
  const PANE_NAME = new RegExp(`"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|(?<!\\w)(?<!(?:\\.|->|::)\\s*)[A-Za-z_]\\w*(\\s*\\{)?`, "g");
  function paneVariables(m, step) {
    const named = /* @__PURE__ */ new Set();
    const refs = step.refs || {};
    const records = new Set(m.groups.map((group) => group.type));
    for (const [token, brace] of step.pane.matchAll(PANE_NAME)) {
      const name = brace ? token.slice(0, -brace.length) : token;
      if (/^["']/.test(name) || brace && records.has(name)) continue;
      if (m.top.includes(name)) named.add(name);
      if (Object.hasOwn(refs, name) && refs[name]) {
        named.add(name);
        named.add(refs[name].split(".")[0]);
      }
    }
    return named;
  }
  function reached(op) {
    if (!op) return null;
    switch (op.kind) {
      // A read or address lights the cell as its walk lands on the last level, a write as its
      // value lands.
      case "read":
      case "addr":
        return { name: op.name, at: landing(op) };
      case "write":
        return { name: op.name, at: arrival(op) };
      // A binding highlights its storage from the start.
      case "bind":
        return { name: op.target, at: 0 };
      case "deref":
      case "alias":
        return { name: op.target, at: arrival(op) - 0.15 };
      default:
        return null;
    }
  }
  const topOf = (leaf) => leaf.group ?? leaf.name;
  const covers = (name, cell) => cell === name || cell.startsWith(name + ".");
  const addressOfStruct = (m, op) => (op == null ? void 0 : op.kind) === "addr" && m.groups.some((group) => group.name === op.name);
  function reachedIn(m, j, next) {
    var _a;
    const op = m.steps[j].op;
    if (addressOfStruct(m, op)) return null;
    const target = reached(op);
    if (!target || (op == null ? void 0 : op.kind) !== "deref" && (op == null ? void 0 : op.kind) !== "alias") return target;
    const after = ((_a = m.steps[next]) == null ? void 0 : _a.op) ?? null;
    if (addressOfStruct(m, after)) return null;
    const later = reached(after);
    return later && later.name !== target.name ? null : target;
  }
  function continuation(m, j) {
    var _a;
    const op = m.steps[j].op;
    if ((op == null ? void 0 : op.kind) !== "deref" && (op == null ? void 0 : op.kind) !== "alias") return -1;
    const name = op.target;
    let at = op.span[0];
    for (let k = j + 1; k < m.steps.length && !opensStatement(m.steps, k); k++) {
      const op2 = m.steps[k].op;
      if (!op2 || !("span" in op2)) continue;
      const later = (_a = reached(op2)) == null ? void 0 : _a.name;
      const [from, to] = op2.kind === "write" ? op2.destination : op2.kind === "read" && op2.compound ? [0, op2.span[0]] : op2.span;
      if (later && covers(name, later) && from <= at && at < to) return k;
      if (m.steps[k].pane === m.steps[k - 1].pane) continue;
      const [s, e] = op2.span;
      if (at >= e) {
        at += m.steps[k].pane.length - m.steps[k - 1].pane.length;
      } else if (at >= s) {
        const spelled = codeName(name);
        const pane2 = m.steps[k].pane;
        if (!pane2.startsWith(spelled, s) || /\w/.test(pane2[s + spelled.length] ?? "")) return -1;
        at = s;
      }
    }
    return -1;
  }
  function litAt(m, i) {
    var _a;
    const tops = activeVariables(m, i);
    const names = [];
    for (const j of statementSteps(m.steps, i)) {
      const op2 = m.steps[j].op;
      const name = (_a = m.reach[j]) == null ? void 0 : _a.name;
      if (j > i || !name) continue;
      const handsOn = (op2 == null ? void 0 : op2.kind) === "addr" || (op2 == null ? void 0 : op2.kind) === "read" && !op2.compound;
      if (j === i || !handsOn) names.push(name);
    }
    const op = m.steps[i].op;
    if ((op == null ? void 0 : op.kind) === "deref") names.push(op.via);
    const shown = new Set(tops);
    for (const leaf of m.leaves) {
      if (!tops.has(topOf(leaf))) continue;
      if (!leaf.group || names.some((name) => covers(name, leaf.name))) shown.add(leaf.name);
    }
    for (const group of m.groups) {
      const taken = addressOfStruct(m, op) && op.name === group.name;
      const inner = m.leaves.some((leaf) => shown.has(leaf.name) && covers(group.name, leaf.name));
      if (group.parent && (taken || inner)) shown.add(group.name);
    }
    return shown;
  }
  function stepFocus(m, i, animate) {
    const now = litAt(m, i);
    const begin = /* @__PURE__ */ new Map();
    if (!animate || i === 0) return { now, before: now, begin };
    const before = litAt(m, i - 1);
    const op = m.steps[i].op;
    const target = m.reach[i] ?? reached(op);
    if (target) {
      for (const name of now) {
        if (!before.has(name) && (covers(name, target.name) || covers(target.name, name))) {
          begin.set(name, target.at);
        }
      }
    }
    if (op && !opensStatement(m.steps, i)) {
      const named = paneVariables(m, m.steps[i - 1]);
      const still = paneVariables(m, m.steps[i]);
      for (const name of before) {
        const top = name.split(".")[0];
        if (!now.has(name) && named.has(top) && !still.has(top)) begin.set(name, arrival(op));
      }
    }
    return { now, before, begin };
  }
  const SHOWN_DIGITS = 8;
  const FLOAT_DIGITS = 9;
  function shortestDecimal(value, size) {
    if (size === 8 || Math.fround(value) !== value) return String(value);
    for (let digits = 1; digits <= FLOAT_DIGITS; digits++) {
      const [mantissa, exponent] = value.toExponential(digits - 1).split("e");
      const scaled2 = Number(mantissa.replace(".", ""));
      const scale = Number(exponent) - (digits - 1);
      const fits = [scaled2, scaled2 - 1, scaled2 + 1].map((candidate) => Number(`${candidate}e${scale}`)).filter((candidate) => Math.fround(candidate) === value).sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
      if (fits.length) return String(fits[0]);
    }
    return String(value);
  }
  function compact(text2) {
    const scientific = Number(text2).toExponential();
    return scientific.length < text2.length ? scientific : text2;
  }
  const significantDigits = (text2) => Number(text2).toExponential().split("e")[0].replace(/[-.]/g, "").length;
  function displayFloat(value, size) {
    if (Object.is(value, -0)) return "-0";
    if (Number.isSafeInteger(value)) return compact(shortestDecimal(value, size));
    const shortest = shortestDecimal(value, size);
    if (significantDigits(shortest) <= SHOWN_DIGITS) return compact(shortest);
    return "≈" + compact(String(Number(value.toPrecision(SHOWN_DIGITS))));
  }
  function displayNumber(value, floatSize = null) {
    if (floatSize) return displayFloat(value, floatSize);
    return Object.is(value, -0) ? "-0" : String(value);
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
    const fade2 = (from2, to, begin2) => `<animate attributeName="opacity" from="${from2}" to="${to}" dur="0.35s" begin="${round(begin2)}s" ${EASE} fill="freeze"/>`;
    const begin = focus.begin.get(name) ?? 0;
    if (on === was) return on ? markup : `<g opacity="${DIM}">${markup}</g>`;
    const from = was ? 1 : DIM;
    return `<g opacity="${from}">${fade2(from, on ? 1 : DIM, begin)}${markup}</g>`;
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
      l.from.name,
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
        out += dim(
          c,
          l.from.name,
          `<path d="${l.d}" fill="none" stroke="${l.from.color}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`
        );
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
  function gaps(c, height) {
    return c.g.gaps.map(
      ([x, w, y]) => `<rect x="${round(x + 3)}" y="${y + 3}" width="${round(w - 6)}" height="${height - 6}" fill="none" stroke="${c.P.gapStroke}" stroke-dasharray="5 5"/>`
    ).join("");
  }
  function memory$1(c) {
    const { g, P, step, prev, op } = c;
    const values = op && op.kind === "write" && prev ? prev.values : step.values;
    const at = op ? arrival(op) : 0;
    const writing = new Set(op && op.kind === "write" ? g.cellsOf(op.name).map((l) => l.name) : []);
    const live = (l) => values[l.name] !== null || writing.has(l.name);
    let out = "";
    out += gaps(c, CELL);
    const arrays = new Set(g.groups.filter((s) => arrayType(s.type ?? "")).map((s) => s.name));
    const inArray = (name) => [...arrays].some((a) => name.startsWith(a + "."));
    const startsAt = (target, cell) => {
      var _a;
      return target === cell.name || cell.name.startsWith(target + ".") && ((_a = g.box(target)) == null ? void 0 : _a.address) === cell.address;
    };
    const pointed = (shown, cell) => Boolean(shown && Object.values(shown.targets).some((t) => startsAt(t, cell)));
    const taking = (i, cell) => {
      if (i < 0) return false;
      return statementSteps(c.m.steps, i).some((j) => {
        const o = c.m.steps[j].op;
        return j <= i && (o == null ? void 0 : o.kind) === "addr" && startsAt(o.name, cell);
      });
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
      const appear = (op == null ? void 0 : op.kind) === "addr" ? landing(op) : at;
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
        // A nested struct's frame dims on its own, the outermost with its variable.
        s.parent ? s.name : s.top,
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
      out += `<g opacity="0">${fade(0, 1, 0.15, landing(op))}${fade(1, 0, 0.2, at + 0.1)}` + rect(lx - labelWidth$1(cell) / 2 - 5, ly - 13, labelWidth$1(cell) + 10, 24, P.readFill, P.read, 5, 2) + "</g>";
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
          const display = typeof value === "number" ? displayNumber(value, cell.floating ? cell.size : null) : String(value);
          const length = display.length;
          const size = Math.min(30, (cell.w - Math.min(12, cell.w / 5)) / (length * CHAR));
          return text(0, size / 3 + 1, display, round(size), value === "?" ? P.grey : P.fg, "middle");
        };
        markup += `<g transform="translate(${round(cell.x + cell.w / 2)} ${cell.y + cell.h / 2})"><g>` + (changing ? pulse(at - 0.2) : "");
        const before = prev ? prev.values[cell.name] : null;
        const after = step.values[cell.name];
        if (changing && !Object.is(before, after)) {
          if (before !== null) markup += `<g>${hide(at)}${shown(before)}</g>`;
          markup += `<g opacity="0">${show(at)}${shown(after)}</g>`;
        } else {
          markup += shown(changing ? after : values[cell.name]);
        }
        markup += "</g></g>";
      }
      out += dim(c, cell.name, markup);
    }
    if (op && (op.kind === "read" || op.kind === "write" || op.kind === "addr")) {
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
    const levels = walkOf(op);
    const windows = memoryWalk(levels, at);
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
  function walkBoxes(ends, end, box, whole) {
    if (!ends) return whole;
    const windows = walkWindows(ends.length, end);
    return ends.map((chars, k) => {
      const [begin, leave] = windows[k];
      return `<g opacity="0">${fade(0, 1, 0.15, begin)}${fade(1, 0, 0.2, leave)}${box(chars)}</g>`;
    }).join("");
  }
  function operatorMark(c, dx) {
    const { op, P, g } = c;
    if ((op == null ? void 0 : op.kind) !== "convert" || !op.operator) return "";
    const [s, e] = op.operator;
    const at = arrival(op);
    const opens = !c.animate || !continuesOperator(c.m.steps, c.index);
    const lasts = continuesOperator(c.m.steps, c.index + 1);
    const box = markBox(g.tx + s * g.paneChar, g.ty, (e - s) * g.paneChar, P.fg, P.derefFill);
    const moved = s >= op.span[1] && dx !== 0 ? glide(box, dx, at + 0.1, 0.3) : box;
    return `<g opacity="${opens ? 0 : 1}">${opens ? fade(0, 1, 0.25) : ""}${lasts ? "" : fade(1, 0, 0.3, at + 0.3)}${moved}</g>`;
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
      if (prev) {
        out += `<g>${fade(1, 0, 0.3, begin + 0.2)}${settledPane(c, prev, tx, ty)}</g>`;
      }
      const scale = CODE_SIZE / c.g.paneSize;
      out += `<g><animateMotion dur="${round(total)}s" path="M ${round(sx)} ${sy} L ${tx} ${ty}" keyPoints="0;0;1" keyTimes="0;${(begin / total).toFixed(4)};1" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1" fill="freeze"/><g transform="scale(${scale})"><animateTransform attributeName="transform" type="scale" from="${scale}" to="1" begin="${begin}s" dur="${T.copyTravel}s" ${EASE} fill="freeze"/><g opacity="0">${fade(0, 1, 0.15, begin - 0.15)}${fade(1, 0, 0.12, total)}` + rect(-8, -36, step.pane.length * c.g.paneChar + 16, 48, P.highlight, P.read, 7, 2) + "</g>" + settledPane(c, step, 0, 0) + "</g></g>";
      return out;
    }
    if ((op == null ? void 0 : op.kind) === "read" && op.compound && prev) {
      const [s, e] = op.span;
      const at = arrival(op);
      const left = prev.pane.slice(0, s).trimEnd().length + " = ".length;
      out += exprBackground(c, tx, ty, step.expr, prev.expr, at);
      const operand = prev.pane.length - prev.pane.trimStart().length;
      out += walkBoxes(
        paneLevels(walkOf(op), prev.pane, operand),
        at - 0.1,
        (chars) => markBox(tx + operand * c.g.paneChar, ty, chars * c.g.paneChar, P.read, P.readFill),
        ""
      );
      out += `<g opacity="0">${fade(0, 1, 0.15)}${hide(at)}${markBox(tx + s * c.g.paneChar, ty, (e - s) * c.g.paneChar, P.read, P.readFill)}</g><g opacity="0">${show(at)}${fade(1, 0, 0.3, at + 0.3)}${markBox(tx + left * c.g.paneChar, ty, op.value.length * c.g.paneChar, P.read, P.readFill)}</g>`;
      out += `<g>${hide(at)}${paneText(c, tx, ty, prev.pane, 0, prev.pane.length, prev.expr)}</g>`;
      out += `<g opacity="0">${show(at)}${paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr)}</g>`;
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
        op.kind === "read" || op.kind === "addr" ? paneLevels(walkOf(op), before, s) : null,
        at - 0.1,
        (chars) => markBox(sx, ty, chars * c.g.paneChar, stroke, fill),
        `<g opacity="0">${fade(0, 1, 0.15, lead(op))}${fade(1, 0, 0.2, at - 0.1)}${markBox(sx, ty, (e - s) * c.g.paneChar, stroke, fill)}</g>`
      );
      out += operatorMark(c, dx);
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
        paneLevels(walkOf(op), step.pane, ns),
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
    return code(c, oldLine) + tether(c, oldLine) + arrows(c) + memory$1(c) + pane(c, copying) + output(c) + transfers(c);
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
    if (op.kind === "read" && op.compound) return format(S.compound, { ...op, name: codeName(op.name) });
    return format(S[op.kind], op);
  }
  class Integer {
    constructor(size, signed) {
      __publicField(this, "size");
      __publicField(this, "signed");
      this.size = size;
      this.signed = signed;
      Object.freeze(this);
    }
    /** `value` converted to this type: its low bits, as every conversion keeps them. */
    wrap(value) {
      return this.signed ? BigInt.asIntN(8 * this.size, value) : BigInt.asUintN(8 * this.size, value);
    }
    holds(value) {
      return this.wrap(value) === value;
    }
  }
  const INTEGERS = Object.freeze({
    "signed char": new Integer(1, true),
    "unsigned char": new Integer(1, false),
    short: new Integer(2, true),
    "unsigned short": new Integer(2, false),
    int: new Integer(4, true),
    "unsigned int": new Integer(4, false),
    long: new Integer(8, true),
    "unsigned long": new Integer(8, false),
    "long long": new Integer(8, true),
    "unsigned long long": new Integer(8, false)
  });
  const ALIASES = Object.freeze({
    size_t: "unsigned long",
    ptrdiff_t: "long",
    intptr_t: "long",
    uintptr_t: "unsigned long",
    int8_t: "signed char",
    uint8_t: "unsigned char",
    int16_t: "short",
    uint16_t: "unsigned short",
    int32_t: "int",
    uint32_t: "unsigned int",
    int64_t: "long",
    uint64_t: "unsigned long",
    int_least8_t: "signed char",
    uint_least8_t: "unsigned char",
    int_least16_t: "short",
    uint_least16_t: "unsigned short",
    int_least32_t: "int",
    uint_least32_t: "unsigned int",
    int_least64_t: "long",
    uint_least64_t: "unsigned long",
    int_fast8_t: "signed char",
    uint_fast8_t: "unsigned char",
    int_fast16_t: "long",
    uint_fast16_t: "unsigned long",
    int_fast32_t: "long",
    uint_fast32_t: "unsigned long",
    int_fast64_t: "long",
    uint_fast64_t: "unsigned long",
    intmax_t: "long",
    uintmax_t: "unsigned long",
    signed: "int",
    unsigned: "unsigned int",
    "signed int": "int",
    "short int": "short",
    "signed short": "short",
    "unsigned short int": "unsigned short",
    "long int": "long",
    "signed long": "long",
    "unsigned long int": "unsigned long",
    "long long int": "long long",
    "signed long long": "long long",
    "unsigned long long int": "unsigned long long"
  });
  const bareSpelling = (spelling) => spelling.replace(/^const /, "").replace(/^std::/, "");
  function integerSpelled(spelling, aliases = {}) {
    const name = integerName(spelling, aliases);
    return name === null ? null : INTEGERS[name];
  }
  function integerName(spelling, aliases = {}) {
    const name = bareSpelling(spelling);
    const known = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
    const canonical = Object.hasOwn(INTEGERS, known) || !Object.hasOwn(aliases, name) ? known : aliases[name];
    return Object.hasOwn(INTEGERS, canonical) ? canonical : null;
  }
  function integerLiteral(spelling) {
    const match = spelling.trim().match(/^([-+]?)\s*(0[xX][0-9a-fA-F']+|0[bB][01']+|0[0-7']*|[1-9][0-9']*)(?:[uU](?:ll|LL|[lLzZ])?|(?:ll|LL|[lLzZ])[uU]?)?$/);
    if (!match || /^0[xXbB]'|''|'$/.test(match[2])) return null;
    const digits = match[2].replaceAll("'", "");
    const octal = /^0[0-7]+$/.test(digits) ? `0o${digits.slice(1)}` : digits;
    const value = BigInt(octal);
    return match[1] === "-" ? -value : value;
  }
  function convertOperand(previous, op) {
    var _a;
    const part = (_a = previous.types) == null ? void 0 : _a.find(
      (t) => !t.slot && t.type === op.from && t.span[0] >= op.span[0] && t.span[1] <= op.span[1]
    );
    return integerLiteral(previous.pane.slice(...(part == null ? void 0 : part.span) ?? op.span).replace(/^\((.*)\)$/, "$1"));
  }
  function integerOf(m, spelling) {
    return integerSpelled(spelling ?? "int", m.trace.integers) ?? integerSpelled("int");
  }
  function toBytesMSB(value, bytes) {
    const unsigned = BigInt.asUintN(bytes * 8, value);
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
  function invertedOperand(prev, step) {
    var _a, _b;
    if (((_a = step.op) == null ? void 0 : _a.kind) !== "eval" || !prev) return null;
    const operand = (_b = prev.pane.slice(...step.op.span).match(/^\s*~(.*)$/)) == null ? void 0 : _b[1];
    return operand === void 0 ? null : integerLiteral(operand);
  }
  function signCopies(m, step) {
    const { op } = step;
    if ((op == null ? void 0 : op.kind) !== "convert") return 0;
    const from = integerOf(m, op.from);
    return from.signed ? Math.max(0, integerOf(m, op.to).size - from.size) : 0;
  }
  function activeBitAction(c) {
    var _a, _b, _c;
    const { step, prev, m } = c;
    const op = step.op;
    if ((op == null ? void 0 : op.kind) === "convert") {
      const beforeVal = prev ? convertOperand(prev, op) : null;
      const afterVal = integerLiteral(op.value);
      if (beforeVal === null || afterVal === null) return null;
      const fromInfo = integerOf(m, op.from);
      const toInfo = integerOf(m, op.to);
      let kind = "reinterpret";
      let signBit;
      if (toInfo.size < fromInfo.size) {
        kind = "narrow";
      } else if (toInfo.size > fromInfo.size) {
        if (fromInfo.signed) {
          kind = "sign-extend";
          signBit = fromInfo.wrap(beforeVal) < 0n ? 1 : 0;
        } else {
          kind = "zero-extend";
        }
      }
      return { kind, signBit, fromType: op.from, toType: op.to, fromInfo, toInfo, beforeVal, afterVal };
    }
    if ((op == null ? void 0 : op.kind) === "eval" || (op == null ? void 0 : op.kind) === "print") {
      const value = integerLiteral(op.value);
      const type = (_b = (_a = step.types) == null ? void 0 : _a.find((t) => !t.slot && t.span[0] === op.span[0])) == null ? void 0 : _b.type;
      if (value === null || !type) return null;
      const beforeVal = invertedOperand(prev, step);
      if (beforeVal !== null) {
        return { kind: "invert", type, info: integerOf(m, type), beforeVal, afterVal: value };
      }
      return { kind: "value", type, info: integerOf(m, type), value };
    }
    if (op && (op.kind === "read" || op.kind === "write")) {
      const value = integerLiteral(op.value);
      if (value === null) return null;
      const type = ((_c = m.leaves.find((l) => l.name === op.name)) == null ? void 0 : _c.type) ?? "int";
      return { kind: "value", type, info: integerOf(m, type), value };
    }
    const literals = op === null ? (step.types ?? []).filter((t) => !t.slot) : [];
    if (literals.length === 1) {
      const value = integerLiteral(step.pane.slice(...literals[0].span));
      if (value !== null) {
        const { type } = literals[0];
        return { kind: "value", type, info: integerOf(m, type), value };
      }
    }
    return null;
  }
  const STAGGER = 0.2;
  const TRAVEL = 0.55;
  const signSeconds = (copies2) => (copies2 - 1) * STAGGER + TRAVEL + 0.7;
  function bitStepSeconds(m, i) {
    var _a;
    const { steps } = m;
    const step = steps[i];
    if (((_a = step.op) == null ? void 0 : _a.kind) === "convert" || invertedOperand(steps[i - 1] ?? null, step) !== null) {
      const copies2 = signCopies(m, step);
      const signDone = copies2 > 0 ? arrival(step.op) + signSeconds(copies2) : 0;
      return step.hold + Math.max(2.1, signDone);
    }
    return stepSeconds(steps, i);
  }
  const BITS_CELL = 88;
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
  function memory(c) {
    const { g, P, step, prev, op } = c;
    const { littleEndian } = c;
    const values = op && op.kind === "write" && prev ? prev.values : step.values;
    const at = op ? arrival(op) : 0;
    const writing = new Set(op && op.kind === "write" ? g.cellsOf(op.name).map((l) => l.name) : []);
    const live = (l) => values[l.name] !== null || writing.has(l.name);
    let out = gaps(c, BITS_CELL);
    for (const cell of g.leaves) {
      const on = live(cell);
      const changing = writing.has(cell.name);
      const color = cell.fieldColor || cell.color;
      const before = prev ? prev.values[cell.name] : null;
      const after = step.values[cell.name];
      const shownVal = changing ? after : values[cell.name];
      let markup = "";
      const bw = cell.w / cell.size;
      markup += text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
      if (cell.size > 1) {
        for (let i = 1; i < cell.size; i++) {
          markup += text(cell.x + i * bw + 6, cell.y - 12, cell.address + i, 14, P.grey);
        }
      }
      markup += rect(cell.x, cell.y, cell.w, cell.h, on ? P.panel : P.deadFill, "none", 0);
      const divStroke = on ? P.gapStroke : P.deadStroke;
      const splitY = cell.y + 52;
      markup += `<line x1="${cell.x + 2}" y1="${splitY}" x2="${cell.x + cell.w - 2}" y2="${splitY}" stroke="${divStroke}" stroke-width="1.3"/>`;
      for (let i = 1; i < cell.size; i++) {
        const lx = round(cell.x + i * bw);
        markup += `<line x1="${lx}" y1="${splitY}" x2="${lx}" y2="${cell.y + cell.h - 2}" stroke="${divStroke}" stroke-width="1.3"/>`;
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
      if (on) {
        const bytesOf = (v) => littleEndian ? toBytesLSB(BigInt(v), cell.size) : toBytesMSB(BigInt(v), cell.size);
        const renderCellBody = (val) => {
          if (typeof val !== "number") {
            return text(cell.x + cell.w / 2, cell.y + 36, String(val), 26, P.grey, "middle");
          }
          const bytes = bytesOf(val);
          let body = "";
          const dec = String(val);
          const decSize = Math.min(28, (cell.w - 14) / (dec.length * CHAR));
          body += text(cell.x + cell.w / 2, cell.y + 36, dec, round(decSize), P.fg, "middle");
          const hexY = cell.y + 76;
          body += `<g class="cv-byte-hex" data-name="${cell.name}" opacity="0.86">`;
          for (let i = 0; i < cell.size; i++) {
            const bx = cell.x + i * bw + bw / 2;
            body += text(bx, hexY, hexByte(bytes[i]), 15.5, P.fg, "middle");
          }
          return body + "</g>";
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
      if (cell.size > 1) {
        const ay = cell.y + cell.h + 10;
        const dir = littleEndian ? 1 : -1;
        const xLow = cell.x + (littleEndian ? bw / 2 : cell.w - bw / 2);
        const xHigh = cell.x + (littleEndian ? cell.w - bw / 2 : bw / 2);
        const arrowCol = on ? P.grey : P.deadStroke;
        markup += `<g opacity="${on ? "0.75" : "0.5"}"><line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.5" stroke-linecap="round"/><path d="M -8 -4 L 0 0 L -8 4 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${littleEndian ? 0 : 180})"/></g>`;
      }
      markup += text(
        cell.x + cell.w / 2,
        cell.y + cell.h + 36,
        cell.label,
        g.nameSize,
        on ? color : P.grey,
        "middle"
      );
      out += dim(c, cell.group || cell.name, markup);
    }
    return out + drawTypeLabels(c, live);
  }
  const BIT_FONT = 22;
  const HEX_FONT = 21;
  const RESULT_FONT = 24;
  const BIT_STEP = BIT_FONT * CHAR;
  const NIBBLE_W = 4 * BIT_STEP;
  const NIB_GAP = 8;
  const BYTE_W = 2 * NIBBLE_W + NIB_GAP;
  const BYTE_GAP = 26;
  const CARD_PAD = 12;
  const ARC_RISE = 9;
  const ROOMY_ARCS = 3;
  const extents = /* @__PURE__ */ new WeakMap();
  function workbenchExtent(m) {
    let extent = extents.get(m);
    if (extent) return extent;
    const sizes = m.leaves.map((l) => l.size);
    let labelChars = 0;
    let arcs = 0;
    for (const step of m.steps) {
      arcs = Math.max(arcs, signCopies(m, step));
      for (const part of step.types ?? []) sizes.push(integerOf(m, part.type).size);
      const { op } = step;
      if ((op == null ? void 0 : op.kind) === "convert") sizes.push(integerOf(m, op.from).size, integerOf(m, op.to).size);
      if (op && "value" in op) labelChars = Math.max(labelChars, op.value.length + 2);
    }
    extent = { bytes: Math.max(1, ...sizes), labelChars, drop: Math.max(0, arcs - ROOMY_ARCS) * ARC_RISE };
    extents.set(m, extent);
    return extent;
  }
  const slotsWidth = (bytes) => bytes * BYTE_W + (bytes - 1) * BYTE_GAP;
  const RESULT_GAP = 20;
  const labelWidth = (label) => (typeof label === "number" ? label : label.length) * RESULT_FONT * CHAR;
  const bitCx = (x, i) => x + (i < 4 ? 0 : NIBBLE_W + NIB_GAP) + (i % 4 + 0.5) * BIT_STEP;
  function drawByte(x, yBits, yHex, byte, ink) {
    const bits = byte.toString(2).padStart(8, "0");
    const hex = hexByte(byte);
    let out = `<g class="cv-bit-byte" data-bits="${bits}">`;
    for (let i = 0; i < 8; i++) {
      const color = i === 0 && ink.msb ? ink.msb : ink.bits;
      out += text(bitCx(x, i), yBits, bits[i], BIT_FONT, color, "middle");
    }
    out += text(x + NIBBLE_W / 2, yHex, hex[0], HEX_FONT, ink.hex, "middle");
    out += text(x + NIBBLE_W + NIB_GAP + NIBBLE_W / 2, yHex, hex[1], HEX_FONT, ink.hex, "middle");
    return out + "</g>";
  }
  const BOX_TOP = BIT_FONT * 0.78 + 4;
  function signFrame(x, yBits, stroke, fill = "none") {
    return rect(bitCx(x, 0) - BIT_STEP / 2 - 3, yBits - BOX_TOP, BIT_STEP + 6, BOX_TOP + 6, fill, stroke, 4, 1.8);
  }
  function arrowheadAt(tipX, tipY, dx, dy, color) {
    const deg = round(Math.atan2(dy, dx) * 180 / Math.PI);
    return `<path d="M -10 -5 L 0 0 L -10 5 Z" fill="${color}" transform="translate(${round(tipX)} ${round(tipY)}) rotate(${deg})"/>`;
  }
  const scaled = (cx, cy, inner, begin) => `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`;
  function workbench(c) {
    const act = activeBitAction(c);
    if (!act) return "";
    const { g, P, animate, op } = c;
    const cardTop = g.ty + 56 + workbenchExtent(c.m).drop;
    const yBits = cardTop + CARD_PAD + BOX_TOP;
    const yHex = yBits + 34;
    const yRes = yBits + 16;
    const cardBottom = yHex + CARD_PAD;
    const rightAnchor = g.tx + 12 + slotsWidth(workbenchExtent(c.m).bytes);
    const slotX = (bytesFromLSB) => rightAnchor - (bytesFromLSB + 1) * BYTE_W - bytesFromLSB * BYTE_GAP;
    const card = (bytes, resultLabel) => {
      const left = slotX(bytes - 1) - CARD_PAD - 4;
      const right = rightAnchor + RESULT_GAP + labelWidth(resultLabel) + CARD_PAD + 4;
      return rect(left, cardTop, right - left, cardBottom - cardTop, P.panel, P.gapStroke, 8, 1.5);
    };
    const reveal = (at2, markup) => animate && at2 > 0 ? `<g opacity="0">${fade(0, 1, 0.22, at2)}${markup}</g>` : markup;
    const swap = (at2, before, after) => animate ? `<g>${hide(at2)}${before}</g><g opacity="0">${show(at2)}${after}</g>` : after;
    const result = (at2, label2, color) => reveal(at2, text(rightAnchor + RESULT_GAP, yRes, label2, RESULT_FONT, color));
    const plainValue = (value, info, hexInk) => {
      const bytes = toBytesMSB(value, info.size);
      let out2 = "";
      bytes.forEach((b, idx) => {
        out2 += drawByte(slotX(bytes.length - 1 - idx), yBits, yHex, b, { bits: P.fg, hex: hexInk });
      });
      return out2;
    };
    if (act.kind === "value") {
      const col = typeColour(c, act.type);
      let appearAt = 0;
      if (animate && copies(c.m.steps, c.index)) {
        appearAt = copyBegin(c.m.steps, c.index) + T.copyTravel;
      } else if (animate && (op == null ? void 0 : op.kind) === "read") {
        appearAt = arrival(op);
      }
      const label2 = `= ${act.value}`;
      return reveal(
        appearAt,
        card(act.info.size, label2) + plainValue(act.value, act.info, col) + text(rightAnchor + RESULT_GAP, yRes, label2, RESULT_FONT, col)
      );
    }
    if (act.kind === "invert") {
      const at2 = op ? arrival(op) : T.evaluate;
      const after = toBytesMSB(act.afterVal, act.info.size);
      let inverted = "";
      after.forEach((b, idx) => {
        inverted += drawByte(slotX(after.length - 1 - idx), yBits, yHex, b, { bits: P.write, hex: P.write });
      });
      const label2 = `→ ${act.afterVal}`;
      return card(act.info.size, label2) + swap(at2, plainValue(act.beforeVal, act.info, P.fg), inverted) + result(at2 + 0.18, label2, P.write);
    }
    const fromBytes = toBytesMSB(act.beforeVal, act.fromInfo.size);
    const toBytes = toBytesMSB(act.afterVal, act.toInfo.size);
    const fromCol = typeColour(c, act.fromType);
    const toCol = typeColour(c, act.toType);
    const at = op ? arrival(op) : T.evaluate;
    const label = `→ ${act.afterVal}`;
    let out = card(Math.max(fromBytes.length, toBytes.length), label);
    if (act.kind === "narrow") {
      const keep = toBytes.length;
      fromBytes.forEach((b, idx) => {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        if (lsbPos < keep) {
          out += drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
          return;
        }
        const dropped = `<g opacity="0.48">` + drawByte(bx, yBits, yHex, b, { bits: P.error, hex: P.error }) + `<line x1="${round(bx + 4)}" y1="${round(yBits - 20)}" x2="${round(bx + BYTE_W - 4)}" y2="${round(yHex + 6)}" stroke="${P.error}" stroke-width="2"/></g>`;
        out += animate ? `<g>${hide(at)}${drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: fromCol })}</g><g opacity="0">${show(at)}<animateTransform attributeName="transform" type="translate" from="0 -6" to="0 0" begin="${round(at)}s" dur="0.32s" fill="freeze"/>${dropped}</g>` : dropped;
      });
      const cutX = slotX(keep - 1) - BYTE_GAP / 2;
      out += reveal(
        at - 0.15,
        `<line x1="${round(cutX)}" y1="${cardTop + 6}" x2="${round(cutX)}" y2="${cardBottom - 6}" stroke="${P.error}" stroke-width="2.2" stroke-dasharray="5 4"/>`
      );
      return out + result(at + 0.34, label, toCol);
    }
    if (act.kind === "zero-extend") {
      toBytes.forEach((b, idx) => {
        const lsbPos = toBytes.length - 1 - idx;
        const isExt = lsbPos >= fromBytes.length;
        const block = drawByte(slotX(lsbPos), yBits, yHex, b, {
          bits: isExt ? P.muted : P.fg,
          hex: isExt ? P.muted : toCol
        });
        if (!isExt) out += block;
        else if (animate) out += `<g opacity="0">${fade(0, 1, 0.35, at)}${block}</g>`;
        else out += block;
      });
      return out + result(at + 0.35, label, toCol);
    }
    if (act.kind === "sign-extend") {
      const ext = act.signBit === 1 ? { stroke: P.write, fill: P.writeFill } : { stroke: P.read, fill: P.readFill };
      const srcX = slotX(fromBytes.length - 1);
      const msbX = bitCx(srcX, 0);
      const litAt2 = Math.max(0.2, at - 0.25);
      fromBytes.forEach((b, idx) => {
        const lsbPos = fromBytes.length - 1 - idx;
        const bx = slotX(lsbPos);
        if (lsbPos !== fromBytes.length - 1) {
          out += drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
          return;
        }
        const lit = signFrame(bx, yBits, ext.stroke, ext.fill) + drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol, msb: ext.stroke });
        const plain = drawByte(bx, yBits, yHex, b, { bits: P.fg, hex: toCol });
        out += animate ? swap(litAt2, plain, scaled(msbX, yBits - 8, lit, litAt2)) : lit;
      });
      const extCount = toBytes.length - fromBytes.length;
      const doneAt = at + (extCount - 1) * STAGGER + TRAVEL;
      const startY = yBits - BOX_TOP - 2;
      let arcs = "";
      for (let k = 0; k < extCount; k++) {
        const lsbPos = fromBytes.length + k;
        const bx = slotX(lsbPos);
        const copy = drawByte(bx, yBits, yHex, toBytes[toBytes.length - 1 - lsbPos], { bits: ext.stroke, hex: ext.stroke });
        if (!animate) {
          out += copy;
          continue;
        }
        const begin = at + k * STAGGER;
        const land = begin + TRAVEL;
        const tipX = bx + BYTE_W / 2;
        const tipY = yBits - BIT_FONT - 2;
        const peakY = startY - 16 - k * ARC_RISE;
        const ctrlX = (msbX + tipX) / 2;
        const ctrlY = 2 * peakY - (startY + tipY) / 2;
        const dx = tipX - ctrlX;
        const dy = tipY - ctrlY;
        const len = Math.hypot(dx, dy) || 1;
        const ex = tipX - 7 * dx / len;
        const ey = tipY - 7 * dy / len;
        const path = (x, y) => `M ${round(msbX)} ${round(startY)} Q ${round(ctrlX)} ${round(ctrlY)}, ${round(x)} ${round(y)}`;
        arcs += `<path d="${path(ex, ey)}" fill="none" stroke="${ext.stroke}" stroke-width="2.2" stroke-linecap="round" data-grow="${round(begin)}"/>`;
        arcs += `<g opacity="0">${show(land - 0.06)}${arrowheadAt(tipX, tipY, dx, dy, ext.stroke)}</g>`;
        arcs += `<g opacity="0">${show(begin)}${hide(land + 0.04)}<circle r="10" fill="${ext.fill}" stroke="${ext.stroke}" stroke-width="1.6"/>` + text(0, 5, String(act.signBit), 15, ext.stroke, "middle") + `<animateMotion begin="${round(begin)}s" dur="${TRAVEL}s" path="${path(tipX, tipY)}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        out += `<g opacity="0">${show(land)}${scaled(tipX, yBits, copy, land)}</g>`;
      }
      if (arcs) out += `<g>${fade(1, 0, 0.32, doneAt + 0.35)}${arcs}</g>`;
      return out + result(doneAt, label, toCol);
    }
    out += swap(at, plainValue(act.beforeVal, act.fromInfo, fromCol), plainValue(act.afterVal, act.toInfo, toCol));
    return out + result(at + 0.12, label, toCol);
  }
  function bitsScene(c) {
    const { step, prev, animate } = c;
    const lineChanged = animate && prev !== null && prev.line !== step.line;
    const oldLine = lineChanged && prev ? prev.line : null;
    return code(c, oldLine) + tether(c, oldLine) + arrows(c) + memory(c) + pane(c, animate && copies(c.m.steps, c.index)) + workbench(c) + output(c) + transfers(c);
  }
  const BITS_VIEW = {
    geometry(m) {
      const { bytes, labelChars, drop } = workbenchExtent(m);
      const workbench2 = 12 + slotsWidth(bytes) + RESULT_GAP + labelWidth(labelChars) + CARD_PAD + 28;
      return {
        minByteWidth: 66,
        minColumnWidth: Math.max(680, Math.ceil(workbench2)),
        cellHeight: BITS_CELL,
        extraPaneHeight: 120 + drop,
        skipWrap: true
      };
    },
    stackBelow: 900,
    maxScale: 0.78,
    byteOrder: true,
    scene: bitsScene,
    stepSeconds: bitStepSeconds
  };
  const DEFAULT_VIEW = {
    stackBelow: STACK_BELOW,
    maxScale: MAX_SCALE,
    byteOrder: false,
    scene,
    stepSeconds: (m, index) => stepSeconds(m.steps, index)
  };
  const viewOf = (m) => m.trace.bits ? BITS_VIEW : DEFAULT_VIEW;
  class Player {
    constructor(host, trace, view) {
      __publicField(this, "host");
      __publicField(this, "m");
      __publicField(this, "S");
      __publicField(this, "view");
      __publicField(this, "index");
      __publicField(this, "elapsed");
      __publicField(this, "duration");
      __publicField(this, "rate");
      /** Steps jump to their settled state instead of animating. */
      __publicField(this, "instant");
      /** Memory's byte order, for a view that draws bytes. */
      __publicField(this, "littleEndian");
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
      __publicField(this, "syncSpeedMenu", null);
      __publicField(this, "observer", null);
      __publicField(this, "P");
      __publicField(this, "g");
      __publicField(this, "shownType");
      this.host = host;
      this.m = prepare(trace);
      this.S = strings();
      this.view = view ?? viewOf(this.m);
      this.index = 0;
      this.elapsed = 0;
      this.duration = 0;
      this.rate = 1;
      this.instant = false;
      this.littleEndian = true;
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
      const order = (side, label, title) => `<button type="button" class="cv-endian-seg" data-endian-side="${side}" aria-pressed="${side === "le" === this.littleEndian}" title="${esc(title)}">${esc(label)}</button>`;
      const endianToggle = this.view.byteOrder ? `<div class="cv-endian" role="group" aria-label="${esc(S.byteOrder)}">` + order("le", S.littleEndianShort, S.littleEndian) + order("be", S.bigEndianShort, S.bigEndian) + "</div>" : "";
      root.innerHTML = `<div class="cv-view"><svg class="cv-stage" role="group" aria-label="${esc(S.stage)}" xmlns="http://www.w3.org/2000/svg"><g class="cv-scene" aria-hidden="true"></g><g class="cv-lines">${lineTargets(this.m, S)}</g></svg><div class="cv-type" aria-hidden="true" hidden></div></div><div class="cv-controls"><div class="cv-transport">` + button("play", S.play, "play", " cv-primary") + button("back", S.back, "back") + button("next", S.next, "next") + button("replay", S.replay, "replay", " cv-icon-only") + `<select class="cv-speed" aria-label="${esc(S.speed)}" title="${esc(S.speed)}">` + [0.5, 1, 1.5, 2].map((v) => `<option value="${v}"${v === 1 ? " selected" : ""}>${v}×</option>`).join("") + `<option value="instant" title="${esc(S.instant)}" aria-label="${esc(S.instant)}">⚡</option></select>` + endianToggle + button("reset", S.reset, "reset", " cv-reset") + `</div><div class="cv-progress"><input class="cv-scrub" type="range" min="0" max="${this.m.steps.length - 1}" value="0" step="1" aria-label="${esc(S.scrub)}"><span class="cv-count"></span></div></div><div class="cv-status" aria-live="polite"></div>`;
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
        var _a, _b;
        const target = (_a = event.target) == null ? void 0 : _a.closest("[data-action]");
        if (target && target.dataset.action) {
          this.invokeAction(target.dataset.action);
        }
        const side = (_b = event.target) == null ? void 0 : _b.closest("[data-endian-side]");
        if (side) this.byteOrder(side.dataset.endianSide === "le");
      });
      const menu = root.querySelector(".cv-speed");
      const instant = menu.querySelector("option[value=instant]");
      const spell = () => {
        const focused = document.activeElement === menu;
        instant.textContent = focused && menu.value !== "instant" ? `${S.instant} ⚡` : "⚡";
      };
      const syncMenu = () => {
        const choice = this.instant ? "instant" : String(this.rate);
        if (menu.value !== choice) menu.value = choice;
        const label = choice === "instant" ? `${S.speed}: ${S.instant}` : S.speed;
        menu.title = label;
        menu.setAttribute("aria-label", label);
        spell();
      };
      this.syncSpeedMenu = syncMenu;
      menu.addEventListener("focus", spell);
      menu.addEventListener("blur", spell);
      menu.addEventListener("change", () => {
        this.speed(menu.value);
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
    /** Draw memory in the given byte order. */
    byteOrder(littleEndian) {
      if (littleEndian === this.littleEndian) return;
      this.littleEndian = littleEndian;
      for (const side of this.root.querySelectorAll("[data-endian-side]")) {
        side.setAttribute("aria-pressed", String(side.dataset.endianSide === "le" === littleEndian));
      }
      this.refresh();
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
      var _a, _b;
      const width = this.root.clientWidth;
      if (width !== this.layoutWidth) {
        this.stacked = width > 0 && width < this.view.stackBelow;
        this.g = this.view.layout ? this.view.layout(this.m, this.P, this.stacked, width) : geometry(this.m, this.P, this.stacked, width, (_b = (_a = this.view).geometry) == null ? void 0 : _b.call(_a, this.m));
        this.layoutWidth = width;
        this.shownType = null;
        this.typeBox.hidden = true;
      }
      const steps = this.m.steps;
      const step = steps[this.index];
      const prev = this.index ? steps[this.index - 1] : null;
      const g = this.g;
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
        focus: stepFocus(this.m, this.index, animate),
        littleEndian: this.littleEndian
      };
      this.animated = animate;
      this.svg.setAttribute("viewBox", `0 0 ${Math.ceil(g.width)} ${Math.ceil(g.height)}`);
      this.svg.style.maxWidth = `${Math.ceil(g.width * this.view.maxScale)}px`;
      this.scene.innerHTML = `<rect width="100%" height="100%" fill="${this.P.bg}"/>` + this.view.scene(c);
      placeLineTargets(g, this.lines);
      this.finishPaths();
      this.seek(0);
      this.update(describe(c));
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
      this.stop();
      this.pristine = false;
      this.continuous = autoplay;
      this.index = index;
      this.elapsed = 0;
      this.duration = this.instant ? autoplay ? T.instantHold : 0 : this.view.stepSeconds(this.m, index);
      this.render(!this.instant);
      if (this.duration > 0 || autoplay) this.resume();
    }
    /**
     * A speed menu choice: a playback rate, or `instant`. A step under way at Instant settles: a
     * running one holds there before the next, a paused one stays paused.
     */
    speed(choice) {
      var _a;
      this.instant = choice === "instant";
      if (!this.instant) this.rate = Number(choice);
      (_a = this.syncSpeedMenu) == null ? void 0 : _a.call(this);
      if (!this.instant || !this.animated) return;
      if (this.running) {
        this.start(this.index, this.continuous);
      } else if (!this.finished) {
        this.render(false);
        this.elapsed = this.duration = 0;
      }
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
      const rate = this.animated ? this.rate : 1;
      this.elapsed = Math.min(this.duration, this.elapsed + (now - this.last) / 1e3 * rate);
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
    /** The extra 1× time a multi-level storage walk adds to step `index`'s animation. */
    walkSeconds(index) {
      return stepWalkSeconds(this.m.steps, index);
    }
  }
  const META = /* @__PURE__ */ new WeakMap();
  function encodeBytes(value, size, littleEndian) {
    const big = BigInt.asUintN(size * 8, BigInt(Math.trunc(value)));
    const msb = [];
    for (let i = size - 1; i >= 0; i--) {
      msb.push(Number(big >> BigInt(i * 8) & 0xffn));
    }
    return littleEndian ? msb.reverse() : msb;
  }
  function decodeBytes(bytes, signed, littleEndian) {
    const ordered = littleEndian ? [...bytes].reverse() : bytes;
    let acc = 0n;
    for (const b of ordered) {
      acc = acc << 8n | BigInt(b & 255);
    }
    if (signed) {
      const bits = BigInt(bytes.length * 8);
      const signBit = 1n << bits - 1n;
      if (acc >= signBit) acc -= 1n << bits;
    }
    return Number(acc);
  }
  const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, "0");
  function ownerAt(meta, addr) {
    for (const v of meta.vars) {
      if (addr >= v.address && addr < v.address + v.size) return v;
    }
    return null;
  }
  function snapshotAt(meta, stepIndex, littleEndian) {
    const mem = [];
    for (let i = 0; i < meta.totalBytes; i++) {
      const addr = meta.baseAddress + i;
      mem.push(ownerAt(meta, addr) ? null : "?");
    }
    for (const init2 of meta.initSteps) {
      if (init2.stepIndex <= stepIndex) {
        const v = meta.vars.find((x) => x.name === init2.varName);
        const bs = encodeBytes(init2.value, v.size, littleEndian);
        for (let k = 0; k < v.size; k++) {
          mem[v.address - meta.baseAddress + k] = bs[k];
        }
      }
    }
    if (meta.writeAction.stepIndex <= stepIndex) {
      const bs = encodeBytes(meta.writeAction.value, meta.pointeeSize, littleEndian);
      for (let k = 0; k < meta.pointeeSize; k++) {
        const idx = meta.targetAddress - meta.baseAddress + k;
        if (idx >= 0 && idx < mem.length) mem[idx] = bs[k];
      }
    }
    return mem;
  }
  function decodeVarValues(meta, mem, littleEndian) {
    const out = /* @__PURE__ */ new Map();
    for (const v of meta.vars) {
      const slice = mem.slice(v.address - meta.baseAddress, v.address - meta.baseAddress + v.size);
      if (slice.some((b) => typeof b !== "number")) {
        out.set(v.name, null);
      } else {
        out.set(v.name, decodeBytes(slice, v.signed, littleEndian));
      }
    }
    return out;
  }
  function simulate(meta, stepIndex, littleEndian) {
    const beforeMem = stepIndex > 0 ? snapshotAt(meta, stepIndex - 1, littleEndian) : snapshotAt(meta, 0, littleEndian);
    const afterMem = snapshotAt(meta, stepIndex, littleEndian);
    const ptrLive = stepIndex >= meta.ptrInitStep;
    const windowActive = stepIndex >= meta.derefStep;
    const isPunningWrite = stepIndex === meta.writeAction.stepIndex;
    const writeDone = stepIndex >= meta.writeAction.stepIndex;
    const wStart = meta.targetAddress;
    const wEnd = meta.targetAddress + meta.pointeeSize;
    const targetVar = meta.vars.find((v) => v.name === meta.targetVar);
    const tStart = targetVar.address;
    const tEnd = targetVar.address + targetVar.size;
    const bytes = [];
    let ubTriggered = false;
    const corruptedVars = /* @__PURE__ */ new Set();
    for (let i = 0; i < meta.totalBytes; i++) {
      const address = meta.baseAddress + i;
      const owner = ownerAt(meta, address);
      const inWindow = ptrLive && address >= wStart && address < wEnd;
      let status = "none";
      if (inWindow) {
        if (!owner) {
          status = "padding";
          if (writeDone) ubTriggered = true;
        } else if (owner.name === meta.targetVar) {
          status = "owned";
        } else {
          status = "foreign";
          if (writeDone) {
            ubTriggered = true;
            corruptedVars.add(owner.name);
          }
        }
      } else if (ptrLive && address >= tStart && address < tEnd) {
        status = "untouched";
      }
      const before = beforeMem[i];
      const after = afterMem[i];
      bytes.push({
        address,
        owner,
        before,
        after,
        changed: stepIndex > 0 && before !== after,
        status,
        inWindow
      });
    }
    return {
      bytes,
      varBefore: decodeVarValues(meta, beforeMem, littleEndian),
      varAfter: decodeVarValues(meta, afterMem, littleEndian),
      corruptedVars,
      ubTriggered,
      ptrLive,
      windowActive,
      isPunningWrite,
      writtenBytes: encodeBytes(meta.writeAction.value, meta.pointeeSize, littleEndian)
    };
  }
  function makeScenario1() {
    const vars = [
      { name: "a", type: "uint8_t", address: 64, size: 1, kind: "int", signed: false, color: 0 },
      { name: "c", type: "int", address: 68, size: 4, kind: "int", signed: true, color: 2 },
      { name: "b", type: "int*", address: 72, size: 8, kind: "ptr", signed: false, color: 1 }
    ];
    const traceVars = vars.map((v) => ({
      name: v.name,
      address: v.address,
      size: v.size,
      kind: v.kind,
      color: v.color,
      type: v.type
    }));
    const source = [
      "uint8_t a{ 5 };",
      "int c{ 10 };",
      "int* b{ &a };",
      "*b = 300;"
    ];
    const v0 = { a: null, c: null, b: null };
    const v1 = { a: 5, c: null, b: null };
    const v2 = { a: 5, c: 10, b: null };
    const v3 = { a: 5, c: 10, b: 64 };
    const v4 = { a: 44, c: 10, b: 64 };
    const steps = [
      { line: 0, pane: "uint8_t a{ 5 }", expr: [11, 12], values: v0, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 0,
        pane: "uint8_t a{ 5 }",
        expr: [11, 12],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "write", name: "a", value: "5", span: [11, 12], destination: [8, 9] }
      },
      { line: 1, pane: "int c{ 10 }", expr: [7, 9], values: v1, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 1,
        pane: "int c{ 10 }",
        expr: [7, 9],
        values: v2,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "write", name: "c", value: "10", span: [7, 9], destination: [4, 5] }
      },
      { line: 2, pane: "int* b{ &a }", expr: [8, 10], values: v2, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 2,
        pane: "int* b{ 64 }",
        expr: [8, 10],
        values: v2,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "addr", name: "a", value: "64", span: [8, 10] }
      },
      {
        line: 2,
        pane: "int* b{ 64 }",
        expr: [8, 10],
        values: v3,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "write", name: "b", value: "64", span: [8, 10], destination: [5, 6] }
      },
      { line: 3, pane: "*b = 300", expr: [0, 2], values: v3, targets: { b: "a" }, stdout: "", hold: 0.7, op: null },
      {
        line: 3,
        pane: "*64 = 300",
        expr: [0, 3],
        values: v3,
        targets: { b: "a" },
        stdout: "",
        hold: 0.9,
        op: { kind: "read", name: "b", value: "64", span: [1, 2] }
      },
      {
        line: 3,
        pane: "*64 = 300",
        expr: [0, 3],
        values: v3,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "deref", target: "a", via: "b", span: [0, 3] }
      },
      {
        line: 3,
        pane: "*64 = 300",
        expr: [6, 9],
        values: v4,
        targets: { b: "a" },
        stdout: "",
        hold: 1.8,
        op: { kind: "write", name: "a", value: "300", span: [6, 9], destination: [0, 3] }
      }
    ];
    const trace = {
      format: 1,
      title: "Larger pointer overwrites alignment padding",
      source,
      variables: traceVars,
      steps
    };
    const meta = {
      id: "larger-padding",
      title: "1. Larger pointer writes past 1-byte object into padding",
      subtitle: "Scope locks onto 64..67 on line 3; writing *b = 300 highlights all 4 written bytes and marks spilled padding red.",
      direction: "larger",
      baseAddress: 64,
      totalBytes: 16,
      vars,
      ptrName: "b",
      pointeeType: "int",
      pointeeSize: 4,
      targetVar: "a",
      targetAddress: 64,
      ptrInitStep: 6,
      derefStep: 9,
      writeAction: { stepIndex: 10, value: 300, valueText: "300" },
      initSteps: [
        { stepIndex: 1, varName: "a", value: 5 },
        { stepIndex: 3, varName: "c", value: 10 },
        { stepIndex: 6, varName: "b", value: 64 }
      ]
    };
    META.set(trace, meta);
    return { trace, meta };
  }
  function makeScenario2() {
    const vars = [
      { name: "a", type: "uint8_t", address: 64, size: 1, kind: "int", signed: false, color: 0 },
      { name: "c", type: "uint8_t", address: 65, size: 1, kind: "int", signed: false, color: 3 },
      { name: "d", type: "int", address: 68, size: 4, kind: "int", signed: true, color: 2 },
      { name: "b", type: "int*", address: 72, size: 8, kind: "ptr", signed: false, color: 1 }
    ];
    const traceVars = vars.map((v) => ({
      name: v.name,
      address: v.address,
      size: v.size,
      kind: v.kind,
      color: v.color,
      type: v.type
    }));
    const source = [
      "uint8_t a{ 5 };",
      "uint8_t c{ 9 };",
      "int d{ 10 };",
      "int* b{ &a };",
      "*b = 0x04030201;"
    ];
    const v0 = { a: null, c: null, d: null, b: null };
    const v1 = { a: 5, c: null, d: null, b: null };
    const v2 = { a: 5, c: 9, d: null, b: null };
    const v3 = { a: 5, c: 9, d: 10, b: null };
    const v4 = { a: 5, c: 9, d: 10, b: 64 };
    const v5 = { a: 1, c: 2, d: 10, b: 64 };
    const steps = [
      { line: 0, pane: "uint8_t a{ 5 }", expr: [11, 12], values: v0, targets: {}, stdout: "", hold: 0.6, op: null },
      {
        line: 0,
        pane: "uint8_t a{ 5 }",
        expr: [11, 12],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.8,
        op: { kind: "write", name: "a", value: "5", span: [11, 12], destination: [8, 9] }
      },
      { line: 1, pane: "uint8_t c{ 9 }", expr: [11, 12], values: v1, targets: {}, stdout: "", hold: 0.6, op: null },
      {
        line: 1,
        pane: "uint8_t c{ 9 }",
        expr: [11, 12],
        values: v2,
        targets: {},
        stdout: "",
        hold: 0.8,
        op: { kind: "write", name: "c", value: "9", span: [11, 12], destination: [8, 9] }
      },
      { line: 2, pane: "int d{ 10 }", expr: [7, 9], values: v2, targets: {}, stdout: "", hold: 0.6, op: null },
      {
        line: 2,
        pane: "int d{ 10 }",
        expr: [7, 9],
        values: v3,
        targets: {},
        stdout: "",
        hold: 0.8,
        op: { kind: "write", name: "d", value: "10", span: [7, 9], destination: [4, 5] }
      },
      { line: 3, pane: "int* b{ &a }", expr: [8, 10], values: v3, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 3,
        pane: "int* b{ 64 }",
        expr: [8, 10],
        values: v3,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "addr", name: "a", value: "64", span: [8, 10] }
      },
      {
        line: 3,
        pane: "int* b{ 64 }",
        expr: [8, 10],
        values: v4,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "write", name: "b", value: "64", span: [8, 10], destination: [5, 6] }
      },
      { line: 4, pane: "*b = 0x04030201", expr: [0, 2], values: v4, targets: { b: "a" }, stdout: "", hold: 0.7, op: null },
      {
        line: 4,
        pane: "*64 = 0x04030201",
        expr: [0, 3],
        values: v4,
        targets: { b: "a" },
        stdout: "",
        hold: 0.9,
        op: { kind: "read", name: "b", value: "64", span: [1, 2] }
      },
      {
        line: 4,
        pane: "*64 = 0x04030201",
        expr: [0, 3],
        values: v4,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "deref", target: "a", via: "b", span: [0, 3] }
      },
      {
        line: 4,
        pane: "*64 = 0x04030201",
        expr: [6, 16],
        values: v5,
        targets: { b: "a" },
        stdout: "",
        hold: 1.8,
        op: { kind: "write", name: "a", value: "0x04030201", span: [6, 16], destination: [0, 3] }
      }
    ];
    const trace = {
      format: 1,
      title: "Larger pointer corrupts adjacent variable and padding",
      source,
      variables: traceVars,
      steps
    };
    const meta = {
      id: "larger-adjacent",
      title: "2. Larger pointer silently corrupts an adjacent variable",
      subtitle: "a (64) and c (65) sit side by side. Writing *b = 0x04030201 overwrites c and padding.",
      direction: "larger",
      baseAddress: 64,
      totalBytes: 16,
      vars,
      ptrName: "b",
      pointeeType: "int",
      pointeeSize: 4,
      targetVar: "a",
      targetAddress: 64,
      ptrInitStep: 8,
      derefStep: 11,
      writeAction: { stepIndex: 12, value: 67305985, valueText: "0x04030201" },
      initSteps: [
        { stepIndex: 1, varName: "a", value: 5 },
        { stepIndex: 3, varName: "c", value: 9 },
        { stepIndex: 5, varName: "d", value: 10 },
        { stepIndex: 8, varName: "b", value: 64 }
      ]
    };
    META.set(trace, meta);
    return { trace, meta };
  }
  function makeScenario3() {
    const vars = [
      { name: "a", type: "int", address: 64, size: 4, kind: "int", signed: true, color: 0 },
      { name: "b", type: "uint8_t*", address: 72, size: 8, kind: "ptr", signed: false, color: 1 }
    ];
    const traceVars = vars.map((v) => ({
      name: v.name,
      address: v.address,
      size: v.size,
      kind: v.kind,
      color: v.color,
      type: v.type
    }));
    const source = [
      "int a = 5;",
      "uint8_t* b = &a;",
      "*b = 2;"
    ];
    const v0 = { a: null, b: null };
    const v1 = { a: 5, b: null };
    const v2 = { a: 5, b: 64 };
    const v3 = { a: 2, b: 64 };
    const steps = [
      { line: 0, pane: "int a = 5", expr: [8, 9], values: v0, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 0,
        pane: "int a = 5",
        expr: [8, 9],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "write", name: "a", value: "5", span: [8, 9], destination: [4, 5] }
      },
      { line: 1, pane: "uint8_t* b = &a", expr: [13, 15], values: v1, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 1,
        pane: "uint8_t* b = 64",
        expr: [13, 15],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "addr", name: "a", value: "64", span: [13, 15] }
      },
      {
        line: 1,
        pane: "uint8_t* b = 64",
        expr: [13, 15],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "write", name: "b", value: "64", span: [13, 15], destination: [9, 10] }
      },
      { line: 2, pane: "*b = 2", expr: [0, 2], values: v2, targets: { b: "a" }, stdout: "", hold: 0.7, op: null },
      {
        line: 2,
        pane: "*64 = 2",
        expr: [0, 3],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 0.9,
        op: { kind: "read", name: "b", value: "64", span: [1, 2] }
      },
      {
        line: 2,
        pane: "*64 = 2",
        expr: [0, 3],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "deref", target: "a", via: "b", span: [0, 3] }
      },
      {
        line: 2,
        pane: "*64 = 2",
        expr: [6, 7],
        values: v3,
        targets: { b: "a" },
        stdout: "",
        hold: 1.8,
        op: { kind: "write", name: "a", value: "2", span: [6, 7], destination: [0, 3] }
      }
    ];
    const trace = {
      format: 1,
      title: "Smaller pointer overwrites one byte of an int",
      source,
      variables: traceVars,
      steps
    };
    const meta = {
      id: "smaller-five",
      title: "3. Smaller pointer overwrites only byte 64 of int a (a = 5)",
      subtitle: "Hit Play or Replay on step 9 to see the tall 1-byte write highlight on byte 64. Flip LE/BE for 2 vs 33554437.",
      direction: "smaller",
      baseAddress: 64,
      totalBytes: 16,
      vars,
      ptrName: "b",
      pointeeType: "uint8_t",
      pointeeSize: 1,
      targetVar: "a",
      targetAddress: 64,
      ptrInitStep: 4,
      derefStep: 7,
      writeAction: { stepIndex: 8, value: 2, valueText: "2" },
      initSteps: [
        { stepIndex: 1, varName: "a", value: 5 },
        { stepIndex: 4, varName: "b", value: 64 }
      ]
    };
    META.set(trace, meta);
    return { trace, meta };
  }
  function makeScenario4() {
    const vars = [
      { name: "a", type: "int", address: 64, size: 4, kind: "int", signed: true, color: 0 },
      { name: "b", type: "uint8_t*", address: 72, size: 8, kind: "ptr", signed: false, color: 1 }
    ];
    const traceVars = vars.map((v) => ({
      name: v.name,
      address: v.address,
      size: v.size,
      kind: v.kind,
      color: v.color,
      type: v.type
    }));
    const source = [
      "int a = 261;",
      "uint8_t* b = &a;",
      "*b = 0;"
    ];
    const v0 = { a: null, b: null };
    const v1 = { a: 261, b: null };
    const v2 = { a: 261, b: 64 };
    const v3 = { a: 256, b: 64 };
    const steps = [
      { line: 0, pane: "int a = 261", expr: [8, 11], values: v0, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 0,
        pane: "int a = 261",
        expr: [8, 11],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "write", name: "a", value: "261", span: [8, 11], destination: [4, 5] }
      },
      { line: 1, pane: "uint8_t* b = &a", expr: [13, 15], values: v1, targets: {}, stdout: "", hold: 0.7, op: null },
      {
        line: 1,
        pane: "uint8_t* b = 64",
        expr: [13, 15],
        values: v1,
        targets: {},
        stdout: "",
        hold: 0.9,
        op: { kind: "addr", name: "a", value: "64", span: [13, 15] }
      },
      {
        line: 1,
        pane: "uint8_t* b = 64",
        expr: [13, 15],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "write", name: "b", value: "64", span: [13, 15], destination: [9, 10] }
      },
      { line: 2, pane: "*b = 0", expr: [0, 2], values: v2, targets: { b: "a" }, stdout: "", hold: 0.7, op: null },
      {
        line: 2,
        pane: "*64 = 0",
        expr: [0, 3],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 0.9,
        op: { kind: "read", name: "b", value: "64", span: [1, 2] }
      },
      {
        line: 2,
        pane: "*64 = 0",
        expr: [0, 3],
        values: v2,
        targets: { b: "a" },
        stdout: "",
        hold: 1.2,
        op: { kind: "deref", target: "a", via: "b", span: [0, 3] }
      },
      {
        line: 2,
        pane: "*64 = 0",
        expr: [6, 7],
        values: v3,
        targets: { b: "a" },
        stdout: "",
        hold: 1.8,
        op: { kind: "write", name: "a", value: "0", span: [6, 7], destination: [0, 3] }
      }
    ];
    const trace = {
      format: 1,
      title: "Smaller pointer leaves upper bytes of int intact",
      source,
      variables: traceVars,
      steps
    };
    const meta = {
      id: "smaller-261",
      title: "4. Smaller pointer leaves upper bytes intact (a = 261, *b = 0)",
      subtitle: "261 is 05 01 00 00 (LE). *b = 0 zeroes only byte 64, leaving byte 65 (01) -> a becomes 256.",
      direction: "smaller",
      baseAddress: 64,
      totalBytes: 16,
      vars,
      ptrName: "b",
      pointeeType: "uint8_t",
      pointeeSize: 1,
      targetVar: "a",
      targetAddress: 64,
      ptrInitStep: 4,
      derefStep: 7,
      writeAction: { stepIndex: 8, value: 0, valueText: "0" },
      initSteps: [
        { stepIndex: 1, varName: "a", value: 261 },
        { stepIndex: 4, varName: "b", value: 64 }
      ]
    };
    META.set(trace, meta);
    return { trace, meta };
  }
  const SCENARIOS = [makeScenario1(), makeScenario2(), makeScenario3(), makeScenario4()];
  let patternSeq = 0;
  function hatchDefs(P) {
    const uid = ++patternSeq;
    const padId = `cv-pad-hatch-${uid}`;
    const ubId = `cv-ub-hatch-${uid}`;
    const defs = `<defs><pattern id="${padId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="${P.deadFill}"/><line x1="0" y1="0" x2="0" y2="10" stroke="${P.gapStroke}" stroke-width="3.2"/></pattern><pattern id="${ubId}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="${P.panel}"/><rect width="10" height="10" fill="${P.error}" fill-opacity="0.13"/><line x1="0" y1="0" x2="0" y2="10" stroke="${P.error}" stroke-opacity="0.34" stroke-width="2.8"/></pattern></defs>`;
    return { defs, padId, ubId };
  }
  function varColor(P, v) {
    return P.vars[v.color % VARIABLE_COLOURS];
  }
  function pill(cx, cy, label, size, fill, stroke, ink) {
    const w = label.length * size * CHAR + 16;
    const h = size + 10;
    return rect(cx - w / 2, cy - h / 2, w, h, fill, stroke, h / 2, 1.8) + text(cx, cy + size * 0.35, label, size, ink, "middle");
  }
  function scaledAt(cx, cy, inner, begin) {
    return `<g transform="translate(${round(cx)} ${round(cy)})"><g>${pulse(begin)}<g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g>`;
  }
  function paddingRuns(meta) {
    const runs = [];
    let start = null;
    for (let i = 0; i < meta.totalBytes; i++) {
      const addr = meta.baseAddress + i;
      if (!ownerAt(meta, addr)) {
        if (start === null) start = addr;
      } else if (start !== null) {
        runs.push({ start, size: addr - start });
        start = null;
      }
    }
    if (start !== null) runs.push({ start, size: meta.baseAddress + meta.totalBytes - start });
    return runs;
  }
  function punningStepSeconds(m, index) {
    const meta = META.get(m.trace);
    if (meta && index === meta.writeAction.stepIndex) return m.steps[index].hold + 2.3;
    if (meta && index === meta.derefStep) return m.steps[index].hold + 1.6;
    if (meta && index === meta.ptrInitStep) return m.steps[index].hold + 2.4;
    return stepSeconds(m.steps, index);
  }
  function gridValueBox(c, value, color, path, begin, travel, end) {
    const half = Math.max(26, value.length * c.g.paneChar / 2 + 12);
    return `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g><g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}` + rect(-half, -23, 2 * half, 46, c.P.panel, color, 9) + text(0, 10, value, c.g.paneSize, c.P.fg, "middle") + `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
  }
  function gridTransfers(c, meta, sim, xOf, byteW, gridY, cellH) {
    const { g, P, op, animate } = c;
    if (!animate || !op || sim.isPunningWrite) return "";
    const at = arrival(op);
    const begin = departure(op);
    const ty = g.ty - 11;
    const below = g.below;
    const spanCentre = (span) => g.tx + (span[0] + span[1]) / 2 * g.paneChar;
    const p = (...vals) => vals.map(round).join(" ");
    if (op.kind === "read") {
      const v = meta.vars.find((x) => x.name === op.name);
      if (!v) return "";
      const sx = xOf(v.address) + v.size * byteW / 2;
      const sy = gridY + cellH / 2;
      const dx = spanCentre(op.span);
      return gridValueBox(
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
      const v = meta.vars.find((x) => x.name === op.name);
      if (!v) return "";
      const sx = xOf(v.address) + byteW / 2;
      const sy = gridY - 17;
      const dx = spanCentre(op.span);
      const side = xOf(v.address) - 18;
      const flash = `<g opacity="0">${fade(0, 1, 0.15, begin - 0.1)}${fade(1, 0, 0.2, at + 0.1)}` + rect(sx - 15, sy - 12, 30, 22, P.readFill, P.read, 5, 2) + "</g>";
      return flash + gridValueBox(
        c,
        op.value,
        P.read,
        `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, gridY + cellH)}, ${p(side, below)} C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`,
        begin,
        T.travel,
        at
      );
    }
    if (op.kind === "write") {
      const v = meta.vars.find((x) => x.name === op.name);
      if (!v) return "";
      const sx = spanCentre(op.span);
      const ex = xOf(v.address) + v.size * byteW / 2;
      const ey = gridY + cellH / 2;
      return gridValueBox(
        c,
        op.value,
        P.write,
        `M ${p(sx, ty)} C ${p(sx, below)}, ${p(ex, below)}, ${p(ex, ey)}`,
        begin,
        T.travel,
        at
      );
    }
    return "";
  }
  function drawHudReticle(bx, by, bw, bh, leftCol, rightCol, splitX) {
    const arm = Math.min(14, bw * 0.28);
    const tick = 5;
    const rx = bx + bw;
    const ry = by + bh;
    const mx = bx + bw / 2;
    const my = by + bh / 2;
    const rightTopCol = splitX !== null ? rightCol : leftCol;
    const topTickCol = splitX !== null && mx >= splitX ? rightCol : leftCol;
    let out = "";
    if (splitX !== null) {
      out += `<path d="M ${round(splitX)} ${round(by)} H ${round(bx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/><path d="M ${round(splitX)} ${round(by)} H ${round(rx)} V ${round(ry)} H ${round(splitX)}" fill="none" stroke="${rightCol}" stroke-opacity="0.4" stroke-dasharray="3 3" stroke-width="1.3"/>`;
    } else {
      out += `<rect x="${round(bx)}" y="${round(by)}" width="${round(bw)}" height="${round(bh)}" fill="none" stroke="${leftCol}" stroke-opacity="0.32" stroke-dasharray="3 3" stroke-width="1.3"/>`;
    }
    out += `<path d="M ${round(bx)} ${round(by + arm)} V ${round(by)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/><path d="M ${round(bx)} ${round(ry - arm)} V ${round(ry)} H ${round(bx + arm)}" fill="none" stroke="${leftCol}" stroke-width="3.2" stroke-linecap="square"/><path d="M ${round(rx - arm)} ${round(by)} H ${round(rx)} V ${round(by + arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/><path d="M ${round(rx - arm)} ${round(ry)} H ${round(rx)} V ${round(ry - arm)}" fill="none" stroke="${rightTopCol}" stroke-width="3.2" stroke-linecap="square"/><line x1="${round(mx)}" y1="${round(by)}" x2="${round(mx)}" y2="${round(by + tick)}" stroke="${topTickCol}" stroke-width="2.2"/><line x1="${round(mx)}" y1="${round(ry)}" x2="${round(mx)}" y2="${round(ry - tick)}" stroke="${topTickCol}" stroke-width="2.2"/><line x1="${round(bx)}" y1="${round(my)}" x2="${round(bx + tick)}" y2="${round(my)}" stroke="${leftCol}" stroke-width="2.2"/><line x1="${round(rx)}" y1="${round(my)}" x2="${round(rx - tick)}" y2="${round(my)}" stroke="${rightTopCol}" stroke-width="2.2"/>`;
    return out;
  }
  function targetScopeReticle(c, meta, sim, xOf, byteW, gridY, cellH, pCol) {
    if (!sim.ptrLive) return "";
    const { P, animate, op } = c;
    const at = op ? arrival(op) : 0;
    const wLeft = xOf(meta.targetAddress);
    const wWidth = meta.pointeeSize * byteW;
    const targetVar = meta.vars.find((v) => v.name === meta.targetVar);
    const ownEnd = xOf(targetVar.address + targetVar.size);
    const pad = 3.5;
    const bx = wLeft - pad;
    const by = gridY - pad;
    const bw = wWidth + 2 * pad;
    const bh = cellH + 2 * pad;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const isWritingPtr = animate && (op == null ? void 0 : op.kind) === "write" && op.name === meta.ptrName;
    const isDeref = animate && c.index === meta.derefStep;
    const hot = sim.windowActive;
    let inner = "";
    if (meta.direction === "larger" && sim.ubTriggered) {
      const calm = drawHudReticle(bx, by, bw, bh, pCol, pCol, null);
      const breached = drawHudReticle(bx, by, bw, bh, P.write, P.error, ownEnd);
      inner = animate && sim.isPunningWrite ? `<g>${hide(at)}${calm}</g><g opacity="0">${show(at)}${breached}</g>` : breached;
    } else {
      const col = hot ? P.write : pCol;
      inner = drawHudReticle(bx, by, bw, bh, col, col, null);
    }
    if (isWritingPtr) {
      const lockBegin = at + 0.52;
      return `<g opacity="0">${fade(0, 1, 0.14, lockBegin)}<g transform="translate(${round(cx)} ${round(cy)})"><g><animateTransform attributeName="transform" type="scale" values="1.28;0.96;1" keyTimes="0;0.74;1" calcMode="spline" keySplines="0.2 0 0.2 1;0.4 0 0.2 1" begin="${round(lockBegin)}s" dur="0.46s" fill="freeze"/><g transform="translate(${round(-cx)} ${round(-cy)})">${inner}</g></g></g></g>`;
    }
    if (isDeref) {
      return scaledAt(cx, cy, inner, at - 0.18);
    }
    return inner;
  }
  function transientWriteHighlight(x, y, w, h, color, at) {
    return `<g opacity="0">${fade(0, 1, 0.15, Math.max(0, at - 0.25))}${fade(1, 0, 0.3, at + 0.35)}` + rect(x + 2, y + 2, w - 4, h - 4, color, "none", 0).replace("fill=", 'fill-opacity="0.2" fill=') + rect(x + 2, y + 2, w - 4, h - 4, "none", color, 0, 2.8) + "</g>";
  }
  function punningScene(c) {
    const meta = META.get(c.m.trace);
    const sim = simulate(meta, c.index, c.littleEndian);
    const { g, P, animate, op, step, prev } = c;
    const { defs, padId, ubId } = hatchDefs(P);
    const lineChanged = animate && prev !== null && prev.line !== step.line;
    const oldLine = lineChanged && prev ? prev.line : null;
    const byteW = (g.pane.w - 48) / meta.totalBytes;
    const gridX = g.memX;
    const gridY = g.memY;
    const cellH = 88;
    const splitY = gridY + 48;
    const xOf = (addr) => gridX + (addr - meta.baseAddress) * byteW;
    const at = op ? arrival(op) : 0;
    const ptrVar = meta.vars.find((v) => v.name === meta.ptrName);
    const targetVar = meta.vars.find((v) => v.name === meta.targetVar);
    const pCol = varColor(P, ptrVar);
    let mem = "";
    for (let i = 0; i < meta.totalBytes; i++) {
      const addr = meta.baseAddress + i;
      const owner = ownerAt(meta, addr);
      const isStart = owner && owner.address === addr;
      const bx = xOf(addr);
      mem += text(
        bx + byteW / 2,
        gridY - 12,
        addr,
        isStart ? 15 : 13,
        isStart ? P.muted : P.grey,
        "middle"
      );
    }
    for (const run of paddingRuns(meta)) {
      const rx = xOf(run.start);
      const rw = run.size * byteW;
      mem += rect(rx + 1, gridY + 1, rw - 2, cellH - 2, `url(#${padId})`, P.gapStroke, 0, 1.5);
      for (let k = 0; k < run.size; k++) {
        const addr = run.start + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bx = xOf(addr);
        if (k > 0) {
          mem += `<line x1="${round(bx)}" y1="${gridY + 2}" x2="${round(bx)}" y2="${gridY + cellH - 2}" stroke="${P.gapStroke}" stroke-dasharray="3 3" stroke-width="1"/>`;
        }
        const hexY = gridY + 74;
        if (slot.status === "padding" && sim.ubTriggered) {
          const hexText = typeof slot.after === "number" ? hex2(slot.after) : "??";
          const badgeBg = rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, "none", 3);
          const hazard = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, P.error, 0, 1.6) + badgeBg + text(bx + byteW / 2, hexY, hexText, 15.5, P.error, "middle");
          if (animate && sim.isPunningWrite) {
            const revealAt = at + 0.08 * (addr - meta.targetAddress);
            mem += `<g>${hide(revealAt)}${text(bx + byteW / 2, hexY, "??", 13.5, P.grey, "middle")}</g><g opacity="0">${show(revealAt)}${scaledAt(bx + byteW / 2, gridY + 68, hazard, revealAt - 0.1)}</g>`;
          } else {
            mem += hazard;
          }
        } else {
          mem += text(bx + byteW / 2, hexY, "??", 13.5, P.grey, "middle");
        }
      }
    }
    const pillRowEdge = [];
    const pillRowOf = /* @__PURE__ */ new Map();
    for (const v of meta.vars) {
      const cx = xOf(v.address) + v.size * byteW / 2;
      const half = typeLabelWidth(v.type, 13.5) / 2;
      let r = 0;
      while (pillRowEdge[r] !== void 0 && cx - half < pillRowEdge[r] + 6) r++;
      pillRowEdge[r] = cx + half;
      pillRowOf.set(v.name, r);
    }
    const pillRowsCount = Math.max(1, pillRowEdge.length);
    for (const v of meta.vars) {
      const vx = xOf(v.address);
      const vw = v.size * byteW;
      const col = varColor(P, v);
      const valAfter = sim.varAfter.get(v.name) ?? null;
      const valBefore = sim.varBefore.get(v.name) ?? null;
      const on = valAfter !== null;
      const isCorrupted = sim.corruptedVars.has(v.name);
      const borderCol = isCorrupted ? P.error : on ? col : P.deadStroke;
      let markup = "";
      markup += rect(vx + 1, gridY + 1, vw - 2, cellH - 2, on ? P.panel : P.deadFill, "none", 0);
      for (let k = 0; k < v.size; k++) {
        const addr = v.address + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bx = xOf(addr);
        if (slot.status === "foreign" && sim.ubTriggered) {
          const bg = rect(bx + 1.5, gridY + 1.5, byteW - 3, cellH - 3, `url(#${ubId})`, "none", 0);
          markup += animate && sim.isPunningWrite ? `<g opacity="0">${show(at + 0.08 * (addr - meta.targetAddress))}${bg}</g>` : bg;
        }
      }
      const divCol = on ? P.gapStroke : P.deadStroke;
      markup += `<line x1="${round(vx + 2)}" y1="${splitY}" x2="${round(vx + vw - 2)}" y2="${splitY}" stroke="${divCol}" stroke-width="1.2"/>`;
      for (let k = 1; k < v.size; k++) {
        const lx = xOf(v.address + k);
        markup += `<line x1="${round(lx)}" y1="${splitY}" x2="${round(lx)}" y2="${gridY + cellH - 2}" stroke="${divCol}" stroke-width="1.2"/>`;
      }
      if (animate && sim.isPunningWrite && isCorrupted) {
        markup += `<g>${hide(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, "none", col, 0, 2.8)}</g><g opacity="0">${show(at)}${rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, "none", P.error, 0, 3.2)}</g>`;
      } else {
        markup += rect(vx + 1.5, gridY + 1.5, vw - 3, cellH - 3, "none", borderCol, 0, isCorrupted ? 3.2 : 2.8);
      }
      const headCx = vx + vw / 2;
      const renderHeader = (val, useBefore) => {
        if (val === null) return "";
        const dec = String(val);
        const decSize = Math.min(25, (vw - 12) / (Math.max(1, dec.length) * CHAR));
        const decCol = isCorrupted && !useBefore ? P.error : P.fg;
        const bg = isCorrupted && !useBefore ? rect(headCx - 14, gridY + 12, 28, 26, P.panel, "none", 4) : "";
        return bg + text(headCx, gridY + 33, dec, round(decSize), decCol, "middle");
      };
      const normalWrite = animate && (op == null ? void 0 : op.kind) === "write" && op.name === v.name && !sim.isPunningWrite;
      const valueChanged = animate && sim.isPunningWrite && valBefore !== valAfter;
      if (normalWrite || valueChanged) {
        const headCy = gridY + 26;
        const swapped = (valBefore !== null ? `<g>${hide(at)}${renderHeader(valBefore, true)}</g>` : "") + `<g opacity="0">${show(at)}${renderHeader(valAfter, false)}</g>`;
        markup += scaledAt(headCx, headCy, swapped, at - 0.15);
      } else {
        markup += renderHeader(valAfter, false);
      }
      const hexY = gridY + 74;
      for (let k = 0; k < v.size; k++) {
        const addr = v.address + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bx = xOf(addr);
        const renderByte = (bval, useBefore) => {
          if (typeof bval !== "number") return "";
          const byteInk = slot.status === "foreign" && sim.ubTriggered && !useBefore ? P.error : v.kind === "ptr" ? P.muted : P.fg;
          const opAttr = v.kind === "ptr" ? ' opacity="0.65"' : "";
          const bg = slot.status === "foreign" && sim.ubTriggered && !useBefore ? rect(bx + byteW / 2 - 15, hexY - 15, 30, 20, P.panel, "none", 3) : "";
          return bg + `<g${opAttr}>${text(bx + byteW / 2, hexY, hex2(bval), v.kind === "ptr" ? 13 : 15.5, byteInk, "middle")}</g>`;
        };
        const byteChanged = animate && (normalWrite || sim.isPunningWrite && slot.before !== slot.after);
        if (byteChanged) {
          const byteAt = sim.isPunningWrite ? at + 0.08 * (addr - meta.targetAddress) : at;
          const swapped = (slot.before !== null ? `<g>${hide(byteAt)}${renderByte(slot.before, true)}</g>` : "") + `<g opacity="0">${show(byteAt)}${renderByte(slot.after, false)}</g>`;
          markup += scaledAt(bx + byteW / 2, gridY + 68, swapped, byteAt - 0.15);
        } else {
          markup += renderByte(slot.after, false);
        }
      }
      if (animate && op && !sim.isPunningWrite) {
        if (op.kind === "read" && op.name === v.name) {
          markup += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.25, at)}` + rect(vx + 2, gridY + 2, vw - 4, cellH - 4, P.read, "none", 0).replace("fill=", 'fill-opacity="0.18" fill=') + rect(vx + 2, gridY + 2, vw - 4, cellH - 4, "none", P.read, 0, 2.8) + "</g>";
        } else if (op.kind === "write" && op.name === v.name) {
          markup += transientWriteHighlight(vx, gridY, vw, cellH, P.write, at);
        }
      }
      if (v.kind === "int" && v.size > 1) {
        const ay = gridY + cellH + 10;
        const dir = c.littleEndian ? 1 : -1;
        const xLow = vx + (c.littleEndian ? byteW / 2 : vw - byteW / 2);
        const xHigh = vx + (c.littleEndian ? vw - byteW / 2 : byteW / 2);
        const arrowCol = on ? P.grey : P.deadStroke;
        markup += `<g opacity="${on ? "0.75" : "0.45"}"><line x1="${round(xLow)}" y1="${ay}" x2="${round(xHigh - 6 * dir)}" y2="${ay}" stroke="${arrowCol}" stroke-width="1.5" stroke-linecap="round"/><path d="M -8 -4 L 0 0 L -8 4 Z" fill="${arrowCol}" transform="translate(${round(xHigh)} ${ay}) rotate(${c.littleEndian ? 0 : 180})"/></g>`;
      }
      const pillRow = pillRowOf.get(v.name) ?? 0;
      const nameY = gridY + cellH + 34;
      const pillTop = nameY + 8 + pillRow * 24;
      const nameCol = isCorrupted ? P.error : on ? col : P.grey;
      if (animate && sim.isPunningWrite && isCorrupted) {
        markup += `<g>${hide(at)}${text(vx + vw / 2, nameY, v.name, 20, col, "middle")}</g><g opacity="0">${show(at)}${text(vx + vw / 2, nameY, v.name, 20, P.error, "middle")}</g>`;
      } else {
        markup += text(vx + vw / 2, nameY, v.name, 20, nameCol, "middle");
      }
      markup += typeLabel(c, vx + vw / 2, pillTop, v.type, 13.5, on ? typeColour(c, v.type) : P.deadStroke);
      const keepBright = isCorrupted || sim.ptrLive && (v.name === meta.targetVar || v.name === meta.ptrName);
      mem += keepBright ? markup : dim(c, v.name, markup);
    }
    let writeFlash = "";
    if (animate && sim.isPunningWrite) {
      const wLeft = xOf(meta.targetAddress);
      const wWidth = meta.pointeeSize * byteW;
      if (meta.direction === "larger") {
        const ownW = targetVar.size * byteW;
        const spillW = wWidth - ownW;
        writeFlash += transientWriteHighlight(wLeft, gridY, ownW, cellH, P.write, at);
        if (spillW > 0) {
          writeFlash += transientWriteHighlight(wLeft + ownW, gridY, spillW, cellH, P.error, at + 0.08);
        }
      } else {
        writeFlash += transientWriteHighlight(wLeft, gridY, wWidth, cellH, P.write, at);
      }
    }
    let arcMarkup = "";
    if (sim.ptrLive) {
      const sx = xOf(ptrVar.address) + ptrVar.size * byteW / 2;
      const ex = xOf(meta.targetAddress) + byteW * 0.5;
      const sy = gridY - 2;
      const ey = gridY - 26;
      const apex = gridY - 92;
      const d = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(apex)}, ${round(ex)} ${round(apex)}, ${round(ex)} ${round(ey - 8)}`;
      const head = `<path d="M -10 -6 L 0 0 L -10 6 Z" fill="${pCol}" transform="translate(${round(ex)} ${round(ey)}) rotate(90)"/>`;
      const isWritingPtr = animate && (op == null ? void 0 : op.kind) === "write" && op.name === meta.ptrName;
      const grow = isWritingPtr ? ` data-grow="${round(at + 0.08)}"` : "";
      arcMarkup += `<g><path d="${d}" fill="none" stroke="${P.bg}" stroke-width="9"${grow}/><path d="${d}" fill="none" stroke="${pCol}" stroke-width="2.6"${grow}/>` + (isWritingPtr ? `<g opacity="0">${fade(0, 1, 0.15, at + 0.55)}${head}</g>` : head) + "</g>";
      if (animate && c.index === meta.derefStep) {
        arcMarkup += `<path d="${d}" fill="none" stroke="${pCol}" stroke-width="7" stroke-linecap="round" data-follow="${T.prepare}"/>`;
      }
    }
    const scopeReticle = targetScopeReticle(c, meta, sim, xOf, byteW, gridY, cellH, pCol);
    let belowOverlay = "";
    if (meta.direction === "larger" && sim.ubTriggered) {
      const wLeft = xOf(meta.targetAddress);
      const wRight = xOf(meta.targetAddress + meta.pointeeSize);
      const ownEnd = xOf(targetVar.address + targetVar.size);
      const brY = gridY + cellH + 46 + pillRowsCount * 24 + 8;
      const tickTop = brY - 10;
      const cal = `<path d="M ${round(wLeft + 2)} ${tickTop} V ${brY} H ${round(ownEnd)}" fill="none" stroke="${P.write}" stroke-width="2.2"/><path d="M ${round(ownEnd)} ${brY} H ${round(wRight - 2)} V ${tickTop}" fill="none" stroke="${P.error}" stroke-width="2.8"/>` + pill((ownEnd + wRight) / 2, brY + 18, "⚠ UB", 13.5, P.error, P.error, P.bg);
      belowOverlay += animate && sim.isPunningWrite ? `<g opacity="0">${fade(0, 1, 0.25, at)}${cal}</g>` : cal;
    }
    let wb = "";
    let flight = "";
    if (sim.windowActive) {
      const stripY = g.ty + 28;
      const tileW = 44;
      const tileH = 30;
      const tileGap = 6;
      const rhsStart = step.pane.indexOf("= ") + 2;
      const tilesX = g.tx + Math.max(0, rhsStart) * g.paneChar;
      const bytes = sim.writtenBytes;
      for (let k = 0; k < bytes.length; k++) {
        const addr = meta.targetAddress + k;
        const slot = sim.bytes[addr - meta.baseAddress];
        const bad = sim.ubTriggered && (slot.status === "padding" || slot.status === "foreign");
        const tx = tilesX + k * (tileW + tileGap);
        const stroke = bad ? P.error : P.write;
        const fill = bad ? P.panel : P.writeFill;
        wb += rect(tx, stripY, tileW, tileH, fill, stroke, 5, 2) + text(tx + tileW / 2, stripY + 20, hex2(bytes[k]), 15.5, stroke, "middle");
        if (animate && sim.isPunningWrite) {
          const sx = tx + tileW / 2;
          const sy = stripY;
          const ex = xOf(addr) + byteW / 2;
          const ey = gridY + 70;
          const midY = (sy + ey) / 2;
          const path = `M ${round(sx)} ${round(sy)} C ${round(sx)} ${round(midY)}, ${round(ex)} ${round(midY)}, ${round(ex)} ${round(ey)}`;
          const dur = 0.85;
          const end = at + k * 0.08;
          const begin = Math.max(0.2, end - dur);
          const flyCol = slot.status === "padding" || slot.status === "foreign" ? P.error : P.write;
          flight += `<g opacity="0">${fade(0, 0.5, 0.2, begin)}${fade(0.5, 0, 0.25, end)}<path d="${path}" fill="none" stroke="${flyCol}" stroke-width="2.4"/></g><g opacity="0">${fade(0, 1, 0.1, begin)}${hide(end + 0.05)}` + rect(-20, -14, 40, 28, P.panel, flyCol, 6, 2) + text(0, 6, hex2(bytes[k]), 15, flyCol, "middle") + `<animateMotion begin="${round(begin)}s" dur="${dur}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
        }
      }
      if (meta.direction === "smaller") {
        for (let k = bytes.length; k < targetVar.size; k++) {
          const tx = tilesX + k * (tileW + tileGap);
          wb += `<rect x="${round(tx)}" y="${stripY}" width="${tileW}" height="${tileH}" rx="5" fill="none" stroke="${P.grey}" stroke-opacity="0.75" stroke-dasharray="4 3" stroke-width="1.6"/>`;
        }
      }
    }
    return defs + code(c, oldLine) + tether(c, oldLine) + arcMarkup + mem + writeFlash + scopeReticle + belowOverlay + pane(c, animate && copies(c.m.steps, c.index)) + wb + output(c) + gridTransfers(c, meta, sim, xOf, byteW, gridY, cellH) + flight;
  }
  const PUNNING_VIEW = {
    geometry: (m) => {
      const meta = META.get(m.trace);
      return {
        minByteWidth: 46,
        minColumnWidth: 780,
        cellHeight: 88,
        extraMemBottom: meta.direction === "larger" ? 104 : 46,
        extraPaneHeight: 46,
        skipWrap: true
      };
    },
    stackBelow: 900,
    maxScale: 0.72,
    byteOrder: true,
    scene: punningScene,
    stepSeconds: punningStepSeconds
  };
  let players = [];
  function init() {
    const sections = document.getElementById("sections");
    sections.innerHTML = "";
    for (const { trace, meta } of SCENARIOS) {
      const sec = document.createElement("section");
      sec.className = "scenario";
      sec.innerHTML = `<h2>${esc(meta.title)}</h2><p class="note">${esc(meta.subtitle)}</p><div class="course-visualization"></div>`;
      sections.append(sec);
      const host = sec.querySelector(".course-visualization");
      const player = new Player(host, trace, PUNNING_VIEW);
      player.settle(trace.steps.length - 1);
      players.push(player);
    }
    document.getElementById("theme").addEventListener("click", () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
      for (const p of players) p.refresh();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
