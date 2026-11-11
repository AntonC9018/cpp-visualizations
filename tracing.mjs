// Compiler-backed execution traces of flat int, pointer and aggregate struct examples.
//
// Clang supplies syntax, types and record layouts. A strict AST whitelist predicts each
// statement's effects without executing arbitrary C++. GDB verifies every live scalar and
// struct field after every statement, including unchanged memory. Only verified states become
// unified-format reductions; addresses are normalized deterministically near 64.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Cell, Execution, REFERENCE, execute as defaultExecute } from './execution.mjs';
import { layouts, typeName, typeSpelling } from './records.mjs';
import { Unsupported, run, tool } from './toolchain.mjs';
import {
  FORMAT,
  FormatError,
  UNKNOWN,
  addresses as storageAddresses,
  field as traceField,
  leaves,
  reference as traceReference,
  scalar,
  struct,
  structField,
  validate,
  whitespaceOutput,
} from './trace_format.mjs';

export { Unsupported };

export const hooks = {
  execute: defaultExecute,
  after: null,
};

const MIN_INT = -(2 ** 31);
const MAX_INT = 2 ** 31 - 1;
const FIRST_ADDRESS = 64;
const INT_SIZE = 4;
const POINTER_SIZE = 8;
const MAX_STATEMENTS = 20;
const MAX_VARIABLES = 8;
const QUOTED_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Values -----------------------------------------------------------------------------------

export class Pointer {
  constructor(target = null) {
    this.target = target;
    Object.freeze(this);
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Pointer);
}

