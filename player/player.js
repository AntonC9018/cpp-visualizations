var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const CHAR = 0.602;
  const CODE_SIZE = 25;
  const PANE_SIZE = 30;
  const CODE_CHAR = CODE_SIZE * CHAR;
  const EVAL_CHAR = PANE_SIZE * CHAR;
  const LINE = 56;
  const CELL = 64;
  const MARGIN = 28;
  const MEMORY_WIDTH = 600;
  const MAX_BYTE = 28;
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
    evaluate: 0.6
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
    "tether"
  ];
  const VARIABLE_COLOURS = 5;
  const FIELD_COLOURS = 4;
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
  const markBox = (x, y, length, stroke, fill) => `<rect x="${round(x - 3)}" y="${round(y - 32)}" width="${round(length * EVAL_CHAR + 6)}" height="42" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const settle = (markup, from, begin) => from ? `<g transform="translate(${round(from)} 0)"><animateTransform attributeName="transform" type="translate" from="${round(from)} 0" to="0 0" begin="${round(begin)}s" dur="0.3s" ${EASE} fill="freeze"/>${markup}</g>` : markup;
  const glide = (markup, dx, begin, dur) => dx ? `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${round(dx)} 0" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>${markup}</g>` : markup;
  const scaleAbout = (markup, x, y, from, to, begin, dur) => `<g transform="translate(${round(x)} ${round(y)})"><g transform="scale(${from})"><animateTransform attributeName="transform" type="scale" from="${from}" to="${to}" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/><g transform="translate(${round(-x)} ${round(-y)})">${markup}</g></g></g>`;
  class Layout {
    constructor(host, trace) {
      __publicField(this, "host");
      __publicField(this, "root");
      __publicField(this, "locked", null);
      __publicField(this, "stale", false);
      var _a;
      if (trace.format !== 1 || !((_a = trace.records) == null ? void 0 : _a.length)) throw new Error("Invalid layout");
      this.host = host;
      this.root = document.createElement("div");
      this.root.className = "cv-player cv-layout not-content";
      const ru = (document.documentElement.lang || "").startsWith("ru");
      const padding = ru ? "Выравнивание" : "Padding";
      this.root.innerHTML = trace.records.map((record, ri) => {
        const key = (fi) => `${ri}:${fi}`;
        const button = (fi, label, cls = "", description = "") => `<button type="button" class="cv-layout-target ${cls}" data-layout-key="${key(fi)}" aria-pressed="false"${description ? ` aria-label="${esc(description)}" title="${esc(description)}"` : ""}>${label}</button>`;
        const rows = button("all", esc(`struct ${record.name}`), "cv-layout-row") + record.fields.map(
          (f, fi) => button(
            fi,
            esc(`${f.type} ${f.name};`) + `<small>+${f.offset} · ${f.size} B</small>`,
            `cv-layout-row cv-field-${fi % FIELD_COLOURS}`
          )
        ).join("") + button("all", esc(`sizeof(${record.name}) = ${record.size}`), "cv-layout-row");
        const bytes = Array.from({ length: record.size }, (_, offset) => {
          const fi = record.fields.findIndex(
            (f) => offset >= f.offset && offset < f.offset + f.size
          );
          const label = fi < 0 ? padding : record.fields[fi].name;
          return button(
            fi < 0 ? "pad" : fi,
            `<span aria-hidden="true">${offset}</span><small>${fi < 0 ? "▧" : esc(label)}</small>`,
            `cv-byte ${fi < 0 ? "cv-padding" : `cv-field-${fi % FIELD_COLOURS}`}`,
            `+${offset}: ${label}`
          );
        }).join("");
        return `<section class="cv-layout-record" data-layout-record="${ri}"><div class="cv-layout-code">${rows}</div><div class="cv-layout-bytes"><p>alignof(${esc(record.name)}) = ${record.alignment}</p><div class="cv-layout-memory" style="--cv-slot:${record.alignment}">${bytes}</div><p>${esc(padding)}: ▧ · ${record.size - record.fields.reduce((sum, f) => sum + f.size, 0)} B</p></div></section>`;
      }).join("");
      host.append(this.root);
      this.lock(null);
      const target = (event) => {
        var _a2;
        return ((_a2 = event.target) == null ? void 0 : _a2.closest("[data-layout-key]")) ?? null;
      };
      this.root.addEventListener(
        "pointerover",
        (event) => {
          var _a2;
          return this.highlight(((_a2 = target(event)) == null ? void 0 : _a2.dataset.layoutKey) ?? null);
        }
      );
      this.root.addEventListener("pointerleave", () => this.restore());
      this.root.addEventListener(
        "focusin",
        (event) => {
          var _a2;
          return this.highlight(((_a2 = target(event)) == null ? void 0 : _a2.dataset.layoutKey) ?? null);
        }
      );
      this.root.addEventListener("focusout", () => queueMicrotask(() => this.restore()));
      this.root.addEventListener("click", (event) => {
        var _a2;
        const key = ((_a2 = target(event)) == null ? void 0 : _a2.dataset.layoutKey) ?? null;
        this.lock(this.locked === key ? null : key);
        this.restore();
      });
      this.root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.lock(null);
          this.highlight(null);
        }
      });
      this.refresh();
    }
    lock(key) {
      this.locked = key;
      for (const element of this.root.querySelectorAll("[data-layout-key]")) {
        element.setAttribute("aria-pressed", String(element.dataset.layoutKey === key));
      }
    }
    restore() {
      const active = document.activeElement;
      this.highlight(
        this.locked || (this.root.contains(active) ? (active == null ? void 0 : active.dataset.layoutKey) ?? null : null)
      );
    }
    highlight(key) {
      const [record, field] = (key || "").split(":");
      for (const section of this.root.querySelectorAll("[data-layout-record]")) {
        section.classList.toggle("cv-layout-active", section.dataset.layoutRecord === record);
      }
      for (const element of this.root.querySelectorAll("[data-layout-key]")) {
        const [r, f] = (element.dataset.layoutKey || "").split(":");
        element.classList.toggle("cv-linked", r === record && (field === "all" || f === field));
      }
    }
    refresh() {
      this.root.dataset.cvTheme = themeName();
    }
    pause() {
    }
    disconnect() {
    }
  }
  const frameOf = (s) => ({
    x: s.x - FRAME.side,
    y: s.y - FRAME.top - s.rise * RISE.top,
    w: s.w + 2 * FRAME.side,
    h: s.h + FRAME.top + FRAME.bottom + s.rise * (RISE.top + RISE.bottom) + (s.drop || 0)
  });
  const labelWidth = (c) => String(c.address).length * 16 * CHAR;
  const labelCentre = (c) => [
    c.x + 3 + labelWidth(c) / 2,
    c.y - 18
  ];
  const valueCentre = (c) => [
    c.x + c.w / 2,
    c.y + 32
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
      const spread = 20 * (ends.length - 1);
      const low = g.isStruct(cell) ? cell.x + 12 : cell.x + 3 + labelWidth(cell) + 14;
      const high = cell.x + cell.w - 12;
      const first = Math.min(Math.max(centre(cell) - spread / 2, low), Math.max(low, high - spread));
      ends.forEach((end, i) => {
        end.l[end.key] = first + i * 20;
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
  function placement(m, byte) {
    const spans = /* @__PURE__ */ new Map();
    const gaps = [];
    const unused = (x, bytes) => {
      if (bytes > 0) gaps.push([x, bytes * byte]);
      return Math.max(0, bytes) * byte;
    };
    const put = (item, x) => {
      let w = item.size * byte;
      if (item.children) {
        let address2 = item.address;
        w = 0;
        for (const child of item.children) {
          w += unused(x + w, child.address - address2);
          const pad = child.children ? NEST : 0;
          w += pad + put(child, x + w + pad) + pad;
          address2 = child.address + child.size;
        }
        w += unused(x + w, item.address + item.size - address2);
      }
      spans.set(item.name, [x, w]);
      return w;
    };
    let width = 0;
    let address = null;
    for (const item of m.tops) {
      if (address !== null) width += unused(width, item.address - address) + GAP;
      width += put(item, width);
      address = item.address + item.size;
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
        targets.push({
          type: match[1],
          underline: true,
          x: g.code.x + 62 + idx * CODE_CHAR,
          y: g.lineY(i) - CODE_SIZE * 0.85,
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
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    let current = size;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const room = b.x + b.w / 2 - (a.x + a.w / 2) - 8;
      const half = (label(a).length + label(b).length) * CHAR / 2;
      if (half * current > room) current = room / half;
    }
    return current;
  }
  function geometry(m, P, stacked) {
    const isStruct = (c) => Boolean(c.fields);
    const longest = Math.max(...m.source.map((line) => line.length));
    let codeW = Math.max(300, 62 + longest * CODE_CHAR + 30);
    const codeH = 44 + m.source.length * LINE;
    const first = m.tops[0];
    const last = m.tops[m.tops.length - 1];
    const fixed = GAP * (m.tops.length - 1) + 2 * NEST * m.groups.filter((s) => s.parent).length;
    const placed = placement(
      m,
      Math.min(MAX_BYTE, (MEMORY_WIDTH - fixed) / (last.address + last.size - first.address))
    );
    const memoryW = placed.width;
    const rise = m.rise;
    const paneChars = Math.max(...m.steps.map((step) => step.pane.length));
    const finalStdout = m.steps[m.steps.length - 1].stdout;
    const outputLines = finalStdout ? finalStdout.replace(/\n$/, "").split("\n") : [];
    const outputChars = Math.max(0, ...outputLines.map((line) => line.length));
    let columnW = Math.max(
      360,
      memoryW + 48,
      paneChars * EVAL_CHAR + 48,
      (P.outputLabel.length + 1) * 26 * CHAR + outputChars * EVAL_CHAR + 48
    );
    if (stacked) codeW = columnW = Math.max(codeW, columnW);
    const atLeaf = (memX2, memY2, c) => {
      const span = placed.spans.get(c.name);
      return {
        ...c,
        x: memX2 + span[0],
        y: memY2,
        w: span[1],
        h: CELL,
        color: "",
        fieldColor: null
      };
    };
    const atGroup = (memX2, memY2, c) => {
      const span = placed.spans.get(c.name);
      return {
        ...c,
        x: memX2 + span[0],
        y: memY2,
        w: span[1],
        h: CELL,
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
    const structs = m.groups.length > 0;
    const room = (level >= 0 ? FRAME.top + 84 + level * 40 + 10 : (structs ? FRAME.top : 0) + 30) + rise * RISE.top;
    const tagged = tagRows(m, probe.box);
    const names = (structs ? CELL + FRAME.bottom + 32 : CELL + 34) + rise * RISE.bottom + tagged.height;
    const paneTop = room + names + 56;
    const paneH = 76;
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
    const memX = columnX + 24;
    const memY = columnY + room;
    const pane2 = { x: columnX, y: columnY + paneTop, w: columnW, h: paneH };
    const tx = columnX + 24;
    const ty = pane2.y + 38 + 11;
    const below = pane2.y - 56;
    const out = [columnX + 24, columnY + outputTop];
    const code2 = { x: codeX, y: codeY, w: codeW, h: codeH };
    const lineY = (i) => code2.y + 50 + i * LINE;
    const gaps = placed.gaps.map(([x, w]) => [memX + x, w]);
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
      gaps,
      leaves,
      groups,
      box,
      cellsOf,
      tags: tags2,
      owner,
      field,
      typeTargets: [],
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
  const stores = (op) => op.kind === "write" || op.kind === "bind";
  const departure = (op) => stores(op) ? T.writeHold : op.kind === "print" ? 0.2 : T.prepare;
  function arrival(op) {
    if (op.kind === "deref") return T.prepare + T.follow;
    if (op.kind === "eval" || op.kind === "alias") return T.evaluate;
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
  function colored(c, x, y, value, size = PANE_SIZE, mute = true, member = false) {
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
    if (!expr) return colored(c, x, y, pane2.slice(a, b), PANE_SIZE, true, member);
    const cuts = [a, Math.min(b, Math.max(a, expr[0])), Math.min(b, Math.max(a, expr[1])), b];
    let out = "";
    for (let i = 0; i < 3; i++) {
      const [from, to] = [cuts[i], cuts[i + 1]];
      if (from >= to) continue;
      const px = x + (from - a) * EVAL_CHAR;
      const part = pane2.slice(from, to);
      out += i === 1 ? colored(c, px, y, part, PANE_SIZE, true, /(\.|->)$/.test(pane2.slice(0, from))) : text(px, y, part, PANE_SIZE, c.P.context);
    }
    return out;
  }
  function exprBackground(c, x, y, expr, from = null, begin = 0) {
    if (!expr || expr[0] === expr[1]) return "";
    const box = (e) => [
      x + e[0] * EVAL_CHAR - 4,
      (e[1] - e[0]) * EVAL_CHAR + 8
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
  function code(c, oldLine) {
    const { m, g, P, step, op } = c;
    const x = g.code.x;
    let out = rect(x, g.code.y, g.code.w, g.code.h, P.panel);
    const box = (line) => {
      const source = m.source[line];
      const span2 = m.spans[line] || [0, source.replace(/;\s*$/, "").length];
      return [
        x + 62 + span2[0] * CODE_CHAR - 3,
        g.lineY(line) - 30,
        (span2[1] - span2[0]) * CODE_CHAR + 6
      ];
    };
    const y = g.lineY(step.line);
    const [bx, by, bw] = box(step.line);
    let stripe = rect(
      x + 8,
      y - 32,
      4,
      44,
      op && op.kind === "write" ? P.write : P.read,
      "none",
      0
    );
    let span = rect(bx, by, bw, 40, P.highlight, "none", 6);
    if (oldLine !== null) {
      const [ox, oy, ow] = box(oldLine);
      stripe = animated(stripe, animateAttr("y", g.lineY(oldLine) - 32, y - 32));
      span = animated(
        span,
        animateAttr("x", ox, bx) + animateAttr("y", oy, by) + animateAttr("width", ow, bw)
      );
    }
    out += stripe + span;
    m.source.forEach((source, i) => {
      out += text(x + 22, g.lineY(i), i + 1, 18, P.muted) + colored(c, x + 62, g.lineY(i), source, CODE_SIZE, /^\s*struct\b/.test(source));
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
    for (const [x, w] of g.gaps) {
      out += `<rect x="${round(x + 3)}" y="${g.memY + 3}" width="${round(w - 6)}" height="58" fill="none" stroke="${P.gapStroke}" stroke-dasharray="5 5"/>`;
    }
    for (const s of g.groups) {
      const on = g.cellsOf(s.name).some(live);
      const f = frameOf(s);
      const color = on ? s.fieldColor || s.color : null;
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
      const color = cell.fieldColor || cell.color;
      let markup = text(cell.x + 3, cell.y - 12, cell.address, 16, on ? P.muted : P.grey);
      markup += cell.group ? text(
        cell.x + cell.w / 2,
        cell.y + cell.h + 28,
        cell.label,
        g.fieldSize,
        on ? color : P.grey,
        "middle"
      ) : text(
        cell.x + cell.w / 2,
        cell.y + cell.h + 34,
        cell.label,
        g.nameSize,
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
          const size = Math.min(30, (cell.w - 12) / (length * CHAR));
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
      out += `<g>${fade(1, 0, 0.35, at + 0.15)}${outline(c, g.box(op.name), op.kind === "write" ? P.write : P.read)}</g>`;
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
    return out + tags(c, at);
  }
  function valueBox(c, value, color, path, begin, travel, end) {
    const half = Math.max(28, String(value).length * EVAL_CHAR / 2 + 12);
    return `<g opacity="0">${fade(0, 0.55, 0.25, begin)}${fade(0.55, 0, 0.2, end - 0.2)}<path d="${path}" fill="none" stroke="${color}" stroke-width="3"/></g><g opacity="0">${fade(0, 1, 0.12, begin)}${hide(end)}` + rect(-half, -25, 2 * half, 50, c.P.panel, color, 9) + text(0, 11, value, PANE_SIZE, c.P.fg, "middle") + `<animateMotion begin="${round(begin)}s" dur="${travel}s" path="${path}" keyPoints="0;1" ${EASE} fill="freeze"/></g>`;
  }
  function transfers(c) {
    const { g, P, op } = c;
    if (!op) return "";
    const at = arrival(op);
    const begin = departure(op);
    const ty = g.ty - 11;
    const below = g.below;
    const spanCentre = (span) => g.tx + (span[0] + span[1]) / 2 * EVAL_CHAR;
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
        `M ${p(sx, sy)} C ${p(side, sy)}, ${p(side, g.memY + CELL)}, ${p(side, below)} C ${p(side, ty)}, ${p(dx, ty - 60)}, ${p(dx, ty)}`,
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
    const { g, P, step, prev, op } = c;
    const tx = g.tx;
    const ty = g.ty;
    let out = rect(g.pane.x, g.pane.y, g.pane.w, g.pane.h, P.pane);
    if (copying) {
      const sx = g.code.x + 62;
      const sy = g.lineY(step.line);
      const begin = copyBegin(c.m.steps, c.index);
      const total = begin + T.copyTravel;
      if (prev && prev.line !== step.line) {
        out += `<g>${fade(1, 0, 0.3, begin + 0.2)}${settledPane(c, prev, tx, ty)}</g>`;
      }
      const scale = CODE_SIZE / PANE_SIZE;
      out += `<g><animateMotion dur="${round(total)}s" path="M ${round(sx)} ${sy} L ${tx} ${ty}" keyPoints="0;0;1" keyTimes="0;${(begin / total).toFixed(4)};1" calcMode="spline" keySplines="0 0 1 1;0.4 0 0.2 1" fill="freeze"/><g transform="scale(${scale})"><animateTransform attributeName="transform" type="scale" from="${scale}" to="1" begin="${begin}s" dur="${T.copyTravel}s" ${EASE} fill="freeze"/><g opacity="0">${fade(0, 1, 0.15, begin - 0.15)}${fade(1, 0, 0.12, total)}` + rect(-8, -36, step.pane.length * EVAL_CHAR + 16, 48, P.highlight, P.read, 7, 2) + "</g>" + settledPane(c, step, 0, 0) + "</g></g>";
      return out;
    }
    if (op && prev && ["read", "addr", "deref", "eval", "alias"].includes(op.kind)) {
      const before = prev.pane;
      const [s, e] = op.span;
      const length = step.pane.length - before.length + (e - s);
      const at = arrival(op);
      const dx = (length - (e - s)) * EVAL_CHAR;
      const sx = tx + s * EVAL_CHAR;
      const [stroke, fill] = op.kind === "read" || op.kind === "addr" ? [P.read, P.readFill] : [P.fg, P.derefFill];
      out += exprBackground(c, tx, ty, step.expr, prev.expr, at + 0.1);
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at - 0.1)}${markBox(sx, ty, e - s, stroke, fill)}</g>`;
      out += paneText(c, tx, ty, before, 0, s, prev.expr);
      let old = paneText(c, sx, ty, before, s, e, prev.expr);
      let fresh = paneText(c, sx, ty, step.pane, s, s + length, step.expr);
      const middle = sx + (e - s) * EVAL_CHAR / 2;
      if (op.kind === "eval") {
        old = scaleAbout(old, middle, ty - 11, 1, 0.45, 0.15, at - 0.15);
        fresh = scaleAbout(fresh, sx + length * EVAL_CHAR / 2, ty - 11, 0.45, 1, at, 0.25);
      }
      out += `<g>${hide(at)}${old}</g>`;
      out += `<g opacity="0">${show(at)}${settle(fresh, (e - s - length) / 2 * EVAL_CHAR, at + 0.1)}</g>`;
      return out + glide(
        paneText(c, tx + e * EVAL_CHAR, ty, before, e, before.length, prev.expr),
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
        tx + vs * EVAL_CHAR - 3 + tight,
        ty - 32,
        (ve - vs) * EVAL_CHAR + 6 - tight,
        42,
        P.writeFill,
        P.write,
        6,
        2
      ) + "</g>";
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}` + rect(tx + ns * EVAL_CHAR - 3, ty - 32, (ne - ns) * EVAL_CHAR + 6 - tight, 42, "none", P.write, 6, 2) + "</g>";
      out += paneText(c, tx, ty, step.pane, 0, step.pane.length, step.expr);
      if (inContext(step, op.destination)) {
        out += `<g opacity="0">${fade(0, 1, 0.2)}${fade(1, 0, 0.35, at + 0.15)}` + colored(c, tx + ns * EVAL_CHAR, ty, step.pane.slice(ns, ne)) + "</g>";
      }
      return out;
    }
    if (op && op.kind === "bind") {
      const at = arrival(op);
      const [vs, ve] = op.span;
      const [ns, ne] = op.destination;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.15)}${markBox(tx + ns * EVAL_CHAR, ty, ne - ns, P.fg, P.derefFill)}</g>`;
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.3, at + 0.4)}` + rect(tx + vs * EVAL_CHAR - 3, ty - 32, (ve - vs) * EVAL_CHAR + 6, 42, "none", P.fg, 6, 2) + "</g>";
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
      out += text(vx, oy + i * 36, line, PANE_SIZE, P.fg);
    });
    if (printing && op.kind === "print") {
      const lines = shown.split("\n");
      const x = vx + lines[lines.length - 1].length * EVAL_CHAR;
      const y = oy + (lines.length - 1) * 36;
      const sx = g.tx + (op.span[0] + op.span[1]) / 2 * EVAL_CHAR;
      const w = op.value.length * EVAL_CHAR;
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
      out += `<g opacity="0">${show(0.9)}${text(x, y, op.value, PANE_SIZE, P.fg)}</g>`;
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
    return format(S[op.kind], op);
  }
  class Player {
    constructor(host, trace) {
      __publicField(this, "host");
      __publicField(this, "m");
      __publicField(this, "S");
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
      __publicField(this, "observer", null);
      __publicField(this, "P");
      __publicField(this, "g");
      __publicField(this, "shownType");
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
          if (this.arrangement() !== this.stacked) this.refresh();
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
    arrangement() {
      const width = this.root.clientWidth;
      return width > 0 && width < STACK_BELOW;
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
      this.P = P;
    }
    refresh() {
      this.theme();
      this.render(this.animated);
      if (this.animated) this.seek(this.elapsed);
    }
    render(animate) {
      this.stacked = this.arrangement();
      const steps = this.m.steps;
      const step = steps[this.index];
      const prev = this.index ? steps[this.index - 1] : null;
      const g = this.g = geometry(this.m, this.P, this.stacked);
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
      this.svg.style.maxWidth = `${Math.ceil(g.width * MAX_SCALE)}px`;
      this.scene.innerHTML = `<rect width="100%" height="100%" fill="${this.P.bg}"/>` + scene(c);
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
      this.duration = stepSeconds(this.m.steps, index);
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
  function setupCourseVisualization() {
    if (typeof window === "undefined" || window.CourseVisualization) return;
    const players = [];
    const closedAncestor = (element) => element.parentElement && element.parentElement.closest("details:not([open])");
    function initialize(host) {
      if (host.dataset.cvState === "ready" || host.dataset.cvState === "error") return;
      try {
        const data = host.querySelector('script[type="application/json"]');
        const trace = JSON.parse((data == null ? void 0 : data.textContent) ?? "");
        const player = trace.kind === "layout" ? new Layout(host, trace) : new Player(host, trace);
        host.dataset.cvState = "ready";
        host.cvPlayer = player;
        players.push(player);
      } catch (error) {
        host.dataset.cvState = "error";
        const message = document.createElement("p");
        message.className = "cv-error";
        message.textContent = strings().error;
        host.append(message);
        console.error("course visualization:", error);
      }
    }
    function scan(root = document) {
      for (let i = players.length - 1; i >= 0; i--) {
        if (!players[i].host.isConnected) {
          players[i].disconnect();
          players.splice(i, 1);
        }
      }
      for (const host of root.querySelectorAll("div.course-visualization")) {
        if (!host.dataset.cvState) host.dataset.cvState = "waiting";
        if (host.dataset.cvState === "waiting" && !closedAncestor(host)) initialize(host);
      }
    }
    document.addEventListener(
      "toggle",
      (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement)) return;
        if (!details.open) {
          for (const player of players) {
            if (details.contains(player.host)) player.pause();
          }
          return;
        }
        scan(details);
        for (const player of players) {
          if (player.stale && !closedAncestor(player.host)) {
            player.stale = false;
            player.refresh();
          }
        }
      },
      true
    );
    const restyle = () => {
      for (const player of players) {
        if (closedAncestor(player.host)) player.stale = true;
        else player.refresh();
      }
    };
    new MutationObserver(restyle).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", restyle);
    }
    document.addEventListener("astro:page-load", () => scan());
    window.CourseVisualization = { version: 1, players, scan };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => scan());
    } else {
      scan();
    }
  }
  setupCourseVisualization();
})();
