var CoursePlaygroundBundle = (function(exports) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
  class Unsupported extends Error {
    constructor(message) {
      super(message);
      this.name = "Unsupported";
    }
  }
  class IllFormed extends Unsupported {
    constructor(diagnostic, offset = null) {
      super(diagnostic);
      __publicField(this, "offset");
      this.name = "IllFormed";
      this.offset = offset;
    }
  }
  class NeedsFlag extends IllFormed {
    constructor(diagnostic, flag, offset = null) {
      super(`${diagnostic}; with ${flag} on (--${flag}), the trace shows why`, offset);
      /** Clang's error, without the hint. */
      __publicField(this, "diagnostic");
      __publicField(this, "flag");
      this.name = "NeedsFlag";
      this.diagnostic = diagnostic;
      this.flag = flag;
    }
  }
  const TEMPLATES = {
    "expression-timeline": {
      label: { en: "Execution trace", ru: "Трассировка выполнения" }
    },
    layout: {
      label: { en: "Struct layout", ru: "Раскладка структур" }
    }
  };
  const DEFAULT_TEMPLATE = "expression-timeline";
  const FLAGS = {
    types: {
      templates: ["expression-timeline"],
      label: { en: "Types", ru: "Типы" },
      description: {
        en: "Show the type of every value, and a last statement whose types do not fit",
        ru: "Показывать тип каждого значения и последнюю инструкцию с несовместимыми типами"
      }
    },
    bits: {
      templates: ["expression-timeline"],
      label: { en: "Bits", ru: "Биты" },
      description: {
        en: "Show the bytes of every integer in memory and its bits as it is converted; implies types",
        ru: "Показывать байты каждого целого в памяти и его биты при преобразовании; включает типы"
      }
    }
  };
  const TEMPLATE_NAMES = Object.keys(TEMPLATES);
  const FLAG_NAMES = Object.keys(FLAGS);
  function isTemplate(name) {
    return Object.hasOwn(TEMPLATES, name);
  }
  function isFlag(name) {
    return Object.hasOwn(FLAGS, name);
  }
  function takesFlag(template, flag) {
    return FLAGS[flag].templates.includes(template);
  }
  function flagsOf(template) {
    return FLAG_NAMES.filter((flag) => takesFlag(template, flag));
  }
  function flagsFor(template, flags) {
    return Object.fromEntries(flagsOf(template).filter((flag) => flags[flag]).map((flag) => [flag, true]));
  }
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
  const PADDING = "pad";
  const WIDEST = "widest";
  const WHOLE = "all";
  const LABEL_ROWS = 3;
  const LABEL_GAP = 6;
  function spansOf(record) {
    const spans = [];
    let end = 0;
    record.fields.forEach((field, index) => {
      if (field.offset > end) spans.push({ offset: end, size: field.offset - end });
      spans.push({ offset: field.offset, size: field.size, field: index });
      end = field.offset + field.size;
    });
    if (record.size > end) spans.push({ offset: end, size: record.size - end });
    return spans;
  }
  const paddingBytes = (record) => record.size - record.fields.reduce((sum, field) => sum + field.size, 0);
  const colour = (index) => `cv-field-${index % FIELD_COLOURS}`;
  class RecordView {
    constructor(record, index, words) {
      __publicField(this, "record");
      __publicField(this, "index");
      __publicField(this, "words");
      __publicField(this, "spans");
      __publicField(this, "padded");
      __publicField(this, "widest");
      this.record = record;
      this.index = index;
      this.words = words;
      this.spans = spansOf(record);
      this.padded = paddingBytes(record) > 0;
      this.widest = Math.max(...record.fields.map((field) => field.size));
    }
    key(span) {
      return span.field === void 0 ? `pad:${span.offset}` : String(span.field);
    }
    groups(span) {
      if (span.field === void 0) return PADDING;
      return this.isWidest(this.record.fields[span.field]) ? WIDEST : "";
    }
    isWidest(field) {
      return this.padded && field.size === this.widest;
    }
    /** Attributes that link an element: its key and the groups it belongs to. */
    link(key, groups = "") {
      return ` data-layout-key="${this.index}:${key}"` + (groups ? ` data-layout-groups="${groups}"` : "");
    }
    button(key, cls, body, groups = "", label = "") {
      const aria = label ? ` aria-label="${esc(label)}"` : "";
      return `<button type="button" class="cv-layout-target ${cls}" aria-pressed="false"${this.link(key, groups)}${aria}>${body}</button>`;
    }
    fieldList() {
      const name = esc(this.record.name);
      const rows = this.spans.map((span) => {
        if (span.field === void 0) {
          const text2 = `${esc(this.words.padding)} ×${span.size}`;
          return this.button(
            this.key(span),
            "cv-layout-row cv-layout-padding",
            `<i class="cv-layout-swatch cv-hatch"></i><span>${text2}</span>`,
            this.groups(span),
            `${this.words.padding}: ${span.size} B, +${span.offset}`
          );
        }
        const field = this.record.fields[span.field];
        return this.button(
          this.key(span),
          `cv-layout-row ${colour(span.field)}`,
          `<i class="cv-layout-swatch"></i><span>${esc(field.type)} <b>${esc(field.name)}</b>;</span>`,
          this.groups(span),
          `${field.type} ${field.name}: ${field.size} B, +${field.offset}`
        );
      });
      return `<div class="cv-layout-fields">` + this.button(WHOLE, "cv-layout-row cv-layout-struct", `struct <b>${name}</b> {`) + rows.join("") + `<span class="cv-layout-close">};</span></div>`;
    }
    facts() {
      const { record } = this;
      const size = this.button(WHOLE, "cv-layout-fact cv-layout-strong", `sizeof ${record.size}`);
      if (!this.padded) return `<div class="cv-layout-facts">${size}</div>`;
      const sizes = record.fields.map((field, index) => {
        const widest = this.isWidest(field) ? " cv-layout-widest" : "";
        return `<b class="${colour(index)}${widest}">${field.size}</b>`;
      }).join(", ");
      const alignment = this.button(
        WIDEST,
        "cv-layout-fact",
        `alignof = max(${sizes}) = <b>${record.alignment}</b>`,
        "",
        `alignof ${record.alignment}`
      );
      const padding = this.button(
        PADDING,
        "cv-layout-fact",
        `<i class="cv-layout-swatch cv-hatch"></i> ${esc(this.words.padding)} ${paddingBytes(record)} B`
      );
      return `<div class="cv-layout-facts">${size}${alignment}${padding}</div>`;
    }
    tape() {
      const { record } = this;
      const columns = (span) => `grid-column:${span.offset + 1} / span ${span.size}`;
      const labels = this.spans.filter((span) => span.field !== void 0).map((span) => {
        const field = record.fields[span.field];
        return `<span class="cv-layout-label ${colour(span.field)}"${this.link(this.key(span), this.groups(span))} style="${columns(span)}"><b>${esc(field.name)}</b></span>`;
      });
      const padding = this.spans.filter((span) => span.field === void 0).map(
        (span) => `<span class="cv-layout-gap cv-hatch"${this.link(this.key(span), PADDING)} style="${columns(span)}"></span>`
      );
      const bytes = this.spans.flatMap(
        (span) => Array.from({ length: span.size }, (_, i) => {
          const offset = span.offset + i;
          const classes = [
            "cv-byte",
            span.field === void 0 ? "cv-byte-padding" : colour(span.field),
            i === 0 ? "cv-byte-start" : "",
            this.padded && offset % record.alignment === 0 ? "cv-byte-slot" : "",
            offset === record.size - 1 ? "cv-byte-last" : ""
          ].filter(Boolean);
          return `<span class="${classes.join(" ")}"${this.link(this.key(span), this.groups(span))} style="grid-column:${offset + 1}"></span>`;
        })
      );
      const marks = this.padded ? Array.from({ length: record.size / record.alignment }, (_, i) => i * record.alignment) : record.fields.map((field) => field.offset);
      const ticks = marks.map(
        (offset) => `<span class="cv-layout-tick" style="grid-column:${offset + 1}">${offset}</span>`
      );
      ticks.push(
        `<span class="cv-layout-tick cv-layout-tick-end" style="grid-column:${record.size}">${record.size}</span>`
      );
      return `<div class="cv-layout-tape" aria-hidden="true" style="--cv-bytes:${record.size}">${labels.join("")}${padding.join("")}${bytes.join("")}${ticks.join("")}</div>`;
    }
    html() {
      return `<section class="cv-layout-record" data-layout-record="${this.index}">${this.fieldList()}${this.facts()}${this.tape()}</section>`;
    }
  }
  class Layout {
    constructor(host, trace) {
      __publicField(this, "host");
      __publicField(this, "root");
      __publicField(this, "locked", null);
      __publicField(this, "stale", false);
      __publicField(this, "resize", null);
      __publicField(this, "escape", (event) => {
        if (event.key !== "Escape") return;
        if (this.locked === null && !this.root.contains(document.activeElement)) return;
        this.lock(null);
        this.highlight(null);
      });
      var _a;
      if (trace.format !== 1 || !((_a = trace.records) == null ? void 0 : _a.length)) throw new Error("Invalid layout");
      this.host = host;
      this.root = document.createElement("div");
      this.root.className = "cv-player cv-layout not-content";
      const ru = (document.documentElement.lang || "").startsWith("ru");
      const words = { padding: ru ? "выравнивание" : "padding" };
      this.root.innerHTML = trace.records.map((record, index) => new RecordView(record, index, words).html()).join("");
      host.append(this.root);
      this.listen();
      this.refresh();
      if (typeof ResizeObserver !== "undefined") {
        this.resize = new ResizeObserver(() => this.arrangeLabels());
        this.resize.observe(this.root);
      }
    }
    listen() {
      const keyOf = (event) => {
        var _a, _b;
        return ((_b = (_a = event.target) == null ? void 0 : _a.closest("[data-layout-key]")) == null ? void 0 : _b.dataset.layoutKey) ?? null;
      };
      this.root.addEventListener("pointerover", (event) => this.highlight(keyOf(event) ?? this.locked));
      this.root.addEventListener("pointerleave", () => this.restore());
      this.root.addEventListener("focusin", (event) => this.highlight(keyOf(event)));
      this.root.addEventListener("focusout", () => queueMicrotask(() => this.restore()));
      this.root.addEventListener("click", (event) => {
        const key = keyOf(event);
        if (key === null) return;
        this.lock(this.locked === key ? null : key);
        this.restore();
      });
      document.addEventListener("keydown", this.escape);
    }
    lock(key) {
      this.locked = key;
      for (const element of this.root.querySelectorAll("button[data-layout-key]")) {
        element.setAttribute("aria-pressed", String(element.dataset.layoutKey === key));
      }
    }
    restore() {
      const active = document.activeElement;
      const focused = this.root.contains(active) ? (active == null ? void 0 : active.dataset.layoutKey) ?? null : null;
      this.highlight(this.locked ?? focused);
    }
    /** Links everything sharing `key`, or belonging to the group it names, and dims the rest. */
    highlight(key) {
      const [record, ...rest] = (key ?? "").split(":");
      const target = rest.join(":");
      for (const section of this.root.querySelectorAll("[data-layout-record]")) {
        section.classList.toggle("cv-layout-active", key !== null && section.dataset.layoutRecord === record);
      }
      for (const element of this.root.querySelectorAll("[data-layout-key]")) {
        const [r, ...own] = (element.dataset.layoutKey ?? "").split(":");
        const groups = (element.dataset.layoutGroups ?? "").split(" ");
        const linked = key !== null && r === record && (target === WHOLE || own.join(":") === target || groups.includes(target));
        element.classList.toggle("cv-linked", linked);
      }
    }
    /**
     * Stacks field names above the tape in as few rows as keep them apart: a name wider than its
     * field would otherwise run into the next one. A name that would leave the tape is right-aligned.
     */
    arrangeLabels() {
      for (const tape of this.root.querySelectorAll(".cv-layout-tape")) {
        const labels = [...tape.querySelectorAll(".cv-layout-label")];
        for (const label of labels) {
          label.style.gridRow = "1";
          label.classList.remove("cv-layout-label-end");
        }
        const right = tape.getBoundingClientRect().right;
        const rowEnds = [];
        for (const label of labels) {
          const text2 = label.firstElementChild.getBoundingClientRect();
          let left = label.getBoundingClientRect().left;
          if (left + text2.width > right) {
            label.classList.add("cv-layout-label-end");
            left = right - text2.width;
          }
          let row = rowEnds.findIndex((end) => end <= left);
          if (row < 0) row = Math.min(rowEnds.length, LABEL_ROWS - 1);
          rowEnds[row] = left + text2.width + LABEL_GAP;
          label.style.gridRow = String(row + 1);
        }
      }
    }
    refresh() {
      this.root.dataset.cvTheme = themeName();
      this.arrangeLabels();
    }
    pause() {
    }
    disconnect() {
      var _a;
      (_a = this.resize) == null ? void 0 : _a.disconnect();
      document.removeEventListener("keydown", this.escape);
    }
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
    const named = (structs ? cellH + FRAME.bottom + 32 : cellH + 34) + rise * RISE.bottom + tagged.height;
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
    const colour2 = (list, i, count) => list[i % count];
    const leaves = m.leaves.map((l) => ({
      ...atLeaf(memX, memY, l),
      color: colour2(P.vars, l.color, VARIABLE_COLOURS),
      fieldColor: l.group ? colour2(P.fields, l.fieldColor ?? 0, FIELD_COLOURS) : null
    }));
    const groups = m.groups.map((s) => ({
      ...atGroup(memX, memY, s),
      color: colour2(P.vars, s.color, VARIABLE_COLOURS),
      fieldColor: s.parent ? colour2(P.fields, s.fieldColor ?? 0, FIELD_COLOURS) : null,
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
        color: colour2(P.vars, t.color, VARIABLE_COLOURS)
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
  function chainDelay(name) {
    const count = name ? chainOf(name).length : 1;
    return count > 1 ? (count - 1) * CHAIN_STEP + CHAIN_LEAD : 0;
  }
  function paneLevels(name, spelled) {
    const levels = chainOf(name).map(codeName);
    return levels.length > 1 && levels.every((level) => spelled.startsWith(level)) ? levels : null;
  }
  const memoryWalk = (name, at) => walkWindows(chainOf(name).length, at + 0.15, CHAIN_LEAD);
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
  function reached(op) {
    if (!op) return null;
    switch (op.kind) {
      // A read lights the cell as its walk lands on the last level, a write as its value lands.
      case "read":
        return { name: op.name, at: memoryWalk(op.name, arrival(op)).at(-1)[0] };
      case "write":
        return { name: op.name, at: arrival(op) };
      // An address and a binding highlight their storage from the start.
      case "addr":
        return { name: op.name, at: 0 };
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
  function statementStart(m, i) {
    let start = i;
    while (start > 0 && m.steps[start - 1].line === m.steps[i].line) start--;
    return start;
  }
  function reachedIn(m, j) {
    const target = reached(m.steps[j].op);
    const op = m.steps[j].op;
    if (!target || (op == null ? void 0 : op.kind) !== "deref" && (op == null ? void 0 : op.kind) !== "alias") return target;
    return goesInto(m, j, target.name) ? null : target;
  }
  function goesInto(m, j, name) {
    var _a;
    let at = m.steps[j].op.span[0];
    for (let k = j + 1; k < m.steps.length && m.steps[k].line === m.steps[j].line; k++) {
      const op = m.steps[k].op;
      if (!op || !("span" in op)) continue;
      const later = (_a = reached(op)) == null ? void 0 : _a.name;
      const [from, to] = op.kind === "write" ? op.destination : op.kind === "read" && op.compound ? [0, op.span[0]] : op.span;
      if (later && later !== name && covers(name, later) && from <= at && at < to) return true;
      if (m.steps[k].pane === m.steps[k - 1].pane) continue;
      const [s, e] = op.span;
      if (at >= e) {
        at += m.steps[k].pane.length - m.steps[k - 1].pane.length;
      } else if (at >= s) {
        const spelled = codeName(name);
        const pane2 = m.steps[k].pane;
        if (!pane2.startsWith(spelled, s) || /\w/.test(pane2[s + spelled.length] ?? "")) return false;
        at = s;
      }
    }
    return false;
  }
  function litAt(m, i) {
    var _a;
    const tops = activeVariables(m, i);
    const start = statementStart(m, i);
    const names = [];
    for (let j = start; j <= i; j++) {
      const name = (_a = reachedIn(m, j)) == null ? void 0 : _a.name;
      if (name) names.push(name);
    }
    const shown = new Set(tops);
    for (const leaf of m.leaves) {
      if (!tops.has(topOf(leaf))) continue;
      if (!leaf.group || names.some((name) => covers(name, leaf.name))) shown.add(leaf.name);
    }
    return shown;
  }
  function stepFocus(m, i, animate) {
    const now = litAt(m, i);
    const begin = /* @__PURE__ */ new Map();
    if (!animate || i === 0) return { now, before: now, begin };
    const before = litAt(m, i - 1);
    const target = reachedIn(m, i);
    if (target) {
      const top = target.name.split(".")[0];
      for (const name of now) {
        if (!before.has(name) && (name === top || covers(target.name, name))) begin.set(name, target.at);
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
      out += `<g opacity="0">${fade(0, 1, 0.15)}${fade(1, 0, 0.2, at + 0.1)}` + rect(lx - labelWidth$1(cell) / 2 - 5, ly - 13, labelWidth$1(cell) + 10, 24, P.readFill, P.read, 5, 2) + "</g>";
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
    const windows = memoryWalk(op.name, at);
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
    if ((op == null ? void 0 : op.kind) === "read" && op.compound && prev) {
      const [s, e] = op.span;
      const at = arrival(op);
      const left = prev.pane.slice(0, s).trimEnd().length + " = ".length;
      out += exprBackground(c, tx, ty, step.expr, prev.expr, at);
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
    constructor(host, trace) {
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
      __publicField(this, "observer", null);
      __publicField(this, "P");
      __publicField(this, "g");
      __publicField(this, "shownType");
      this.host = host;
      this.m = prepare(trace);
      this.S = strings();
      this.view = viewOf(this.m);
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
      menu.addEventListener("focus", spell);
      menu.addEventListener("blur", spell);
      menu.addEventListener("change", () => {
        this.speed(menu.value);
        const label = menu.value === "instant" ? `${S.speed}: ${S.instant}` : S.speed;
        menu.title = label;
        menu.setAttribute("aria-label", label);
        spell();
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
        this.g = geometry(this.m, this.P, this.stacked, width, (_b = (_a = this.view).geometry) == null ? void 0 : _b.call(_a, this.m));
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
      this.instant = choice === "instant";
      if (!this.instant) this.rate = Number(choice);
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
  }
  const WASM_VERSION = 3;
  const CACHE_PREFIX = "clang-trace-frontend-v";
  const DEFAULT_CACHE_NAME = `${CACHE_PREFIX}${WASM_VERSION}`;
  const DEFAULT_WASM_URL = `./clang-trace-frontend.wasm?v=${WASM_VERSION}`;
  class ClangWasmClient {
    constructor(options = {}) {
      __publicField(this, "wasmUrl");
      __publicField(this, "workerUrl");
      __publicField(this, "workerType");
      __publicField(this, "cacheName");
      __publicField(this, "onProgress");
      __publicField(this, "worker", null);
      __publicField(this, "nextId", 1);
      __publicField(this, "pending", /* @__PURE__ */ new Map());
      this.wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
      this.workerUrl = options.workerUrl ?? new URL("./clang-worker.js", _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("playground.js", document.baseURI).href);
      this.workerType = options.workerType ?? "classic";
      this.cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
      this.onProgress = options.onProgress;
    }
    ensureWorker() {
      if (this.worker) return this.worker;
      const worker = new Worker(this.workerUrl, { type: this.workerType });
      worker.addEventListener("message", (event) => {
        var _a, _b;
        const response = event.data;
        const call = this.pending.get(response.id);
        if (!call) return;
        if (response.type === "progress") {
          (_a = call.onProgress) == null ? void 0 : _a.call(call, response.progress);
          (_b = this.onProgress) == null ? void 0 : _b.call(this, response.progress);
          return;
        }
        this.pending.delete(response.id);
        if (response.type === "error") {
          const { name, message, flag, diagnostic } = response.error;
          const err = name === "NeedsFlag" && flag ? new NeedsFlag(diagnostic ?? message, flag) : name === "IllFormed" ? new IllFormed(message) : name === "Unsupported" ? new Unsupported(message) : new Error(message);
          err.name = name;
          call.reject(err);
          return;
        }
        call.resolve(response);
      });
      worker.addEventListener("error", (event) => {
        const err = new Error(event.message || "Clang Web Worker failed");
        this.rejectAll(err);
        this.worker = null;
      });
      this.worker = worker;
      return worker;
    }
    rejectAll(error) {
      for (const call of this.pending.values()) {
        call.reject(error);
      }
      this.pending.clear();
    }
    call(request, onProgress) {
      const worker = this.ensureWorker();
      const id = this.nextId++;
      const fullRequest = { ...request, id };
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, onProgress });
        worker.postMessage(fullRequest);
      });
    }
    async init(onProgress) {
      const response = await this.call(
        {
          type: "init",
          wasmUrl: this.wasmUrl,
          cacheName: this.cacheName
        },
        onProgress
      );
      if (response.type !== "init-ok") {
        throw new Error(`Unexpected worker response: ${response.type}`);
      }
      return response.load;
    }
    async trace(source, settings, options = {}) {
      const response = await this.call(
        {
          type: "trace",
          source,
          settings,
          wasmUrl: this.wasmUrl,
          cacheName: this.cacheName
        },
        options.onProgress
      );
      if (response.type !== "trace-ok") {
        throw new Error(`Unexpected worker response: ${response.type}`);
      }
      return {
        trace: response.trace,
        durationMs: response.durationMs,
        load: response.load
      };
    }
    async clearCache() {
      const response = await this.call({
        type: "clear-cache",
        wasmUrl: this.wasmUrl,
        cacheName: this.cacheName
      });
      if (response.type !== "clear-ok") {
        throw new Error(`Unexpected worker response: ${response.type}`);
      }
      return response.cleared;
    }
    terminate() {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.rejectAll(new Error("ClangWasmClient terminated"));
    }
  }
  const PRESETS = [
    {
      id: "double-pointer",
      settings: { template: "expression-timeline", flags: {} },
      label: { en: "Double pointer (**pp)", ru: "Указатель на указатель (**pp)" },
      source: [
        "int a = 5;",
        "int b = 6;",
        "int* p = &a;",
        "int** pp = &p;",
        "**pp = 7;",
        "std::cout << a << std::endl;"
      ].join("\n")
    },
    {
      id: "struct-shallow-copy",
      settings: { template: "expression-timeline", flags: {} },
      label: { en: "Struct & shallow pointer copy", ru: "Структура и поверхностное копирование" },
      source: [
        "struct S {",
        "  int x;",
        "  int* p;",
        "};",
        "int a = 1;",
        "S s{2, &a};",
        "S t = s;",
        "S* ptr = &s;",
        "ptr->x = 3;",
        "*t.p = 7;",
        "std::cout << s.x << std::endl;"
      ].join("\n")
    },
    {
      id: "references",
      settings: { template: "expression-timeline", flags: {} },
      label: { en: "References as aliases", ru: "Ссылки как псевдонимы" },
      source: [
        "int a = 10;",
        "int& ref = a;",
        "ref = 25;",
        "int* p = &ref;",
        "*p = 42;",
        "std::cout << a << std::endl;"
      ].join("\n")
    },
    {
      id: "nested-struct",
      settings: { template: "expression-timeline", flags: {} },
      label: { en: "Nested struct & designated init", ru: "Вложенная структура и поля" },
      source: [
        "struct N { int f; int g; };",
        "struct A { int* p; N n; int f; };",
        "int v = 1;",
        "A a{ .p = &v, .n = { .f = 2 } };",
        "A b{a};",
        "N* q = &b.n;",
        "q->g = 9;",
        "int* r = &a.n.f;",
        "*r = 4;",
        "std::cout << b.n.g << std::endl;"
      ].join("\n")
    },
    {
      id: "type-mismatch",
      settings: { template: "expression-timeline", flags: { types: true } },
      label: { en: "Conversions & mismatched types", ru: "Преобразования и несовместимые типы" },
      source: ["uint8_t a = 200;", "int b = a + a;", "int* p = b;"].join("\n")
    },
    {
      id: "bits-widening",
      settings: { template: "expression-timeline", flags: { bits: true } },
      label: { en: "Bits: narrowing & sign extension", ru: "Биты: сужение и расширение знака" },
      source: ["int c = -200;", "int8_t d = static_cast<int8_t>(c);", "int e = d;", "uint8_t f = 200;", "int g = f;"].join("\n")
    },
    {
      id: "layout-padding",
      settings: { template: "layout", flags: {} },
      label: { en: "Struct padding & alignment", ru: "Выравнивание и заполнение полей" },
      source: [
        "struct Packet {",
        "  uint8_t tag;",
        "  int value;",
        "  uint8_t flags;",
        "};"
      ].join("\n")
    },
    {
      id: "layout-pointers",
      settings: { template: "layout", flags: {} },
      label: { en: "64-bit pointer fields layout", ru: "Раскладка полей с указателями" },
      source: [
        "struct Node {",
        "  int8_t kind;",
        "  int* next;",
        "  size_t count;",
        "  uint64_t id;",
        "};"
      ].join("\n")
    }
  ];
  const LEGACY_TEMPLATES = { trace: "expression-timeline", layout: "layout" };
  function templateNamed(name) {
    if (name === null) return null;
    return isTemplate(name) ? name : LEGACY_TEMPLATES[name] ?? null;
  }
  function matchingPreset(state) {
    return PRESETS.find((p) => p.source === state.source && p.settings.template === state.template);
  }
  function firstPreset(template) {
    return PRESETS.find((p) => p.settings.template === template) ?? PRESETS[0];
  }
  function readState(params) {
    const preset = PRESETS.find((p) => p.id === params.get("preset"));
    const template = templateNamed(params.get("template")) ?? templateNamed(params.get("mode")) ?? (preset == null ? void 0 : preset.settings.template) ?? DEFAULT_TEMPLATE;
    const fallback = preset ?? firstPreset(template);
    const flags = {};
    for (const flag of FLAG_NAMES) {
      if (params.has(flag) ? params.get(flag) === "1" : fallback.settings.flags[flag]) {
        flags[flag] = true;
      }
    }
    const source = params.has("code") ? params.get("code") ?? "" : fallback.source;
    return { source, template, flags };
  }
  function writeState(params, state) {
    const preset = matchingPreset(state);
    if (!preset) {
      params.set("code", state.source);
      params.delete("preset");
    } else {
      params.delete("code");
      if (preset === PRESETS[0]) params.delete("preset");
      else params.set("preset", preset.id);
    }
    params.delete("mode");
    params.set("template", state.template);
    for (const flag of FLAG_NAMES) {
      if (state.flags[flag]) params.set(flag, "1");
      else params.delete(flag);
    }
  }
  const CUSTOM_PRESET_ID = "__custom__";
  const UI_COPY = {
    en: {
      title: "C++ Memory & Layout Playground",
      subtitle: "Compiled in-browser with Clang 21 WebAssembly — no backend required.",
      presetLabel: "Example",
      customPreset: "Custom code",
      themeDark: "Dark",
      themeLight: "Light",
      langLabel: "RU",
      editorLabel: "C++ body (runs inside int main())",
      run: "Visualize",
      running: "Compiling…",
      shortcut: "Ctrl+Enter / Cmd+Enter to run",
      clearCache: "Clear WASM cache",
      cacheCleared: "WASM cache cleared — next run will re-download",
      checkingCache: "Checking browser WASM cache…",
      downloading: (loadedMb, totalMb) => totalMb ? `Downloading Clang WASM (${loadedMb} / ${totalMb} MB)…` : `Downloading Clang WASM (${loadedMb} MB)…`,
      compiling: "Compiling WebAssembly module…",
      readyCached: (sizeMb, ms) => ms !== null ? `Clang WASM ready · cached (${sizeMb} MB, ${ms} ms)` : `Clang WASM ready · cached (${sizeMb} MB)`,
      readyDownloaded: (sizeMb, ms) => ms !== null ? `Clang WASM ready · downloaded & cached (${sizeMb} MB, ${ms} ms)` : `Clang WASM ready · downloaded & cached (${sizeMb} MB)`,
      traceTime: (ms) => `Traced in ${ms} ms`,
      emptyPlaceholder: "Write a C++ snippet on the left and press Visualize.",
      turnOn: (flag) => `Turn on ${flag}`,
      needsFlag: (flag) => `; with ${flag} on, the trace shows why`
    },
    ru: {
      title: "Песочница памяти и раскладки C++",
      subtitle: "Компиляция прямо в браузере через Clang 21 WebAssembly — без сервера.",
      presetLabel: "Пример",
      customPreset: "Свой код",
      themeDark: "Тёмная",
      themeLight: "Светлая",
      langLabel: "EN",
      editorLabel: "Код C++ (выполняется внутри int main())",
      run: "Визуализировать",
      running: "Компиляция…",
      shortcut: "Ctrl+Enter / Cmd+Enter для запуска",
      clearCache: "Очистить кэш WASM",
      cacheCleared: "Кэш WASM очищен — следующий запуск загрузит модуль заново",
      checkingCache: "Проверка кэша WASM в браузере…",
      downloading: (loadedMb, totalMb) => totalMb ? `Загрузка Clang WASM (${loadedMb} / ${totalMb} МБ)…` : `Загрузка Clang WASM (${loadedMb} МБ)…`,
      compiling: "Компиляция WebAssembly модуля…",
      readyCached: (sizeMb, ms) => ms !== null ? `Clang WASM готов · из кэша (${sizeMb} МБ, ${ms} мс)` : `Clang WASM готов · из кэша (${sizeMb} МБ)`,
      readyDownloaded: (sizeMb, ms) => ms !== null ? `Clang WASM готов · загружен и кэширован (${sizeMb} МБ, ${ms} мс)` : `Clang WASM готов · загружен и кэширован (${sizeMb} МБ)`,
      traceTime: (ms) => `Готово за ${ms} мс`,
      emptyPlaceholder: "Введите фрагмент C++ слева и нажмите «Визуализировать».",
      turnOn: (flag) => `Включить «${flag}»`,
      needsFlag: (flag) => `; если включить «${flag}», трасса покажет причину`
    }
  };
  function getLang() {
    return (document.documentElement.lang || "").toLowerCase().startsWith("ru") ? "ru" : "en";
  }
  function getTheme() {
    const theme = document.documentElement.dataset.theme;
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function formatMb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1);
  }
  function resolveConfig(root) {
    const params = new URLSearchParams(window.location.search);
    const globalCfg = window.CoursePlaygroundConfig ?? {};
    const wasmUrl = params.get("wasm") || root.dataset.wasmUrl || document.documentElement.dataset.wasmUrl || globalCfg.wasmUrl || DEFAULT_WASM_URL;
    const workerUrl = params.get("worker") || root.dataset.workerUrl || globalCfg.workerUrl || new URL("./clang-worker.js", _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("playground.js", document.baseURI).href).href;
    const workerType = root.dataset.workerType || globalCfg.workerType || "classic";
    const cacheName = root.dataset.cacheName || globalCfg.cacheName || DEFAULT_CACHE_NAME;
    return { wasmUrl, workerUrl, workerType, cacheName };
  }
  function initPlayground(root) {
    const params = new URLSearchParams(window.location.search);
    const queryTheme = params.get("theme");
    if (queryTheme === "light" || queryTheme === "dark") {
      document.documentElement.dataset.theme = queryTheme;
    } else if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = getTheme();
    }
    const queryLang = params.get("lang");
    if (queryLang === "en" || queryLang === "ru") {
      document.documentElement.lang = queryLang;
    } else if (!document.documentElement.lang) {
      document.documentElement.lang = "en";
    }
    const state = readState(params);
    const cfg = resolveConfig(root);
    root.innerHTML = `
    <header class="pg-header">
      <div class="pg-brand">
        <h1 class="pg-title"></h1>
        <p class="pg-subtitle"></p>
      </div>
      <div class="pg-header-actions">
        <div class="pg-segmented" role="group" aria-label="Visualization template">
          ${TEMPLATE_NAMES.map((t) => `<button type="button" class="pg-mode-btn" data-template="${t}"></button>`).join("")}
        </div>
        <div class="pg-flags" role="group" aria-label="Trace flags">
          ${FLAG_NAMES.map((f) => `<button type="button" class="pg-btn pg-flag-btn" data-flag="${f}"></button>`).join("")}
        </div>
        <label class="pg-preset-wrap">
          <span class="pg-preset-label"></span>
          <select class="pg-preset-select"></select>
        </label>
        <button type="button" class="pg-btn pg-lang-btn"></button>
        <button type="button" class="pg-btn pg-theme-btn"></button>
      </div>
    </header>
    <div class="pg-status-bar">
      <div class="pg-wasm-status" data-state="idle">
        <span class="pg-status-dot" aria-hidden="true"></span>
        <span class="pg-status-text"></span>
      </div>
      <div class="pg-status-meta">
        <span class="pg-trace-time"></span>
        <button type="button" class="pg-btn pg-btn-subtle pg-clear-cache-btn"></button>
      </div>
    </div>
    <main class="pg-workspace">
      <section class="pg-editor-pane">
        <div class="pg-pane-head">
          <label class="pg-editor-label" for="pg-source"></label>
          <span class="pg-shortcut"></span>
        </div>
        <textarea id="pg-source" class="pg-editor" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        <div class="pg-editor-foot">
          <button type="button" class="pg-btn pg-btn-primary pg-run-btn"></button>
        </div>
      </section>
      <section class="pg-output-pane">
        <div class="pg-error-box" hidden></div>
        <div class="pg-empty-box"></div>
        <div class="course-visualization pg-vis-host"></div>
      </section>
    </main>
  `;
    const titleEl = root.querySelector(".pg-title");
    const subtitleEl = root.querySelector(".pg-subtitle");
    const templateBtns = new Map(
      TEMPLATE_NAMES.map((t) => [t, root.querySelector(`[data-template="${t}"]`)])
    );
    const flagBtns = new Map(
      FLAG_NAMES.map((f) => [f, root.querySelector(`[data-flag="${f}"]`)])
    );
    const presetLabelEl = root.querySelector(".pg-preset-label");
    const presetSelect = root.querySelector(".pg-preset-select");
    const langBtn = root.querySelector(".pg-lang-btn");
    const themeBtn = root.querySelector(".pg-theme-btn");
    const wasmStatusBox = root.querySelector(".pg-wasm-status");
    const wasmStatusText = root.querySelector(".pg-status-text");
    const traceTimeEl = root.querySelector(".pg-trace-time");
    const clearCacheBtn = root.querySelector(".pg-clear-cache-btn");
    const editorLabelEl = root.querySelector(".pg-editor-label");
    const shortcutEl = root.querySelector(".pg-shortcut");
    const editor = root.querySelector("#pg-source");
    const runBtn = root.querySelector(".pg-run-btn");
    const errorBox = root.querySelector(".pg-error-box");
    const emptyBox = root.querySelector(".pg-empty-box");
    const visHost = root.querySelector(".pg-vis-host");
    editor.value = state.source;
    let currentView = null;
    let lastTrace = null;
    let lastError = null;
    let errorSource = null;
    let lastDurationMs = null;
    let lastLoadMeta = null;
    let isRunning = false;
    let activeRunSeq = 0;
    const client = new ClangWasmClient({
      wasmUrl: cfg.wasmUrl,
      workerUrl: cfg.workerUrl,
      workerType: cfg.workerType,
      cacheName: cfg.cacheName,
      onProgress: handleProgress
    });
    function settings() {
      return { template: state.template, flags: flagsFor(state.template, state.flags) };
    }
    function syncUrl() {
      const url = new URL(window.location.href);
      state.source = editor.value;
      writeState(url.searchParams, state);
      url.searchParams.set("theme", getTheme());
      url.searchParams.set("lang", getLang());
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    function handleProgress(progress) {
      const copy = UI_COPY[getLang()];
      wasmStatusBox.dataset.state = progress.phase;
      if (progress.phase === "checking-cache") {
        wasmStatusText.textContent = copy.checkingCache;
      } else if (progress.phase === "downloading") {
        const loaded = formatMb(progress.loadedBytes ?? 0);
        const total = progress.totalBytes ? formatMb(progress.totalBytes) : null;
        wasmStatusText.textContent = copy.downloading(loaded, total);
      } else if (progress.phase === "compiling") {
        wasmStatusText.textContent = copy.compiling;
      } else if (progress.phase === "ready") {
        const size = formatMb(progress.totalBytes ?? progress.loadedBytes ?? 0);
        wasmStatusText.textContent = progress.fromCache ? copy.readyCached(size, null) : copy.readyDownloaded(size, null);
      }
    }
    function populatePresets() {
      const lang = getLang();
      const copy = UI_COPY[lang];
      const matched = matchingPreset({ source: editor.value, template: state.template });
      presetSelect.innerHTML = "";
      if (!matched) {
        const customOpt = document.createElement("option");
        customOpt.value = CUSTOM_PRESET_ID;
        customOpt.textContent = copy.customPreset;
        presetSelect.append(customOpt);
      }
      for (const template of TEMPLATE_NAMES) {
        const group = document.createElement("optgroup");
        group.label = TEMPLATES[template].label[lang];
        for (const preset of PRESETS.filter((p) => p.settings.template === template)) {
          const opt = document.createElement("option");
          opt.value = preset.id;
          opt.textContent = preset.label[lang];
          group.append(opt);
        }
        if (group.children.length) presetSelect.append(group);
      }
      presetSelect.value = matched ? matched.id : CUSTOM_PRESET_ID;
    }
    function renderStrings() {
      const lang = getLang();
      const theme = getTheme();
      const copy = UI_COPY[lang];
      titleEl.textContent = copy.title;
      subtitleEl.textContent = copy.subtitle;
      for (const [template, btn] of templateBtns) {
        const active = template === state.template;
        btn.textContent = TEMPLATES[template].label[lang];
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      }
      for (const [flag, btn] of flagBtns) {
        const on = Boolean(state.flags[flag]);
        btn.textContent = FLAGS[flag].label[lang];
        btn.title = FLAGS[flag].description[lang];
        btn.hidden = !takesFlag(state.template, flag);
        btn.setAttribute("aria-pressed", String(on));
      }
      presetLabelEl.textContent = copy.presetLabel;
      populatePresets();
      langBtn.textContent = copy.langLabel;
      themeBtn.textContent = theme === "dark" ? copy.themeLight : copy.themeDark;
      editorLabelEl.textContent = copy.editorLabel;
      shortcutEl.textContent = copy.shortcut;
      runBtn.textContent = isRunning ? copy.running : copy.run;
      runBtn.disabled = isRunning;
      clearCacheBtn.textContent = copy.clearCache;
      emptyBox.textContent = copy.emptyPlaceholder;
      if (!errorBox.hidden) renderError();
      if (lastLoadMeta) {
        const size = formatMb(lastLoadMeta.byteLength);
        wasmStatusBox.dataset.state = "ready";
        wasmStatusText.textContent = lastLoadMeta.fromCache ? copy.readyCached(size, lastLoadMeta.elapsedMs) : copy.readyDownloaded(size, lastLoadMeta.elapsedMs);
      } else if (wasmStatusBox.dataset.state === "idle") {
        wasmStatusText.textContent = copy.checkingCache;
      }
      traceTimeEl.textContent = lastDurationMs !== null ? copy.traceTime(lastDurationMs) : "";
    }
    function renderError() {
      const err = lastError;
      const lang = getLang();
      if (err instanceof NeedsFlag && isFlag(err.flag) && takesFlag(state.template, err.flag)) {
        const flag = err.flag;
        const label = FLAGS[flag].label[lang];
        errorBox.replaceChildren(`IllFormed: ${err.diagnostic}`);
        if (errorSource !== editor.value) return;
        errorBox.append(UI_COPY[lang].needsFlag(label));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pg-btn pg-error-action";
        button.textContent = UI_COPY[lang].turnOn(label);
        button.addEventListener("click", () => {
          var _a;
          (_a = flagBtns.get(flag)) == null ? void 0 : _a.focus();
          setFlag(flag, true);
        });
        errorBox.append(button);
        return;
      }
      const prefix = err instanceof Unsupported ? `${err.name}: ` : "";
      const message = err instanceof Error ? err.message : String(err);
      errorBox.replaceChildren(`${prefix}${message}`);
    }
    function clearVisualization() {
      if (currentView) {
        currentView.disconnect();
        currentView = null;
      }
      delete visHost.cvPlayer;
      visHost.innerHTML = "";
    }
    function mountTrace(trace) {
      clearVisualization();
      emptyBox.hidden = true;
      errorBox.hidden = true;
      if (trace.kind === "layout") {
        currentView = new Layout(visHost, trace);
      } else {
        currentView = new Player(visHost, trace);
      }
      visHost.cvPlayer = currentView;
      lastTrace = trace;
    }
    async function run() {
      const seq = ++activeRunSeq;
      const source = editor.value;
      isRunning = true;
      renderStrings();
      errorBox.hidden = true;
      try {
        const result = await client.trace(source, settings());
        if (seq !== activeRunSeq) return;
        lastLoadMeta = result.load;
        lastDurationMs = result.durationMs;
        mountTrace(result.trace);
      } catch (err) {
        if (seq !== activeRunSeq) return;
        clearVisualization();
        emptyBox.hidden = true;
        errorBox.hidden = false;
        lastError = err;
        errorSource = source;
        renderError();
        lastTrace = null;
      } finally {
        if (seq === activeRunSeq) {
          isRunning = false;
          renderStrings();
        }
      }
    }
    function setTemplate(template) {
      if (state.template === template) return;
      const selected = PRESETS.find((p) => p.id === presetSelect.value);
      state.template = template;
      if (selected) {
        const preset = firstPreset(template);
        editor.value = preset.source;
        state.flags = { ...preset.settings.flags };
      }
      renderStrings();
      syncUrl();
      void run();
    }
    function setFlag(flag, on) {
      if (Boolean(state.flags[flag]) === on) return;
      state.flags = { ...state.flags, [flag]: on };
      renderStrings();
      syncUrl();
      void run();
    }
    for (const [template, btn] of templateBtns) {
      btn.addEventListener("click", () => setTemplate(template));
    }
    for (const [flag, btn] of flagBtns) {
      btn.addEventListener("click", () => setFlag(flag, !state.flags[flag]));
    }
    presetSelect.addEventListener("change", () => {
      const preset = PRESETS.find((p) => p.id === presetSelect.value);
      if (!preset) return;
      state.template = preset.settings.template;
      state.flags = { ...preset.settings.flags };
      editor.value = preset.source;
      renderStrings();
      syncUrl();
      void run();
    });
    themeBtn.addEventListener("click", () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      currentView == null ? void 0 : currentView.refresh();
      renderStrings();
      syncUrl();
    });
    langBtn.addEventListener("click", () => {
      const next = getLang() === "en" ? "ru" : "en";
      document.documentElement.lang = next;
      renderStrings();
      syncUrl();
      if (lastTrace) {
        const stepIndex = currentView instanceof Player ? currentView.index : null;
        mountTrace(lastTrace);
        if (currentView instanceof Player && stepIndex !== null) {
          currentView.settle(stepIndex);
        }
      }
    });
    runBtn.addEventListener("click", () => {
      syncUrl();
      void run();
    });
    editor.addEventListener("input", () => {
      populatePresets();
      syncUrl();
      if (!errorBox.hidden) renderError();
    });
    editor.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        syncUrl();
        void run();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.setRangeText("  ", start, end, "end");
        populatePresets();
        syncUrl();
        if (!errorBox.hidden) renderError();
      }
    });
    async function clearCache() {
      const cleared = await client.clearCache();
      lastLoadMeta = null;
      wasmStatusBox.dataset.state = "idle";
      wasmStatusText.textContent = UI_COPY[getLang()].cacheCleared;
      return cleared;
    }
    clearCacheBtn.addEventListener("click", () => {
      void clearCache();
    });
    renderStrings();
    const controller = {
      client,
      run,
      setTemplate,
      setFlag,
      clearCache
    };
    window.CoursePlayground = controller;
    void run();
    return controller;
  }
  if (typeof document !== "undefined") {
    const mount = () => {
      const root = document.getElementById("playground-root");
      if (root && !root.dataset.pgMounted) {
        root.dataset.pgMounted = "true";
        initPlayground(root);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }
  }
  exports.PRESETS = PRESETS;
  exports.initPlayground = initPlayground;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
