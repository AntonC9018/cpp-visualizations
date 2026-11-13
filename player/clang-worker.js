var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const DEFAULT_CACHE_NAME = "clang-trace-frontend-v1";
  const DEFAULT_WASM_URL = "./clang-trace-frontend.wasm";
  const inFlight = /* @__PURE__ */ new Map();
  function resolveWasmUrl(wasmUrl) {
    var _a;
    try {
      const base = typeof ((_a = globalThis.location) == null ? void 0 : _a.href) === "string" ? globalThis.location.href : "http://localhost/";
      return new URL(wasmUrl, base).href;
    } catch {
      return wasmUrl;
    }
  }
  function isValidWasmBytes(bytes) {
    return bytes.byteLength >= 8 && bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109;
  }
  function getCacheStorage(explicit) {
    if (explicit !== void 0) return explicit;
    return typeof globalThis.caches !== "undefined" ? globalThis.caches : null;
  }
  async function openCacheSafe(storage, cacheName) {
    if (!storage) return null;
    try {
      return await storage.open(cacheName);
    } catch {
      return null;
    }
  }
  async function readResponseWithProgress(response, onProgress) {
    const contentLengthHeader = response.headers.get("Content-Length");
    const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : void 0;
    const total = totalBytes && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : void 0;
    if (!response.body || typeof response.body.getReader !== "function") {
      const buffer = await response.arrayBuffer();
      const bytes2 = new Uint8Array(buffer);
      onProgress == null ? void 0 : onProgress({
        phase: "downloading",
        loadedBytes: bytes2.byteLength,
        totalBytes: total ?? bytes2.byteLength,
        fromCache: false
      });
      return bytes2;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loadedBytes = 0;
    onProgress == null ? void 0 : onProgress({
      phase: "downloading",
      loadedBytes: 0,
      totalBytes: total,
      fromCache: false
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        loadedBytes += value.byteLength;
        onProgress == null ? void 0 : onProgress({
          phase: "downloading",
          loadedBytes,
          totalBytes: total,
          fromCache: false
        });
      }
    }
    const bytes = new Uint8Array(loadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  async function clearWasmCache(options = {}) {
    const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
    const storage = getCacheStorage(options.cachesImpl);
    if (!storage) return false;
    if (options.wasmUrl !== void 0) {
      const cache = await openCacheSafe(storage, cacheName);
      if (!cache) return false;
      try {
        return await cache.delete(resolveWasmUrl(options.wasmUrl));
      } catch {
        return false;
      }
    }
    try {
      return await storage.delete(cacheName);
    } catch {
      return false;
    }
  }
  function loadWasmModule(wasmUrl = DEFAULT_WASM_URL, options = {}) {
    const cacheName = options.cacheName ?? DEFAULT_CACHE_NAME;
    const resolvedUrl = resolveWasmUrl(wasmUrl);
    const key = `${cacheName}::${resolvedUrl}`;
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      const start = performance.now();
      const { onProgress } = options;
      const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      const storage = getCacheStorage(options.cachesImpl);
      onProgress == null ? void 0 : onProgress({ phase: "checking-cache" });
      const cache = await openCacheSafe(storage, cacheName);
      let bytes = null;
      let fromCache = false;
      if (cache) {
        try {
          const cached = await cache.match(resolvedUrl);
          if (cached) {
            const cachedBytes = new Uint8Array(await cached.arrayBuffer());
            if (isValidWasmBytes(cachedBytes)) {
              bytes = cachedBytes;
              fromCache = true;
            } else {
              await cache.delete(resolvedUrl);
            }
          }
        } catch {
        }
      }
      if (!bytes) {
        const response = await fetchFn(resolvedUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Clang WASM from ${resolvedUrl} (${response.status} ${response.statusText})`
          );
        }
        const downloaded = await readResponseWithProgress(response, onProgress);
        if (!isValidWasmBytes(downloaded)) {
          throw new Error(`Invalid WASM binary received from ${resolvedUrl}`);
        }
        bytes = downloaded;
        if (cache) {
          try {
            const cacheBody = new Uint8Array(bytes.byteLength);
            cacheBody.set(bytes);
            await cache.put(
              resolvedUrl,
              new Response(cacheBody, {
                status: 200,
                headers: {
                  "Content-Type": "application/wasm",
                  "Content-Length": String(cacheBody.byteLength)
                }
              })
            );
          } catch {
          }
        }
      }
      onProgress == null ? void 0 : onProgress({
        phase: "compiling",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        fromCache
      });
      const wasmBuffer = new Uint8Array(bytes.byteLength);
      wasmBuffer.set(bytes);
      const module = await WebAssembly.compile(wasmBuffer);
      const elapsedMs = Math.round(performance.now() - start);
      onProgress == null ? void 0 : onProgress({
        phase: "ready",
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        fromCache
      });
      return {
        module,
        wasmUrl: resolvedUrl,
        cacheName,
        fromCache,
        byteLength: bytes.byteLength,
        elapsedMs
      };
    })().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }
  class Unsupported extends Error {
    constructor(message) {
      super(message);
      this.name = "Unsupported";
    }
  }
  class RecordLayout {
    constructor(name, size, alignment, fields) {
      __publicField(this, "name");
      __publicField(this, "size");
      __publicField(this, "alignment");
      __publicField(this, "fields");
      this.name = name;
      this.size = size;
      this.alignment = alignment;
      this.fields = fields;
      Object.freeze(this);
    }
  }
  function typeSpelling(node) {
    var _a;
    const qualified = ((_a = node == null ? void 0 : node.type) == null ? void 0 : _a.qualType) ?? "";
    return qualified.replace(/^(const )?struct /, "$1");
  }
  function typeName(node) {
    return typeSpelling(node).replace(/^const /, "");
  }
  function canonicalType(node) {
    const qualified = (node == null ? void 0 : node.type) ?? {};
    return qualified.desugaredQualType ?? qualified.qualType ?? "";
  }
  const LAYOUT_SPELLINGS = [
    "uint8_t",
    "int8_t",
    "int",
    "size_t",
    "uint64_t",
    "std::uint8_t",
    "std::int8_t",
    "std::size_t",
    "std::uint64_t"
  ];
  const BUILTIN_INTEGERS = [
    "signed char",
    "unsigned char",
    "int",
    "unsigned long",
    "unsigned long long"
  ];
  function isPointer(node) {
    return canonicalType(node).endsWith("*");
  }
  function extractEnumConstantSizes(tree, types) {
    const enumValues = {};
    function constant(item) {
      if (item.kind === "ConstantExpr") {
        return Number.parseInt(item.value ?? "0", 10);
      }
      return constant(item.inner[0]);
    }
    function walkTree(node) {
      if (node.kind === "EnumConstantDecl" && node.name) {
        enumValues[node.name] = constant(node);
      }
      for (const child of node.inner ?? []) {
        walkTree(child);
      }
    }
    walkTree(tree);
    const result = {};
    for (let i = 0; i < types.length; i++) {
      result[types[i]] = enumValues[`__course_${i}`];
    }
    return result;
  }
  function layoutsFromFrontend(ast, program, frontend, { layoutOnly = false } = {}) {
    const definitions2 = {};
    for (const statement of (ast == null ? void 0 : ast.inner) ?? []) {
      const inner = (statement == null ? void 0 : statement.kind) === "DeclStmt" ? statement.inner ?? [] : [];
      for (const node of inner) {
        if ((node == null ? void 0 : node.kind) === "CXXRecordDecl" && node.completeDefinition) {
          const name = node.name;
          if (!name || Object.hasOwn(definitions2, name)) {
            throw new Unsupported("structs require unique names");
          }
          definitions2[name] = node;
        }
      }
    }
    if (Object.keys(definitions2).length === 0) {
      return {};
    }
    for (const [name, node] of Object.entries(definitions2)) {
      if (node.tagUsed !== "struct" || node.bases && node.bases.length > 0) {
        throw new Unsupported("only plain aggregate structs without inheritance are supported");
      }
      const fields = [];
      for (const child of node.inner ?? []) {
        if (child.isImplicit) continue;
        if (child.kind !== "FieldDecl") {
          throw new Unsupported(`struct ${name}: methods, attributes and nested types are unsupported`);
        }
        const qualified = typeSpelling(child);
        const canonical = canonicalType(child);
        let allowed = qualified === "int" || /^int \*+$/.test(qualified);
        allowed || (allowed = Object.keys(definitions2).some((record) => qualified === `${record} *`));
        allowed || (allowed = Object.hasOwn(definitions2, qualified) && qualified !== name);
        if (layoutOnly) {
          allowed = LAYOUT_SPELLINGS.includes(qualified) && BUILTIN_INTEGERS.includes(canonical);
          allowed || (allowed = /^(?:const )?[\w:]+ \*+$/.test(qualified));
        }
        if (!allowed) {
          throw new Unsupported(`struct ${name}.${child.name}: unsupported field type ${qualified}`);
        }
        if (child.isBitfield || child.inner && child.inner.length > 0 || !child.name) {
          throw new Unsupported(`struct ${name}: bitfields, attributes and default initializers are unsupported`);
        }
        fields.push(child);
      }
      if (fields.length === 0) {
        throw new Unsupported("empty structs are unsupported");
      }
    }
    const dumpOutput = frontend.recordLayoutsDump(program);
    const records = {};
    const canonicals = {};
    for (const block of dumpOutput.split("*** Dumping AST Record Layout")) {
      const header = /^\s*0 \| struct (\w+)\s*$/m.exec(block);
      if (!header || !Object.hasOwn(definitions2, header[1])) continue;
      const name = header[1];
      const sizes = /\[sizeof=(\d+), dsize=\d+, align=(\d+),/.exec(block);
      const rows = [...block.matchAll(/^\s*(\d+) \|   (\S.*?) (\w+)\s*$/gm)];
      const nodes = (definitions2[name].inner ?? []).filter((c) => c.kind === "FieldDecl");
      if (!sizes || rows.length !== nodes.length || rows.some((row, i) => row[3] !== nodes[i].name)) {
        throw new Unsupported(`Clang returned an incomplete layout for ${name}`);
      }
      const fields = [];
      const recordCanonicals = [];
      for (let i = 0; i < rows.length; i++) {
        const offset = Number.parseInt(rows[i][1], 10);
        const member = rows[i][3];
        const node = nodes[i];
        const spelling = typeSpelling(node);
        const nested = !layoutOnly && Object.hasOwn(definitions2, spelling) ? spelling : null;
        const item = {
          name: member,
          offset,
          kind: nested ? "struct" : isPointer(node) ? "ptr" : "int",
          size: 0
        };
        if (layoutOnly || nested) {
          item.type = spelling;
        }
        fields.push(item);
        recordCanonicals.push(
          item.kind === "struct" ? null : isPointer(node) ? "void *" : canonicalType(node)
        );
      }
      records[name] = new RecordLayout(
        name,
        Number.parseInt(sizes[1], 10),
        Number.parseInt(sizes[2], 10),
        fields
      );
      canonicals[name] = recordCanonicals;
    }
    const defKeys = Object.keys(definitions2);
    const recKeys = Object.keys(records);
    if (defKeys.length !== recKeys.length || !defKeys.every((k) => Object.hasOwn(records, k))) {
      throw new Unsupported("Clang omitted a struct layout");
    }
    const types = [
      ...new Set(
        Object.values(canonicals).flat().filter((v) => Boolean(v))
      )
    ].sort();
    const sizesMap = frontend.typeSizes(types);
    for (const [name, record] of Object.entries(records)) {
      const recCanonicals = canonicals[name];
      for (let i = 0; i < record.fields.length; i++) {
        const item = record.fields[i];
        const canonical = recCanonicals[i];
        item.size = canonical === null ? records[item.type].size : sizesMap[canonical];
      }
    }
    return records;
  }
  const FORMAT = 1;
  const SCALAR_KINDS = ["int", "ptr"];
  const STRUCT = "struct";
  const OPERATIONS = [
    "read",
    "addr",
    "deref",
    "eval",
    "write",
    "print",
    "bind",
    "alias"
  ];
  const UNKNOWN = "?";
  const IDENTIFIER = /^[A-Za-z_]\w*$/;
  class FormatError extends Error {
    constructor(message) {
      super(message);
      this.name = "FormatError";
    }
  }
  const WHITESPACE_SPELLINGS = {
    "std::endl": "\n",
    endl: "\n",
    "'\\n'": "\n",
    "'\\t'": "	",
    "' '": " "
  };
  function whitespaceOutput(spelling) {
    return Object.hasOwn(WHITESPACE_SPELLINGS, spelling) ? WHITESPACE_SPELLINGS[spelling] : null;
  }
  function scalar(name, address, size = 4, kind = "int", color = 0) {
    return { name, address, size, kind, color };
  }
  function struct(name, type_, address, size, fields, color = 0) {
    return { name, type: type_, address, size, kind: "struct", color, fields };
  }
  function reference(name, color = 0) {
    return { name, color };
  }
  function field(name, offset, size = 4, kind = "int", color = 0) {
    return { name, offset, size, kind, color };
  }
  function structField(name, type_, offset, size, fields, color = 0) {
    return { name, type: type_, offset, size, kind: STRUCT, color, fields };
  }
  function* walk(variables) {
    function* visit(prefix, base, item) {
      const name = prefix + item.name;
      const itemOffset = "offset" in item ? item.offset : item.address;
      const address = base + (itemOffset ?? 0);
      yield [name, address, item];
      if (item.kind === STRUCT) {
        for (const inner of item.fields) {
          yield* visit(name + ".", address, inner);
        }
      }
    }
    for (const variable of variables) {
      yield* visit("", 0, variable);
    }
  }
  function leaves(variables) {
    const result = {};
    for (const [name, , item] of walk(variables)) {
      if (item.kind !== STRUCT) {
        result[name] = item;
      }
    }
    return result;
  }
  function addresses(variables) {
    const result = {};
    for (const [name, address] of walk(variables)) {
      result[name] = address;
    }
    return result;
  }
  function cellsOf(variables, name) {
    return Object.keys(leaves(variables)).filter((leaf) => leaf === name || leaf.startsWith(name + "."));
  }
  function isPlainObject$1(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function pyRepr(value) {
    if (typeof value === "string") {
      return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    }
    return JSON.stringify(value);
  }
  function pyListRepr(items) {
    return `[${items.map(pyRepr).join(", ")}]`;
  }
  function check(condition, where, message) {
    if (!condition) {
      throw new FormatError(`${where}: ${message}`);
    }
  }
  function checkKeys(value, where, required, optional = []) {
    check(isPlainObject$1(value), where, "expected an object");
    const keys = Object.keys(value);
    const reqSet = new Set(required);
    const optSet = new Set(optional);
    const missing = [...reqSet].filter((k) => !Object.hasOwn(value, k)).sort();
    const unknown = keys.filter((k) => !reqSet.has(k) && !optSet.has(k)).sort();
    check(missing.length === 0, where, `missing ${pyListRepr(missing)}`);
    check(unknown.length === 0, where, `unknown ${pyListRepr(unknown)}`);
  }
  function natural(value, where, positive = false) {
    check(
      Number.isInteger(value) && typeof value === "number" && value >= (positive ? 1 : 0),
      where,
      positive ? "expected a positive integer" : "expected a non-negative integer"
    );
  }
  function checkSpan(value, text, where, empty = false) {
    check(
      Array.isArray(value) && value.length === 2 && value.every((v) => Number.isInteger(v) && typeof v === "number"),
      where,
      "expected [start, end]"
    );
    const [start, end] = value;
    check(
      0 <= start && start <= end && end <= text.length && (empty || start < end),
      where,
      `[${start}, ${end}] is outside ${pyRepr(text)}`
    );
    return [start, end];
  }
  function checkFields(owner, here) {
    check(typeof owner.type === "string" && owner.type.length > 0, here, "type must be a name");
    const fields = owner.fields;
    check(Array.isArray(fields) && fields.length > 0, `${here}.fields`, "expected a nonempty list");
    const seen = /* @__PURE__ */ new Set();
    let end = 0;
    for (let position = 0; position < fields.length; position++) {
      const item = fields[position];
      const spot = `${here}.fields[${position}]`;
      const nested = isPlainObject$1(item) && item.kind === STRUCT;
      const req = ["name", "offset", "size", "kind", "color", ...nested ? ["type", "fields"] : []];
      checkKeys(item, spot, req);
      check(IDENTIFIER.test(String(item.name)), spot, "name is not an identifier");
      check(!seen.has(item.name), spot, `duplicate field ${pyRepr(item.name)}`);
      seen.add(item.name);
      check(
        nested || SCALAR_KINDS.includes(item.kind),
        spot,
        "kind must be one of ('int', 'ptr') or struct"
      );
      natural(item.offset, `${spot}.offset`);
      natural(item.size, `${spot}.size`, true);
      natural(item.color, `${spot}.color`);
      check(item.offset >= end, spot, "fields must be ordered and must not overlap");
      end = item.offset + item.size;
      if (nested) {
        checkFields(item, spot);
      }
    }
    check(end <= owner.size, here, "fields exceed the struct size");
  }
  function checkVariables(variables, where) {
    check(Array.isArray(variables) && variables.length > 0, where, "expected a nonempty list");
    const names = /* @__PURE__ */ new Set();
    const ranges = [];
    for (let index = 0; index < variables.length; index++) {
      const variable = variables[index];
      const here = `${where}[${index}]`;
      const struct_ = isPlainObject$1(variable) && variable.kind === "struct";
      const req = ["name", "address", "size", "kind", "color", ...struct_ ? ["type", "fields"] : []];
      checkKeys(variable, here, req);
      check(IDENTIFIER.test(String(variable.name)), here, "name is not an identifier");
      check(!names.has(variable.name), here, `duplicate variable ${pyRepr(variable.name)}`);
      names.add(variable.name);
      natural(variable.address, `${here}.address`);
      natural(variable.size, `${here}.size`, true);
      natural(variable.color, `${here}.color`);
      ranges.push([variable.address, variable.address + variable.size, variable.name]);
      if (!struct_) {
        check(
          SCALAR_KINDS.includes(variable.kind),
          here,
          "kind must be one of ('int', 'ptr') or struct"
        );
        continue;
      }
      checkFields(variable, here);
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
    for (let i = 0; i < ranges.length - 1; i++) {
      const [, end, left] = ranges[i];
      const [start, , right] = ranges[i + 1];
      check(start >= end, where, `${pyRepr(left)} and ${pyRepr(right)} overlap`);
    }
    return leaves(variables);
  }
  function checkReferences(references, variables, where) {
    check(Array.isArray(references) && references.length > 0, where, "expected a nonempty list");
    const names = /* @__PURE__ */ new Set();
    const taken = new Set(variables.map((v) => v.name));
    for (let index = 0; index < references.length; index++) {
      const item = references[index];
      const here = `${where}[${index}]`;
      checkKeys(item, here, ["name", "color"]);
      check(IDENTIFIER.test(String(item.name)), here, "name is not an identifier");
      check(!names.has(item.name) && !taken.has(item.name), here, `duplicate name ${pyRepr(item.name)}`);
      names.add(item.name);
      natural(item.color, `${here}.color`);
    }
    return names;
  }
  function checkValue(value, where) {
    check(
      value === null || value === UNKNOWN || Number.isInteger(value) && typeof value === "number",
      where,
      'a value is an integer, "?" (declared, unknown) or null (no storage yet)'
    );
  }
  function replacement(before, after, span, where) {
    const [start, end] = span;
    const tail = before.length - end;
    check(
      after.length >= start + tail && after.slice(0, start) === before.slice(0, start) && after.slice(after.length - tail) === before.slice(end),
      where,
      `${pyRepr(after)} is not ${pyRepr(before)} with ${pyRepr(before.slice(start, end))} replaced`
    );
    const replaced = after.slice(start, after.length - tail);
    check(replaced.length > 0, where, "the replacement is empty");
    return replaced;
  }
  const LITERAL = /^-?\d+$/;
  function stored(text, where) {
    const braced = /^(?:[A-Za-z_]\w*)?\{[\s\S]*\}$/.test(text);
    const inner = braced ? text.slice(text.indexOf("{")) : text;
    const items = braced ? inner.replace(/[{}]/g, "").split(",").map((s) => s.trim()) : [inner];
    const result = [];
    for (const item of items) {
      check(
        item === "nullptr" || item === UNKNOWN || LITERAL.test(item),
        where,
        `${pyRepr(inner)} is not a value: expected an integer, nullptr, "?" or {…} of them`
      );
      result.push(item === "nullptr" ? 0 : item === UNKNOWN ? item : Number.parseInt(item, 10));
    }
    return result;
  }
  function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  function checkMemory(op, step, previous, storage, where) {
    const { kind, name } = op;
    if (kind === "addr") {
      const address = storage.addresses[name];
      check(
        arraysEqual(stored(op.value, where), [address]),
        `${where}.value`,
        `the address of ${name} is ${address}, not ${pyRepr(op.value)}`
      );
      return;
    }
    const cells = storage.cellsOf(name);
    const values = (kind === "write" ? step : previous).values;
    const expected = cells.map((cell) => values[cell]);
    const shown = cells.length === 1 && cells[0] === name ? String(expected[0]) : `{${expected.map(String).join(", ")}}`;
    const when = kind === "write" ? "after the write" : "before the read";
    check(
      arraysEqual(stored(op.value, where), expected),
      `${where}.value`,
      `${name} holds ${shown} ${when}, not ${pyRepr(op.value)}`
    );
  }
  function checkPointers(step, storage, where) {
    var _a;
    for (const [name, target] of Object.entries(step.targets)) {
      check(((_a = storage.cells[name]) == null ? void 0 : _a.kind) === "ptr", `${where}.targets.${name}`, "only pointers have targets");
      check(
        Object.hasOwn(storage.addresses, target),
        `${where}.targets.${name}`,
        `unknown variable ${pyRepr(target)}`
      );
    }
    for (const [name, cell] of Object.entries(storage.cells)) {
      if (cell.kind !== "ptr") continue;
      const value = step.values[name];
      const target = Object.hasOwn(step.targets, name) ? step.targets[name] : void 0;
      if (target !== void 0 && target !== null) {
        const address = storage.addresses[target];
        check(
          value === address,
          `${where}.targets.${name}`,
          `${name} holds ${pyRepr(value)}, but ${target} is at ${address}`
        );
      } else {
        check(
          typeof value !== "number" || value === 0,
          `${where}.targets.${name}`,
          `${name} holds the address ${value} but points nowhere`
        );
      }
    }
  }
  function refs(step) {
    return step.refs ?? {};
  }
  function checkReferenceOp(op, step, previous, storage, where) {
    const { kind, name, target } = op;
    check(storage.references.has(name), `${where}.name`, `unknown reference ${pyRepr(name)}`);
    check(Object.hasOwn(storage.addresses, target), `${where}.target`, `unknown variable ${pyRepr(target)}`);
    if (kind === "alias") {
      check(refs(previous)[name] === target, where, `${name} is not bound to ${target}`);
      const span = checkSpan(op.span, previous.pane, `${where}.span`);
      const [start, end] = span;
      check(previous.pane.slice(start, end) === name, `${where}.span`, "does not cover the name");
      const replaced = replacement(previous.pane, step.pane, span, where);
      check(replaced === target, where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(target)}`);
      return;
    }
    check(step.pane === previous.pane, where, "a bind does not change the pane");
    check(
      !Object.hasOwn(refs(previous), name) && refs(step)[name] === target,
      where,
      `${name} must become bound to ${target}`
    );
    for (const [key, text] of [
      ["span", target],
      ["destination", name]
    ]) {
      const [start, end] = checkSpan(op[key], step.pane, `${where}.${key}`);
      check(step.pane.slice(start, end) === text, `${where}.${key}`, `does not cover ${pyRepr(text)}`);
    }
  }
  function unchangedPane(op, step, previous, where) {
    const { kind } = op;
    check(step.pane === previous.pane, where, `a ${kind} does not change the pane`);
    const [start, end] = checkSpan(op.span, step.pane, `${where}.span`);
    const covered = step.pane.slice(start, end);
    check(
      covered === op.value || kind === "print" && whitespaceOutput(covered) === op.value,
      `${where}.span`,
      "does not cover the value"
    );
    if (kind === "write") {
      const [dStart, dEnd] = checkSpan(op.destination, step.pane, `${where}.destination`);
      check(step.pane.slice(dStart, dEnd) === op.name, `${where}.destination`, "does not cover the name");
    } else {
      const printed = step.stdout.slice(previous.stdout.length);
      check(
        step.stdout.startsWith(previous.stdout) && printed.startsWith(op.value) && printed.slice(op.value.length).trim() === "",
        where,
        "stdout must grow by the printed value and optional whitespace"
      );
    }
  }
  function checkOperation(op, step, previous, storage, where) {
    var _a;
    check(
      isPlainObject$1(op) && OPERATIONS.includes(op.kind),
      where,
      `kind must be one of (${OPERATIONS.map(pyRepr).join(", ")})`
    );
    const kind = op.kind;
    const fieldMap = {
      read: ["name", "value", "span"],
      addr: ["name", "value", "span"],
      deref: ["target", "via", "span"],
      eval: ["value", "span"],
      write: ["name", "value", "span", "destination"],
      print: ["value", "span"],
      bind: ["name", "target", "span", "destination"],
      alias: ["name", "target", "span"]
    };
    const fields = fieldMap[kind];
    checkKeys(op, where, [...fields, "kind"]);
    for (const key of fields.filter((k) => ["name", "target", "via", "value"].includes(k))) {
      check(typeof op[key] === "string" && op[key].length > 0, `${where}.${key}`, "expected text");
    }
    if (kind === "bind" || kind === "alias") {
      checkReferenceOp(op, step, previous, storage, where);
      return;
    }
    for (const key of ["name", "via"]) {
      if (Object.hasOwn(op, key)) {
        check(
          Object.hasOwn(storage.addresses, op[key]),
          `${where}.${key}`,
          `unknown variable ${pyRepr(op[key])}`
        );
      }
    }
    if (kind === "deref") {
      check(
        Object.hasOwn(storage.addresses, op.target),
        `${where}.target`,
        `unknown variable ${pyRepr(op.target)}`
      );
      check(((_a = storage.cells[op.via]) == null ? void 0 : _a.kind) === "ptr", `${where}.via`, "must be a pointer");
      const pointee = previous.targets[op.via];
      check(
        pointee !== void 0 && (op.target === pointee || op.target.startsWith(pointee + ".")),
        where,
        `${op.via} does not point to ${op.target}`
      );
    }
    if (["read", "addr", "deref", "eval"].includes(kind)) {
      const span = checkSpan(op.span, previous.pane, `${where}.span`);
      const replaced = replacement(previous.pane, step.pane, span, where);
      const expected = kind === "deref" ? op.target : op.value;
      check(replaced === expected, where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(expected)}`);
    } else {
      unchangedPane(op, step, previous, where);
    }
    if (["read", "addr", "write"].includes(kind)) {
      checkMemory(op, step, previous, storage, where);
    }
  }
  function shallowEqualObj(a, b) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
  }
  function checkChanges(step, previous, storage, where) {
    const op = step.op || {};
    const written = new Set(op.kind === "write" ? storage.cellsOf(op.name) : []);
    for (const [name, value] of Object.entries(step.values)) {
      const old = previous.values[name];
      check(
        value === old || written.has(name) || !step.op && old === null && value === UNKNOWN,
        `${where}.values.${name}`,
        'only a write, or a declaration ("?"), changes a value'
      );
    }
    const targetNames = /* @__PURE__ */ new Set([...Object.keys(step.targets), ...Object.keys(previous.targets)]);
    for (const name of targetNames) {
      check(
        step.targets[name] === previous.targets[name] || written.has(name),
        `${where}.targets.${name}`,
        "only a write changes where a pointer points"
      );
    }
    check(
      step.stdout === previous.stdout || op.kind === "print",
      `${where}.stdout`,
      "only a print changes the output"
    );
    const bound = op.kind === "bind" ? { [op.name]: op.target } : {};
    check(
      shallowEqualObj(refs(step), { ...refs(previous), ...bound }),
      `${where}.refs`,
      "only a bind changes what a reference is bound to, and only once"
    );
  }
  function roundUp(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
  }
  function checkLayout(trace) {
    checkKeys(trace, "layout", ["format", "kind", "records"]);
    check(trace.format === FORMAT, "layout.format", `expected ${FORMAT}`);
    const records = trace.records;
    check(Array.isArray(records) && records.length > 0, "layout.records", "expected nonempty list");
    const names = /* @__PURE__ */ new Set();
    for (const record of records) {
      checkKeys(record, "record", ["name", "size", "alignment", "fields"]);
      const { name } = record;
      check(typeof name === "string" && IDENTIFIER.test(name), "record", "invalid name");
      check(!names.has(name), "record", "duplicate name");
      names.add(name);
      natural(record.size, `${name}.size`, true);
      natural(record.alignment, `${name}.alignment`, true);
      const align = record.alignment;
      check([1, 4, 8].includes(align), name, "invalid alignment");
      const fields = record.fields;
      check(Array.isArray(fields) && fields.length > 0, name, "expected nonempty fields");
      const seen = /* @__PURE__ */ new Set();
      let end = 0;
      for (const item of fields) {
        checkKeys(item, name, ["name", "offset", "size", "kind", "type"]);
        check(typeof item.name === "string" && IDENTIFIER.test(item.name), name, "invalid field name");
        check(!seen.has(item.name), name, "duplicate field");
        seen.add(item.name);
        check(typeof item.type === "string" && item.type.length > 0, name, "invalid field type");
        check(SCALAR_KINDS.includes(item.kind), name, "invalid field kind");
        natural(item.offset, `${name}.offset`);
        natural(item.size, `${name}.size`, true);
        const { size } = item;
        check([1, 4, 8].includes(size) && (item.kind !== "ptr" || size === 8), name, "unsupported field size");
        const expectedOffset = roundUp(end, size);
        check(
          item.offset === expectedOffset,
          name,
          `field ${item.name} must start at offset ${expectedOffset}`
        );
        end = item.offset + size;
      }
      const widest = Math.max(...fields.map((item) => item.size));
      check(align === widest, name, `alignment must be ${widest}, the widest field`);
      const expectedSize = roundUp(end, align);
      check(
        record.size === expectedSize,
        name,
        `size must be ${expectedSize}, the last field end rounded to alignment`
      );
    }
  }
  function validate(trace) {
    if (isPlainObject$1(trace) && trace.kind === "layout") {
      checkLayout(trace);
      return;
    }
    checkKeys(
      trace,
      "trace",
      ["format", "source", "variables", "steps"],
      ["title", "spans", "types", "references"]
    );
    check(trace.format === FORMAT, "trace.format", `expected ${FORMAT}`);
    const { source } = trace;
    check(
      Array.isArray(source) && source.length > 0 && source.every((line) => typeof line === "string"),
      "trace.source",
      "expected nonempty list of lines"
    );
    if (Object.hasOwn(trace, "title")) {
      check(typeof trace.title === "string", "trace.title", "expected text");
    }
    if (Object.hasOwn(trace, "spans")) {
      check(
        Array.isArray(trace.spans) && trace.spans.length === source.length,
        "trace.spans",
        "expected one entry per source line"
      );
      for (let index = 0; index < trace.spans.length; index++) {
        const span = trace.spans[index];
        if (span !== null) {
          checkSpan(span, source[index], `trace.spans[${index}]`);
        }
      }
    }
    if (Object.hasOwn(trace, "types")) {
      check(
        isPlainObject$1(trace.types) && Object.keys(trace.types).length > 0 && Object.entries(trace.types).every(
          ([k, v]) => typeof k === "string" && typeof v === "string" && v.length > 0
        ),
        "trace.types",
        "expected struct names mapped to their definitions"
      );
    }
    const variables = trace.variables;
    const cells = checkVariables(variables, "trace.variables");
    const references = Object.hasOwn(trace, "references") ? checkReferences(trace.references, variables, "trace.references") : /* @__PURE__ */ new Set();
    const storage = {
      variables,
      cells,
      addresses: addresses(variables),
      references,
      cellsOf(name) {
        return cellsOf(variables, name);
      }
    };
    const { steps } = trace;
    check(Array.isArray(steps) && steps.length > 0, "trace.steps", "expected a nonempty list");
    const sortedCellNames = Object.keys(cells).sort();
    let previous = null;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const where = `trace.steps[${index}]`;
      checkKeys(
        step,
        where,
        ["line", "pane", "values", "targets", "stdout", "hold", "op"],
        ["expr", "refs"]
      );
      check(
        Number.isInteger(step.line) && typeof step.line === "number" && 0 <= step.line && step.line < source.length,
        `${where}.line`,
        "not a source line"
      );
      check(typeof step.pane === "string", `${where}.pane`, "expected text");
      if (step.expr !== void 0 && step.expr !== null) {
        checkSpan(step.expr, step.pane, `${where}.expr`, true);
      }
      check(
        isPlainObject$1(step.values) && arraysEqual(Object.keys(step.values).sort(), sortedCellNames),
        `${where}.values`,
        `expected exactly ${pyListRepr(sortedCellNames)}`
      );
      for (const [name, value] of Object.entries(step.values)) {
        checkValue(value, `${where}.values.${name}`);
      }
      check(isPlainObject$1(step.targets), `${where}.targets`, "expected an object");
      checkPointers(step, storage, where);
      check(typeof step.stdout === "string", `${where}.stdout`, "expected text");
      check(
        typeof step.hold === "number" && !Number.isNaN(step.hold) && step.hold >= 0,
        `${where}.hold`,
        "expected seconds"
      );
      const stepRefs = refs(step);
      check(
        isPlainObject$1(stepRefs) && Object.entries(stepRefs).every(
          ([name, target]) => references.has(name) && Object.hasOwn(storage.addresses, target)
        ),
        `${where}.refs`,
        "expected references mapped to variables"
      );
      if (previous === null) {
        check(
          step.op === null && Object.keys(stepRefs).length === 0,
          `${where}.op`,
          "the first step has no operation and no bound reference"
        );
      } else {
        if (step.op !== null) {
          checkOperation(step.op, step, previous, storage, `${where}.op`);
        }
        checkChanges(step, previous, storage, where);
      }
      previous = step;
    }
  }
  const REFERENCE = "reference";
  const hooks = {
    execute: null
  };
  const MIN_INT = -2147483648;
  const MAX_INT = 2 ** 31 - 1;
  const FIRST_ADDRESS = 64;
  const INT_SIZE = 4;
  const POINTER_SIZE = 8;
  const MAX_STATEMENTS = 20;
  const MAX_VARIABLES = 8;
  const QUOTED_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  class Pointer {
    constructor(target = null) {
      __publicField(this, "target");
      this.target = target;
      Object.freeze(this);
    }
  }
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Pointer);
  }
  function integer(value) {
    if (typeof value === "bigint") {
      if (value < BigInt(MIN_INT) || value > BigInt(MAX_INT)) {
        throw new Unsupported("signed integer overflow is outside the timeline category");
      }
      return Number(value);
    }
    if (!Number.isSafeInteger(value) || value < MIN_INT || value > MAX_INT) {
      throw new Unsupported("signed integer overflow is outside the timeline category");
    }
    return value === 0 ? 0 : value;
  }
  function hasRecord(records, name) {
    if (!records) return false;
    if (Array.isArray(records) || records instanceof Set) {
      return [...records].includes(name);
    }
    return Object.hasOwn(records, name);
  }
  function getRecord(records, name) {
    if (!records || Array.isArray(records) || records instanceof Set) return void 0;
    const map = records;
    return Object.hasOwn(map, name) ? map[name] : void 0;
  }
  function _depth(node, records = {}) {
    const qualified = typeSpelling(node);
    const intMatch = /^(const )?int(?: (\*+))?$/.exec(qualified);
    if (intMatch && !(intMatch[1] && intMatch[2])) {
      return (intMatch[2] || "").length;
    }
    const recordType = typeName(node);
    if (hasRecord(records, recordType)) {
      return 0;
    }
    const recPtrMatch = /^(\w+) (\*+)$/.exec(qualified);
    if (recPtrMatch && hasRecord(records, recPtrMatch[1])) {
      return recPtrMatch[2].length;
    }
    if (qualified.includes("&")) {
      throw new Unsupported("references are not supported");
    }
    if (qualified.includes("[")) {
      throw new Unsupported("arrays are not supported");
    }
    if (qualified.includes("*")) {
      throw new Unsupported(`only pointers to int are supported, not ${qualified}`);
    }
    throw new Unsupported(`only int and pointer values are supported, not ${qualified || "this type"}`);
  }
  function isAscii(str) {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) return false;
    }
    return true;
  }
  function _body(source) {
    let cleaned = source.replace(QUOTED_OR_COMMENT, (value) => {
      if (value.startsWith("//") || value.startsWith("/*")) {
        const newlines = (value.match(/\n/g) || []).length;
        return "\n".repeat(newlines) + " ";
      }
      return value;
    });
    for (const line of cleaned.split(/\r?\n/)) {
      if (line.trimStart().startsWith("#") && !/^\s*#\s*include\s*[<"][\w./]+[>"]\s*$/.test(line)) {
        throw new Unsupported("only ordinary include directives are supported");
      }
    }
    cleaned = cleaned.replace(/^\s*#\s*include[^\n]*/gm, "").trim();
    cleaned = cleaned.replace(/^using\s+namespace\s+std\s*;\s*/, "");
    if (/\bmain\s*\(/.test(cleaned)) {
      const match = /^([\s\S]*?)int\s+main\s*\(\s*(?:void\s*)?\)\s*\{([\s\S]*)\}\s*$/.exec(cleaned);
      if (!match) {
        throw new Unsupported("only a standalone parameterless main or statement fragment is supported");
      }
      if (match[1].replace(/\bstruct\s+\w+\s*\{[^{}]*\}\s*;/g, "").trim()) {
        throw new Unsupported("only struct definitions may precede main");
      }
      cleaned = (match[1] + match[2]).trim();
    }
    if (!cleaned || cleaned.length > 1e4) {
      throw new Unsupported("empty or oversized snippet");
    }
    if (!isAscii(cleaned)) {
      throw new Unsupported("non-ASCII source text is not supported");
    }
    return cleaned;
  }
  const DEFINITION = /^struct\s+\w+\s*[{;]/;
  const DEFINITION_TEXT = /(?:^([ \t]*)|\s*)(struct\s+(\w+)\s*\{[^{}]*\}\s*;)/gm;
  function dedent(text) {
    const lines = text.split("\n");
    let margin = null;
    for (const line of lines) {
      const stripped = line.replace(/^[ \t]+/, "");
      if (!stripped) continue;
      const indent = line.slice(0, line.length - stripped.length);
      if (margin === null) {
        margin = indent;
      } else if (indent.startsWith(margin)) ;
      else if (margin.startsWith(indent)) {
        margin = indent;
      } else {
        let i = 0;
        while (i < margin.length && i < indent.length && margin[i] === indent[i]) i++;
        margin = margin.slice(0, i);
      }
    }
    if (!margin) return text;
    return lines.map((line) => line.startsWith(margin) ? line.slice(margin.length) : line.replace(/^[ \t]+$/, "")).join("\n");
  }
  function definitions(body) {
    const result = {};
    for (const match of body.matchAll(DEFINITION_TEXT)) {
      result[match[3]] = dedent((match[1] ?? "") + match[2]);
    }
    return result;
  }
  function bounds(node) {
    var _a, _b;
    const first = (_a = node == null ? void 0 : node.range) == null ? void 0 : _a.begin;
    const last = (_b = node == null ? void 0 : node.range) == null ? void 0 : _b.end;
    if (!first || !last || typeof first.offset !== "number" || typeof last.offset !== "number" || typeof last.tokLen !== "number") {
      throw new Unsupported("macro-expanded or implicit source ranges are not supported");
    }
    return [first.offset, last.offset + last.tokLen];
  }
  function compact(source) {
    const out = [];
    const mapping = new Array(source.length + 1).fill(0);
    let index = 0;
    const pattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\s+|[\s\S]/g;
    for (const match of source.matchAll(pattern)) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      const isSpace = /^\s+$/.test(token);
      let replacement2;
      if (isSpace) {
        replacement2 = out.length > 0 && out[out.length - 1] !== " " ? " " : "";
      } else {
        replacement2 = token;
      }
      for (let offset = start; offset < end; offset++) {
        mapping[offset] = index + (!isSpace ? Math.min(offset - start, replacement2.length) : 0);
      }
      out.push(replacement2);
      index += replacement2.length;
      mapping[end] = index;
    }
    return [out.join("").replace(/\s+$/, ""), mapping];
  }
  function parseLeadingJson(text, startOffset) {
    let i = startOffset;
    const n = text.length;
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) return null;
    const start = i;
    if (text[i] !== "{" && text[i] !== "[") {
      throw new Error("Expected JSON object or array");
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < n; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === "{" || ch === "[") {
          depth++;
        } else if (ch === "}" || ch === "]") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
    }
    if (depth !== 0 || inString) {
      throw new Error("Unterminated JSON value");
    }
    return [JSON.parse(text.slice(start, i)), i];
  }
  function extractMainAstFromStdout(stdout, program) {
    const selected = [];
    let offset = 0;
    try {
      while (offset < stdout.length) {
        const parsed = parseLeadingJson(stdout, offset);
        if (!parsed) break;
        const [node, nextOffset] = parsed;
        offset = nextOffset;
        if (node.kind === "FunctionDecl" && node.name === "main") {
          selected.push(node);
        }
      }
    } catch {
      throw new Unsupported("Clang returned invalid AST JSON");
    }
    if (selected.length !== 1) {
      throw new Unsupported("expected one main function");
    }
    const compound = (selected[0].inner ?? []).filter((node) => node.kind === "CompoundStmt");
    if (compound.length !== 1) {
      throw new Unsupported("main has no supported body");
    }
    if (bounds(compound[0])[1] !== program.lastIndexOf("}") + 1) {
      throw new Unsupported("declarations outside main are unsupported");
    }
    return compound[0];
  }
  class Reduction {
    constructor(kind, span, {
      name = null,
      value = null,
      spelling = null,
      record = null
    } = {}) {
      __publicField(this, "kind");
      __publicField(this, "span");
      __publicField(this, "name");
      __publicField(this, "value");
      __publicField(this, "spelling");
      __publicField(this, "record");
      this.kind = kind;
      this.span = span;
      this.name = name;
      this.value = value;
      this.spelling = spelling;
      this.record = record;
      Object.freeze(this);
    }
  }
  function load(state, name, missing = false) {
    const [owner, ...path] = name.split(".");
    if (!missing && !Object.hasOwn(state, owner)) {
      throw new Error(`KeyError: ${owner}`);
    }
    let value = state[owner];
    for (const member of path) {
      value = value[member];
    }
    return value;
  }
  function _flatten(state) {
    const cells = {};
    for (const [name, value] of Object.entries(state)) {
      if (isPlainObject(value)) {
        const sub = {};
        for (const [member, item] of Object.entries(value)) {
          sub[`${name}.${member}`] = item;
        }
        Object.assign(cells, _flatten(sub));
      } else {
        cells[name] = value;
      }
    }
    return cells;
  }
  function filled(item, records, zero = false) {
    const record = item && "fields" in item && Array.isArray(item.fields) ? item : "kind" in item && item.kind === "struct" && item.type ? records[item.type] : null;
    if (record) {
      const res = {};
      for (const inner of record.fields) {
        res[inner.name] = filled(inner, records, zero);
      }
      return res;
    }
    return !zero ? null : "kind" in item && item.kind === "ptr" ? new Pointer() : 0;
  }
  function operandIsPointer(node) {
    var _a;
    return (((_a = node == null ? void 0 : node.type) == null ? void 0 : _a.qualType) ?? "").includes("*");
  }
  function rejectPointerOperator(node) {
    if ((node == null ? void 0 : node.kind) === "BinaryOperator" && (operandIsPointer(node) || (node.inner ?? []).some(operandIsPointer))) {
      throw new Unsupported("pointer arithmetic and comparison are not supported");
    }
  }
  class Evaluator {
    constructor(state, locate, records, references = {}) {
      __publicField(this, "state");
      __publicField(this, "locate");
      __publicField(this, "reductions");
      __publicField(this, "records");
      __publicField(this, "references");
      __publicField(this, "temporary");
      this.state = state;
      this.locate = locate;
      this.reductions = [];
      this.records = records;
      this.references = references;
      this.temporary = false;
    }
    _reduce(kind, node, details = {}) {
      this.reductions.push(new Reduction(kind, this.locate(node), details));
    }
    _load(name) {
      const value = load(this.state, name);
      if (value === null || value === void 0) {
        throw new Unsupported(`reading uninitialized variable ${name}`);
      }
      return value;
    }
    variable(node) {
      const declaration = (node == null ? void 0 : node.referencedDecl) ?? {};
      const name = declaration.name ?? "";
      if ((node == null ? void 0 : node.kind) === "DeclRefExpr" && declaration.kind === "VarDecl" && Object.hasOwn(this.references, name)) {
        this._reduce("alias", node, { name, spelling: this.references[name] });
        return this.references[name];
      }
      if ((node == null ? void 0 : node.kind) !== "DeclRefExpr" || declaration.kind !== "VarDecl" || !Object.hasOwn(this.state, name)) {
        throw new Unsupported("expression references an undeclared or nonlocal variable");
      }
      return name;
    }
    lvalue(node, outer = null) {
      const kind = node == null ? void 0 : node.kind;
      const children = (node == null ? void 0 : node.inner) ?? [];
      if (kind === "ParenExpr" && children.length === 1) {
        return this.lvalue(children[0], outer ?? node);
      }
      if (kind === "DeclRefExpr") {
        return this.variable(node);
      }
      if (kind === "MemberExpr" && children.length === 1) {
        if (node.isArrow) {
          const [pointer, via] = this.rvalue(children[0]);
          if (via === null) {
            throw new Unsupported("arrow access requires a pointer variable");
          }
          if (pointer.target === null) {
            throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
          }
          const name = `${pointer.target}.${node.name}`;
          this._reduce("deref", outer ?? node, { name: via, value: new Pointer(name) });
          return name;
        }
        return `${this.lvalue(children[0])}.${node.name}`;
      }
      if (kind === "UnaryOperator" && node.opcode === "*" && children.length === 1) {
        const [pointer, via] = this.rvalue(children[0]);
        if (via === null) {
          throw new Unsupported("only dereferencing a pointer variable is supported, not a computed address");
        }
        if (pointer.target === null) {
          throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
        }
        this._reduce("deref", outer ?? node, { name: via });
        return pointer.target;
      }
      throw new Unsupported(`unsupported assignable expression: ${kind}`);
    }
    rvalue(node) {
      var _a, _b, _c;
      const kind = node == null ? void 0 : node.kind;
      const children = (node == null ? void 0 : node.inner) ?? [];
      if (kind === "MaterializeTemporaryExpr" && children.length === 1) {
        this.temporary = true;
        return this.rvalue(children[0]);
      }
      if (kind === "ExprWithCleanups" && children.length === 1) {
        return this.rvalue(children[0]);
      }
      if (kind === "ImplicitCastExpr" && children.length === 1) {
        const cast = node.castKind;
        if (cast === "LValueToRValue") {
          _depth(node, this.records);
          const name = this.lvalue(children[0]);
          const value2 = this._load(name);
          this._reduce("read", node, { name, value: value2 });
          return [value2, name];
        }
        if (cast === "NullToPointer" && _depth(node, this.records)) {
          const literal = children[0];
          if ((literal == null ? void 0 : literal.kind) === "CXXNullPtrLiteralExpr" || (literal == null ? void 0 : literal.kind) === "IntegerLiteral" && (literal == null ? void 0 : literal.value) === "0") {
            this._reduce("eval", node, { value: new Pointer() });
            return [new Pointer(), null];
          }
        }
        if (cast === "NoOp") {
          return this.rvalue(children[0]);
        }
        rejectPointerOperator(children[0]);
        throw new Unsupported(`implicit ${cast} conversions are outside this category`);
      }
      const depth = _depth(node, this.records);
      const record = !depth ? getRecord(this.records, typeName(node)) : null;
      if (record) {
        if (kind === "CXXFunctionalCastExpr" && children.length === 1) {
          const [value2] = this.rvalue(children[0]);
          if (((_a = children[0]) == null ? void 0 : _a.kind) === "InitListExpr" && this.reductions.length > 0 && this.reductions[this.reductions.length - 1].value === value2) {
            this.reductions.pop();
          }
          this._reduce("eval", node, { value: value2, record: record.name });
          return [value2, null];
        }
        if (kind === "InitListExpr") {
          const value2 = {};
          const limit = Math.min(record.fields.length, children.length);
          for (let i = 0; i < limit; i++) {
            const item = record.fields[i];
            const child = children[i];
            if ((child == null ? void 0 : child.kind) === "ImplicitValueInitExpr") {
              value2[item.name] = filled(item, this.records, true);
            } else {
              const [childVal] = this.rvalue(child);
              value2[item.name] = childVal;
              if ((child == null ? void 0 : child.kind) === "InitListExpr" && this.reductions.length > 0 && this.reductions[this.reductions.length - 1].value === value2[item.name]) {
                this.reductions.pop();
              }
            }
          }
          this._reduce("eval", node, { value: value2 });
          return [value2, null];
        }
        if (kind === "CXXConstructExpr") {
          if (children.length === 0) {
            return [filled(record, this.records), null];
          }
          if (children.length === 1) {
            return this.rvalue(children[0]);
          }
        }
        if (kind === "DeclRefExpr" || kind === "MemberExpr" || kind === "UnaryOperator" && node.opcode === "*") {
          const name = this.lvalue(node);
          const value2 = this._load(name);
          if (Object.values(_flatten({ [name]: value2 })).some((item) => item === null)) {
            throw new Unsupported(`reading uninitialized struct ${name}`);
          }
          this._reduce("read", node, { name, value: value2, record: record.name });
          return [value2, name];
        }
      }
      if (kind === "IntegerLiteral") {
        return [integer(BigInt(node.value ?? "0")), null];
      }
      if (kind === "InitListExpr" || kind === "CXXFunctionalCastExpr") {
        return [this._braces(node, depth), null];
      }
      let value;
      if (kind === "ParenExpr" && children.length === 1) {
        [value] = this.rvalue(children[0]);
      } else if (kind === "UnaryOperator" && node.opcode === "&" && children.length === 1) {
        if (((_b = children[0]) == null ? void 0 : _b.kind) !== "DeclRefExpr" && ((_c = children[0]) == null ? void 0 : _c.kind) !== "MemberExpr") {
          throw new Unsupported("only the address of a variable is supported");
        }
        const name = this.lvalue(children[0]);
        this._reduce("addr", node, { name });
        return [new Pointer(name), null];
      } else if (kind === "UnaryOperator" && (node.opcode === "+" || node.opcode === "-") && children.length === 1 && !depth) {
        const operand = this._integerOperand(children[0]);
        value = integer(node.opcode === "+" ? operand : -operand);
      } else if (kind === "BinaryOperator" && ["+", "-", "*", "/", "%"].includes(node.opcode ?? "") && children.length === 2) {
        rejectPointerOperator(node);
        value = Evaluator._arithmetic(
          node.opcode,
          this._integerOperand(children[0]),
          this._integerOperand(children[1])
        );
      } else {
        throw new Unsupported(`unsupported expression: ${kind} ${(node == null ? void 0 : node.opcode) ?? ""}`.trimEnd());
      }
      this._reduce("eval", node, { value });
      return [value, null];
    }
    _integerOperand(node) {
      const [value] = this.rvalue(node);
      if (typeof value !== "number") {
        throw new Unsupported("pointer arithmetic and comparison are not supported");
      }
      return value;
    }
    _braces(node, depth) {
      var _a;
      const children = node.inner ?? [];
      let value;
      if (node.kind === "CXXFunctionalCastExpr") {
        if (children.length !== 1 || ((_a = children[0]) == null ? void 0 : _a.kind) !== "InitListExpr" || children[0].inner && children[0].inner.length > 0) {
          throw new Unsupported("only empty int{} functional initialization is supported");
        }
        value = 0;
      } else if (children.length > 1) {
        throw new Unsupported("multiple initializer elements are unsupported");
      } else if (children.length === 1) {
        [value] = this.rvalue(children[0]);
      } else {
        value = depth ? new Pointer() : 0;
      }
      this._reduce("eval", node, { value });
      return value;
    }
    static _arithmetic(operation, left, right) {
      const l = BigInt(left);
      const r = BigInt(right);
      if (operation === "/" || operation === "%") {
        if (r === 0n || l === BigInt(MIN_INT) && r === -1n) {
          throw new Unsupported("undefined integer division");
        }
        const quotient = l / r;
        const remainder = l % r;
        return integer(operation === "/" ? quotient : remainder);
      }
      if (operation === "+") return integer(l + r);
      if (operation === "-") return integer(l - r);
      if (operation === "*") return integer(l * r);
      throw new Unsupported(`unsupported operator ${operation}`);
    }
  }
  function stripParentheses(node) {
    let cur = node;
    while ((cur == null ? void 0 : cur.kind) === "ParenExpr" && (cur.inner ?? []).length === 1) {
      cur = cur.inner[0];
    }
    return cur;
  }
  class Statement {
    constructor({
      source,
      span,
      pane,
      expr = null,
      result = null,
      value = null,
      reductions = [],
      target = null,
      destination = null,
      declared = null,
      pointer = false,
      record = null,
      output_suffix = null,
      printed = null,
      temporary = false,
      bound = null
    }) {
      __publicField(this, "source");
      __publicField(this, "span");
      __publicField(this, "pane");
      __publicField(this, "expr");
      __publicField(this, "result");
      __publicField(this, "value");
      __publicField(this, "reductions");
      __publicField(this, "target");
      __publicField(this, "destination");
      __publicField(this, "declared");
      __publicField(this, "pointer");
      __publicField(this, "record");
      __publicField(this, "output_suffix");
      __publicField(this, "printed");
      __publicField(this, "temporary");
      __publicField(this, "bound");
      this.source = source;
      this.span = span;
      this.pane = pane;
      this.expr = expr;
      this.result = result;
      this.value = value;
      this.reductions = reductions;
      this.target = target;
      this.destination = destination;
      this.declared = declared;
      this.pointer = pointer;
      this.record = record;
      this.output_suffix = output_suffix;
      this.printed = printed;
      this.temporary = temporary;
      this.bound = bound;
    }
  }
  function paneParts(source, span, emptyInitializer) {
    const [start, end] = span;
    let prefix = source.slice(0, start);
    let suffix = source.slice(end).replace(/\s+$/, "").replace(/;$/, "").replace(/\s+$/, "");
    if (emptyInitializer) {
      prefix = prefix.replace(/\s+$/, "") + " = ";
    }
    if (prefix.replace(/\s+$/, "").endsWith("{") && suffix.replace(/^\s+/, "").startsWith("}")) {
      prefix = prefix.replace(/\s+$/, "").slice(0, -1).replace(/\s+$/, "");
      prefix += prefix.endsWith("=") ? " " : " = ";
      suffix = suffix.replace(/^\s+/, "").slice(1);
    }
    return [prefix, suffix];
  }
  function coutOperands(node) {
    var _a, _b;
    let cur = node;
    while (((cur == null ? void 0 : cur.kind) === "ImplicitCastExpr" || (cur == null ? void 0 : cur.kind) === "ExprWithCleanups") && (cur.inner ?? []).length === 1) {
      cur = cur.inner[0];
    }
    if ((cur == null ? void 0 : cur.kind) === "DeclRefExpr" && ((_a = cur.referencedDecl) == null ? void 0 : _a.name) === "cout") {
      return [];
    }
    if ((cur == null ? void 0 : cur.kind) !== "CXXOperatorCallExpr" || (cur.inner ?? []).length !== 3) {
      throw new Unsupported("only std::cout insertion calls are supported");
    }
    let [callee, left, right] = cur.inner;
    while ((callee == null ? void 0 : callee.kind) === "ImplicitCastExpr" && callee.inner && callee.inner.length > 0) {
      callee = callee.inner[0];
    }
    if (((_b = callee == null ? void 0 : callee.referencedDecl) == null ? void 0 : _b.name) !== "operator<<") {
      throw new Unsupported("only stream insertion calls are supported");
    }
    return [...coutOperands(left), right];
  }
  function stripCasts(operand) {
    let cur = operand;
    while ((cur == null ? void 0 : cur.kind) === "ImplicitCastExpr" && cur.inner && cur.inner.length > 0) {
      cur = cur.inner[0];
    }
    return cur;
  }
  function whitespace(operand) {
    var _a;
    const stripped = stripCasts(operand);
    if (((_a = stripped == null ? void 0 : stripped.referencedDecl) == null ? void 0 : _a.name) === "endl") {
      return "\n";
    }
    if ((stripped == null ? void 0 : stripped.kind) === "CharacterLiteral") {
      const code = Number.parseInt(stripped.value ?? "", 10);
      if (code === 9 || code === 10 || code === 32) {
        return String.fromCharCode(code);
      }
    }
    return null;
  }
  function outputSuffix(operands) {
    let suffix = "";
    for (const operand of operands) {
      const printed = whitespace(operand);
      if (printed === null) {
        throw new Unsupported("one integer output followed only by whitespace or endl is supported");
      }
      suffix += printed;
    }
    return suffix;
  }
  function analyzeStatement(node, program, state, records, references) {
    var _a, _b, _c, _d, _e;
    let cur = node;
    while ((cur == null ? void 0 : cur.kind) === "ExprWithCleanups" && (cur.inner ?? []).length === 1) {
      cur = cur.inner[0];
    }
    let [start, end] = bounds(cur);
    if (end < program.length && program[end] === ";") {
      end += 1;
    }
    const [source, mapping] = compact(program.slice(start, end));
    let left = null;
    let declared = null;
    let outSuffix = null;
    let printed = null;
    let root = null;
    let nameOffset = null;
    let whole = false;
    let pointer = false;
    let emptyInitializer = false;
    let reference2 = false;
    let record = null;
    if (cur.kind === "DeclStmt") {
      const children = cur.inner ?? [];
      if (children.length === 1 && ((_a = children[0]) == null ? void 0 : _a.kind) === "CXXRecordDecl") {
        return new Statement({
          source,
          span: null,
          pane: source.replace(/;$/, "")
        });
      }
      if (children.length !== 1 || ((_b = children[0]) == null ? void 0 : _b.kind) !== "VarDecl") {
        throw new Unsupported("one scalar declaration per statement is required");
      }
      const variable = children[0];
      if ((variable.inner ?? []).some((child) => (child.kind ?? "").endsWith("Attr"))) {
        throw new Unsupported("declaration attributes need a separate memory-layout visualization");
      }
      const spelling = typeSpelling(variable);
      reference2 = spelling.endsWith("&");
      if (reference2) {
        if (spelling.endsWith("&&")) {
          throw new Unsupported("rvalue references are not supported");
        }
        _depth({ type: { qualType: spelling.slice(0, -1).replace(/\s+$/, "") } }, records);
      } else {
        pointer = _depth(variable, records) > 0;
      }
      record = !pointer && Object.hasOwn(records, typeName(variable)) ? typeName(variable) : null;
      declared = variable.name ?? null;
      if (!declared || declared.startsWith("__course_") || Object.hasOwn(state, declared) || Object.hasOwn(references, declared)) {
        throw new Unsupported("unique variable names are required");
      }
      if (variable.storageClass || variable.constexpr) {
        throw new Unsupported("static and constexpr storage are outside this category");
      }
      nameOffset = ((_c = variable.loc) == null ? void 0 : _c.offset) ?? null;
      if (nameOffset === null) {
        throw new Unsupported("macro-expanded declarations are not supported");
      }
      const varChildren = variable.inner ?? [];
      root = varChildren.length > 0 ? varChildren[0] : null;
      if (!record && root && root.kind === "InitListExpr" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
      while (reference2 && root && root.castKind === "NoOp" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
      if (record && root && root.kind === "CXXConstructExpr" && (!root.inner || root.inner.length === 0)) {
        return new Statement({
          source,
          span: null,
          pane: source.replace(/;$/, ""),
          value: filled(records[record], records),
          target: declared,
          declared,
          record
        });
      }
      if (record && root && root.kind === "CXXConstructExpr" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
      emptyInitializer = Boolean(root) && root.kind === "InitListExpr" && (!root.inner || root.inner.length === 0);
    } else if (cur.kind === "BinaryOperator" && cur.opcode === "=" || cur.kind === "CXXOperatorCallExpr" && (cur.inner ?? []).length === 3 && Object.hasOwn(records, typeName(cur))) {
      const inner = cur.inner;
      left = inner[inner.length - 2];
      root = inner[inner.length - 1];
      _depth(left, records);
      if (left.kind === "ParenExpr" && stripParentheses(left).kind === "DeclRefExpr") {
        throw new Unsupported("a parenthesized variable as assignment target is not supported");
      }
      whole = left.kind !== "DeclRefExpr" || Object.hasOwn(references, ((_d = left.referencedDecl) == null ? void 0 : _d.name) ?? "");
    } else if (cur.kind === "CXXOperatorCallExpr") {
      const operands = coutOperands(cur);
      if (operands.length === 0) {
        throw new Unsupported("empty output expression");
      }
      root = operands[0];
      outSuffix = outputSuffix(operands.slice(1));
      printed = whitespace(root);
      if (((_e = stripCasts(root)) == null ? void 0 : _e.kind) === "StringLiteral") {
        throw new Unsupported("string literal output is not supported");
      }
      if (root.kind === "ImplicitCastExpr" && root.castKind === "BitCast" && typeSpelling(root) === "const void *" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
    } else {
      throw new Unsupported(`unsupported statement: ${cur.kind}`);
    }
    if (root === null) {
      return new Statement({
        source,
        span: null,
        pane: source.replace(/;$/, "").replace(/\s+$/, ""),
        target: declared,
        declared,
        pointer
      });
    }
    const [first, last] = whole ? [start, bounds(cur)[1]] : bounds(root);
    const span = [mapping[first - start], mapping[last - start]];
    const [prefix, suffix] = paneParts(source, span, emptyInitializer);
    const text = source.slice(span[0], span[1]);
    function toPane(offset) {
      const position = mapping[offset - start];
      return position < span[0] ? position : position - span[0] + prefix.length;
    }
    function locate(item) {
      const [b0, b1] = bounds(item);
      return [toPane(b0), toPane(b1)];
    }
    if (printed !== null) {
      if (whitespaceOutput(text) !== printed) {
        throw new Unsupported("whitespace output is supported as std::endl, '\\n', '\\t' or ' '");
      }
      return new Statement({
        source,
        span,
        pane: prefix + text + suffix,
        expr: [prefix.length, prefix.length + text.length],
        result: locate(root),
        output_suffix: outSuffix,
        printed
      });
    }
    const evaluator = new Evaluator(state, locate, records, references);
    if (reference2) {
      const bound = evaluator.lvalue(root);
      if (evaluator.temporary) {
        throw new Unsupported("a reference bound to a temporary is not supported");
      }
      return new Statement({
        source,
        span,
        pane: prefix + text + suffix,
        expr: [prefix.length, prefix.length + text.length],
        result: locate(root),
        reductions: evaluator.reductions,
        declared,
        bound,
        destination: [toPane(nameOffset), toPane(nameOffset) + declared.length]
      });
    }
    let target = declared;
    let destination = null;
    let designation = [];
    if (left !== null) {
      target = evaluator.lvalue(left);
      destination = locate(left);
      let renamed = 0;
      while (renamed < evaluator.reductions.length && evaluator.reductions[renamed].kind === "alias") {
        renamed++;
      }
      designation = evaluator.reductions.slice(renamed);
      evaluator.reductions = evaluator.reductions.slice(0, renamed);
    }
    const [value] = evaluator.rvalue(root);
    evaluator.reductions.push(...designation);
    if (declared) {
      destination = [toPane(nameOffset), toPane(nameOffset) + declared.length];
    } else if (left === null && isPlainObject(value)) {
      throw new Unsupported("only integer and pointer output is supported");
    }
    return new Statement({
      source,
      span,
      pane: prefix + text + suffix,
      expr: [prefix.length, prefix.length + text.length],
      result: locate(root),
      value,
      reductions: evaluator.reductions,
      target,
      destination,
      declared,
      pointer,
      record,
      output_suffix: outSuffix,
      temporary: evaluator.temporary
    });
  }
  function storedAt(value, path, newValue) {
    if (path.length === 0) {
      return newValue;
    }
    return { ...value, [path[0]]: storedAt(value[path[0]], path.slice(1), newValue) };
  }
  function _after(statement, state) {
    return defaultAfter(statement, state);
  }
  function defaultAfter(statement, state) {
    const after = { ...state };
    if (statement.target !== null) {
      const [owner, ...path] = statement.target.split(".");
      after[owner] = storedAt(after[owner], path, statement.value);
    }
    return after;
  }
  function analyzeWithFrontend(source, frontend) {
    var _a, _b;
    const program = "#include <iostream>\n#include <cstdint>\nusing namespace std;\nint main() {\n" + source + "\n}\n";
    const ast = frontend.mainAst(program);
    const records = layoutsFromFrontend(ast, program, frontend);
    const statements = [];
    let state = {};
    const references = {};
    const inner = ast.inner ?? [];
    for (let i = 0; i < inner.length; i++) {
      const node = inner[i];
      if (node.kind === "ReturnStmt") {
        const children = node.inner ?? [];
        if (children.length === 1 && ((_a = children[0]) == null ? void 0 : _a.kind) === "IntegerLiteral" && ((_b = children[0]) == null ? void 0 : _b.value) === "0" && i === inner.length - 1) {
          continue;
        }
        throw new Unsupported("only a final return 0 is supported");
      }
      const statement = analyzeStatement(node, program, state, records, references);
      if (statement.declared && statements.some((earlier) => earlier.temporary)) {
        throw new Unsupported(
          "a declaration after a materialized temporary needs a separate memory-layout visualization"
        );
      }
      statements.push(statement);
      if (statements.length > MAX_STATEMENTS) {
        throw new Unsupported("too many statements");
      }
      state = _after(statement, state);
      if (statement.bound && statement.declared) {
        references[statement.declared] = statement.bound;
      }
      if (Object.keys(state).length > MAX_VARIABLES) {
        throw new Unsupported("too many variables");
      }
    }
    if (Object.keys(state).length === 0) {
      throw new Unsupported("a variable timeline requires at least one variable");
    }
    return [statements, records];
  }
  function sizeOf(pointer) {
    return pointer ? POINTER_SIZE : INT_SIZE;
  }
  function floorDiv(a, b) {
    return Math.floor(a / b);
  }
  function pyMod(a, b) {
    return (a % b + b) % b;
  }
  function _normalize(addresses2, sizes) {
    const alignment = Math.max(...Object.values(sizes));
    const lowest = Math.min(...Object.values(addresses2));
    const base = lowest - pyMod(lowest, alignment);
    const result = {};
    for (const [name, address] of Object.entries(addresses2)) {
      result[name] = FIRST_ADDRESS + address - base;
    }
    return result;
  }
  function withoutReferenceSlots(real, variables) {
    const packed = addresses(variables);
    const names = variables.map((v) => v.name);
    const sortedReal = [...names].sort((a, b) => real[a] - real[b]);
    const sortedPacked = [...names].sort((a, b) => packed[a] - packed[b]);
    if (sortedReal.some((n, i) => n !== sortedPacked[i])) {
      throw new Unsupported("runtime order of the variables disagrees with their declarations");
    }
    return packed;
  }
  function _observed(execution, predicted, pointers = /* @__PURE__ */ new Set(), variables = null, references = null) {
    const ptrSet = pointers instanceof Set ? pointers : new Set(pointers);
    if (variables === null) {
      variables = Object.keys(predicted[predicted.length - 1]).map(
        (name) => scalar(name, 0, sizeOf(ptrSet.has(name)), ptrSet.has(name) ? "ptr" : "int")
      );
    }
    const cells = leaves(variables);
    const addresses$1 = {};
    const owners = Object.fromEntries(variables.map((v) => [v.name, v]));
    const offsets = addresses(variables);
    const bindings = execution.checkpoints.map(
      (row) => Object.fromEntries(Object.entries(row).filter(([, cell]) => cell.reference))
    );
    const checkpoints = execution.checkpoints.map(
      (row) => Object.fromEntries(Object.entries(row).filter(([, cell]) => !cell.reference))
    );
    for (const row of checkpoints) {
      for (const [name, cell] of Object.entries(row)) {
        if (cell.size !== cells[name].size || cell.pointer !== (cells[name].kind === "ptr")) {
          throw new Unsupported(`runtime storage of ${name} disagrees with Clang`);
        }
        if (!Object.hasOwn(addresses$1, name)) {
          addresses$1[name] = cell.address;
        } else if (addresses$1[name] !== cell.address) {
          throw new Unsupported("variable address changed during the trace");
        }
        const dot = name.indexOf(".");
        const owner = dot === -1 ? name : name.slice(0, dot);
        const member = dot === -1 ? "" : name.slice(dot + 1);
        if (member) {
          const offset = offsets[name] - offsets[owner];
          const base = cell.object_address;
          if (!Object.hasOwn(addresses$1, owner)) {
            addresses$1[owner] = base;
          }
          if (cell.object_size !== owners[owner].size || cell.address !== base + offset || addresses$1[owner] !== base) {
            throw new Unsupported(`runtime field offset of ${name} disagrees with Clang`);
          }
        }
      }
    }
    for (const [name, offset] of Object.entries(offsets)) {
      const owner = name.split(".")[0];
      if (Object.hasOwn(addresses$1, owner) && !Object.hasOwn(addresses$1, name)) {
        addresses$1[name] = addresses$1[owner] + offset - offsets[owner];
      }
    }
    for (const row of bindings) {
      for (const [name, cell] of Object.entries(row)) {
        const refTarget = (references ?? {})[name];
        if (cell.address !== addresses$1[refTarget]) {
          throw new Unsupported(`runtime verification failed: the reference ${name} disagrees`);
        }
      }
    }
    for (let i = 0; i < checkpoints.length; i++) {
      const row = checkpoints[i];
      const expected = _flatten(predicted[i]);
      const rowKeys = Object.keys(row).sort();
      const expKeys = Object.keys(expected).sort();
      if (rowKeys.length !== expKeys.length || rowKeys.some((k, idx) => k !== expKeys[idx])) {
        throw new Unsupported("runtime verification failed: incomplete frame");
      }
      const addrValues = new Set(Object.values(addresses$1));
      for (const [name, value] of Object.entries(expected)) {
        const bits = value instanceof Pointer ? value.target ? addresses$1[value.target] : 0 : value;
        if (row[name].value !== bits) {
          if (value instanceof Pointer && row[name].value && !addrValues.has(row[name].value)) {
            throw new Unsupported(`runtime value of ${name} is not the address of a variable`);
          }
          throw new Unsupported(`runtime verification failed: ${name} disagrees`);
        }
      }
    }
    return [addresses$1, predicted];
  }
  function spaceless(text) {
    return text.replace(/\s+/g, "");
  }
  class Pane {
    constructor(text) {
      __publicField(this, "original");
      __publicField(this, "edits");
      this.original = text;
      this.edits = [];
    }
    get text() {
      const parts = [];
      let cursor = 0;
      for (const [start, end, newText] of this.edits) {
        parts.push(this.original.slice(cursor, start), newText);
        cursor = end;
      }
      return parts.join("") + this.original.slice(cursor);
    }
    locate(start, end) {
      const shift = (at) => {
        let delta = 0;
        for (const [begin, finish, newText] of this.edits) {
          if (finish <= at) {
            delta += newText.length - (finish - begin);
          }
        }
        return at + delta;
      };
      return [shift(start), shift(end)];
    }
    read(start, end) {
      const [first, last] = this.locate(start, end);
      return this.text.slice(first, last);
    }
    replace(start, end, newText) {
      const span = this.locate(start, end);
      const filtered = this.edits.filter((edit) => !(start <= edit[0] && edit[1] <= end));
      filtered.push([start, end, newText]);
      filtered.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      this.edits = filtered;
      return span;
    }
  }
  function valuesEqual(a, b) {
    if (a === b) return true;
    if (a instanceof Pointer && b instanceof Pointer) {
      return a.target === b.target;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => valuesEqual(a[k], b[k]));
    }
    return false;
  }
  class Renderer {
    constructor(addresses2, cells = null, real = null, hasReferences = false) {
      __publicField(this, "addresses");
      __publicField(this, "refs");
      __publicField(this, "order");
      __publicField(this, "steps");
      __publicField(this, "stdout");
      __publicField(this, "real");
      __publicField(this, "realStdout");
      this.addresses = addresses2;
      this.refs = hasReferences ? {} : null;
      const keys = Object.keys(cells ?? addresses2);
      this.order = keys.sort((a, b) => addresses2[a] - addresses2[b]);
      this.steps = [];
      this.stdout = "";
      this.real = real ?? addresses2;
      this.realStdout = "";
    }
    printed(pointer, addresses2) {
      if (pointer.target === null) {
        return "0";
      }
      const address = addresses2[pointer.target];
      if (addresses2 === this.real && this.real !== this.addresses) {
        return `0x${address.toString(16)}`;
      }
      return `0x${address.toString(16).padStart(16, "0")}`;
    }
    show(value) {
      if (isPlainObject(value)) {
        return `{${Object.values(value).map((item) => this.show(item)).join(", ")}}`;
      }
      return String(this.stored(value));
    }
    stored(value) {
      if (value instanceof Pointer) {
        return value.target ? this.addresses[value.target] : 0;
      }
      return value;
    }
    add(line, pane, expr, state, op = null, hold = 1) {
      const flat = _flatten(state);
      const values = {};
      for (const name of this.order) {
        values[name] = !Object.hasOwn(flat, name) ? null : flat[name] === null ? UNKNOWN : this.stored(flat[name]);
      }
      const targets = {};
      for (const [name, value] of Object.entries(flat)) {
        if (value instanceof Pointer && value.target) {
          targets[name] = value.target;
        }
      }
      const step = {
        line,
        pane: pane.text,
        op,
        stdout: this.stdout,
        hold,
        values,
        targets
      };
      if (expr) {
        step.expr = pane.locate(expr[0], expr[1]);
      }
      if (this.refs !== null) {
        step.refs = { ...this.refs };
      }
      this.steps.push(step);
    }
    statement(line, statement, before, after) {
      const pane = new Pane(statement.pane);
      const expr = statement.expr;
      const writes = statement.target !== null && statement.result !== null;
      this.add(line, pane, expr, writes ? before : after);
      for (const reduction of statement.reductions) {
        let text2;
        let op2;
        if (reduction.kind === "read") {
          text2 = (reduction.record ?? "") + this.show(load(before, reduction.name));
          op2 = { kind: "read", name: reduction.name, value: text2 };
        } else if (reduction.kind === "addr") {
          text2 = String(this.addresses[reduction.name]);
          op2 = { kind: "addr", name: reduction.name, value: text2 };
        } else if (reduction.kind === "alias") {
          text2 = reduction.spelling;
          op2 = { kind: "alias", name: reduction.name, target: text2 };
        } else if (reduction.kind === "deref") {
          text2 = (reduction.value ?? load(before, reduction.name)).target;
          op2 = { kind: "deref", target: text2, via: reduction.name };
        } else {
          text2 = reduction.spelling ?? (reduction.record ?? "") + this.show(reduction.value);
          op2 = { kind: "eval", value: text2 };
          if (isPlainObject(reduction.value) && spaceless(pane.read(reduction.span[0], reduction.span[1])) === spaceless(text2)) {
            continue;
          }
        }
        if (pane.read(reduction.span[0], reduction.span[1]) !== text2) {
          op2.span = pane.replace(reduction.span[0], reduction.span[1], text2);
          this.add(line, pane, expr, before, op2);
        }
      }
      if (statement.result === null) {
        return;
      }
      if (statement.bound && statement.declared && statement.destination) {
        this.refs[statement.declared] = statement.bound;
        const op2 = {
          kind: "bind",
          name: statement.declared,
          target: statement.bound,
          span: pane.locate(statement.result[0], statement.result[1]),
          destination: pane.locate(statement.destination[0], statement.destination[1])
        };
        this.add(line, pane, expr, after, op2, 1.2);
        return;
      }
      if (typeof statement.value === "number" && pane.read(statement.result[0], statement.result[1]) !== String(statement.value)) {
        const op2 = {
          kind: "eval",
          value: String(statement.value),
          span: pane.replace(statement.result[0], statement.result[1], String(statement.value))
        };
        this.add(line, pane, expr, before, op2);
      }
      let span = pane.locate(statement.result[0], statement.result[1]);
      let text = pane.read(statement.result[0], statement.result[1]);
      let real = text;
      if (statement.printed !== null) {
        real = text = statement.printed;
      } else if (statement.output_suffix !== null && statement.value instanceof Pointer) {
        text = this.printed(statement.value, this.addresses);
        real = this.printed(statement.value, this.real);
        if (pane.read(statement.result[0], statement.result[1]) !== text) {
          const op2 = {
            kind: "eval",
            value: text,
            span: pane.replace(statement.result[0], statement.result[1], text)
          };
          this.add(line, pane, expr, before, op2);
          span = pane.locate(statement.result[0], statement.result[1]);
        }
      }
      if (statement.output_suffix !== null) {
        this.realStdout += real + statement.output_suffix;
        this.stdout += text + statement.output_suffix;
        this.add(line, pane, expr, after, { kind: "print", value: text, span }, 1.2);
        return;
      }
      const name = statement.target;
      const old = load(before, name, true);
      const op = {
        kind: "write",
        name,
        value: text,
        span,
        destination: pane.locate(statement.destination[0], statement.destination[1])
      };
      const redirected = old instanceof Pointer && Boolean(old.target) && !valuesEqual(old, load(after, name));
      this.add(line, pane, expr, after, op, redirected ? 1.6 : 1.2);
    }
  }
  function traceWithFrontend(source, options) {
    const { runtime = true, frontend, executor = hooks.execute, directory } = options;
    const body = _body(source);
    const [statements, records] = analyzeWithFrontend(body, frontend);
    const predicted = [];
    let state = {};
    for (const statement of statements) {
      state = _after(statement, state);
      predicted.push(state);
    }
    const declarations = statements.filter((s) => s.declared);
    const variables = [];
    const references = {};
    let top = -8;
    const fieldColors = {};
    for (let color = 0; color < declarations.length; color++) {
      const declaration = declarations[color];
      const name = declaration.declared;
      if (declaration.bound) {
        references[name] = reference(name, color);
        continue;
      }
      const record = declaration.record ? records[declaration.record] : void 0;
      const size = record ? record.size : sizeOf(declaration.pointer);
      const alignment2 = record ? record.alignment : size;
      top = floorDiv(top - size, alignment2) * alignment2;
      if (record) {
        const fieldsOf = (rec) => {
          const flds = [];
          for (const item of rec.fields) {
            if (!Object.hasOwn(fieldColors, item.name)) {
              fieldColors[item.name] = Object.keys(fieldColors).length;
            }
            const shade = fieldColors[item.name];
            if (item.kind === "struct") {
              flds.push(
                structField(
                  item.name,
                  item.type,
                  item.offset,
                  item.size,
                  fieldsOf(records[item.type]),
                  shade
                )
              );
            } else {
              flds.push(field(item.name, item.offset, item.size, item.kind, shade));
            }
          }
          return flds;
        };
        variables.push(struct(name, record.name, top, size, fieldsOf(record), color));
      } else {
        variables.push(scalar(name, top, size, declaration.pointer ? "ptr" : "int", color));
      }
    }
    let addresses$1;
    let states;
    let execution = null;
    if (runtime) {
      if (!executor) {
        throw new Unsupported("runtime executor is required when runtime=true");
      }
      const scopes = [];
      const bound = {};
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const row = predicted[i];
        if (statement.bound && statement.declared) {
          bound[statement.declared] = statement.bound;
        }
        scopes.push([
          ...Object.entries(_flatten(row)).map(([name, value]) => [name, value !== null]),
          ...Object.keys(bound).map((name) => [name, REFERENCE])
        ]);
      }
      execution = executor(
        statements.map((s) => s.source),
        scopes,
        directory
      );
      [addresses$1, states] = _observed(execution, predicted, /* @__PURE__ */ new Set(), variables, bound);
    } else {
      addresses$1 = addresses(variables);
      states = predicted;
    }
    const real = addresses$1;
    if (Object.keys(references).length > 0) {
      addresses$1 = withoutReferenceSlots(addresses$1, variables);
    }
    const alignment = Math.max(
      ...Object.values(records).map((r) => r.alignment),
      ...declarations.filter((d) => !d.record && !d.bound).map((d) => sizeOf(d.pointer)),
      4
    );
    addresses$1 = _normalize(addresses$1, { ABI: alignment });
    for (const variable of variables) {
      variable.address = addresses$1[variable.name];
    }
    variables.sort((a, b) => a.address - b.address);
    const shown = [];
    for (let i = 0; i < statements.length; i++) {
      if (!DEFINITION.test(statements[i].source)) {
        shown.push([statements[i], states[i]]);
      }
    }
    if (shown.length === 0) {
      throw new Unsupported("a snippet of only struct definitions has nothing to step through");
    }
    const hasRefs = Object.keys(references).length > 0;
    const renderer = new Renderer(addresses$1, leaves(variables), real, hasRefs);
    let previous = {};
    for (let line = 0; line < shown.length; line++) {
      const [statement, after] = shown[line];
      renderer.statement(line, statement, previous, after);
      previous = after;
    }
    if (runtime && execution && renderer.realStdout !== execution.stdout) {
      throw new Unsupported("runtime output disagrees with the expression trace");
    }
    renderer.steps[renderer.steps.length - 1].hold = 3;
    const shownStatements = shown.map(([s]) => s);
    const result = {
      format: FORMAT,
      source: shownStatements.map((s) => s.source),
      spans: shownStatements.map((s) => s.span ? [...s.span] : null),
      variables,
      steps: renderer.steps
    };
    const types = definitions(body);
    if (Object.keys(types).length > 0) {
      result.types = types;
    }
    if (hasRefs) {
      result.references = Object.values(references);
    }
    try {
      validate(result);
    } catch (exc) {
      if (exc instanceof FormatError) {
        throw new Unsupported(`the tracer produced an invalid trace: ${exc.message}`);
      }
      throw exc;
    }
    return result;
  }
  function traceLayout(source, frontend) {
    const body = _body(source);
    const program = "#include <iostream>\n#include <cstdint>\n#include <cstddef>\nusing namespace std;\nint main() {\n" + body + "\n}\n";
    const ast = frontend.mainAst(program);
    const records = layoutsFromFrontend(ast, program, frontend, { layoutOnly: true });
    if (Object.keys(records).length === 0) {
      throw new Unsupported("layout requires at least one plain struct definition");
    }
    const result = {
      format: FORMAT,
      kind: "layout",
      records: Object.values(records).map((record) => ({
        name: record.name,
        size: record.size,
        alignment: record.alignment,
        fields: record.fields
      }))
    };
    validate(result);
    return result;
  }
  const EBADF = 8;
  const ENOENT = 44;
  const ENOSYS = 52;
  const ESPIPE = 70;
  const FILETYPE_CHARACTER_DEVICE = 2;
  class WasiExit extends Error {
    constructor(code) {
      super(`WASI proc_exit(${code})`);
      __publicField(this, "code");
      this.name = "WasiExit";
      this.code = code;
    }
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  function runWasiModule(module, options) {
    const args = options.args;
    const argBytes = args.map((arg) => encoder.encode(`${arg}\0`));
    const envEntries = Object.entries(options.env ?? {}).map(
      ([key, value]) => encoder.encode(`${key}=${value}\0`)
    );
    const stdinBytes = typeof options.stdin === "string" ? encoder.encode(options.stdin) : options.stdin ?? new Uint8Array(0);
    let stdinOffset = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    let memory;
    const view = () => new DataView(memory.buffer);
    const bytes = () => new Uint8Array(memory.buffer);
    const wasi_snapshot_preview1 = {
      args_sizes_get(argcPtr, argvBufSizePtr) {
        const dv = view();
        dv.setUint32(argcPtr, argBytes.length, true);
        let total = 0;
        for (const arg of argBytes) total += arg.length;
        dv.setUint32(argvBufSizePtr, total, true);
        return 0;
      },
      args_get(argvPtr, argvBufPtr) {
        const dv = view();
        const mem = bytes();
        let bufOffset = argvBufPtr;
        for (let i = 0; i < argBytes.length; i++) {
          dv.setUint32(argvPtr + i * 4, bufOffset, true);
          mem.set(argBytes[i], bufOffset);
          bufOffset += argBytes[i].length;
        }
        return 0;
      },
      environ_sizes_get(countPtr, bufSizePtr) {
        const dv = view();
        dv.setUint32(countPtr, envEntries.length, true);
        let total = 0;
        for (const entry of envEntries) total += entry.length;
        dv.setUint32(bufSizePtr, total, true);
        return 0;
      },
      environ_get(environPtr, environBufPtr) {
        const dv = view();
        const mem = bytes();
        let bufOffset = environBufPtr;
        for (let i = 0; i < envEntries.length; i++) {
          dv.setUint32(environPtr + i * 4, bufOffset, true);
          mem.set(envEntries[i], bufOffset);
          bufOffset += envEntries[i].length;
        }
        return 0;
      },
      clock_res_get(_id, resPtr) {
        view().setBigUint64(resPtr, 1000000n, true);
        return 0;
      },
      clock_time_get(_id, _precision, timePtr) {
        const ns = BigInt(Date.now()) * 1000000n;
        view().setBigUint64(timePtr, ns, true);
        return 0;
      },
      random_get(bufPtr, bufLen) {
        const slice = bytes().subarray(bufPtr, bufPtr + bufLen);
        globalThis.crypto.getRandomValues(slice);
        return 0;
      },
      fd_prestat_get(_fd, _bufPtr) {
        return EBADF;
      },
      fd_prestat_dir_name(_fd, _pathPtr, _pathLen) {
        return EBADF;
      },
      fd_fdstat_get(fd, statPtr) {
        if (fd < 0 || fd > 2) return EBADF;
        const dv = view();
        bytes().fill(0, statPtr, statPtr + 24);
        dv.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
        dv.setBigUint64(statPtr + 8, 0xffffffffffffffffn, true);
        dv.setBigUint64(statPtr + 16, 0xffffffffffffffffn, true);
        return 0;
      },
      fd_fdstat_set_flags(fd, _flags) {
        return fd >= 0 && fd <= 2 ? 0 : EBADF;
      },
      fd_filestat_get(fd, statPtr) {
        if (fd < 0 || fd > 2) return EBADF;
        const dv = view();
        bytes().fill(0, statPtr, statPtr + 64);
        dv.setBigUint64(statPtr + 8, BigInt(fd), true);
        dv.setUint8(statPtr + 16, FILETYPE_CHARACTER_DEVICE);
        dv.setBigUint64(statPtr + 24, 1n, true);
        dv.setBigUint64(statPtr + 32, fd === 0 ? BigInt(stdinBytes.length) : 0n, true);
        return 0;
      },
      fd_seek(_fd, _offset, _whence, _newOffsetPtr) {
        return ESPIPE;
      },
      fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
        if (fd !== 0) return EBADF;
        const dv = view();
        const mem = bytes();
        let totalRead = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = dv.getUint32(iovsPtr + i * 8, true);
          const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
          const available = Math.min(len, stdinBytes.length - stdinOffset);
          if (available > 0) {
            mem.set(stdinBytes.subarray(stdinOffset, stdinOffset + available), ptr);
            stdinOffset += available;
            totalRead += available;
          }
          if (available < len) break;
        }
        dv.setUint32(nreadPtr, totalRead, true);
        return 0;
      },
      fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
        if (fd !== 1 && fd !== 2) return EBADF;
        const dv = view();
        const mem = bytes();
        const target = fd === 1 ? stdoutChunks : stderrChunks;
        let totalWritten = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = dv.getUint32(iovsPtr + i * 8, true);
          const len = dv.getUint32(iovsPtr + i * 8 + 4, true);
          if (len > 0) {
            target.push(mem.slice(ptr, ptr + len));
            totalWritten += len;
          }
        }
        dv.setUint32(nwrittenPtr, totalWritten, true);
        return 0;
      },
      fd_close(fd) {
        return fd >= 0 && fd <= 2 ? 0 : EBADF;
      },
      fd_sync(fd) {
        return fd >= 0 && fd <= 2 ? 0 : EBADF;
      },
      fd_datasync(fd) {
        return fd >= 0 && fd <= 2 ? 0 : EBADF;
      },
      fd_readdir() {
        return EBADF;
      },
      path_open() {
        return ENOENT;
      },
      path_filestat_get() {
        return ENOENT;
      },
      sched_yield() {
        return 0;
      },
      poll_oneoff() {
        return ENOSYS;
      },
      proc_exit(code) {
        throw new WasiExit(code);
      }
    };
    const proxy = new Proxy(wasi_snapshot_preview1, {
      get(target, prop) {
        if (typeof prop === "string" && prop in target) {
          return target[prop];
        }
        return () => ENOSYS;
      }
    });
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: proxy
    });
    memory = instance.exports.memory;
    let returncode = 0;
    try {
      const start = instance.exports._start;
      start();
    } catch (err) {
      if (err instanceof WasiExit) {
        returncode = err.code;
      } else {
        throw err;
      }
    }
    return {
      returncode,
      stdout: concatUtf8(stdoutChunks),
      stderr: concatUtf8(stderrChunks)
    };
  }
  function concatUtf8(chunks) {
    if (chunks.length === 0) return "";
    if (chunks.length === 1) return decoder.decode(chunks[0]);
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return decoder.decode(out);
  }
  function createWasmClangFrontend(module) {
    return {
      mainAst(program) {
        const result = runWasiModule(module, {
          args: [
            "clang-trace-frontend",
            "-Xclang",
            "-ast-dump=json",
            "-Xclang",
            "-ast-dump-filter=main",
            "-"
          ],
          stdin: program
        });
        if (result.returncode !== 0) {
          const line = result.stderr.split(/\r?\n/).find((l) => l.includes("error:")) || "error: ill-formed C++";
          throw new Unsupported(line.slice(line.indexOf("error:")));
        }
        return extractMainAstFromStdout(result.stdout, program);
      },
      recordLayoutsDump(program) {
        const result = runWasiModule(module, {
          args: ["clang-trace-frontend", "-Xclang", "-fdump-record-layouts-complete", "-"],
          stdin: program
        });
        if (result.returncode !== 0) {
          throw new Unsupported("Clang could not compute record layouts");
        }
        return result.stdout;
      },
      typeSizes(types) {
        if (types.length === 0) return {};
        const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };
`).join("");
        const result = runWasiModule(module, {
          args: ["clang-trace-frontend", "-Xclang", "-ast-dump=json", "-"],
          stdin: probe
        });
        if (result.returncode !== 0) {
          throw new Unsupported("Clang could not obtain field sizes");
        }
        return extractEnumConstantSizes(JSON.parse(result.stdout), types);
      }
    };
  }
  function traceWithWasmModule(source, module, { mode = "trace" } = {}) {
    const frontend = createWasmClangFrontend(module);
    if (mode === "layout") {
      return traceLayout(source, frontend);
    }
    return traceWithFrontend(source, { runtime: false, frontend });
  }
  const workerSelf = self;
  let activeKey = null;
  let activeModule = null;
  let activeMeta = null;
  let queue = Promise.resolve();
  async function ensureLoaded(id, wasmUrl = DEFAULT_WASM_URL, cacheName = DEFAULT_CACHE_NAME) {
    const resolvedUrl = resolveWasmUrl(wasmUrl);
    const key = `${cacheName}::${resolvedUrl}`;
    if (activeModule && activeMeta && activeKey === key) {
      return { module: activeModule, meta: activeMeta };
    }
    const loaded = await loadWasmModule(resolvedUrl, {
      cacheName,
      onProgress(progress) {
        workerSelf.postMessage({ id, type: "progress", progress });
      }
    });
    const meta = {
      wasmUrl: loaded.wasmUrl,
      cacheName: loaded.cacheName,
      fromCache: loaded.fromCache,
      byteLength: loaded.byteLength,
      elapsedMs: loaded.elapsedMs
    };
    activeKey = key;
    activeModule = loaded.module;
    activeMeta = meta;
    return { module: loaded.module, meta };
  }
  async function handleRequest(request) {
    try {
      if (request.type === "init") {
        const { meta } = await ensureLoaded(request.id, request.wasmUrl, request.cacheName);
        workerSelf.postMessage({ id: request.id, type: "init-ok", load: meta });
        return;
      }
      if (request.type === "clear-cache") {
        const cleared = await clearWasmCache({
          wasmUrl: request.wasmUrl,
          cacheName: request.cacheName
        });
        if (!request.wasmUrl || resolveWasmUrl(request.wasmUrl) === (activeMeta == null ? void 0 : activeMeta.wasmUrl)) {
          activeKey = null;
          activeModule = null;
          activeMeta = null;
        }
        workerSelf.postMessage({ id: request.id, type: "clear-ok", cleared });
        return;
      }
      if (request.type === "trace") {
        const { module, meta } = await ensureLoaded(request.id, request.wasmUrl, request.cacheName);
        const start = performance.now();
        const trace = traceWithWasmModule(request.source, module, {
          mode: request.mode ?? "trace"
        });
        const durationMs = Math.round(performance.now() - start);
        workerSelf.postMessage({
          id: request.id,
          type: "trace-ok",
          trace,
          durationMs,
          load: meta
        });
        return;
      }
    } catch (err) {
      const error = err instanceof Error ? { name: err.name || "Error", message: err.message } : { name: "Error", message: String(err) };
      workerSelf.postMessage({ id: request.id, type: "error", error });
    }
  }
  workerSelf.addEventListener("message", (event) => {
    const request = event.data;
    queue = queue.then(() => handleRequest(request));
  });
})();
