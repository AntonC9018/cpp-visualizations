var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
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
  function illFormed(stderr, program) {
    const diagnostics = stderr.split(/\r?\n/);
    const index = diagnostics.findIndex((line) => line.includes("error:"));
    if (index < 0) return new IllFormed("error: ill-formed C++");
    const diagnostic = diagnostics[index];
    const place = /^.*?:(\d+):(\d+): error:/.exec(diagnostic);
    let offset = null;
    if (place) {
      const lines = program.split(new RegExp("(?<=\\n)"));
      offset = lines.slice(0, Number(place[1]) - 1).reduce((total, line) => total + line.length, 0) + Number(place[2]) - 1;
    }
    let message = diagnostic.slice(diagnostic.indexOf("error:"));
    if (message === "error: no viable overloaded '='") {
      const note = diagnostics.slice(index + 1).find((line) => line.includes("note:") || line.includes("error:")) ?? "";
      if (note.includes("note:") && note.includes("copy assignment operator")) {
        message += "; " + note.slice(note.indexOf("note:"));
      }
    }
    return new IllFormed(message, offset);
  }
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
  function arrayType(spelling) {
    var _a;
    const type = spelling.replace(/\b(?:struct|class) /g, "").replace(/^const /, "");
    const match = /^(?:std::)?array<(.+), (\d+)>$/.exec(type);
    if (!match) return null;
    const element = ((_a = arrayType(match[1])) == null ? void 0 : _a.name) ?? match[1];
    const count = Number(match[2]);
    return { name: `std::array<${element}, ${count}>`, element, count };
  }
  function elementLabel(index) {
    return `[${index}]`;
  }
  function codeName(path) {
    return path.replaceAll(".[", "[");
  }
  function operatorName(node) {
    var _a, _b, _c, _d, _e;
    return (_e = (_d = (_c = (_b = (_a = node.inner) == null ? void 0 : _a[0]) == null ? void 0 : _b.inner) == null ? void 0 : _c[0]) == null ? void 0 : _d.referencedDecl) == null ? void 0 : _e.name;
  }
  const libraryAlias = /\b(?:value_type|const_pointer|pointer)\b/;
  function needsConcreteType(spelling) {
    return libraryAlias.test(spelling) || /^(?:const )?(?:std::)?array</.test(spelling) && !arrayType(spelling.replace(/ [*&]+$/, ""));
  }
  function resolveArrayAliases(ast) {
    const locals = /* @__PURE__ */ new Map();
    function visit(node) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i;
      for (const child of node.inner ?? []) visit(child);
      for (const child of node.array_filler ?? []) visit(child);
      const type = node.type;
      if (!type) return;
      const spelling = type.desugaredQualType ?? type.qualType ?? "";
      if (needsConcreteType(spelling)) {
        const child = (_a = node.inner) == null ? void 0 : _a[0];
        let resolved;
        if (node.kind === "CXXMemberCallExpr" && (child == null ? void 0 : child.kind) === "MemberExpr" && child.name === "data") {
          const receiver = (_c = (_b = child.inner) == null ? void 0 : _b[0]) == null ? void 0 : _c.type;
          const receiverType = (receiver == null ? void 0 : receiver.desugaredQualType) ?? (receiver == null ? void 0 : receiver.qualType) ?? "";
          const array = arrayType(receiverType.replace(/ \*$/, ""));
          if (array) {
            const qualified = receiverType.startsWith("const ");
            const element = array.element;
            resolved = element.endsWith("*") ? element + (qualified ? "const *" : "*") : (qualified ? "const " : "") + element + " *";
          }
        } else if (node.kind === "DeclRefExpr") {
          const id = (_d = node.referencedDecl) == null ? void 0 : _d.id;
          resolved = id ? (_e = locals.get(id)) == null ? void 0 : _e.replace(/ &$| &&$/, "") : void 0;
        } else {
          const childType = ((_f = child == null ? void 0 : child.type) == null ? void 0 : _f.desugaredQualType) ?? ((_g = child == null ? void 0 : child.type) == null ? void 0 : _g.qualType);
          if (childType && !needsConcreteType(childType)) {
            if (node.kind === "UnaryOperator" && node.opcode === "&") {
              const pointee = childType.replace(/^([\w: ]+) const$/, "const $1");
              resolved = pointee.endsWith("*") ? pointee + "*" : pointee + " *";
            } else if (node.kind === "VarDecl") {
              resolved = childType + (spelling.endsWith("&") ? " &" : "");
            } else if (node.kind === "ImplicitCastExpr" && (node.castKind === "NoOp" || node.castKind === "LValueToRValue") || node.kind === "ParenExpr" || node.kind === "InitListExpr" && ((_h = node.inner) == null ? void 0 : _h.length) === 1) {
              resolved = childType;
            }
          }
        }
        if (resolved) node.type = { ...type, desugaredQualType: resolved };
      }
      if (node.kind === "VarDecl" && node.id) {
        locals.set(node.id, ((_i = node.type) == null ? void 0 : _i.desugaredQualType) ?? spelling);
      }
    }
    visit(ast);
  }
  const MAX_ARRAY_ELEMENTS = 32;
  const MAX_ARRAY_CELLS = 64;
  function checkArrayExtent(count, cells) {
    if (count < 1 || count > MAX_ARRAY_ELEMENTS || cells > MAX_ARRAY_CELLS) {
      throw new Unsupported(
        `std::array requires 1–${MAX_ARRAY_ELEMENTS} elements and at most ${MAX_ARRAY_CELLS} scalar cells`
      );
    }
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
    /** The result of arithmetic in this type: unsigned wraps, signed overflow is undefined. */
    result(value) {
      if (this.signed && !this.holds(value)) {
        throw new Unsupported("signed integer overflow is outside the timeline category");
      }
      return this.wrap(value);
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
  function displayed(spelling) {
    return spelling.replace(/^(const )?struct /, "$1").replace(/\s+(?=[*&])/g, "").replace(/^std::/, "");
  }
  function displayedType(node) {
    const spelling = typeSpelling(node);
    const canonical = canonicalType(node);
    return displayed(
      /^(?:const )?std::array</.test(canonical) || /\b(?:value_type|size_type|const_pointer|pointer)\b/.test(spelling) ? canonical : spelling
    );
  }
  function typeName(node) {
    return typeSpelling(node).replace(/^const /, "");
  }
  function canonicalType(node) {
    const qualified = (node == null ? void 0 : node.type) ?? {};
    const spelling = qualified.desugaredQualType ?? qualified.qualType ?? "";
    return spelling.replace(/^([\w: ]+) const$/, "const $1");
  }
  function recordName(node) {
    var _a;
    const canonical = canonicalType(node);
    return ((_a = arrayType(canonical)) == null ? void 0 : _a.name) ?? (/^value_type$/.test(typeName(node)) ? canonical.replace(/^const /, "") : typeName(node));
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
    const arrayTypes = /* @__PURE__ */ new Set();
    if (!layoutOnly) {
      let collectType = function(spelling) {
        const array = arrayType(spelling);
        if (!array || arrayTypes.has(array.name)) return;
        checkArrayExtent(array.count, array.count);
        arrayTypes.add(array.name);
        collectType(array.element);
      }, collect = function(node) {
        collectType(canonicalType(node));
        if (node.argType) collectType(canonicalType({ type: node.argType }));
        for (const child of node.inner ?? []) collect(child);
        for (const child of node.array_filler ?? []) collect(child);
      };
      collect(ast);
    }
    if (Object.keys(definitions2).length === 0 && arrayTypes.size === 0) {
      return {};
    }
    const floatSpelled = (spelling) => spelling === "float" || spelling === "double";
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
        const base = canonical.replace(/^struct /, "").replace(/ \*+$/, "");
        const isPtr = canonical.endsWith("*") && !qualified.startsWith("const ");
        const shadowed = Object.hasOwn(definitions2, qualified.replace(/^const /, "").replace(/^std::/, "").replace(/ \*+$/, ""));
        let allowed = !shadowed && (Boolean(integerSpelled(canonical)) || floatSpelled(canonical)) && !qualified.startsWith("const ") || isPtr && (!shadowed && (Boolean(integerSpelled(base)) || floatSpelled(base)) || base === "void" || Object.hasOwn(definitions2, base) || arrayTypes.has(base));
        allowed || (allowed = Object.hasOwn(definitions2, qualified) && qualified !== name);
        allowed || (allowed = arrayTypes.has(recordName(child)));
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
    const arrayLayouts = /* @__PURE__ */ new Map();
    const canonicals = {};
    for (const block of dumpOutput.split("*** Dumping AST Record Layout")) {
      const header = /^\s*0 \| struct (\S[^\n]*)$/m.exec(block);
      if (!header) continue;
      const name = header[1].trimEnd();
      const sizes = /\[sizeof=(\d+), dsize=\d+, align=(\d+),/.exec(block);
      const array = arrayType(name);
      if (array && arrayTypes.has(array.name) && sizes) {
        arrayLayouts.set(array.name, { size: Number(sizes[1]), alignment: Number(sizes[2]) });
      }
      if (!Object.hasOwn(definitions2, name)) continue;
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
        const nestedName = recordName(node);
        const nested = !layoutOnly && (Object.hasOwn(definitions2, nestedName) || arrayTypes.has(nestedName)) ? nestedName : null;
        const item = {
          name: member,
          offset,
          kind: nested ? "struct" : isPointer(node) ? "ptr" : "int",
          size: 0,
          ...!layoutOnly ? { canonical: canonicalType(node).replace(/^struct /, "") } : {},
          ...floatSpelled(canonicalType(node)) ? { floating: true } : {}
        };
        if (layoutOnly || nested) {
          item.type = nested ?? spelling;
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
    const sizesMap = types.length ? frontend.typeSizes(types) : {};
    const leafCounts = /* @__PURE__ */ new Map();
    function countCells(name) {
      var _a;
      const known = leafCounts.get(name);
      if (known !== void 0) return known;
      const array = arrayType(name);
      if (array) {
        const layout = arrayLayouts.get(name);
        if (!layout || layout.size % array.count !== 0) {
          throw new Unsupported(`Clang omitted a contiguous layout for ${name}`);
        }
        const nested = arrayType(array.element) || Object.hasOwn(records, array.element);
        const scalarElem = /^(?:(?:signed|unsigned) char|(?:unsigned )?(?:short|int|long(?: long)?)|float|double)$/;
        const pointee = (_a = /^(.*) \*+$/.exec(array.element)) == null ? void 0 : _a[1];
        const pointer = pointee !== void 0 && (scalarElem.test(pointee) || pointee === "void" || Object.hasOwn(records, pointee) || Boolean(arrayType(pointee)));
        if (!nested && !pointer && !scalarElem.test(array.element)) {
          throw new Unsupported(`unsupported std::array element type ${array.element}`);
        }
        const count2 = array.count * (nested ? countCells(array.element) : 1);
        checkArrayExtent(array.count, count2);
        const size = layout.size / array.count;
        const isFloatElem = floatSpelled(array.element);
        const fields = Array.from({ length: array.count }, (_, index) => ({
          name: elementLabel(index),
          offset: index * size,
          kind: nested ? "struct" : pointer ? "ptr" : "int",
          ...nested ? { type: array.element } : {},
          ...!layoutOnly ? { canonical: array.element } : {},
          ...isFloatElem ? { floating: true } : {},
          size
        }));
        records[name] = new RecordLayout(name, layout.size, layout.alignment, fields);
        leafCounts.set(name, count2);
        return count2;
      }
      const count = records[name].fields.reduce(
        (total, field2) => total + (field2.kind === "struct" ? countCells(field2.type) : 1),
        0
      );
      leafCounts.set(name, count);
      return count;
    }
    for (const name of arrayTypes) countCells(name);
    for (const [name, record] of Object.entries(records)) {
      const recCanonicals = canonicals[name];
      if (!recCanonicals) continue;
      for (let i = 0; i < record.fields.length; i++) {
        const item = record.fields[i];
        const canonical = recCanonicals[i];
        item.size = canonical === null ? records[item.type].size : sizesMap[canonical];
      }
    }
    return records;
  }
  const COMPOUND_OPERATORS = ["+", "-", "*", "/", "%"];
  function openCompound(pane, span, left, operator, grouped) {
    const [start, end] = span;
    const head = pane.slice(0, start).trimEnd() + " = ";
    const rest = pane.slice(end);
    const from = end + rest.length - rest.trimStart().length;
    const middle = `${head}${left} ${operator} ${grouped ? "(" : ""}`;
    return {
      text: middle + pane.slice(from) + (grouped ? ")" : ""),
      left: [head.length, head.length + left.length],
      right: middle.length,
      from
    };
  }
  const PRINTED_DIGITS = 6;
  function binaryParts(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    const biased = Number(bits >> 52n);
    const fraction = bits & (1n << 52n) - 1n;
    return biased === 0 ? { mantissa: fraction, exponent: -1074 } : { mantissa: fraction | 1n << 52n, exponent: biased - 1075 };
  }
  function isTie(value, digits, scale) {
    const { mantissa, exponent } = binaryParts(value);
    let left = 2n * mantissa;
    let right = 2n * BigInt(digits) - 1n;
    if (exponent >= 0) left <<= BigInt(exponent);
    else right <<= BigInt(-exponent);
    if (scale >= 0) right *= 10n ** BigInt(scale);
    else left *= 10n ** BigInt(-scale);
    return left === right;
  }
  function formatFloat(value) {
    if (Object.is(value, -0)) return "-0";
    if (value === 0) return "0";
    const sign = value < 0 ? "-" : "";
    const magnitude = Math.abs(value);
    const [mantissa, e] = magnitude.toExponential(PRINTED_DIGITS - 1).split("e");
    const exp = Number(e);
    let rounded = Number(mantissa.replace(".", ""));
    if (rounded % 2 === 1 && isTie(magnitude, rounded, exp - (PRINTED_DIGITS - 1))) rounded -= 1;
    const digits = String(rounded);
    if (exp < -4 || exp >= PRINTED_DIGITS) {
      const trimmed = (digits[0] + "." + digits.slice(1)).replace(/\.?0+$/, "");
      const expSign = exp < 0 ? "-" : "+";
      return `${sign}${trimmed}e${expSign}${String(Math.abs(exp)).padStart(2, "0")}`;
    }
    const point = exp + 1;
    const fixed = point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point);
    return sign + (fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed);
  }
  const SHOWN_DIGITS = 8;
  const FLOAT_DIGITS = 9;
  function shortestDecimal(value, size) {
    if (size === 8 || Math.fround(value) !== value) return String(value);
    for (let digits = 1; digits <= FLOAT_DIGITS; digits++) {
      const [mantissa, exponent] = value.toExponential(digits - 1).split("e");
      const scaled = Number(mantissa.replace(".", ""));
      const scale = Number(exponent) - (digits - 1);
      const fits = [scaled, scaled - 1, scaled + 1].map((candidate) => Number(`${candidate}e${scale}`)).filter((candidate) => Math.fround(candidate) === value).sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
      if (fits.length) return String(fits[0]);
    }
    return String(value);
  }
  function compact$1(text) {
    const scientific = Number(text).toExponential();
    return scientific.length < text.length ? scientific : text;
  }
  const significantDigits = (text) => Number(text).toExponential().split("e")[0].replace(/[-.]/g, "").length;
  function displayFloat(value, size) {
    if (Object.is(value, -0)) return "-0";
    if (Number.isSafeInteger(value)) return String(value);
    const shortest = shortestDecimal(value, size);
    if (significantDigits(shortest) <= SHOWN_DIGITS) return compact$1(shortest);
    return "≈" + compact$1(String(Number(value.toPrecision(SHOWN_DIGITS))));
  }
  function displayNumber(value, floatSize = null) {
    if (floatSize) return displayFloat(value, floatSize);
    return Object.is(value, -0) ? "-0" : String(value);
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
    "alias",
    "convert",
    "clash"
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
  function scalar(name, address, size = 4, kind = "int", color = 0, type = null, floating = false) {
    const variable = { name, address, size, kind, color };
    if (type) variable.type = type;
    if (floating) variable.floating = true;
    return variable;
  }
  function struct(name, type_, address, size, fields, color = 0) {
    return { name, type: type_, address, size, kind: "struct", color, fields };
  }
  function reference(name, color = 0) {
    return { name, color };
  }
  function field(name, offset, size = 4, kind = "int", color = 0, floating = false) {
    return { name, offset, size, kind, color, ...floating ? { floating: true } : {} };
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
  function contiguous(cells) {
    const sorted = [...cells].sort((a, b) => a.address - b.address);
    return sorted.every((lower, i) => {
      const higher = sorted[i + 1];
      if (!higher) return true;
      const gap = higher.address - lower.address - lower.size;
      return 0 <= gap && gap < lower.size;
    });
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
    const array = arrayType(owner.type);
    check(Array.isArray(fields) && fields.length > 0, `${here}.fields`, "expected a nonempty list");
    if (array) check(fields.length === array.count, here, "array extent must match its fields");
    const seen = /* @__PURE__ */ new Set();
    let end = 0;
    for (let position = 0; position < fields.length; position++) {
      const item = fields[position];
      const spot = `${here}.fields[${position}]`;
      const nested = isPlainObject$1(item) && item.kind === STRUCT;
      const req = ["name", "offset", "size", "kind", "color", ...nested ? ["type", "fields"] : []];
      checkKeys(item, spot, req, nested ? [] : ["floating"]);
      checkFloating(item, spot);
      if (array) {
        check(item.name === elementLabel(position), spot, "invalid array element name");
        check(
          item.size * array.count === owner.size && item.offset === position * item.size,
          spot,
          "array elements must be contiguous and equally sized"
        );
      } else {
        check(IDENTIFIER.test(String(item.name)), spot, "name is not an identifier");
      }
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
  function checkFloating(cell, where) {
    if (!Object.hasOwn(cell, "floating")) return;
    check(
      cell.floating === true && cell.kind === "int" && (cell.size === 4 || cell.size === 8),
      `${where}.floating`,
      "only a 4- or 8-byte value cell is floating, and it says true"
    );
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
      checkKeys(variable, here, req, struct_ ? ["type"] : ["type", "floating"]);
      checkFloating(variable, here);
      check(typeof (variable.type ?? "") === "string", `${here}.type`, "expected text");
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
  function checkValue(value, cell, where) {
    if (value === null || value === UNKNOWN) return;
    if (cell == null ? void 0 : cell.floating) {
      check(
        typeof value === "number" && Number.isFinite(value) && (cell.size === 8 || Math.fround(value) === value),
        where,
        `a ${cell.size}-byte floating value is a finite number it can hold, "?" or null`
      );
      return;
    }
    check(
      typeof value === "number" && Number.isInteger(value),
      where,
      'a value is an integer, "?" (declared, unknown) or null (no storage yet)'
    );
  }
  function checkTypes(step, where) {
    const { types } = step;
    check(Array.isArray(types) && types.length > 0, where, "expected a nonempty list");
    let end = 0;
    let slots = 0;
    for (let index = 0; index < types.length; index++) {
      const item = types[index];
      const here = `${where}[${index}]`;
      checkKeys(item, here, ["span", "type"], ["slot"]);
      const [start, finish] = checkSpan(item.span, step.pane, `${here}.span`);
      check(start >= end, `${here}.span`, "typed spans must be ordered and must not overlap");
      end = finish;
      check(typeof item.type === "string" && item.type.length > 0, `${here}.type`, "expected text");
      check(!Object.hasOwn(item, "slot") || item.slot === true, `${here}.slot`, "expected true when present");
      if (Object.hasOwn(item, "slot")) slots++;
    }
    check(slots <= 1, where, "a statement has one slot");
  }
  function typedAt(step, span) {
    var _a;
    return (_a = (step.types ?? []).find((part) => part.span[0] === span[0] && part.span[1] === span[1])) == null ? void 0 : _a.type;
  }
  function convertedFrom(step, span) {
    const inside = (step.types ?? []).filter(
      (part) => span[0] <= part.span[0] && part.span[1] <= span[1]
    );
    return inside.length === 1 ? inside[0].type : void 0;
  }
  function checkClash(op, step, previous, where) {
    check(
      step.pane === previous.pane && previous.op === null,
      where,
      "a clash follows the statement as written and does not change the pane"
    );
    const [, end] = checkSpan(op.destination, step.pane, `${where}.destination`);
    const [start] = checkSpan(op.span, step.pane, `${where}.span`);
    check(end <= start, where, "the slot comes before the value");
    check(op.from !== op.to, where, "the types must differ");
    const slot = (step.types ?? []).find((part) => part.slot);
    check(
      slot !== void 0 && arraysEqual(slot.span, op.destination) && slot.type === op.to,
      `${where}.destination`,
      "must be the typed slot of the statement"
    );
    check(typedAt(step, op.span) === op.from, `${where}.span`, "must be a typed part of type `from`");
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
  function checkCompoundRead(op, step, previous, storage, where) {
    check(COMPOUND_OPERATORS.includes(op.compound), `${where}.compound`, "is not an arithmetic operator");
    const span = checkSpan(op.span, previous.pane, `${where}.span`);
    const spelling = `${op.compound}=`;
    check(previous.pane.slice(...span) === spelling, `${where}.span`, `does not cover ${spelling}`);
    check(
      previous.pane.slice(0, span[0]).trim() === codeName(op.name),
      `${where}.name`,
      `${pyRepr(previous.pane.slice(0, span[0]).trim())} does not designate ${op.name}`
    );
    const cell = storage.cells[op.name];
    check(
      cell !== void 0 && cell.kind !== "ptr" && arraysEqual(storage.cellsOf(op.name), [op.name]),
      `${where}.name`,
      "is not one arithmetic cell"
    );
    check(op.value !== UNKNOWN, `${where}.value`, "reads an uninitialized value");
    const opened = [false, true].map((grouped) => openCompound(previous.pane, span, op.value, op.compound, grouped).text);
    check(opened.includes(step.pane), where, `${pyRepr(step.pane)} is not ${pyRepr(opened[0])} or ${pyRepr(opened[1])}`);
  }
  const LITERAL = /^≈?-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  function storedItems(text, where) {
    const braced = /^(?:[A-Za-z_]\w*)?\{[\s\S]*\}$/.test(text);
    const inner = braced ? text.slice(text.indexOf("{")) : text;
    const items = braced ? inner.replace(/[{}]/g, "").split(",").map((s) => s.trim()) : [inner];
    for (const item of items) {
      check(
        item === "nullptr" || item === UNKNOWN || LITERAL.test(item),
        where,
        `${pyRepr(inner)} is not a value: expected an integer, nullptr, "?" or {…} of them`
      );
    }
    return items;
  }
  function showsCell(item, value, cell) {
    if (item === UNKNOWN || value === UNKNOWN) return item === value;
    if (item === "nullptr") return (cell == null ? void 0 : cell.kind) === "ptr" && value === 0;
    if ((cell == null ? void 0 : cell.floating) && typeof value === "number") return item === displayFloat(value, cell.size);
    return !item.startsWith("≈") && Object.is(Number(item), value);
  }
  function stored(text, where) {
    return storedItems(text, where).map((item) => item === "nullptr" ? 0 : item === UNKNOWN ? item : Number(item));
  }
  function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
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
    const items = storedItems(op.value, where);
    check(
      items.length === cells.length && items.every((item, i) => showsCell(item, expected[i], storage.cells[cells[i]])),
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
      check(replaced === codeName(target), where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(target)}`);
      return;
    }
    check(step.pane === previous.pane, where, "a bind does not change the pane");
    check(
      !Object.hasOwn(refs(previous), name) && refs(step)[name] === target,
      where,
      `${name} must become bound to ${target}`
    );
    for (const [key, text] of [
      ["span", codeName(target)],
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
      check(step.pane.slice(dStart, dEnd) === codeName(op.name), `${where}.destination`, "does not cover the name");
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
      alias: ["name", "target", "span"],
      convert: ["value", "span", "from", "to"],
      clash: ["span", "destination", "from", "to"]
    };
    const fields = fieldMap[kind];
    checkKeys(op, where, [...fields, "kind"], kind === "read" ? ["compound"] : []);
    for (const key of fields.filter((k) => ["name", "target", "via", "value", "from", "to"].includes(k))) {
      check(typeof op[key] === "string" && op[key].length > 0, `${where}.${key}`, "expected text");
    }
    if (kind === "bind" || kind === "alias") {
      checkReferenceOp(op, step, previous, storage, where);
      return;
    }
    if (kind === "clash") {
      checkClash(op, step, previous, where);
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
    if (Object.hasOwn(op, "compound")) {
      checkCompoundRead(op, step, previous, storage, where);
    } else if (["read", "addr", "deref", "eval", "convert"].includes(kind)) {
      const span = checkSpan(op.span, previous.pane, `${where}.span`);
      const replaced = replacement(previous.pane, step.pane, span, where);
      const expected = kind === "deref" ? codeName(op.target) : op.value;
      check(replaced === expected, where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(expected)}`);
      if (kind === "convert") {
        check(convertedFrom(previous, span) === op.from, `${where}.from`, "is not the type of the converted value");
        check(
          typedAt(step, [span[0], span[0] + replaced.length]) === op.to,
          `${where}.to`,
          "is not the type of the result"
        );
      }
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
        Object.is(value, old) || written.has(name) || !step.op && old === null && value === UNKNOWN,
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
    var _a;
    if (isPlainObject$1(trace) && trace.kind === "layout") {
      checkLayout(trace);
      return;
    }
    checkKeys(
      trace,
      "trace",
      ["format", "source", "variables", "steps"],
      ["title", "spans", "types", "bits", "integers", "references"]
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
    const aliases = trace.integers ?? {};
    if (Object.hasOwn(trace, "integers")) {
      check(
        trace.bits === true && isPlainObject$1(aliases) && Object.values(aliases).every((name) => typeof name === "string" && Object.hasOwn(INTEGERS, name)),
        "trace.integers",
        "expected builtin integer types by alias, in a bits trace"
      );
    }
    if (Object.hasOwn(trace, "bits")) {
      check(trace.bits === true, "trace.bits", "expected true");
      check(
        !Object.hasOwn(trace, "references") && variables.every((v) => {
          var _a2;
          return v.kind === "int" && ((_a2 = integerSpelled(v.type ?? "", aliases)) == null ? void 0 : _a2.size) === v.size;
        }),
        "trace.bits",
        "expected only integer variables, each with its type"
      );
    }
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
        ["expr", "refs", "types"]
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
      if (Object.hasOwn(step, "types")) {
        checkTypes(step, `${where}.types`);
      }
      check(
        isPlainObject$1(step.values) && arraysEqual(Object.keys(step.values).sort(), sortedCellNames),
        `${where}.values`,
        `expected exactly ${pyListRepr(sortedCellNames)}`
      );
      for (const [name, value] of Object.entries(step.values)) {
        checkValue(value, storage.cells[name], `${where}.values.${name}`);
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
      if (trace.bits) {
        checkBitsStep(step, previous, aliases, where);
      }
      check(
        index === steps.length - 1 || ((_a = step.op) == null ? void 0 : _a.kind) !== "clash",
        `${where}.op`,
        "nothing runs after a statement that does not compile"
      );
      previous = step;
    }
  }
  function checkBitsStep(step, previous, aliases, where) {
    check(
      (step.types ?? []).every((part) => integerSpelled(part.type, aliases) !== null),
      `${where}.types`,
      "expected integer types in a bits trace"
    );
    const { op } = step;
    if ((op == null ? void 0 : op.kind) !== "convert") return;
    const from = integerSpelled(op.from, aliases);
    const to = integerSpelled(op.to, aliases);
    const value = integerLiteral(op.value);
    check(
      from !== null && to !== null && value !== null,
      `${where}.op`,
      "expected an integer value converted between integer types in a bits trace"
    );
    const operand = previous && convertOperand(previous, op);
    check(
      operand !== null && to.wrap(operand) === value,
      `${where}.op.value`,
      `expected the operand converted to ${op.to}`
    );
  }
  function convertOperand(previous, op) {
    var _a;
    const part = (_a = previous.types) == null ? void 0 : _a.find(
      (t) => !t.slot && t.type === op.from && t.span[0] >= op.span[0] && t.span[1] <= op.span[1]
    );
    return integerLiteral(previous.pane.slice(...(part == null ? void 0 : part.span) ?? op.span));
  }
  const REFERENCE = "reference";
  const hooks = {
    execute: null,
    after: (statement, state) => storeResult(statement, state)
  };
  const FIRST_ADDRESS = 64;
  const POINTER_SIZE = 8;
  const MAX_EXACT = 2n ** 53n;
  const MAX_STATEMENTS = 20;
  const MAX_VARIABLES = 8;
  const QUOTED_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  const FLOATINGS = Object.freeze({
    float: Object.freeze({ size: 4, round: (value) => Math.fround(value) }),
    double: Object.freeze({ size: 8, round: (value) => value })
  });
  function floatNamed(spelling, records = {}) {
    const bare = spelling.replace(/^const /, "").replace(/^std::/, "");
    if (hasRecord(records, bare)) return null;
    return Object.hasOwn(FLOATINGS, bare) ? FLOATINGS[bare] : null;
  }
  function floatType(node, records = {}) {
    return floatNamed(canonicalType(node), records);
  }
  class Pointer {
    constructor(target = null) {
      __publicField(this, "target");
      this.target = target;
      Object.freeze(this);
    }
  }
  function asPointer(value) {
    if (!(value instanceof Pointer)) throw new Error("expected a pointer value");
    return value;
  }
  function fieldOf(value, field2) {
    if (!isPlainObject(value)) throw new Error(`expected a struct value with the field ${field2}`);
    return value[field2];
  }
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Pointer);
  }
  function integerNamed(spelling, records = {}) {
    if (hasRecord(records, spelling.replace(/^const /, "").replace(/^std::/, ""))) return null;
    return integerSpelled(spelling);
  }
  function integerType(node, records = {}) {
    return integerNamed(canonicalType(node), records);
  }
  function integerTypeOf(node) {
    const type = integerType(node);
    if (!type) {
      throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || "this type"}`);
    }
    return type;
  }
  function exact(value) {
    if (value > MAX_EXACT || value < -MAX_EXACT) {
      throw new Unsupported("integers beyond 2^53 are not drawn exactly");
    }
    return Number(value);
  }
  function hasRecord(records, name) {
    if (!records) return false;
    if (Array.isArray(records) || records instanceof Set) {
      return [...records].includes(name);
    }
    return Object.hasOwn(records, name);
  }
  function recordShape(record, records) {
    return Object.fromEntries(
      record.fields.map((field2) => {
        const nested = field2.kind === "struct" && field2.type ? getRecord(records, field2.type) : void 0;
        return [field2.name, nested ? recordShape(nested, records) : field2.floating ? field2.size : null];
      })
    );
  }
  function shapeOf(node, records) {
    const float = floatType(node, records);
    if (float) return float.size;
    const record = pointerDepth(node, records) ? void 0 : getRecord(records, recordName(node));
    return record ? recordShape(record, records) : null;
  }
  function getRecord(records, name) {
    if (!records || Array.isArray(records) || records instanceof Set) return void 0;
    const map = records;
    return Object.hasOwn(map, name) ? map[name] : void 0;
  }
  function pointerDepth(node, records = {}) {
    const qualified = typeSpelling(node);
    const intMatch = /^(const )?([\w: ]+?)(?: (\*+))?$/.exec(canonicalType(node));
    if (intMatch && (integerNamed(intMatch[2], records) || floatNamed(intMatch[2], records) || intMatch[2] === "void" && Boolean(intMatch[3])) && !(intMatch[1] && intMatch[3])) {
      return (intMatch[3] || "").length;
    }
    const recordType = recordName(node);
    if (hasRecord(records, recordType)) {
      return 0;
    }
    const pointerType = canonicalType(node).replace(/^struct /, "");
    const recPtrMatch = /^(\w+|(?:std::)?array<.+>) (\*+)$/.exec(pointerType);
    if (recPtrMatch && (hasRecord(records, recPtrMatch[1]) || arrayType(recPtrMatch[1]))) {
      return recPtrMatch[2].length;
    }
    if (qualified.includes("&")) {
      throw new Unsupported("references are not supported");
    }
    if (qualified.includes("[")) {
      throw new Unsupported("arrays are not supported");
    }
    if (qualified.includes("*")) {
      throw new Unsupported(`only pointers to integers are supported, not ${qualified}`);
    }
    throw new Unsupported(`only integer and pointer values are supported, not ${qualified || "this type"}`);
  }
  function isAscii(str) {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) return false;
    }
    return true;
  }
  function snippetBody(source) {
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
  function load(state, name, missing = false) {
    const [owner, ...path] = name.split(".");
    if (!missing && !Object.hasOwn(state, owner)) {
      throw new Error(`KeyError: ${owner}`);
    }
    let value = state[owner];
    for (const member of path) {
      value = fieldOf(value, member);
    }
    return value;
  }
  function flatten(state) {
    const cells = {};
    for (const [name, value] of Object.entries(state)) {
      if (isPlainObject(value)) {
        const sub = {};
        for (const [member, item] of Object.entries(value)) {
          sub[`${name}.${member}`] = item;
        }
        Object.assign(cells, flatten(sub));
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
    return canonicalType(node).endsWith("*");
  }
  function rejectPointerOperator(node) {
    if ((node == null ? void 0 : node.kind) === "BinaryOperator" && (operandIsPointer(node) || (node.inner ?? []).some(operandIsPointer))) {
      throw new Unsupported("pointer arithmetic and comparison are not supported");
    }
  }
  class Evaluator {
    constructor(state, locate, records, references = {}, storageTypes = {}) {
      __publicField(this, "state");
      __publicField(this, "locate");
      __publicField(this, "reductions");
      __publicField(this, "records");
      __publicField(this, "references");
      __publicField(this, "storageTypes");
      __publicField(this, "temporary");
      this.state = state;
      this.locate = locate;
      this.reductions = [];
      this.records = records;
      this.references = references;
      this.storageTypes = storageTypes;
      this.temporary = false;
    }
    /** A type spelling with its pointee and integer typedefs resolved: `uint8_t *` is `unsigned char *`. */
    storageType(spelling) {
      const [, base, stars] = /^(.*?)((?:\s*\*)*)$/.exec(spelling.replace(/^struct /, "").trim());
      const name = base.trim();
      const integer = hasRecord(this.records, bareSpelling(name)) ? null : integerName(name);
      return { base: integer ?? name, stars: stars.replace(/\s/g, "").length };
    }
    /** Rejects reading `target` through a pointer to another type, such as a cast `void*`. */
    checkPointeeType(pointer, target) {
      if (!Object.hasOwn(this.storageTypes, target)) {
        throw new Unsupported(`the storage type of ${target} is unknown`);
      }
      const through = this.storageType(canonicalType(pointer));
      const held = this.storageType(this.storageTypes[target]);
      if (through.base !== held.base || through.stars !== held.stars + 1) {
        const spell = ({ base, stars }) => stars ? `${base} ${"*".repeat(stars)}` : base;
        throw new Unsupported(
          `dereferencing a pointer to ${spell({ ...through, stars: through.stars - 1 })} when ${target} holds ${spell(held)}`
        );
      }
    }
    reduce(node, details) {
      this.reduceAt(this.locate(node), node, details);
    }
    /** A reduction at `span` to a value of the type of `typed`, a node or just its type. */
    reduceAt(span, typed, details) {
      this.reductions.push({
        ...details,
        span,
        type: displayedType(typed),
        shape: shapeOf(typed, this.records)
      });
    }
    /**
     * `left op= right`, already designated as `target`: the value it holds, read into the pane's
     * hidden copy of `left` at `copy`; the right side, then its parentheses at `group`, if any;
     * then the operation over `result` in the type Clang computes it in, and back in the type of
     * `left`.
     */
    compound(node, target, copy, result, group) {
      const [left, right] = node.inner;
      const operator = node.opcode.slice(0, -1);
      const held = this.load(target);
      if (typeof held !== "number") {
        throw new Unsupported("pointer arithmetic and comparison are not supported");
      }
      this.reduceAt(copy, left, { kind: "read", name: target, record: null, compound: operator });
      const computation = { type: node.computeLHSType };
      const resultType = { type: node.computeResultType };
      const operand = this.convertedAt(copy, held, computation, left);
      const other = this.numericOperand(right);
      if (group) this.reduceAt(group, right, { kind: "eval", value: other, record: null });
      const value = this.operate(resultType, operator, operand, other);
      this.reduceAt(result, resultType, { kind: "eval", value, record: null });
      return this.convertedAt(result, value, left, resultType);
    }
    /** `node`, which designates `target`, spelled as `target` is: `(s.x)` becomes `s.x`. */
    respell(node, target, written) {
      const span = this.locate(node);
      const spelled = this.reductions.some((item) => item.span[0] === span[0] && item.span[1] === span[1]);
      if (!spelled && written !== codeName(target)) this.reduce(node, { kind: "select", name: target });
    }
    /** `value`, of the type of `source`, in the type of `node`; a step at `span` if the type changes. */
    convertedAt(span, value, node, source) {
      if (displayedType(node) === displayedType(source)) return value;
      const converted = this.conversion(node, source)(value);
      this.reduceAt(span, node, { kind: "convert", value: converted, source: displayedType(source) });
      return converted;
    }
    /** A brace list inside another one is part of its value, not an evaluation of its own. */
    absorb(child, value) {
      const last = this.reductions[this.reductions.length - 1];
      const list = (child == null ? void 0 : child.kind) === "InitListExpr" || (child == null ? void 0 : child.kind) === "CXXFunctionalCastExpr" && arrayType(canonicalType(child));
      if (list && (last == null ? void 0 : last.kind) === "eval" && last.value === value) {
        this.reductions.pop();
      }
    }
    load(name) {
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
        this.reduce(node, { kind: "alias", name, target: this.references[name] });
        return this.references[name];
      }
      if ((node == null ? void 0 : node.kind) !== "DeclRefExpr" || declaration.kind !== "VarDecl" || !Object.hasOwn(this.state, name)) {
        throw new Unsupported("expression references an undeclared or nonlocal variable");
      }
      return name;
    }
    arrayAccess(node) {
      const [callee, ...operands] = node.inner ?? [];
      if (node.kind === "CXXOperatorCallExpr" && operatorName(node) === "operator[]") {
        const [object, ...args] = operands;
        const array = arrayType(canonicalType(object));
        if (array && args.length === 1) return { object, array, member: null, args };
      }
      if (node.kind === "CXXMemberCallExpr" && (callee == null ? void 0 : callee.kind) === "MemberExpr") {
        const [object] = callee.inner ?? [];
        const array = arrayType(canonicalType(object).replace(/ \*$/, ""));
        if (array && object) return { object, array, member: callee, args: operands };
      }
      return null;
    }
    arrayObject(object, arrow = false) {
      const base = object.kind === "ImplicitCastExpr" && object.castKind === "NoOp" ? object.inner[0] : object;
      if (!arrow) return this.lvalue(base);
      const [value, via] = this.rvalue(base);
      const pointer = asPointer(value);
      if (via === null || pointer.target === null) {
        throw new Unsupported("array member access requires a non-null pointer variable");
      }
      this.checkPointeeType(base, pointer.target);
      return pointer.target;
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
      const access = this.arrayAccess(node);
      if (access && !access.member) {
        const owner = this.arrayObject(access.object);
        const indexNode = access.args[0];
        const index = this.integerOperand(indexNode.castKind === "IntegralCast" ? indexNode.inner[0] : indexNode);
        if (index < 0 || index >= access.array.count) {
          throw new Unsupported(`std::array index ${index} is out of bounds`);
        }
        const name = `${owner}.${elementLabel(index)}`;
        this.reduce(outer ?? node, { kind: "select", name });
        return name;
      }
      if (kind === "MemberExpr" && children.length === 1) {
        if (node.isArrow) {
          const [value, via] = this.rvalue(children[0]);
          if (via === null) {
            throw new Unsupported("arrow access requires a pointer variable");
          }
          const pointer = asPointer(value);
          if (pointer.target === null) {
            throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
          }
          this.checkPointeeType(children[0], pointer.target);
          const name = `${pointer.target}.${node.name}`;
          this.reduce(outer ?? node, { kind: "deref", name: via, value: new Pointer(name) });
          return name;
        }
        return `${this.lvalue(children[0])}.${node.name}`;
      }
      if (kind === "UnaryOperator" && node.opcode === "*" && children.length === 1) {
        const [value, via] = this.rvalue(children[0]);
        if (via === null) {
          throw new Unsupported("only dereferencing a pointer variable is supported, not a computed address");
        }
        const pointer = asPointer(value);
        if (pointer.target === null) {
          throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
        }
        this.checkPointeeType(children[0], pointer.target);
        this.reduce(outer ?? node, { kind: "deref", name: via, value: null });
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
          pointerDepth(node, this.records);
          const name = this.lvalue(children[0]);
          const value2 = this.load(name);
          this.reduce(node, { kind: "read", name, record: null });
          return [value2, name];
        }
        if (cast === "NullToPointer" && pointerDepth(node, this.records)) {
          const literal = children[0];
          if ((literal == null ? void 0 : literal.kind) === "CXXNullPtrLiteralExpr" || (literal == null ? void 0 : literal.kind) === "IntegerLiteral" && (literal == null ? void 0 : literal.value) === "0") {
            this.reduce(node, { kind: "eval", value: new Pointer(), record: null });
            return [new Pointer(), null];
          }
        }
        if (cast === "NoOp") {
          return this.rvalue(children[0]);
        }
        rejectPointerOperator(children[0]);
        if (cast === "IntegralCast" || cast === "IntegralToFloating" || cast === "FloatingToIntegral" || cast === "FloatingCast" || cast === "BitCast" && canonicalType(node) === "void *") {
          return [this.convert(node, children[0]), null];
        }
        throw new Unsupported(`implicit ${cast} conversions are outside this category`);
      }
      if (kind === "CXXStaticCastExpr" && children.length === 1) {
        let operand = children[0];
        while ((operand == null ? void 0 : operand.kind) === "ImplicitCastExpr" && (operand.castKind === "IntegralCast" || operand.castKind === "IntegralToFloating" || operand.castKind === "FloatingToIntegral" || operand.castKind === "FloatingCast" || operand.castKind === "NoOp" || operand.castKind === "BitCast" && canonicalType(operand) === "void *") && (operand.inner ?? []).length === 1) {
          operand = operand.inner[0];
        }
        return [this.convert(node, operand), null];
      }
      if (kind === "UnaryExprOrTypeTraitExpr" && node.name === "sizeof") {
        const target = node.argType ? { type: node.argType } : children[0];
        if (!target) throw new Unsupported("malformed sizeof expression");
        const size = this.byteSizeOf(target);
        this.reduce(node, { kind: "eval", value: size, record: null });
        return [size, null];
      }
      const access = this.arrayAccess(node);
      if ((access == null ? void 0 : access.member) && access.args.length === 0) {
        const { object, array, member } = access;
        if (member.name === "data" || member.name === "size") {
          const owner = this.arrayObject(object, member.isArrow);
          if (member.name === "size") {
            this.reduce(node, { kind: "eval", value: array.count, record: null });
            return [array.count, null];
          }
          const name = `${owner}.${elementLabel(0)}`;
          pointerDepth(node, this.records);
          this.reduce(node, { kind: "addr", name });
          return [new Pointer(name), null];
        }
      }
      const depth = pointerDepth(node, this.records);
      const record = !depth ? getRecord(this.records, recordName(node)) : null;
      if (record) {
        const array = arrayType(record.name);
        const displayRecord = array ? null : record.name;
        if (kind === "CXXFunctionalCastExpr" && children.length === 1) {
          const [value2] = this.rvalue(children[0]);
          this.absorb(children[0], value2);
          this.reduce(node, { kind: "eval", value: value2, record: displayRecord });
          return [value2, null];
        }
        if (kind === "InitListExpr") {
          const value2 = {};
          const storage = array ? children[0] : null;
          const elements = array ? ((_a = storage == null ? void 0 : storage.array_filler) == null ? void 0 : _a.slice(1)) ?? (storage == null ? void 0 : storage.inner) ?? [] : children;
          for (const [i, item] of record.fields.entries()) {
            const child = elements[i];
            if (!child || child.kind === "ImplicitValueInitExpr") {
              value2[item.name] = filled(item, this.records, true);
            } else {
              const [childVal] = this.rvalue(child);
              value2[item.name] = childVal;
              this.absorb(child, childVal);
            }
          }
          this.reduce(node, { kind: "eval", value: value2, record: null });
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
        if (kind === "DeclRefExpr" || kind === "MemberExpr" || access && !access.member || kind === "UnaryOperator" && node.opcode === "*") {
          const name = this.lvalue(node);
          const value2 = this.load(name);
          if (Object.values(flatten({ [name]: value2 })).some((item) => item === null)) {
            throw new Unsupported(`reading uninitialized struct ${name}`);
          }
          this.reduce(node, { kind: "read", name, record: displayRecord });
          return [value2, name];
        }
      }
      if (kind === "IntegerLiteral") {
        return [exact(BigInt(node.value ?? "0")), null];
      }
      if (kind === "FloatingLiteral") {
        const float = floatType(node, this.records);
        if (!float) throw new Unsupported(`unsupported floating literal type ${typeSpelling(node)}`);
        const value2 = float.round(Number(node.value ?? "0"));
        if (!Number.isFinite(value2)) throw new Unsupported("non-finite floating-point value");
        return [value2, null];
      }
      if (kind === "InitListExpr" || kind === "CXXFunctionalCastExpr") {
        return [this.braces(node, depth), null];
      }
      let value;
      if (kind === "ParenExpr" && children.length === 1) {
        [value] = this.rvalue(children[0]);
      } else if (kind === "UnaryOperator" && node.opcode === "&" && children.length === 1) {
        if (((_b = children[0]) == null ? void 0 : _b.kind) !== "DeclRefExpr" && ((_c = children[0]) == null ? void 0 : _c.kind) !== "MemberExpr" && !this.arrayAccess(stripParentheses(children[0]))) {
          throw new Unsupported("only the address of a variable is supported");
        }
        const name = this.lvalue(children[0]);
        this.reduce(node, { kind: "addr", name });
        return [new Pointer(name), null];
      } else if (kind === "UnaryOperator" && (node.opcode === "+" || node.opcode === "-") && children.length === 1 && !depth) {
        const float = floatType(node, this.records);
        if (float) {
          const operand = this.numericOperand(children[0]);
          value = float.round(node.opcode === "+" ? operand : -operand);
        } else {
          const operand = BigInt(this.integerOperand(children[0]));
          value = exact(integerTypeOf(node).result(node.opcode === "+" ? operand : -operand));
        }
      } else if (kind === "UnaryOperator" && node.opcode === "~" && children.length === 1 && !depth) {
        value = exact(integerTypeOf(node).wrap(~BigInt(this.integerOperand(children[0]))));
      } else if (kind === "BinaryOperator" && ["+", "-", "*", "/", "%"].includes(node.opcode ?? "") && children.length === 2) {
        rejectPointerOperator(node);
        value = this.operate(node, node.opcode, this.numericOperand(children[0]), this.numericOperand(children[1]));
      } else {
        throw new Unsupported(`unsupported expression: ${kind} ${(node == null ? void 0 : node.opcode) ?? ""}`.trimEnd());
      }
      this.reduce(node, { kind: "eval", value, record: null });
      return [value, null];
    }
    /** `left operation right`, both evaluated, in the integer or floating type of `node`. */
    operate(node, operation, left, right) {
      const float = floatType(node, this.records);
      if (float) return Evaluator.floatArithmetic(float, operation, left, right);
      if (!Number.isInteger(left) || !Number.isInteger(right)) {
        throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || "this type"}`);
      }
      return Evaluator.arithmetic(integerTypeOf(node), operation, left, right);
    }
    byteSizeOf(node) {
      if (pointerDepth(node, this.records) > 0) return POINTER_SIZE;
      const record = getRecord(this.records, recordName(node));
      if (record) return record.size;
      const int = integerType(node, this.records);
      if (int) return int.size;
      const float = floatType(node, this.records);
      if (float) return float.size;
      throw new Unsupported(`cannot determine size of ${typeSpelling(node)}`);
    }
    numericOperand(node) {
      const [value] = this.rvalue(node);
      if (typeof value !== "number") {
        throw new Unsupported("pointer arithmetic and comparison are not supported");
      }
      return value;
    }
    integerOperand(node) {
      const value = this.numericOperand(node);
      if (!Number.isInteger(value)) {
        throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || "this type"}`);
      }
      return value;
    }
    /** `operand` converted to the integer, float or pointer type of `node`, a cast written or implied. */
    convert(node, operand) {
      const depth = pointerDepth(node, this.records);
      const operandDepth = pointerDepth(operand, this.records);
      let value;
      if (depth > 0 && operandDepth > 0 && (canonicalType(node) === "void *" || canonicalType(operand) === "void *")) {
        const [ptr] = this.rvalue(operand);
        value = asPointer(ptr);
      } else {
        value = this.conversion(node, operand)(this.numericOperand(operand));
      }
      const source = displayedType(operand);
      if (source === displayedType(node)) {
        this.reduce(node, { kind: "eval", value, record: null });
      } else {
        this.reduce(node, { kind: "convert", value, source });
      }
      return value;
    }
    /** How a number of the type of `source` becomes one of the type of `node`. */
    conversion(node, source) {
      const targetInt = integerType(node, this.records);
      const targetFloat = floatType(node, this.records);
      const sourceInt = integerType(source, this.records);
      const sourceFloat = floatType(source, this.records);
      if (targetInt && sourceInt) {
        return (value) => exact(targetInt.wrap(BigInt(value)));
      }
      if (targetFloat && (sourceInt || sourceFloat)) {
        return (value) => {
          const rounded = targetFloat.round(value);
          if (!Number.isFinite(rounded)) throw new Unsupported("non-finite floating-point value");
          return rounded;
        };
      }
      if (targetInt && sourceFloat) {
        return (value) => {
          const truncated = Math.trunc(value);
          if (!Number.isFinite(truncated) || !targetInt.holds(BigInt(truncated))) {
            throw new Unsupported("floating-point conversion overflows integer type");
          }
          return exact(BigInt(truncated));
        };
      }
      throw new Unsupported("only conversions between integer types are supported");
    }
    braces(node, depth) {
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
      this.reduce(node, { kind: "eval", value, record: null });
      return value;
    }
    static floatArithmetic(type, operation, left, right) {
      let raw;
      if (operation === "+") raw = left + right;
      else if (operation === "-") raw = left - right;
      else if (operation === "*") raw = left * right;
      else if (operation === "/") raw = left / right;
      else throw new Unsupported(`only integer arithmetic is supported, not ${operation}`);
      const res = type.round(raw);
      if (!Number.isFinite(res)) {
        throw new Unsupported("undefined floating-point division");
      }
      return res;
    }
    static arithmetic(type, operation, left, right) {
      const l = BigInt(left);
      const r = BigInt(right);
      if (operation === "/" || operation === "%") {
        if (r === 0n || !type.holds(l / r)) {
          throw new Unsupported("undefined integer division");
        }
        return exact(operation === "/" ? l / r : l % r);
      }
      if (operation === "+") return exact(type.result(l + r));
      if (operation === "-") return exact(type.result(l - r));
      if (operation === "*") return exact(type.result(l * r));
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
      outputSuffix: outputSuffix2 = null,
      printed = null,
      temporary = false,
      bound = null,
      typed = [],
      slot = null,
      type = null,
      size = null,
      shape = null,
      fold = null
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
      __publicField(this, "outputSuffix");
      __publicField(this, "printed");
      __publicField(this, "temporary");
      __publicField(this, "bound");
      __publicField(this, "typed");
      __publicField(this, "slot");
      __publicField(this, "type");
      __publicField(this, "size");
      __publicField(this, "shape");
      __publicField(this, "fold");
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
      this.outputSuffix = outputSuffix2;
      this.printed = printed;
      this.temporary = temporary;
      this.bound = bound;
      this.typed = typed;
      this.slot = slot;
      this.type = type;
      this.size = size;
      this.shape = shape;
      this.fold = fold;
    }
  }
  function typedParts(node, locate, names, records) {
    var _a, _b;
    if (node.kind === "UnaryExprOrTypeTraitExpr") return [];
    let plain = node;
    while ((plain == null ? void 0 : plain.kind) === "MemberExpr" && !plain.isArrow && (plain.inner ?? []).length === 1) {
      plain = plain.inner[0];
    }
    const local = (plain == null ? void 0 : plain.kind) === "DeclRefExpr" && names.has(((_a = plain.referencedDecl) == null ? void 0 : _a.name) ?? "");
    const aggregate = (node.kind === "InitListExpr" || node.kind === "CXXFunctionalCastExpr") && hasRecord(records, recordName(node));
    if (local || aggregate || node.kind === "IntegerLiteral" || node.kind === "FloatingLiteral" || node.kind === "CXXNullPtrLiteralExpr") {
      return [[locate(node), displayedType(node)]];
    }
    const children = ((_b = node.array_filler) == null ? void 0 : _b.slice(1)) ?? node.inner ?? [];
    return children.flatMap((child) => typedParts(child, locate, names, records));
  }
  function compareTyped([a, at], [b, bt]) {
    return a[0] - b[0] || a[1] - b[1] || (at < bt ? -1 : at > bt ? 1 : 0);
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
  function recordPaths(prefix, rec, records, storageTypes) {
    for (const field2 of rec.fields) {
      const path = `${prefix}.${field2.name}`;
      if (field2.canonical) storageTypes[path] = field2.canonical;
      if (field2.kind === "struct" && field2.type && Object.hasOwn(records, field2.type)) {
        recordPaths(path, records[field2.type], records, storageTypes);
      }
    }
  }
  function analyzeStatement(node, program, state, records, references, storageTypes = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
    let cur = node;
    while ((cur == null ? void 0 : cur.kind) === "ExprWithCleanups" && (cur.inner ?? []).length === 1) {
      cur = cur.inner[0];
    }
    const [start, end] = bounds(cur);
    const terminated = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*;/.test(program.slice(end));
    const [compacted, mapping] = compact(program.slice(start, end));
    const source = terminated ? `${compacted};` : compacted;
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
    let size = null;
    let variable = null;
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
      variable = children[0];
      if ((variable.inner ?? []).some((child) => (child.kind ?? "").endsWith("Attr"))) {
        throw new Unsupported("declaration attributes need a separate memory-layout visualization");
      }
      const spelling = typeSpelling(variable);
      reference2 = spelling.endsWith("&");
      if (reference2) {
        if (spelling.endsWith("&&")) {
          throw new Unsupported("rvalue references are not supported");
        }
        const referred = Object.fromEntries(
          Object.entries(variable.type ?? {}).map(([key, text2]) => [key, text2.slice(0, -1).replace(/\s+$/, "")])
        );
        pointerDepth({ type: referred }, records);
      } else {
        pointer = pointerDepth(variable, records) > 0;
        size = pointer ? POINTER_SIZE : ((_c = integerType(variable, records) ?? floatType(variable, records)) == null ? void 0 : _c.size) ?? null;
      }
      const aggregate = recordName(variable);
      record = !reference2 && !pointer && Object.hasOwn(records, aggregate) ? aggregate : null;
      declared = variable.name ?? null;
      if (!declared || declared.startsWith("__course_") || Object.hasOwn(state, declared) || Object.hasOwn(references, declared)) {
        throw new Unsupported("unique variable names are required");
      }
      if (variable.storageClass || variable.constexpr) {
        throw new Unsupported("static and constexpr storage are outside this category");
      }
      if (!reference2 && declared) {
        if (record) {
          storageTypes[declared] = record;
          recordPaths(declared, records[record], records, storageTypes);
        } else {
          storageTypes[declared] = canonicalType(variable).replace(/^struct /, "");
        }
      }
      nameOffset = ((_d = variable.loc) == null ? void 0 : _d.offset) ?? null;
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
        const pane2 = source.replace(/;$/, "");
        return new Statement({
          source,
          span: null,
          pane: pane2,
          value: filled(records[record], records),
          target: declared,
          declared,
          record,
          slot: [0, pane2.length],
          type: displayedType(variable)
        });
      }
      if (record && root && root.kind === "CXXConstructExpr" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
      emptyInitializer = Boolean(root) && root.kind === "InitListExpr" && (!root.inner || root.inner.length === 0);
    } else if (cur.kind === "BinaryOperator" && cur.opcode === "=" || cur.kind === "CXXOperatorCallExpr" && (cur.inner ?? []).length === 3 && operatorName(cur) === "operator=" && Object.hasOwn(records, recordName(cur))) {
      const inner = cur.inner;
      left = inner[inner.length - 2];
      root = inner[inner.length - 1];
      pointerDepth(left, records);
      if (left.kind === "ParenExpr" && stripParentheses(left).kind === "DeclRefExpr") {
        throw new Unsupported("a parenthesized variable as assignment target is not supported");
      }
      whole = left.kind !== "DeclRefExpr" || Object.hasOwn(references, ((_e = left.referencedDecl) == null ? void 0 : _e.name) ?? "");
    } else if (cur.kind === "CompoundAssignOperator") {
      return analyzeCompound(cur, source, (offset) => mapping[offset - start], {
        state,
        records,
        references,
        storageTypes
      });
    } else if (cur.kind === "CXXOperatorCallExpr") {
      const operands = coutOperands(cur);
      if (operands.length === 0) {
        throw new Unsupported("empty output expression");
      }
      root = operands[0];
      outSuffix = outputSuffix(operands.slice(1));
      printed = whitespace(root);
      if (((_f = stripCasts(root)) == null ? void 0 : _f.kind) === "StringLiteral") {
        throw new Unsupported("string literal output is not supported");
      }
      if (root.kind === "ImplicitCastExpr" && (root.castKind === "BitCast" || root.castKind === "NoOp") && typeSpelling(root) === "const void *" && (root.inner ?? []).length === 1) {
        root = root.inner[0];
      }
    } else {
      throw new Unsupported(`unsupported statement: ${cur.kind}`);
    }
    if (root === null) {
      const pane2 = source.replace(/;$/, "").replace(/\s+$/, "");
      return new Statement({
        source,
        span: null,
        pane: pane2,
        target: declared,
        declared,
        pointer,
        slot: [0, pane2.length],
        type: displayedType(variable),
        size,
        shape: shapeOf(variable, records)
      });
    }
    const [first, last] = whole ? [start, bounds(cur)[1]] : bounds(root);
    const span = [mapping[first - start], mapping[last - start]];
    let [prefix, suffix] = paneParts(source, span, emptyInitializer);
    let removed = 0;
    if (record && arrayType(record)) {
      if (prefix.trimEnd().endsWith(declared)) prefix = prefix.trimEnd() + " = ";
      const name = mapping[nameOffset - start];
      if (name > 21) {
        removed = name;
        prefix = prefix.slice(removed);
      }
    }
    const text = source.slice(span[0], span[1]);
    const written = prefix + text + suffix;
    const braceSpaces = arrayType(canonicalType(root)) ? [...written.matchAll(new RegExp("(?<=\\{) +| +(?=\\})", "g"))] : [];
    const pane = braceSpaces.length ? written.replace(new RegExp("(?<=\\{) +| +(?=\\})", "g"), "") : written;
    function paneOffset(at) {
      return at - braceSpaces.reduce((total, space) => total + Math.max(0, Math.min(space[0].length, at - space.index)), 0);
    }
    function toPane(offset) {
      const position = mapping[offset - start];
      return paneOffset(position < span[0] ? position - removed : position - span[0] + prefix.length);
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
        pane,
        expr: [paneOffset(prefix.length), paneOffset(prefix.length + text.length)],
        result: locate(root),
        outputSuffix: outSuffix,
        printed
      });
    }
    const evaluator = new Evaluator(state, locate, records, references, storageTypes);
    const names = /* @__PURE__ */ new Set([...Object.keys(state), ...Object.keys(references)]);
    const typed = [
      ...left !== null ? typedParts(left, locate, names, records) : [],
      ...typedParts(root, locate, names, records)
    ].sort(compareTyped);
    if (reference2) {
      const bound = evaluator.lvalue(root);
      if (evaluator.temporary) {
        throw new Unsupported("a reference bound to a temporary is not supported");
      }
      return new Statement({
        source,
        span,
        pane,
        expr: [paneOffset(prefix.length), paneOffset(prefix.length + text.length)],
        result: locate(root),
        reductions: evaluator.reductions,
        declared,
        bound,
        destination: [toPane(nameOffset), toPane(nameOffset) + declared.length],
        typed,
        slot: [0, toPane(nameOffset) + declared.length],
        type: displayedType(variable)
      });
    }
    let target = declared;
    let destination = null;
    let designation = [];
    if (left !== null) {
      target = evaluator.lvalue(left);
      destination = locate(left);
      evaluator.respell(left, target, pane.slice(...destination));
      let renamed = 0;
      while (renamed < evaluator.reductions.length && evaluator.reductions[renamed].kind === "alias") {
        renamed++;
      }
      designation = evaluator.reductions.slice(renamed);
      evaluator.reductions = evaluator.reductions.slice(0, renamed);
    }
    const [value] = evaluator.rvalue(root);
    evaluator.reductions.push(...designation);
    let slot = null;
    if (declared) {
      destination = [toPane(nameOffset), toPane(nameOffset) + declared.length];
      slot = [0, destination[1]];
    } else if (left === null && isPlainObject(value)) {
      throw new Unsupported("only integer and pointer output is supported");
    } else if (left === null && ((_g = integerType(root)) == null ? void 0 : _g.size) === 1) {
      throw new Unsupported("std::cout prints a one-byte integer as a character");
    }
    return new Statement({
      source,
      span,
      pane,
      expr: [paneOffset(prefix.length), paneOffset(prefix.length + text.length)],
      result: locate(root),
      value,
      reductions: evaluator.reductions,
      target,
      destination,
      declared,
      pointer,
      record,
      outputSuffix: outSuffix,
      // Copies into arrays and their elements can use a short-lived RHS aggregate.
      temporary: evaluator.temporary && !(target == null ? void 0 : target.includes(".[")) && !arrayType(canonicalType(left)),
      typed,
      slot,
      type: declared ? displayedType(variable) : null,
      size,
      shape: shapeOf(declared ? variable : root, records)
    });
  }
  function analyzeCompound(node, source, toSource, context) {
    const { state, records, references, storageTypes } = context;
    const spelling = node.opcode;
    const operator = spelling.slice(0, -1);
    if (!COMPOUND_OPERATORS.includes(operator)) {
      throw new Unsupported(`unsupported compound assignment ${spelling}`);
    }
    const [left, right] = node.inner ?? [];
    if (!left || !right || pointerDepth(left, records) > 0) {
      throw new Unsupported("pointer arithmetic and comparison are not supported");
    }
    if (left.kind === "ParenExpr" && stripParentheses(left).kind === "DeclRefExpr") {
      throw new Unsupported("a parenthesized variable as assignment target is not supported");
    }
    const written = source.replace(/;$/, "").replace(/\s+$/, "");
    const [l0, l1] = bounds(left).map(toSource);
    const [r0] = bounds(right).map(toSource);
    const t0 = written.indexOf(spelling, l1);
    if (t0 < 0 || t0 + spelling.length > r0) {
      throw new Unsupported("macro-expanded statements are not supported");
    }
    const t1 = t0 + spelling.length;
    const copied = written.slice(l0, l1);
    const grouped = needsGroup(operator, right);
    const opened = openCompound(written, [t0, t1], copied, operator, grouped);
    const pane = opened.text;
    const toPane = (offset) => {
      const at = toSource(offset);
      return at >= opened.from ? at - opened.from + opened.right : at;
    };
    const locate = (item) => {
      const [b0, b1] = bounds(item);
      return [toPane(b0), toPane(b1)];
    };
    const copy = opened.left;
    const result = [copy[0], pane.length];
    const head = written.slice(0, t0).trimEnd().length;
    const fold = [
      [head, copy[0], written.slice(head, t0)],
      [copy[0], copy[1], spelling],
      [copy[1], opened.right, written.slice(t1, opened.from)],
      ...grouped ? [[pane.length - 1, pane.length, ""]] : []
    ];
    const evaluator = new Evaluator(state, locate, records, references, storageTypes);
    const names = /* @__PURE__ */ new Set([...Object.keys(state), ...Object.keys(references)]);
    const typed = [
      ...typedParts(left, locate, names, records),
      ...typedParts(right, locate, names, records)
    ].sort(compareTyped);
    const target = evaluator.lvalue(left);
    evaluator.respell(left, target, copied);
    const group = grouped ? [opened.right - 1, pane.length] : null;
    const value = evaluator.compound(node, target, copy, result, group);
    const [first, last] = bounds(node).map(toSource);
    return new Statement({
      source,
      span: [first, last],
      pane,
      fold,
      expr: result,
      result,
      value,
      reductions: evaluator.reductions,
      target,
      destination: locate(left),
      typed,
      shape: shapeOf(left, records)
    });
  }
  function needsGroup(operator, right) {
    let bare = right;
    while ((bare == null ? void 0 : bare.kind) === "ImplicitCastExpr" && (bare.inner ?? []).length === 1) bare = bare.inner[0];
    if ((bare == null ? void 0 : bare.kind) === "ConditionalOperator") return true;
    if ((bare == null ? void 0 : bare.kind) !== "BinaryOperator") return false;
    const tighter = ["*", "/", "%"].includes(bare.opcode ?? "") && (operator === "+" || operator === "-");
    return !tighter;
  }
  function storedAt(value, path, newValue) {
    if (path.length === 0) {
      return newValue;
    }
    const struct2 = value;
    return { ...struct2, [path[0]]: storedAt(fieldOf(struct2, path[0]), path.slice(1), newValue) };
  }
  function storeResult(statement, state) {
    const after = { ...state };
    if (statement.target !== null) {
      const [owner, ...path] = statement.target.split(".");
      after[owner] = storedAt(after[owner], path, statement.value);
    }
    return after;
  }
  const HEADERS = "#include <iostream>\n#include <cstdint>\n";
  const MAIN = "using namespace std;\nint main() {\n";
  function arrayHeader(source, frontend) {
    return /\barray\b/.test(source) ? (frontend == null ? void 0 : frontend.arrayPreamble) ?? "#include <array>\n" : "";
  }
  function preamble(source, frontend) {
    return HEADERS + arrayHeader(source, frontend) + MAIN;
  }
  const AKA = String.raw`(?: \(aka '[^']+'\))?`;
  const MISMATCHES = [
    String.raw`cannot initialize a variable of type '(?<to>[^']+)'${AKA} with an? \w+ of type '(?<from>[^']+)'`,
    String.raw`assigning to '(?<to>[^']+)'${AKA} from (?:incompatible type )?'(?<from>[^']+)'`,
    String.raw`no viable conversion from '(?<from>[^']+)'${AKA} to '(?<to>[^']+)'`,
    // A struct on the left: overload resolution fails, and the note names the types.
    String.raw`no viable overloaded '='; note: .*?no known conversion from '(?<from>[^']+)'${AKA} ` + String.raw`to '(?:const )?(?<to>[^'&]+?)(?: &)?' for 1st argument`
  ].map((pattern) => new RegExp(pattern));
  function lastBefore(text, character, end) {
    return end > 0 ? text.lastIndexOf(character, end - 1) : -1;
  }
  const leading = (text) => text.length - text.trimStart().length;
  function cutMismatch(body, error, prefixLength) {
    var _a;
    const found = (_a = MISMATCHES.map((pattern) => pattern.exec(error.message)).find(Boolean)) == null ? void 0 : _a.groups;
    let at = error.offset === null ? -1 : error.offset - prefixLength;
    if (!found || at < 0 || at >= body.length) throw error;
    const end = body.indexOf(";", at);
    let start = Math.max(lastBefore(body, ";", at), lastBefore(body, "}", at)) + 1;
    if (end < 0 || !/^\s*(?:return\s+0\s*;\s*)?$/.test(body.slice(end + 1)) || !body.slice(0, start).trim()) {
      throw error;
    }
    start += leading(body.slice(start, at));
    if (/^=(?!=)/.test(body.slice(at, end))) {
      at += 1 + leading(body.slice(at + 1, end));
    } else if (!/[={]$/.test(body.slice(start, at).trimEnd())) {
      const assigned = /^\w+\s*=\s*/.exec(body.slice(at, end));
      if (!assigned) throw error;
      at += assigned[0].length;
    }
    const [source, mapping] = compact(body.slice(start, end + 1));
    const braced = body.slice(start, at).trimEnd().endsWith("{");
    const written = body.slice(at, end).trimEnd();
    const valueEnd = braced ? written.replace(/\}$/, "").trimEnd() : written;
    const span = [mapping[at - start], mapping[at - start + valueEnd.length]];
    const [prefix, suffix] = paneParts(source, span, false);
    const slot = prefix.trimEnd().replace(/=$/, "").trimEnd();
    if (suffix.trim() || !slot || source.includes('"') || source.includes("'")) throw error;
    const text = source.slice(span[0], span[1]);
    return [
      body.slice(0, start),
      {
        source,
        span,
        pane: prefix + text,
        slot: [0, slot.length],
        value: [prefix.length, prefix.length + text.length],
        needed: displayed(found.to),
        given: displayed(found.from)
      }
    ];
  }
  function integerAliases(node, found = {}) {
    if (node.type) {
      const name = bareSpelling(displayedType(node));
      const canonical = bareSpelling(canonicalType(node));
      if (!integerSpelled(name) && Object.hasOwn(INTEGERS, canonical)) found[name] = canonical;
    }
    for (const child of node.inner ?? []) {
      if (child) integerAliases(child, found);
    }
    return found;
  }
  function analyzeWithFrontend(source, frontend) {
    var _a, _b;
    const program = preamble(source, frontend) + source + "\n}\n";
    const ast = frontend.mainAst(program);
    resolveArrayAliases(ast);
    const records = layoutsFromFrontend(ast, program, frontend);
    const statements = [];
    let state = {};
    const references = {};
    const storageTypes = {};
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
      const statement = analyzeStatement(node, program, state, records, references, storageTypes);
      if (statement.declared && statements.some((earlier) => earlier.temporary)) {
        throw new Unsupported(
          "a declaration after a materialized temporary needs a separate memory-layout visualization"
        );
      }
      statements.push(statement);
      if (statements.length > MAX_STATEMENTS) {
        throw new Unsupported("too many statements");
      }
      state = hooks.after(statement, state);
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
    return [statements, records, integerAliases(ast)];
  }
  function floorDiv(a, b) {
    return Math.floor(a / b);
  }
  function pyMod(a, b) {
    return (a % b + b) % b;
  }
  function normalizeAddresses(addresses2, sizes) {
    const alignment = Math.max(...Object.values(sizes));
    const lowest = Math.min(...Object.values(addresses2));
    const base = lowest - pyMod(lowest, alignment);
    const result = {};
    for (const [name, address] of Object.entries(addresses2)) {
      result[name] = FIRST_ADDRESS + address - base;
    }
    return result;
  }
  function withoutHiddenSlots(real, variables) {
    const packed = addresses(variables);
    const names = variables.map((v) => v.name);
    const sortedReal = [...names].sort((a, b) => real[a] - real[b]);
    const sortedPacked = [...names].sort((a, b) => packed[a] - packed[b]);
    return sortedReal.every((n, i) => n === sortedPacked[i]) ? packed : null;
  }
  function observeExecution(execution, predicted, variables, references) {
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
          const base = cell.objectAddress;
          if (!Object.hasOwn(addresses$1, owner)) {
            addresses$1[owner] = base;
          }
          if (cell.objectSize !== owners[owner].size || cell.address !== base + offset || addresses$1[owner] !== base) {
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
        const refTarget = references[name];
        if (cell.address !== addresses$1[refTarget]) {
          throw new Unsupported(`runtime verification failed: the reference ${name} disagrees`);
        }
      }
    }
    for (let i = 0; i < checkpoints.length; i++) {
      const row = checkpoints[i];
      const expected = flatten(predicted[i]);
      const rowKeys = Object.keys(row).sort();
      const expKeys = Object.keys(expected).sort();
      if (rowKeys.length !== expKeys.length || rowKeys.some((k, idx) => k !== expKeys[idx])) {
        throw new Unsupported("runtime verification failed: incomplete frame");
      }
      const addrValues = new Set(Object.values(addresses$1));
      for (const [name, value] of Object.entries(expected)) {
        const bits = value instanceof Pointer ? value.target ? addresses$1[value.target] : 0 : value;
        if (row[name].value !== bits || bits === 0 && !Object.is(row[name].value, bits)) {
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
    constructor(text, typed = [], slot = null, fold = null) {
      __publicField(this, "original");
      __publicField(this, "edits");
      // The typed parts, in original coordinates; `slot` is one of them.
      __publicField(this, "typed");
      __publicField(this, "slot");
      __publicField(this, "fold");
      this.fold = fold ?? [];
      this.edits = this.fold.map((edit) => [...edit]);
      this.original = text;
      this.typed = [...typed];
      this.slot = slot;
    }
    /**
     * Show the original text the fold hid, with `[start, end)` replaced; returns the span that
     * `[start, end)` covered in the folded text.
     */
    unfold(start, end, newText, type) {
      const span = this.locate(start, end);
      this.edits = this.edits.filter((edit) => !this.fold.some(([s, e]) => s === edit[0] && e === edit[1]));
      this.fold = [];
      this.replace(start, end, newText, type);
      return span;
    }
    /** The typed parts of the current text, in order. */
    get types() {
      return [...this.typed].sort(compareTyped).map(([[start, end], type]) => {
        const part = { span: this.locate(start, end), type };
        if (this.slot && this.slot[0] === start && this.slot[1] === end) part.slot = true;
        return part;
      });
    }
    /** Whether `[start, end)` lies strictly inside one of the pane's typed parts. */
    insideTyped(start, end) {
      const same = ([begin, finish]) => begin === start && finish === end;
      return this.typed.some(([span]) => span[0] <= start && end <= span[1] && !same(span));
    }
    /**
     * The original `[start, end)` is now one value of `type`: its parts are no longer. Inside a
     * typed part (the `rs` of `rs.f`) nothing changes: the part keeps its type.
     */
    retype(start, end, type) {
      var _a;
      const same = ([begin, finish]) => begin === start && finish === end;
      if (this.insideTyped(start, end)) return;
      const kept = type || ((_a = this.typed.find(([span]) => same(span))) == null ? void 0 : _a[1]);
      this.typed = this.typed.filter(([span]) => !(start <= span[0] && span[1] <= end));
      if (kept) this.typed.push([[start, end], kept]);
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
    /**
     * Replace the original `[start, end)`; returns the span it covered in the old text. The new
     * text has `type`, or keeps the type the span had as a whole.
     */
    replace(start, end, newText, type = null) {
      const span = this.locate(start, end);
      this.retype(start, end, type);
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
    constructor(addresses2, cells = null, real = null, hasReferences = false, types = false) {
      __publicField(this, "addresses");
      // Types are drawn only where an example asks for them: elsewhere they are noise.
      __publicField(this, "types");
      __publicField(this, "refs");
      __publicField(this, "order");
      __publicField(this, "steps");
      __publicField(this, "stdout");
      __publicField(this, "real");
      __publicField(this, "realStdout");
      this.addresses = addresses2;
      this.types = types;
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
    show(value, shape) {
      if (isPlainObject(value)) {
        const fields = shape !== null && typeof shape === "object" ? shape : {};
        return `{${Object.entries(value).map(([field2, item]) => this.show(item, fields[field2] ?? null)).join(", ")}}`;
      }
      return displayNumber(this.stored(value), typeof shape === "number" ? shape : null);
    }
    stored(value) {
      if (value instanceof Pointer) {
        return value.target ? this.addresses[value.target] : 0;
      }
      if (typeof value !== "number") throw new Error("only an integer or a pointer is stored in a cell");
      return value;
    }
    add(line, pane, expr, state, op = null, hold = 1) {
      const flat = flatten(state);
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
      this.retyped(step, pane);
      if (this.refs !== null) {
        step.refs = { ...this.refs };
      }
      this.steps.push(step);
    }
    /** Give a step the pane's types, in a trace that shows them. */
    retyped(step, pane) {
      const types = this.types ? pane.types : [];
      if (types.length) step.types = types;
      else delete step.types;
    }
    statement(line, statement, before, after) {
      const typed = statement.slot ? [...statement.typed, [statement.slot, statement.type]] : statement.typed;
      const pane = new Pane(statement.pane, typed, statement.slot, statement.fold);
      const expr = statement.expr;
      const writes = statement.target !== null && statement.result !== null;
      this.add(line, pane, expr, writes ? before : after);
      for (const reduction of statement.reductions) {
        let text2;
        let op2;
        if (reduction.kind === "read" && reduction.compound) {
          text2 = this.show(load(before, reduction.name), reduction.shape);
          const [start, end] = reduction.span;
          const span2 = pane.unfold(start, end, text2, reduction.type);
          const op3 = { kind: "read", name: reduction.name, value: text2, compound: reduction.compound };
          this.add(line, pane, expr, before, { ...op3, span: span2 });
          continue;
        }
        if (reduction.kind === "read") {
          text2 = (reduction.record ?? "") + this.show(load(before, reduction.name), reduction.shape);
          op2 = { kind: "read", name: reduction.name, value: text2 };
        } else if (reduction.kind === "addr") {
          text2 = String(this.addresses[reduction.name]);
          op2 = { kind: "addr", name: reduction.name, value: text2 };
        } else if (reduction.kind === "alias") {
          text2 = codeName(reduction.target);
          op2 = { kind: "alias", name: reduction.name, target: reduction.target };
        } else if (reduction.kind === "select") {
          text2 = codeName(reduction.name);
          op2 = { kind: "eval", value: text2 };
        } else if (reduction.kind === "deref") {
          const target = (reduction.value ?? asPointer(load(before, reduction.name))).target;
          text2 = codeName(target);
          op2 = { kind: "deref", target, via: reduction.name };
        } else if (reduction.kind === "convert" && this.types && !pane.insideTyped(reduction.span[0], reduction.span[1])) {
          text2 = this.show(reduction.value, reduction.shape);
          op2 = { kind: "convert", value: text2, from: reduction.source, to: reduction.type };
        } else {
          text2 = (reduction.kind === "eval" ? reduction.record ?? "" : "") + this.show(reduction.value, reduction.shape);
          op2 = { kind: "eval", value: text2 };
          if (isPlainObject(reduction.value) && spaceless(pane.read(reduction.span[0], reduction.span[1])) === spaceless(text2)) {
            text2 = pane.read(reduction.span[0], reduction.span[1]);
          }
        }
        if (pane.read(reduction.span[0], reduction.span[1]) !== text2 || op2.kind === "convert") {
          const span2 = pane.replace(reduction.span[0], reduction.span[1], text2, reduction.type);
          this.add(line, pane, expr, before, { ...op2, span: span2 });
        } else {
          pane.retype(reduction.span[0], reduction.span[1], reduction.type);
          this.retyped(this.steps[this.steps.length - 1], pane);
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
      if (typeof statement.value === "number") {
        const shown = statement.outputSuffix !== null && typeof statement.shape === "number" ? formatFloat(statement.value) : this.show(statement.value, statement.shape);
        if (pane.read(statement.result[0], statement.result[1]) !== shown) {
          const op2 = {
            kind: "eval",
            value: shown,
            span: pane.replace(statement.result[0], statement.result[1], shown)
          };
          this.add(line, pane, expr, before, op2);
        }
      }
      let span = pane.locate(statement.result[0], statement.result[1]);
      let text = pane.read(statement.result[0], statement.result[1]);
      let real = text;
      if (statement.printed !== null) {
        real = text = statement.printed;
      } else if (statement.outputSuffix !== null && statement.value instanceof Pointer) {
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
      if (statement.outputSuffix !== null) {
        this.realStdout += real + statement.outputSuffix;
        this.stdout += text + statement.outputSuffix;
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
    /** The statement as written, then its value's type against the type its slot needs. */
    mismatch(line, mismatch, state) {
      const typed = [
        [mismatch.slot, mismatch.needed],
        [mismatch.value, mismatch.given]
      ];
      const pane = new Pane(mismatch.pane, typed, mismatch.slot);
      this.add(line, pane, mismatch.value, state);
      const op = {
        kind: "clash",
        span: [...mismatch.value],
        destination: [...mismatch.slot],
        from: mismatch.given,
        to: mismatch.needed
      };
      this.add(line, pane, mismatch.value, state, op);
    }
  }
  function tracesWithTypes(source, options, error) {
    var _a;
    if (!MISMATCHES.some((pattern) => pattern.test(error.message))) return false;
    try {
      const traced = traceWithFrontend(source, { ...options, types: true, runtime: false });
      (_a = options.accept) == null ? void 0 : _a.call(options, traced);
      return true;
    } catch {
      return false;
    }
  }
  function traceWithFrontend(source, options) {
    const { runtime = true, bits = false, frontend, executor = hooks.execute, directory } = options;
    const types = bits || (options.types ?? false);
    let body = snippetBody(source);
    let mismatch = null;
    let statements;
    let records;
    let aliases;
    try {
      [statements, records, aliases] = analyzeWithFrontend(body, frontend);
    } catch (error) {
      if (!(error instanceof IllFormed)) throw error;
      if (!types) {
        throw tracesWithTypes(source, options, error) ? new NeedsFlag(error.message, "types", error.offset) : error;
      }
      [body, mismatch] = cutMismatch(body, error, preamble(body, frontend).length);
      [statements, records, aliases] = analyzeWithFrontend(body, frontend);
    }
    const predicted = [];
    let state = {};
    for (const statement of statements) {
      state = hooks.after(statement, state);
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
      const size = record ? record.size : declaration.size;
      const alignment2 = record ? record.alignment : size;
      top = floorDiv(top - size, alignment2) * alignment2;
      if (record) {
        const fieldsOf = (rec, prefix) => {
          const flds = [];
          for (const item of rec.fields) {
            const path = `${prefix}.${item.name}`;
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
                  fieldsOf(records[item.type], path),
                  shade
                )
              );
            } else {
              flds.push(field(item.name, item.offset, item.size, item.kind, shade, Boolean(item.floating)));
            }
          }
          return flds;
        };
        variables.push(struct(name, record.name, top, size, fieldsOf(record, name), color));
      } else {
        variables.push(
          scalar(
            name,
            top,
            size,
            declaration.pointer ? "ptr" : "int",
            color,
            types ? declaration.type : null,
            typeof declaration.shape === "number"
          )
        );
      }
    }
    if (bits && (Object.keys(references).length > 0 || variables.some((v) => v.kind !== "int" || !integerSpelled(v.type ?? "", aliases)))) {
      throw new Unsupported("bits draw integer variables only");
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
          ...Object.entries(flatten(row)).map(([name, value]) => [name, value !== null]),
          ...Object.keys(bound).map((name) => [name, REFERENCE])
        ]);
      }
      execution = executor(
        statements.map((s) => s.source),
        scopes,
        directory
      );
      [addresses$1, states] = observeExecution(execution, predicted, variables, bound);
    } else {
      addresses$1 = addresses(variables);
      states = predicted;
    }
    const real = addresses$1;
    const packed = withoutHiddenSlots(real, variables);
    if (Object.keys(references).length > 0) {
      if (!packed) {
        throw new Unsupported("runtime order of the variables disagrees with their declarations");
      }
      addresses$1 = packed;
    } else if (packed && !contiguous(variables.map((v) => ({ address: real[v.name], size: v.size })))) {
      addresses$1 = packed;
    }
    const alignment = Math.max(
      ...Object.values(records).map((r) => r.alignment),
      ...declarations.filter((d) => !d.record && !d.bound).map((d) => d.size),
      4
    );
    addresses$1 = normalizeAddresses(addresses$1, { ABI: alignment });
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
    const renderer = new Renderer(addresses$1, leaves(variables), real, hasRefs, types);
    let previous = {};
    for (let line = 0; line < shown.length; line++) {
      const [statement, after] = shown[line];
      renderer.statement(line, statement, previous, after);
      previous = after;
    }
    if (runtime && execution && renderer.realStdout !== execution.stdout) {
      throw new Unsupported("runtime output disagrees with the expression trace");
    }
    const shownStatements = shown.map(([s]) => s);
    if (mismatch) {
      renderer.mismatch(shownStatements.length, mismatch, previous);
      shownStatements.push(mismatch);
    }
    renderer.steps[renderer.steps.length - 1].hold = 3;
    const result = {
      format: FORMAT,
      source: shownStatements.map((s) => s.source),
      spans: shownStatements.map((s) => s.span ? [...s.span] : null),
      variables,
      steps: renderer.steps
    };
    const structs = definitions(body);
    if (Object.keys(structs).length > 0) {
      result.types = structs;
    }
    if (hasRefs) {
      result.references = Object.values(references);
    }
    if (bits) {
      result.bits = true;
      const spelled = new Set(
        [
          ...variables.map((v) => v.kind === "int" ? v.type : void 0),
          ...renderer.steps.flatMap((step) => {
            var _a;
            return [
              ...(step.types ?? []).map((part) => part.type),
              ...((_a = step.op) == null ? void 0 : _a.kind) === "convert" ? [step.op.from, step.op.to] : []
            ];
          })
        ].filter((type) => Boolean(type)).map(bareSpelling)
      );
      const used = Object.entries(aliases).filter(([name]) => spelled.has(name));
      if (used.length > 0) result.integers = Object.fromEntries(used);
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
    const body = snippetBody(source);
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
  function enabledFlags(flags) {
    return FLAG_NAMES.filter((flag) => flags[flag]);
  }
  function parseSettings(template, flags) {
    const chosen = template ?? DEFAULT_TEMPLATE;
    if (!isTemplate(chosen)) {
      throw new Unsupported(`unknown template '${chosen}'`);
    }
    const parsed = {};
    for (const flag of flags) {
      if (!isFlag(flag)) {
        throw new Unsupported(`unknown flag '${flag}'`);
      }
      if (!takesFlag(chosen, flag)) {
        throw new Unsupported(`the ${chosen} template does not take '${flag}'`);
      }
      parsed[flag] = true;
    }
    return { template: chosen, flags: parsed };
  }
  function checkSettings(settings) {
    return parseSettings(settings.template, enabledFlags(settings.flags));
  }
  function traceSnippet(source, settings, context) {
    const { template, flags } = checkSettings(settings);
    const traces = {
      layout: () => traceLayout(source, context.frontend),
      "expression-timeline": () => traceWithFrontend(source, { ...context, ...flags })
    };
    return traces[template]();
  }
  const ARRAY_PREAMBLE = `
namespace std {
template<class T, size_t N> struct array {
  using value_type = T;
  using size_type = size_t;
  using pointer = T*;
  using const_pointer = const T*;
  using reference = T&;
  using const_reference = const T&;
  T elements[N];
  constexpr reference operator[](size_type i) noexcept { return elements[i]; }
  constexpr const_reference operator[](size_type i) const noexcept { return elements[i]; }
  constexpr pointer data() noexcept { return elements; }
  constexpr const_pointer data() const noexcept { return elements; }
  constexpr size_type size() const noexcept { return N; }
};
template<class T> struct array<T, 0> {};
template<class T, class... U> requires (__is_same(T, U) && ...)
array(T, U...) -> array<T, 1 + sizeof...(U)>;
}
`;
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
      arrayPreamble: ARRAY_PREAMBLE,
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
          throw illFormed(result.stderr, program);
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
  function traceWithWasmModule(source, module, settings) {
    return traceSnippet(source, settings, { runtime: false, frontend: createWasmClangFrontend(module) });
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
        const trace = traceWithWasmModule(request.source, module, request.settings);
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
      const error = err instanceof Error ? {
        name: err.name || "Error",
        message: err.message,
        ...err instanceof NeedsFlag ? { flag: err.flag, diagnostic: err.diagnostic } : {}
      } : { name: "Error", message: String(err) };
      workerSelf.postMessage({ id: request.id, type: "error", error });
    }
  }
  workerSelf.addEventListener("message", (event) => {
    const request = event.data;
    queue = queue.then(() => handleRequest(request));
  });
})();