function integer(value) {
  if (typeof value === 'bigint') {
    if (value < BigInt(MIN_INT) || value > BigInt(MAX_INT)) {
      throw new Unsupported('signed integer overflow is outside the timeline category');
    }
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < MIN_INT || value > MAX_INT) {
    throw new Unsupported('signed integer overflow is outside the timeline category');
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
  if (!records || Array.isArray(records) || records instanceof Set) return undefined;
  return Object.hasOwn(records, name) ? records[name] : undefined;
}

export function _depth(node, records = {}) {
  const qualified = typeSpelling(node);
  const intMatch = /^(const )?int(?: (\*+))?$/.exec(qualified);
  if (intMatch && !(intMatch[1] && intMatch[2])) {
    return (intMatch[2] || '').length;
  }
  const recordType = typeName(node);
  if (hasRecord(records, recordType)) {
    return 0;
  }
  const recPtrMatch = /^(\w+) (\*+)$/.exec(qualified);
  if (recPtrMatch && hasRecord(records, recPtrMatch[1])) {
    return recPtrMatch[2].length;
  }
  if (qualified.includes('&')) {
    throw new Unsupported('references are not supported');
  }
  if (qualified.includes('[')) {
    throw new Unsupported('arrays are not supported');
  }
  if (qualified.includes('*')) {
    throw new Unsupported(`only pointers to int are supported, not ${qualified}`);
  }
  throw new Unsupported(`only int and pointer values are supported, not ${qualified || 'this type'}`);
}

// Source text ------------------------------------------------------------------------------

function isAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

export function _body(source) {
  let cleaned = source.replace(QUOTED_OR_COMMENT, value => {
    if (value.startsWith('//') || value.startsWith('/*')) {
      const newlines = (value.match(/\n/g) || []).length;
      return '\n'.repeat(newlines) + ' ';
    }
    return value;
  });
  for (const line of cleaned.split(/\r?\n/)) {
    if (
      line.trimStart().startsWith('#') &&
      !/^\s*#\s*include\s*[<"][\w./]+[>"]\s*$/.test(line)
    ) {
      throw new Unsupported('only ordinary include directives are supported');
    }
  }
  cleaned = cleaned.replace(/^\s*#\s*include[^\n]*/gm, '').trim();
  cleaned = cleaned.replace(/^using\s+namespace\s+std\s*;\s*/, '');
  if (/\bmain\s*\(/.test(cleaned)) {
    const match = /^([\s\S]*?)int\s+main\s*\(\s*(?:void\s*)?\)\s*\{([\s\S]*)\}\s*$/.exec(cleaned);
    if (!match) {
      throw new Unsupported('only a standalone parameterless main or statement fragment is supported');
    }
    if (match[1].replace(/\bstruct\s+\w+\s*\{[^{}]*\}\s*;/g, '').trim()) {
      throw new Unsupported('only struct definitions may precede main');
    }
    cleaned = (match[1] + match[2]).trim();
  }
  if (!cleaned || cleaned.length > 10_000) {
    throw new Unsupported('empty or oversized snippet');
  }
  if (!isAscii(cleaned)) {
    throw new Unsupported('non-ASCII source text is not supported');
  }
  return cleaned;
}

const DEFINITION = /^struct\s+\w+\s*[{;]/;
const DEFINITION_TEXT = /^([ \t]*)(struct\s+(\w+)\s*\{[^{}]*\}\s*;)/gm;

function dedent(text) {
  const lines = text.split('\n');
  let margin = null;
  for (const line of lines) {
    const stripped = line.replace(/^[ \t]+/, '');
    if (!stripped) continue;
    const indent = line.slice(0, line.length - stripped.length);
    if (margin === null) {
      margin = indent;
    } else if (indent.startsWith(margin)) {
      // margin is prefix
    } else if (margin.startsWith(indent)) {
      margin = indent;
    } else {
      let i = 0;
      while (i < margin.length && i < indent.length && margin[i] === indent[i]) i++;
      margin = margin.slice(0, i);
    }
  }
  if (!margin) return text;
  return lines.map(line => (line.startsWith(margin) ? line.slice(margin.length) : line.replace(/^[ \t]+$/, ''))).join('\n');
}

function definitions(body) {
  const result = {};
  for (const match of body.matchAll(DEFINITION_TEXT)) {
    result[match[3]] = dedent(match[1] + match[2]);
  }
  return result;
}

function bounds(node) {
  const first = node?.range?.begin;
  const last = node?.range?.end;
  if (
    !first ||
    !last ||
    typeof first.offset !== 'number' ||
    typeof last.offset !== 'number' ||
    typeof last.tokLen !== 'number'
  ) {
    throw new Unsupported('macro-expanded or implicit source ranges are not supported');
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
    let replacement;
    if (isSpace) {
      replacement = out.length > 0 && out[out.length - 1] !== ' ' ? ' ' : '';
    } else {
      replacement = token;
    }
    for (let offset = start; offset < end; offset++) {
      mapping[offset] =
        index + (!isSpace ? Math.min(offset - start, replacement.length) : 0);
    }
    out.push(replacement);
    index += replacement.length;
    mapping[end] = index;
  }
  return [out.join('').replace(/\s+$/, ''), mapping];
}

function parseLeadingJson(text, startOffset) {
  let i = startOffset;
  const n = text.length;
  while (i < n && /\s/.test(text[i])) i++;
  if (i >= n) return null;
  const start = i;
  if (text[i] !== '{' && text[i] !== '[') {
    throw new Error('Expected JSON object or array');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < n; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
  }
  if (depth !== 0 || inString) {
    throw new Error('Unterminated JSON value');
  }
  return [JSON.parse(text.slice(start, i)), i];
}

export function _main_ast(program, directory) {
  const path = join(directory, 'source.cpp');
  writeFileSync(path, program);
  const result = run([
    tool('CLANGXX', 'clang++'),
    '-std=c++20',
    '-fsyntax-only',
    '-fno-color-diagnostics',
    '-Xclang',
    '-ast-dump=json',
    '-Xclang',
    '-ast-dump-filter=main',
    path,
  ]);
  if (result.returncode) {
    const line =
      result.stderr.split(/\r?\n/).find(l => l.includes('error:')) || 'error: ill-formed C++';
    throw new Unsupported(line.slice(line.indexOf('error:')));
  }
  const selected = [];
  let offset = 0;
  try {
    while (offset < result.stdout.length) {
      const parsed = parseLeadingJson(result.stdout, offset);
      if (!parsed) break;
      const [node, nextOffset] = parsed;
      offset = nextOffset;
      if (node.kind === 'FunctionDecl' && node.name === 'main') {
        selected.push(node);
      }
    }
  } catch (exc) {
    throw new Unsupported('Clang returned invalid AST JSON');
  }
  if (selected.length !== 1) {
    throw new Unsupported('expected one main function');
  }
  const compound = (selected[0].inner ?? []).filter(node => node.kind === 'CompoundStmt');
  if (compound.length !== 1) {
    throw new Unsupported('main has no supported body');
  }
  if (bounds(compound[0])[1] !== program.lastIndexOf('}') + 1) {
    throw new Unsupported('declarations outside main are unsupported');
  }
  return compound[0];
}

// Evaluation -------------------------------------------------------------------------------

export class Reduction {
  constructor(kind, span, { name = null, value = null, spelling = null, record = null } = {}) {
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
  const [owner, ...path] = name.split('.');
  if (!missing && !Object.hasOwn(state, owner)) {
    throw new Error(`KeyError: ${owner}`);
  }
  let value = state[owner];
  for (const member of path) {
    value = value[member];
  }
  return value;
}

export function _flatten(state) {
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
  const record =
    item && Array.isArray(item.fields)
      ? item
      : item?.kind === 'struct'
        ? records[item.type]
        : null;
  if (record) {
    const res = {};
    for (const inner of record.fields) {
      res[inner.name] = filled(inner, records, zero);
    }
    return res;
  }
  return !zero ? null : item.kind === 'ptr' ? new Pointer() : 0;
}

function operandIsPointer(node) {
  return (node?.type?.qualType ?? '').includes('*');
}

function rejectPointerOperator(node) {
  if (
    node?.kind === 'BinaryOperator' &&
    (operandIsPointer(node) || (node.inner ?? []).some(operandIsPointer))
  ) {
    throw new Unsupported('pointer arithmetic and comparison are not supported');
  }
}

class Evaluator {
  constructor(state, locate, records, references = {}) {
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
    if (value === null || value === undefined) {
      throw new Unsupported(`reading uninitialized variable ${name}`);
    }
    return value;
  }

  variable(node) {
    const declaration = node?.referencedDecl ?? {};
    const name = declaration.name;
    if (
      node?.kind === 'DeclRefExpr' &&
      declaration.kind === 'VarDecl' &&
      Object.hasOwn(this.references, name)
    ) {
      this._reduce('alias', node, { name, spelling: this.references[name] });
      return this.references[name];
    }
    if (
      node?.kind !== 'DeclRefExpr' ||
      declaration.kind !== 'VarDecl' ||
      !Object.hasOwn(this.state, name)
    ) {
      throw new Unsupported('expression references an undeclared or nonlocal variable');
    }
    return name;
  }

  lvalue(node, outer = null) {
    const kind = node?.kind;
    const children = node?.inner ?? [];
    if (kind === 'ParenExpr' && children.length === 1) {
      return this.lvalue(children[0], outer ?? node);
    }
    if (kind === 'DeclRefExpr') {
      return this.variable(node);
    }
    if (kind === 'MemberExpr' && children.length === 1) {
      if (node.isArrow) {
        const [pointer, via] = this.rvalue(children[0]);
        if (via === null) {
          throw new Unsupported('arrow access requires a pointer variable');
        }
        if (pointer.target === null) {
          throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
        }
        const name = `${pointer.target}.${node.name}`;
        this._reduce('deref', outer ?? node, { name: via, value: new Pointer(name) });
        return name;
      }
      return `${this.lvalue(children[0])}.${node.name}`;
    }
    if (kind === 'UnaryOperator' && node.opcode === '*' && children.length === 1) {
      const [pointer, via] = this.rvalue(children[0]);
      if (via === null) {
        throw new Unsupported('only dereferencing a pointer variable is supported, not a computed address');
      }
      if (pointer.target === null) {
        throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
      }
      this._reduce('deref', outer ?? node, { name: via });
      return pointer.target;
    }
    throw new Unsupported(`unsupported assignable expression: ${kind}`);
  }

  rvalue(node) {
    const kind = node?.kind;
    const children = node?.inner ?? [];
    if (kind === 'MaterializeTemporaryExpr' && children.length === 1) {
      this.temporary = true;
      return this.rvalue(children[0]);
    }
    if (kind === 'ExprWithCleanups' && children.length === 1) {
      return this.rvalue(children[0]);
    }
    if (kind === 'ImplicitCastExpr' && children.length === 1) {
      const cast = node.castKind;
      if (cast === 'LValueToRValue') {
        _depth(node, this.records);
        const name = this.lvalue(children[0]);
        const value = this._load(name);
        this._reduce('read', node, { name, value });
        return [value, name];
      }
      if (cast === 'NullToPointer' && _depth(node, this.records)) {
        const literal = children[0];
        if (
          literal?.kind === 'CXXNullPtrLiteralExpr' ||
          (literal?.kind === 'IntegerLiteral' && literal?.value === '0')
        ) {
          this._reduce('eval', node, { value: new Pointer() });
          return [new Pointer(), null];
        }
      }
      if (cast === 'NoOp') {
        return this.rvalue(children[0]);
      }
      rejectPointerOperator(children[0]);
      throw new Unsupported(`implicit ${cast} conversions are outside this category`);
    }
    const depth = _depth(node, this.records);
    const record = !depth ? getRecord(this.records, typeName(node)) : null;
    if (record) {
      if (kind === 'CXXFunctionalCastExpr' && children.length === 1) {
        const [value] = this.rvalue(children[0]);
        if (
          children[0]?.kind === 'InitListExpr' &&
          this.reductions.length > 0 &&
          this.reductions[this.reductions.length - 1].value === value
        ) {
          this.reductions.pop();
        }
        this._reduce('eval', node, { value, record: record.name });
        return [value, null];
      }
      if (kind === 'InitListExpr') {
        const value = {};
        const limit = Math.min(record.fields.length, children.length);
        for (let i = 0; i < limit; i++) {
          const item = record.fields[i];
          const child = children[i];
          if (child?.kind === 'ImplicitValueInitExpr') {
            value[item.name] = filled(item, this.records, true);
          } else {
            const [childVal] = this.rvalue(child);
            value[item.name] = childVal;
            if (
              child?.kind === 'InitListExpr' &&
              this.reductions.length > 0 &&
              this.reductions[this.reductions.length - 1].value === value[item.name]
            ) {
              this.reductions.pop();
            }
          }
        }
        this._reduce('eval', node, { value });
        return [value, null];
      }
      if (kind === 'CXXConstructExpr') {
        if (children.length === 0) {
          return [filled(record, this.records), null];
        }
        if (children.length === 1) {
          return this.rvalue(children[0]);
        }
      }
      if (
        kind === 'DeclRefExpr' ||
        kind === 'MemberExpr' ||
        (kind === 'UnaryOperator' && node.opcode === '*')
      ) {
        const name = this.lvalue(node);
        const value = this._load(name);
        if (Object.values(_flatten({ [name]: value })).some(item => item === null)) {
          throw new Unsupported(`reading uninitialized struct ${name}`);
        }
        this._reduce('read', node, { name, value, record: record.name });
        return [value, name];
      }
    }
    if (kind === 'IntegerLiteral') {
      return [integer(BigInt(node.value)), null];
    }
    if (kind === 'InitListExpr' || kind === 'CXXFunctionalCastExpr') {
      return [this._braces(node, depth), null];
    }
    let value;
    if (kind === 'ParenExpr' && children.length === 1) {
      [value] = this.rvalue(children[0]);
    } else if (kind === 'UnaryOperator' && node.opcode === '&' && children.length === 1) {
      if (children[0]?.kind !== 'DeclRefExpr' && children[0]?.kind !== 'MemberExpr') {
        throw new Unsupported('only the address of a variable is supported');
      }
      const name = this.lvalue(children[0]);
      this._reduce('addr', node, { name });
      return [new Pointer(name), null];
    } else if (
      kind === 'UnaryOperator' &&
      (node.opcode === '+' || node.opcode === '-') &&
      children.length === 1 &&
      !depth
    ) {
      const operand = this._integerOperand(children[0]);
      value = integer(node.opcode === '+' ? operand : -operand);
    } else if (
      kind === 'BinaryOperator' &&
      ['+', '-', '*', '/', '%'].includes(node.opcode) &&
      children.length === 2
    ) {
      rejectPointerOperator(node);
      value = Evaluator._arithmetic(
        node.opcode,
        this._integerOperand(children[0]),
        this._integerOperand(children[1])
      );
    } else {
      throw new Unsupported(`unsupported expression: ${kind} ${node?.opcode ?? ''}`.trimEnd());
    }
    this._reduce('eval', node, { value });
    return [value, null];
  }

  _integerOperand(node) {
    const [value] = this.rvalue(node);
    if (typeof value !== 'number') {
      throw new Unsupported('pointer arithmetic and comparison are not supported');
    }
    return value;
  }

  _braces(node, depth) {
    const children = node.inner ?? [];
    let value;
    if (node.kind === 'CXXFunctionalCastExpr') {
      if (
        children.length !== 1 ||
        children[0]?.kind !== 'InitListExpr' ||
        (children[0].inner && children[0].inner.length > 0)
      ) {
        throw new Unsupported('only empty int{} functional initialization is supported');
      }
      value = 0;
    } else if (children.length > 1) {
      throw new Unsupported('multiple initializer elements are unsupported');
    } else if (children.length === 1) {
      [value] = this.rvalue(children[0]);
    } else {
      value = depth ? new Pointer() : 0;
    }
    this._reduce('eval', node, { value });
    return value;
  }

  static _arithmetic(operation, left, right) {
    const l = BigInt(left);
    const r = BigInt(right);
    if (operation === '/' || operation === '%') {
      if (r === 0n || (l === BigInt(MIN_INT) && r === -1n)) {
        throw new Unsupported('undefined integer division');
      }
      const quotient = l / r;
      const remainder = l % r;
      return integer(operation === '/' ? quotient : remainder);
    }
    if (operation === '+') return integer(l + r);
    if (operation === '-') return integer(l - r);
    if (operation === '*') return integer(l * r);
    throw new Unsupported(`unsupported operator ${operation}`);
  }
}

function stripParentheses(node) {
  let cur = node;
  while (cur?.kind === 'ParenExpr' && (cur.inner ?? []).length === 1) {
    cur = cur.inner[0];
  }
  return cur;
}

// Statements -------------------------------------------------------------------------------

export class Statement {
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
    bound = null,
  }) {
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
  let suffix = source
    .slice(end)
    .replace(/\s+$/, '')
    .replace(/;$/, '')
    .replace(/\s+$/, '');
  if (emptyInitializer) {
    prefix = prefix.replace(/\s+$/, '') + ' = ';
  }
  if (prefix.replace(/\s+$/, '').endsWith('{') && suffix.replace(/^\s+/, '').startsWith('}')) {
    prefix = prefix.replace(/\s+$/, '').slice(0, -1).replace(/\s+$/, '');
    prefix += prefix.endsWith('=') ? ' ' : ' = ';
    suffix = suffix.replace(/^\s+/, '').slice(1);
  }
  return [prefix, suffix];
}

function coutOperands(node) {
  let cur = node;
  while (
    (cur?.kind === 'ImplicitCastExpr' || cur?.kind === 'ExprWithCleanups') &&
    (cur.inner ?? []).length === 1
  ) {
    cur = cur.inner[0];
  }
  if (cur?.kind === 'DeclRefExpr' && cur.referencedDecl?.name === 'cout') {
    return [];
  }
  if (cur?.kind !== 'CXXOperatorCallExpr' || (cur.inner ?? []).length !== 3) {
    throw new Unsupported('only std::cout insertion calls are supported');
  }
  let [callee, left, right] = cur.inner;
  while (callee?.kind === 'ImplicitCastExpr' && callee.inner?.length > 0) {
    callee = callee.inner[0];
  }
  if (callee?.referencedDecl?.name !== 'operator<<') {
    throw new Unsupported('only stream insertion calls are supported');
  }
  return [...coutOperands(left), right];
}

function stripCasts(operand) {
  let cur = operand;
  while (cur?.kind === 'ImplicitCastExpr' && cur.inner?.length > 0) {
    cur = cur.inner[0];
  }
  return cur;
}

function whitespace(operand) {
  const stripped = stripCasts(operand);
  if (stripped?.referencedDecl?.name === 'endl') {
    return '\n';
  }
  if (stripped?.kind === 'CharacterLiteral') {
    const code = Number.parseInt(stripped.value, 10);
    if (code === 9 || code === 10 || code === 32) {
      return String.fromCharCode(code);
    }
  }
  return null;
}

function outputSuffix(operands) {
  let suffix = '';
  for (const operand of operands) {
    const printed = whitespace(operand);
    if (printed === null) {
      throw new Unsupported('one integer output followed only by whitespace or endl is supported');
    }
    suffix += printed;
  }
  return suffix;
}

function analyzeStatement(node, program, state, records, references) {
  let cur = node;
  while (cur?.kind === 'ExprWithCleanups' && (cur.inner ?? []).length === 1) {
    cur = cur.inner[0];
  }
  let [start, end] = bounds(cur);
  if (end < program.length && program[end] === ';') {
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
  let reference = false;
  let record = null;

  if (cur.kind === 'DeclStmt') {
    const children = cur.inner ?? [];
    if (children.length === 1 && children[0]?.kind === 'CXXRecordDecl') {
      return new Statement({
        source,
        span: null,
        pane: source.replace(/;$/, ''),
      });
    }
    if (children.length !== 1 || children[0]?.kind !== 'VarDecl') {
      throw new Unsupported('one scalar declaration per statement is required');
    }
    const variable = children[0];
    if ((variable.inner ?? []).some(child => (child.kind ?? '').endsWith('Attr'))) {
      throw new Unsupported('declaration attributes need a separate memory-layout visualization');
    }
    const spelling = typeSpelling(variable);
    reference = spelling.endsWith('&');
    if (reference) {
      if (spelling.endsWith('&&')) {
        throw new Unsupported('rvalue references are not supported');
      }
      _depth({ type: { qualType: spelling.slice(0, -1).replace(/\s+$/, '') } }, records);
    } else {
      pointer = _depth(variable, records) > 0;
    }
    record = !pointer && Object.hasOwn(records, typeName(variable)) ? typeName(variable) : null;
    declared = variable.name;
    if (
      declared.startsWith('__course_') ||
      Object.hasOwn(state, declared) ||
      Object.hasOwn(references, declared)
    ) {
      throw new Unsupported('unique variable names are required');
    }
    if (variable.storageClass || variable.constexpr) {
      throw new Unsupported('static and constexpr storage are outside this category');
    }
    nameOffset = variable.loc?.offset ?? null;
    if (nameOffset === null) {
      throw new Unsupported('macro-expanded declarations are not supported');
    }
    const varChildren = variable.inner ?? [];
    root = varChildren.length > 0 ? varChildren[0] : null;
    if (!record && root && root.kind === 'InitListExpr' && (root.inner ?? []).length === 1) {
      root = root.inner[0];
    }
    while (
      reference &&
      root &&
      root.castKind === 'NoOp' &&
      (root.inner ?? []).length === 1
    ) {
      root = root.inner[0];
    }
    if (
      record &&
      root &&
      root.kind === 'CXXConstructExpr' &&
      (!root.inner || root.inner.length === 0)
    ) {
      return new Statement({
        source,
        span: null,
        pane: source.replace(/;$/, ''),
        value: filled(records[record], records),
        target: declared,
        declared,
        record,
      });
    }
    if (record && root && root.kind === 'CXXConstructExpr' && (root.inner ?? []).length === 1) {
      root = root.inner[0];
    }
    emptyInitializer =
      Boolean(root) && root.kind === 'InitListExpr' && (!root.inner || root.inner.length === 0);
  } else if (
    (cur.kind === 'BinaryOperator' && cur.opcode === '=') ||
    (cur.kind === 'CXXOperatorCallExpr' &&
      (cur.inner ?? []).length === 3 &&
      Object.hasOwn(records, typeName(cur)))
  ) {
    const inner = cur.inner;
    left = inner[inner.length - 2];
    root = inner[inner.length - 1];
    _depth(left, records);
    if (left.kind === 'ParenExpr' && stripParentheses(left).kind === 'DeclRefExpr') {
      throw new Unsupported('a parenthesized variable as assignment target is not supported');
    }
    whole =
      left.kind !== 'DeclRefExpr' ||
      Object.hasOwn(references, left.referencedDecl?.name ?? '');
  } else if (cur.kind === 'CXXOperatorCallExpr') {
    const operands = coutOperands(cur);
    if (operands.length === 0) {
      throw new Unsupported('empty output expression');
    }
    root = operands[0];
    outSuffix = outputSuffix(operands.slice(1));
    printed = whitespace(root);
    if (stripCasts(root)?.kind === 'StringLiteral') {
      throw new Unsupported('string literal output is not supported');
    }
    if (
      root.kind === 'ImplicitCastExpr' &&
      root.castKind === 'BitCast' &&
      typeSpelling(root) === 'const void *' &&
      (root.inner ?? []).length === 1
    ) {
      root = root.inner[0];
    }
  } else {
    throw new Unsupported(`unsupported statement: ${cur.kind}`);
  }

  if (root === null) {
    return new Statement({
      source,
      span: null,
      pane: source.replace(/;$/, '').replace(/\s+$/, ''),
      target: declared,
      declared,
      pointer,
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
      printed,
    });
  }

  const evaluator = new Evaluator(state, locate, records, references);
  if (reference) {
    const bound = evaluator.lvalue(root);
    if (evaluator.temporary) {
      throw new Unsupported('a reference bound to a temporary is not supported');
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
      destination: [toPane(nameOffset), toPane(nameOffset) + declared.length],
    });
  }

  let target = declared;
  let destination = null;
  let designation = [];
  if (left !== null) {
    target = evaluator.lvalue(left);
    destination = locate(left);
    let renamed = 0;
    while (
      renamed < evaluator.reductions.length &&
      evaluator.reductions[renamed].kind === 'alias'
    ) {
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
    throw new Unsupported('only integer and pointer output is supported');
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
    temporary: evaluator.temporary,
  });
}

function storedAt(value, path, newValue) {
  if (path.length === 0) {
    return newValue;
  }
  return { ...value, [path[0]]: storedAt(value[path[0]], path.slice(1), newValue) };
}

export function _after(statement, state) {
  if (hooks.after) {
    return hooks.after(statement, state);
  }
  return defaultAfter(statement, state);
}

export function defaultAfter(statement, state) {
  const after = { ...state };
  if (statement.target !== null) {
    const [owner, ...path] = statement.target.split('.');
    after[owner] = storedAt(after[owner], path, statement.value);
  }
  return after;
}

function analyze(source, directory) {
  const program =
    '#include <iostream>\n#include <cstdint>\nusing namespace std;\nint main() {\n' +
    source +
    '\n}\n';
  const ast = _main_ast(program, directory);
  const records = layouts(ast, directory);
  const statements = [];
  let state = {};
  const references = {};
  const inner = ast.inner ?? [];
  for (let i = 0; i < inner.length; i++) {
    const node = inner[i];
    if (node.kind === 'ReturnStmt') {
      const children = node.inner ?? [];
      if (
        children.length === 1 &&
        children[0]?.kind === 'IntegerLiteral' &&
        children[0]?.value === '0' &&
        i === inner.length - 1
      ) {
        continue;
      }
      throw new Unsupported('only a final return 0 is supported');
    }
    const statement = analyzeStatement(node, program, state, records, references);
    if (statement.declared && statements.some(earlier => earlier.temporary)) {
      throw new Unsupported(
        'a declaration after a materialized temporary needs a separate memory-layout visualization'
      );
    }
    statements.push(statement);
    if (statements.length > MAX_STATEMENTS) {
      throw new Unsupported('too many statements');
    }
    state = _after(statement, state);
    if (statement.bound) {
      references[statement.declared] = statement.bound;
    }
    if (Object.keys(state).length > MAX_VARIABLES) {
      throw new Unsupported('too many variables');
    }
  }
  if (Object.keys(state).length === 0) {
    throw new Unsupported('a variable timeline requires at least one variable');
  }
  return [statements, records];
}

// Memory -----------------------------------------------------------------------------------

function sizeOf(pointer) {
  return pointer ? POINTER_SIZE : INT_SIZE;
}

function floorDiv(a, b) {
  return Math.floor(a / b);
}

function pyMod(a, b) {
  return ((a % b) + b) % b;
}

export function _normalize(addresses, sizes) {
  const alignment = Math.max(...Object.values(sizes));
  const lowest = Math.min(...Object.values(addresses));
  const base = lowest - pyMod(lowest, alignment);
  const result = {};
  for (const [name, address] of Object.entries(addresses)) {
    result[name] = FIRST_ADDRESS + address - base;
  }
  return result;
}

function withoutReferenceSlots(real, variables) {
  const packed = storageAddresses(variables);
  const names = variables.map(v => v.name);
  const sortedReal = [...names].sort((a, b) => real[a] - real[b]);
  const sortedPacked = [...names].sort((a, b) => packed[a] - packed[b]);
  if (sortedReal.some((n, i) => n !== sortedPacked[i])) {
    throw new Unsupported('runtime order of the variables disagrees with their declarations');
  }
  return packed;
}

export function _observed(
  execution,
  predicted,
  pointers = new Set(),
  variables = null,
  references = null
) {
  const ptrSet = pointers instanceof Set ? pointers : new Set(pointers);
  if (variables === null) {
    variables = Object.keys(predicted[predicted.length - 1]).map(name =>
      scalar(name, 0, sizeOf(ptrSet.has(name)), ptrSet.has(name) ? 'ptr' : 'int')
    );
  }
  const cells = leaves(variables);
  const addresses = {};
  const owners = Object.fromEntries(variables.map(v => [v.name, v]));
  const offsets = storageAddresses(variables);
  const bindings = execution.checkpoints.map(row =>
    Object.fromEntries(Object.entries(row).filter(([, cell]) => cell.reference))
  );
  const checkpoints = execution.checkpoints.map(row =>
    Object.fromEntries(Object.entries(row).filter(([, cell]) => !cell.reference))
  );
  for (const row of checkpoints) {
    for (const [name, cell] of Object.entries(row)) {
      if (cell.size !== cells[name].size || cell.pointer !== (cells[name].kind === 'ptr')) {
        throw new Unsupported(`runtime storage of ${name} disagrees with Clang`);
      }
      if (!Object.hasOwn(addresses, name)) {
        addresses[name] = cell.address;
      } else if (addresses[name] !== cell.address) {
        throw new Unsupported('variable address changed during the trace');
      }
      const dot = name.indexOf('.');
      const owner = dot === -1 ? name : name.slice(0, dot);
      const member = dot === -1 ? '' : name.slice(dot + 1);
      if (member) {
        const offset = offsets[name] - offsets[owner];
        const base = cell.object_address;
        if (!Object.hasOwn(addresses, owner)) {
          addresses[owner] = base;
        }
        if (
          cell.object_size !== owners[owner].size ||
          cell.address !== base + offset ||
          addresses[owner] !== base
        ) {
          throw new Unsupported(`runtime field offset of ${name} disagrees with Clang`);
        }
      }
    }
  }
  for (const [name, offset] of Object.entries(offsets)) {
    const owner = name.split('.')[0];
    if (Object.hasOwn(addresses, owner) && !Object.hasOwn(addresses, name)) {
      addresses[name] = addresses[owner] + offset - offsets[owner];
    }
  }
  for (const row of bindings) {
    for (const [name, cell] of Object.entries(row)) {
      const refTarget = (references ?? {})[name];
      if (cell.address !== addresses[refTarget]) {
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
      throw new Unsupported('runtime verification failed: incomplete frame');
    }
    const addrValues = new Set(Object.values(addresses));
    for (const [name, value] of Object.entries(expected)) {
      const bits =
        value instanceof Pointer
          ? value.target
            ? addresses[value.target]
            : 0
          : value;
      if (row[name].value !== bits) {
        if (value instanceof Pointer && row[name].value && !addrValues.has(row[name].value)) {
          throw new Unsupported(`runtime value of ${name} is not the address of a variable`);
        }
        throw new Unsupported(`runtime verification failed: ${name} disagrees`);
      }
    }
  }
  return [addresses, predicted];
}

// Rendering --------------------------------------------------------------------------------

function spaceless(text) {
  return text.replace(/\s+/g, '');
}

class Pane {
  constructor(text) {
    this.original = text;
    this.edits = []; // [start, end, text] in original coordinates
  }

  get text() {
    const parts = [];
    let cursor = 0;
    for (const [start, end, newText] of this.edits) {
      parts.push(this.original.slice(cursor, start), newText);
      cursor = end;
    }
    return parts.join('') + this.original.slice(cursor);
  }

  locate(start, end) {
    const shift = at => {
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
    const filtered = this.edits.filter(edit => !(start <= edit[0] && edit[1] <= end));
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
    return ka.length === kb.length && ka.every(k => valuesEqual(a[k], b[k]));
  }
  return false;
}

class Renderer {
  constructor(addresses, cells = null, real = null, hasReferences = false) {
    this.addresses = addresses;
    this.refs = hasReferences ? {} : null;
    const keys = Object.keys(cells ?? addresses);
    this.order = keys.sort((a, b) => addresses[a] - addresses[b]);
    this.steps = [];
    this.stdout = '';
    this.real = real ?? addresses;
    this.realStdout = '';
  }

  printed(pointer, addresses) {
    if (pointer.target === null) {
      return '0';
    }
    const address = addresses[pointer.target];
    if (addresses === this.real && this.real !== this.addresses) {
      return `0x${address.toString(16)}`;
    }
    return `0x${address.toString(16).padStart(16, '0')}`;
  }

  show(value) {
    if (isPlainObject(value)) {
      return `{${Object.values(value)
        .map(item => this.show(item))
        .join(', ')}}`;
    }
    return String(this.stored(value));
  }

  stored(value) {
    if (value instanceof Pointer) {
      return value.target ? this.addresses[value.target] : 0;
    }
    return value;
  }

  add(line, pane, expr, state, op = null, hold = 1.0) {
    const flat = _flatten(state);
    const values = {};
    for (const name of this.order) {
      values[name] = !Object.hasOwn(flat, name)
        ? null
        : flat[name] === null
          ? UNKNOWN
          : this.stored(flat[name]);
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
      targets,
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
      let text;
      let op;
      if (reduction.kind === 'read') {
        text = (reduction.record ?? '') + this.show(load(before, reduction.name));
        op = { kind: 'read', name: reduction.name, value: text };
      } else if (reduction.kind === 'addr') {
        text = String(this.addresses[reduction.name]);
        op = { kind: 'addr', name: reduction.name, value: text };
      } else if (reduction.kind === 'alias') {
        text = reduction.spelling;
        op = { kind: 'alias', name: reduction.name, target: text };
      } else if (reduction.kind === 'deref') {
        text = (reduction.value ?? load(before, reduction.name)).target;
        op = { kind: 'deref', target: text, via: reduction.name };
      } else {
        text = reduction.spelling ?? (reduction.record ?? '') + this.show(reduction.value);
        op = { kind: 'eval', value: text };
        if (
          isPlainObject(reduction.value) &&
          spaceless(pane.read(reduction.span[0], reduction.span[1])) === spaceless(text)
        ) {
          continue;
        }
      }
      if (pane.read(reduction.span[0], reduction.span[1]) !== text) {
        op.span = pane.replace(reduction.span[0], reduction.span[1], text);
        this.add(line, pane, expr, before, op);
      }
    }
    if (statement.result === null) {
      return;
    }
    if (statement.bound) {
      this.refs[statement.declared] = statement.bound;
      const op = {
        kind: 'bind',
        name: statement.declared,
        target: statement.bound,
        span: pane.locate(statement.result[0], statement.result[1]),
        destination: pane.locate(statement.destination[0], statement.destination[1]),
      };
      this.add(line, pane, expr, after, op, 1.2);
      return;
    }
    if (
      typeof statement.value === 'number' &&
      pane.read(statement.result[0], statement.result[1]) !== String(statement.value)
    ) {
      const op = {
        kind: 'eval',
        value: String(statement.value),
        span: pane.replace(statement.result[0], statement.result[1], String(statement.value)),
      };
      this.add(line, pane, expr, before, op);
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
        const op = {
          kind: 'eval',
          value: text,
          span: pane.replace(statement.result[0], statement.result[1], text),
        };
        this.add(line, pane, expr, before, op);
        span = pane.locate(statement.result[0], statement.result[1]);
      }
    }
    if (statement.output_suffix !== null) {
      this.realStdout += real + statement.output_suffix;
      this.stdout += text + statement.output_suffix;
      this.add(line, pane, expr, after, { kind: 'print', value: text, span }, 1.2);
      return;
    }
    const name = statement.target;
    const old = load(before, statement.target, true);
    const op = {
      kind: 'write',
      name,
      value: text,
      span,
      destination: pane.locate(statement.destination[0], statement.destination[1]),
    };
    const redirected =
      old instanceof Pointer && Boolean(old.target) && !valuesEqual(old, load(after, name));
    this.add(line, pane, expr, after, op, redirected ? 1.6 : 1.2);
  }
}

export function trace(source, { runtime = true } = {}) {
  const body = _body(source);
  const directory = mkdtempSync(join(tmpdir(), 'course-expression-'));
  let statements;
  let records;
  let variables;
  let references;
  let addresses;
  let states;
  let real;
  let execution;
  try {
    [statements, records] = analyze(body, directory);
    const predicted = [];
    let state = {};
    for (const statement of statements) {
      state = _after(statement, state);
      predicted.push(state);
    }
    const declarations = statements.filter(s => s.declared);
    variables = [];
    references = {};
    let top = -8;
    const fieldColors = {};
    for (let color = 0; color < declarations.length; color++) {
      const declaration = declarations[color];
      const name = declaration.declared;
      if (declaration.bound) {
        references[name] = traceReference(name, color);
        continue;
      }
      const record = records[declaration.record];
      const size = record ? record.size : sizeOf(declaration.pointer);
      const alignment = record ? record.alignment : size;
      top = floorDiv(top - size, alignment) * alignment;
      if (record) {
        const fieldsOf = rec => {
          const flds = [];
          for (const item of rec.fields) {
            if (!Object.hasOwn(fieldColors, item.name)) {
              fieldColors[item.name] = Object.keys(fieldColors).length;
            }
            const shade = fieldColors[item.name];
            if (item.kind === 'struct') {
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
              flds.push(traceField(item.name, item.offset, item.size, item.kind, shade));
            }
          }
          return flds;
        };
        variables.push(struct(name, record.name, top, size, fieldsOf(record), color));
      } else {
        variables.push(scalar(name, top, size, declaration.pointer ? 'ptr' : 'int', color));
      }
    }
    if (runtime) {
      const scopes = [];
      const bound = {};
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const row = predicted[i];
        if (statement.bound) {
          bound[statement.declared] = statement.bound;
        }
        scopes.push([
          ...Object.entries(_flatten(row)).map(([name, value]) => [name, value !== null]),
          ...Object.keys(bound).map(name => [name, REFERENCE]),
        ]);
      }
      execution = hooks.execute(
        statements.map(s => s.source),
        scopes,
        directory
      );
      [addresses, states] = _observed(execution, predicted, new Set(), variables, bound);
    } else {
      addresses = storageAddresses(variables);
      states = predicted;
    }
    real = addresses;
    if (Object.keys(references).length > 0) {
      addresses = withoutReferenceSlots(addresses, variables);
    }
    const alignment = Math.max(
      ...Object.values(records).map(r => r.alignment),
      ...declarations.filter(d => !d.record && !d.bound).map(d => sizeOf(d.pointer)),
      4
    );
    addresses = _normalize(addresses, { ABI: alignment });
    for (const variable of variables) {
      variable.address = addresses[variable.name];
    }
    variables.sort((a, b) => a.address - b.address);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const shown = [];
  for (let i = 0; i < statements.length; i++) {
    if (!DEFINITION.test(statements[i].source)) {
      shown.push([statements[i], states[i]]);
    }
  }
  if (shown.length === 0) {
    throw new Unsupported('a snippet of only struct definitions has nothing to step through');
  }
  const hasRefs = Object.keys(references).length > 0;
  const renderer = new Renderer(addresses, leaves(variables), real, hasRefs);
  let previous = {};
  for (let line = 0; line < shown.length; line++) {
    const [statement, after] = shown[line];
    renderer.statement(line, statement, previous, after);
    previous = after;
  }
  if (runtime && renderer.realStdout !== execution.stdout) {
    throw new Unsupported('runtime output disagrees with the expression trace');
  }
  renderer.steps[renderer.steps.length - 1].hold = 3;
  const shownStatements = shown.map(([s]) => s);
  const result = {
    format: FORMAT,
    source: shownStatements.map(s => s.source),
    spans: shownStatements.map(s => (s.span ? [...s.span] : null)),
    variables,
    steps: renderer.steps,
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
