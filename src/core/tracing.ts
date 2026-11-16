// Compiler-backed execution traces of flat integer, pointer and aggregate struct examples (isomorphic core).
//
// Clang supplies syntax, types and record layouts via `CompilerFrontend`. A strict AST whitelist
// predicts each statement's effects without executing arbitrary C++. An optional `RuntimeExecutor`
// (such as GDB in Node) verifies every live scalar and struct field after every statement.

import { type AstNode, type CompilerFrontend, IllFormed, Unsupported } from './errors.ts';
import {
  type Record as RecordInfo,
  type RecordFieldInfo,
  canonicalType,
  displayed,
  displayedType,
  layoutsFromFrontend,
  typeName,
  typeSpelling,
} from './records.ts';
import {
  type ExecutionTrace,
  FORMAT,
  FormatError,
  type Span,
  type StoredCellValue,
  type TypedPart,
  type TraceField,
  type TraceReference,
  type TraceStep,
  type TraceVariable,
  type ClashOperation,
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
} from './trace_format.ts';

export { IllFormed, Unsupported };

export interface CellInput {
  address: number;
  size: number;
  pointer: boolean;
  value: number | null;
  object_address?: number | null;
  object_size?: number | null;
  reference?: boolean;
}

export class Cell {
  address: number;
  size: number;
  pointer: boolean;
  value: number | null;
  object_address: number | null;
  object_size: number | null;
  reference: boolean;

  constructor({
    address,
    size,
    pointer,
    value,
    object_address = null,
    object_size = null,
    reference = false,
  }: CellInput) {
    this.address = address;
    this.size = size;
    this.pointer = pointer;
    this.value = value;
    this.object_address = object_address;
    this.object_size = object_size;
    this.reference = reference;
    Object.freeze(this);
  }
}

export const REFERENCE = 'reference' as const;
export type ScopeEntry = [string, boolean | typeof REFERENCE];

export class Execution {
  checkpoints: Record<string, Cell>[];
  stdout: string;

  constructor(checkpoints: Record<string, Cell>[], stdout: string) {
    this.checkpoints = checkpoints;
    this.stdout = stdout;
    Object.freeze(this);
  }
}

export type RuntimeExecutor = (
  statements: string[],
  expected: ScopeEntry[][],
  directory?: string
) => Execution;

export const hooks: {
  execute: RuntimeExecutor | null;
  after: ((statement: Statement, state: Record<string, any>) => Record<string, any>) | null;
} = {
  execute: null,
  after: null,
};

const FIRST_ADDRESS = 64;
const POINTER_SIZE = 8;
// JSON numbers are doubles in the player: larger magnitudes would not be drawn exactly.
const MAX_EXACT = 2n ** 53n;
const MAX_STATEMENTS = 20;
const MAX_VARIABLES = 8;
const QUOTED_OR_COMMENT = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

// Values -----------------------------------------------------------------------------------

export class Pointer {
  target: string | null;

  constructor(target: string | null = null) {
    this.target = target;
    Object.freeze(this);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Pointer);
}

/** A builtin integer type: its bytes and whether it is signed. Arithmetic is exact in bigint. */
export class Integer {
  readonly size: number;
  readonly signed: boolean;

  constructor(size: number, signed: boolean) {
    this.size = size;
    this.signed = signed;
    Object.freeze(this);
  }

  /** `value` converted to this type: its low bits, as every conversion keeps them. */
  wrap(value: bigint): bigint {
    return this.signed ? BigInt.asIntN(8 * this.size, value) : BigInt.asUintN(8 * this.size, value);
  }

  holds(value: bigint): boolean {
    return this.wrap(value) === value;
  }

  /** The result of arithmetic in this type: unsigned wraps, signed overflow is undefined. */
  result(value: bigint): bigint {
    if (this.signed && !this.holds(value)) {
      throw new Unsupported('signed integer overflow is outside the timeline category');
    }
    return this.wrap(value);
  }
}

// By Clang's canonical spelling, with the sizes of the pinned x86-64 toolchain; GDB checks the
// size of every cell. `char` and `bool` are not numbers in the lessons and stay out.
export const INTEGERS: Readonly<Record<string, Integer>> = Object.freeze({
  'signed char': new Integer(1, true),
  'unsigned char': new Integer(1, false),
  short: new Integer(2, true),
  'unsigned short': new Integer(2, false),
  int: new Integer(4, true),
  'unsigned int': new Integer(4, false),
  long: new Integer(8, true),
  'unsigned long': new Integer(8, false),
  'long long': new Integer(8, true),
  'unsigned long long': new Integer(8, false),
});

// Clang resolves an alias only where it is the whole type, not under a pointer (`uint8_t *`).
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  size_t: 'unsigned long',
  ptrdiff_t: 'long',
  intptr_t: 'long',
  uintptr_t: 'unsigned long',
  int8_t: 'signed char',
  uint8_t: 'unsigned char',
  int16_t: 'short',
  uint16_t: 'unsigned short',
  int32_t: 'int',
  uint32_t: 'unsigned int',
  int64_t: 'long',
  uint64_t: 'unsigned long',
});

/** The integer type a spelling names, unless the snippet has a struct of that name. */
function integerNamed(spelling: string, records: unknown = {}): Integer | null {
  const name = spelling.replace(/^const /, '').replace(/^std::/, '');
  if (hasRecord(records, name)) return null;
  const canonical = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return Object.hasOwn(INTEGERS, canonical) ? INTEGERS[canonical] : null;
}

/** The integer type of an expression or declaration, behind any alias (`uint8_t`). */
function integerType(node: AstNode | null | undefined, records: unknown = {}): Integer | null {
  return integerNamed(canonicalType(node), records);
}

function integerTypeOf(node: AstNode): Integer {
  const type = integerType(node);
  if (!type) {
    throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || 'this type'}`);
  }
  return type;
}

/** A value as the trace stores it: a JSON number, which must hold it exactly. */
function exact(value: bigint): number {
  if (value > MAX_EXACT || value < -MAX_EXACT) {
    throw new Unsupported('integers beyond 2^53 are not drawn exactly');
  }
  return Number(value);
}

function hasRecord(records: unknown, name: string): boolean {
  if (!records) return false;
  if (Array.isArray(records) || records instanceof Set) {
    return [...records].includes(name);
  }
  return Object.hasOwn(records as object, name);
}

function getRecord(records: unknown, name: string): RecordInfo | undefined {
  if (!records || Array.isArray(records) || records instanceof Set) return undefined;
  const map = records as Record<string, RecordInfo>;
  return Object.hasOwn(map, name) ? map[name] : undefined;
}

/** How many pointer levels lie over an integer or a supported struct. */
export function _depth(node: AstNode | null | undefined, records: unknown = {}): number {
  const qualified = typeSpelling(node);
  const intMatch = /^(const )?([\w: ]+?)(?: (\*+))?$/.exec(canonicalType(node));
  if (intMatch && integerNamed(intMatch[2], records) && !(intMatch[1] && intMatch[3])) {
    return (intMatch[3] || '').length;
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
    throw new Unsupported(`only pointers to integers are supported, not ${qualified}`);
  }
  throw new Unsupported(`only integer and pointer values are supported, not ${qualified || 'this type'}`);
}

// Source text ------------------------------------------------------------------------------

function isAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

export function _body(source: string): string {
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
const DEFINITION_TEXT = /(?:^([ \t]*)|\s*)(struct\s+(\w+)\s*\{[^{}]*\}\s*;)/gm;

function dedent(text: string): string {
  const lines = text.split('\n');
  let margin: string | null = null;
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
  return lines
    .map(line => (line.startsWith(margin!) ? line.slice(margin!.length) : line.replace(/^[ \t]+$/, '')))
    .join('\n');
}

function definitions(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of body.matchAll(DEFINITION_TEXT)) {
    result[match[3]] = dedent((match[1] ?? '') + match[2]);
  }
  return result;
}

export function bounds(node: AstNode | null | undefined): Span {
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

function compact(source: string): [string, number[]] {
  const out: string[] = [];
  const mapping = new Array<number>(source.length + 1).fill(0);
  let index = 0;
  const pattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\s+|[\s\S]/g;
  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const start = match.index!;
    const end = start + token.length;
    const isSpace = /^\s+$/.test(token);
    let replacement: string;
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

function parseLeadingJson(text: string, startOffset: number): [AstNode, number] | null {
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
  return [JSON.parse(text.slice(start, i)) as AstNode, i];
}

export function extractMainAstFromStdout(stdout: string, program: string): AstNode {
  const selected: AstNode[] = [];
  let offset = 0;
  try {
    while (offset < stdout.length) {
      const parsed = parseLeadingJson(stdout, offset);
      if (!parsed) break;
      const [node, nextOffset] = parsed;
      offset = nextOffset;
      if (node.kind === 'FunctionDecl' && node.name === 'main') {
        selected.push(node);
      }
    }
  } catch {
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

export type ReductionKind = 'read' | 'addr' | 'deref' | 'alias' | 'eval' | 'convert';

export interface ReductionDetails {
  name?: string | null;
  value?: any;
  spelling?: string | null;
  record?: string | null;
  type?: string | null;
  source?: string | null;
}

/**
 * One rewrite of the pane. `read` replaces `span` with the value of `name`, `addr` with the
 * address of `name`, `deref` with the name of the variable `name` (a pointer) points to,
 * `alias` the reference `name` with what it is bound to (`spelling`), and `eval` with `value`
 * (or `spelling`, when the value is not written as a number). `convert` replaces a value of
 * the type `source` with the `value` it has in another type, even when it reads the same. A
 * struct value that has a type on its own keeps it in front: `record` names it. `span`
 * indexes the statement's original pane; inner reductions come first. `type` is the type of
 * the result.
 */
export class Reduction {
  kind: ReductionKind;
  span: Span;
  name: string | null;
  value: any;
  spelling: string | null;
  record: string | null;
  type: string | null;
  source: string | null;

  constructor(
    kind: ReductionKind,
    span: Span,
    { name = null, value = null, spelling = null, record = null, type = null, source = null }: ReductionDetails = {}
  ) {
    this.kind = kind;
    this.span = span;
    this.name = name;
    this.value = value;
    this.spelling = spelling;
    this.record = record;
    this.type = type;
    this.source = source;
    Object.freeze(this);
  }
}

function load(state: Record<string, any>, name: string, missing = false): any {
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

export function _flatten(state: Record<string, any>): Record<string, any> {
  const cells: Record<string, any> = {};
  for (const [name, value] of Object.entries(state)) {
    if (isPlainObject(value)) {
      const sub: Record<string, any> = {};
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

function filled(item: RecordInfo | RecordFieldInfo, records: Record<string, RecordInfo>, zero = false): any {
  const record: RecordInfo | null =
    item && 'fields' in item && Array.isArray(item.fields)
      ? item
      : 'kind' in item && item.kind === 'struct' && item.type
        ? records[item.type]
        : null;
  if (record) {
    const res: Record<string, any> = {};
    for (const inner of record.fields) {
      res[inner.name] = filled(inner, records, zero);
    }
    return res;
  }
  return !zero ? null : ('kind' in item && item.kind === 'ptr' ? new Pointer() : 0);
}

function operandIsPointer(node: AstNode | null | undefined): boolean {
  return (node?.type?.qualType ?? '').includes('*');
}

function rejectPointerOperator(node: AstNode | null | undefined): void {
  if (
    node?.kind === 'BinaryOperator' &&
    (operandIsPointer(node) || (node.inner ?? []).some(operandIsPointer))
  ) {
    throw new Unsupported('pointer arithmetic and comparison are not supported');
  }
}

class Evaluator {
  state: Record<string, any>;
  locate: (item: AstNode) => Span;
  reductions: Reduction[];
  records: Record<string, RecordInfo>;
  references: Record<string, string>;
  temporary: boolean;

  constructor(
    state: Record<string, any>,
    locate: (item: AstNode) => Span,
    records: Record<string, RecordInfo>,
    references: Record<string, string> = {}
  ) {
    this.state = state;
    this.locate = locate;
    this.reductions = [];
    this.records = records;
    this.references = references;
    this.temporary = false;
  }

  _reduce(kind: ReductionKind, node: AstNode, details: Omit<ReductionDetails, 'type'> = {}): void {
    this.reductions.push(new Reduction(kind, this.locate(node), { ...details, type: displayedType(node) }));
  }

  _load(name: string): any {
    const value = load(this.state, name);
    if (value === null || value === undefined) {
      throw new Unsupported(`reading uninitialized variable ${name}`);
    }
    return value;
  }

  variable(node: AstNode): string {
    const declaration = node?.referencedDecl ?? {};
    const name = declaration.name ?? '';
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

  lvalue(node: AstNode, outer: AstNode | null = null): string {
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

  rvalue(node: AstNode): [any, string | null] {
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
      if (cast === 'IntegralCast') {
        return [this._convert(node, children[0]), null];
      }
      throw new Unsupported(`implicit ${cast} conversions are outside this category`);
    }
    if (kind === 'CXXStaticCastExpr' && children.length === 1) {
      // Clang spells the conversion as implicit casts inside the written one: one step.
      let operand = children[0];
      while (
        operand?.kind === 'ImplicitCastExpr' &&
        (operand.castKind === 'IntegralCast' || operand.castKind === 'NoOp') &&
        (operand.inner ?? []).length === 1
      ) {
        operand = operand.inner![0];
      }
      return [this._convert(node, operand), null];
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
        const value: Record<string, any> = {};
        const limit = Math.min(record.fields.length, children.length);
        for (let i = 0; i < limit; i++) {
          const item = record.fields[i];
          const child = children[i];
          if (child?.kind === 'ImplicitValueInitExpr') {
            value[item.name] = filled(item, this.records, true);
          } else if (child?.castKind === 'IntegralCast') {
            // The list is one typed value: a part of it has no label to change.
            throw new Unsupported("a conversion inside a struct's braces is not supported");
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
      return [exact(BigInt(node.value ?? '0')), null];
    }
    if (kind === 'InitListExpr' || kind === 'CXXFunctionalCastExpr') {
      return [this._braces(node, depth), null];
    }
    let value: any;
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
      const operand = BigInt(this._integerOperand(children[0]));
      value = exact(integerTypeOf(node).result(node.opcode === '+' ? operand : -operand));
    } else if (kind === 'UnaryOperator' && node.opcode === '~' && children.length === 1 && !depth) {
      // Every bit of the (promoted) operand flips; this never overflows, even when signed.
      value = exact(integerTypeOf(node).wrap(~BigInt(this._integerOperand(children[0]))));
    } else if (
      kind === 'BinaryOperator' &&
      ['+', '-', '*', '/', '%'].includes(node.opcode ?? '') &&
      children.length === 2
    ) {
      rejectPointerOperator(node);
      value = Evaluator._arithmetic(
        integerTypeOf(node),
        node.opcode!,
        this._integerOperand(children[0]),
        this._integerOperand(children[1])
      );
    } else {
      throw new Unsupported(`unsupported expression: ${kind} ${node?.opcode ?? ''}`.trimEnd());
    }
    this._reduce('eval', node, { value });
    return [value, null];
  }

  _integerOperand(node: AstNode): number {
    const [value] = this.rvalue(node);
    if (typeof value !== 'number') {
      throw new Unsupported('pointer arithmetic and comparison are not supported');
    }
    return value;
  }

  /** `operand` converted to the integer type of `node`, a cast written or implied. */
  _convert(node: AstNode, operand: AstNode): number {
    _depth(node, this.records);
    const target = integerType(node);
    if (!target || !integerType(operand)) {
      throw new Unsupported('only conversions between integer types are supported');
    }
    const value = exact(target.wrap(BigInt(this._integerOperand(operand))));
    const source = displayedType(operand);
    if (source === displayedType(node)) {
      // `static_cast<int>` of an int changes nothing: the cast just goes away.
      this._reduce('eval', node, { value });
    } else {
      this._reduce('convert', node, { value, source });
    }
    return value;
  }

  _braces(node: AstNode, depth: number): any {
    const children = node.inner ?? [];
    let value: any;
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

  static _arithmetic(type: Integer, operation: string, left: number, right: number): number {
    const l = BigInt(left);
    const r = BigInt(right);
    if (operation === '/' || operation === '%') {
      // bigint division truncates toward zero and the remainder takes the dividend's sign, as in C++.
      if (r === 0n || !type.holds(l / r)) {
        throw new Unsupported('undefined integer division');
      }
      return exact(operation === '/' ? l / r : l % r);
    }
    if (operation === '+') return exact(type.result(l + r));
    if (operation === '-') return exact(type.result(l - r));
    if (operation === '*') return exact(type.result(l * r));
    throw new Unsupported(`unsupported operator ${operation}`);
  }
}

function stripParentheses(node: AstNode): AstNode {
  let cur = node;
  while (cur?.kind === 'ParenExpr' && (cur.inner ?? []).length === 1) {
    cur = cur.inner![0];
  }
  return cur;
}

// Statements -------------------------------------------------------------------------------

/** A part of the pane with a type before anything is reduced: its span and its type. */
export type Typed = [Span, string];

/**
 * One analyzed statement. Besides what it evaluates and writes, `typed` lists the pane's
 * typed parts before any reduction, names and literals; `slot` is the span of the declaration
 * (`int* p`), whose type is `type`; `size` is the bytes a declared scalar takes.
 */
export class Statement {
  source: string;
  span: Span | null;
  pane: string;
  expr: Span | null;
  result: Span | null;
  value: any;
  reductions: Reduction[];
  target: string | null;
  destination: Span | null;
  declared: string | null;
  pointer: boolean;
  record: string | null;
  output_suffix: string | null;
  printed: string | null;
  temporary: boolean;
  bound: string | null;
  typed: Typed[];
  slot: Span | null;
  type: string | null;
  size: number | null;

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
    typed = [],
    slot = null,
    type = null,
    size = null,
  }: {
    source: string;
    span: Span | null;
    pane: string;
    expr?: Span | null;
    result?: Span | null;
    value?: any;
    reductions?: Reduction[];
    target?: string | null;
    destination?: Span | null;
    declared?: string | null;
    pointer?: boolean;
    record?: string | null;
    output_suffix?: string | null;
    printed?: string | null;
    temporary?: boolean;
    bound?: string | null;
    typed?: Typed[];
    slot?: Span | null;
    type?: string | null;
    size?: number | null;
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
    this.typed = typed;
    this.slot = slot;
    this.type = type;
    this.size = size;
  }
}

/**
 * The parts of an expression that have a type before anything is evaluated: local names (a
 * field access by `.` whole) and literals. Compound expressions get theirs when reduced.
 */
function typedParts(node: AstNode, locate: (item: AstNode) => Span, names: Set<string>): Typed[] {
  let plain = node;
  while (plain?.kind === 'MemberExpr' && !plain.isArrow && (plain.inner ?? []).length === 1) {
    plain = plain.inner![0];
  }
  const local = plain?.kind === 'DeclRefExpr' && names.has(plain.referencedDecl?.name ?? '');
  if (local || node.kind === 'IntegerLiteral' || node.kind === 'CXXNullPtrLiteralExpr') {
    return [[locate(node), displayedType(node)]];
  }
  return (node.inner ?? []).flatMap(child => typedParts(child, locate, names));
}

function compareTyped([a, at]: Typed, [b, bt]: Typed): number {
  return a[0] - b[0] || a[1] - b[1] || (at < bt ? -1 : at > bt ? 1 : 0);
}

function paneParts(source: string, span: Span, emptyInitializer: boolean): [string, string] {
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

function coutOperands(node: AstNode): AstNode[] {
  let cur = node;
  while (
    (cur?.kind === 'ImplicitCastExpr' || cur?.kind === 'ExprWithCleanups') &&
    (cur.inner ?? []).length === 1
  ) {
    cur = cur.inner![0];
  }
  if (cur?.kind === 'DeclRefExpr' && cur.referencedDecl?.name === 'cout') {
    return [];
  }
  if (cur?.kind !== 'CXXOperatorCallExpr' || (cur.inner ?? []).length !== 3) {
    throw new Unsupported('only std::cout insertion calls are supported');
  }
  let [callee, left, right] = cur.inner!;
  while (callee?.kind === 'ImplicitCastExpr' && callee.inner && callee.inner.length > 0) {
    callee = callee.inner[0];
  }
  if (callee?.referencedDecl?.name !== 'operator<<') {
    throw new Unsupported('only stream insertion calls are supported');
  }
  return [...coutOperands(left), right];
}

function stripCasts(operand: AstNode): AstNode {
  let cur = operand;
  while (cur?.kind === 'ImplicitCastExpr' && cur.inner && cur.inner.length > 0) {
    cur = cur.inner[0];
  }
  return cur;
}

function whitespace(operand: AstNode): string | null {
  const stripped = stripCasts(operand);
  if (stripped?.referencedDecl?.name === 'endl') {
    return '\n';
  }
  if (stripped?.kind === 'CharacterLiteral') {
    const code = Number.parseInt(stripped.value ?? '', 10);
    if (code === 9 || code === 10 || code === 32) {
      return String.fromCharCode(code);
    }
  }
  return null;
}

function outputSuffix(operands: AstNode[]): string {
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

function analyzeStatement(
  node: AstNode,
  program: string,
  state: Record<string, any>,
  records: Record<string, RecordInfo>,
  references: Record<string, string>
): Statement {
  let cur = node;
  while (cur?.kind === 'ExprWithCleanups' && (cur.inner ?? []).length === 1) {
    cur = cur.inner![0];
  }
  let [start, end] = bounds(cur);
  if (end < program.length && program[end] === ';') {
    end += 1;
  }
  const [source, mapping] = compact(program.slice(start, end));
  let left: AstNode | null = null;
  let declared: string | null = null;
  let outSuffix: string | null = null;
  let printed: string | null = null;
  let root: AstNode | null = null;
  let nameOffset: number | null = null;
  let whole = false;
  let pointer = false;
  let emptyInitializer = false;
  let reference = false;
  let record: string | null = null;
  let size: number | null = null;
  let variable: AstNode | null = null;

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
    variable = children[0];
    if ((variable.inner ?? []).some(child => (child.kind ?? '').endsWith('Attr'))) {
      throw new Unsupported('declaration attributes need a separate memory-layout visualization');
    }
    const spelling = typeSpelling(variable);
    reference = spelling.endsWith('&');
    if (reference) {
      if (spelling.endsWith('&&')) {
        throw new Unsupported('rvalue references are not supported');
      }
      // A reference to anything a variable may hold.
      const referred = Object.fromEntries(
        Object.entries(variable.type ?? {}).map(([key, text]) => [key, text.slice(0, -1).replace(/\s+$/, '')])
      );
      _depth({ type: referred }, records);
    } else {
      pointer = _depth(variable, records) > 0;
      size = pointer ? POINTER_SIZE : (integerType(variable)?.size ?? null);
    }
    record = !pointer && Object.hasOwn(records, typeName(variable)) ? typeName(variable) : null;
    declared = variable.name ?? null;
    if (
      !declared ||
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
      root = root.inner![0];
    }
    while (
      reference &&
      root &&
      root.castKind === 'NoOp' &&
      (root.inner ?? []).length === 1
    ) {
      root = root.inner![0];
    }
    if (
      record &&
      root &&
      root.kind === 'CXXConstructExpr' &&
      (!root.inner || root.inner.length === 0)
    ) {
      const pane = source.replace(/;$/, '');
      return new Statement({
        source,
        span: null,
        pane,
        value: filled(records[record], records),
        target: declared,
        declared,
        record,
        slot: [0, pane.length],
        type: displayedType(variable),
      });
    }
    if (record && root && root.kind === 'CXXConstructExpr' && (root.inner ?? []).length === 1) {
      root = root.inner![0];
    }
    emptyInitializer =
      Boolean(root) && root!.kind === 'InitListExpr' && (!root!.inner || root!.inner.length === 0);
  } else if (
    (cur.kind === 'BinaryOperator' && cur.opcode === '=') ||
    (cur.kind === 'CXXOperatorCallExpr' &&
      (cur.inner ?? []).length === 3 &&
      Object.hasOwn(records, typeName(cur)))
  ) {
    const inner = cur.inner!;
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
      root = root.inner![0];
    }
  } else {
    throw new Unsupported(`unsupported statement: ${cur.kind}`);
  }

  if (root === null) {
    const pane = source.replace(/;$/, '').replace(/\s+$/, '');
    return new Statement({
      source,
      span: null,
      pane,
      target: declared,
      declared,
      pointer,
      slot: [0, pane.length],
      type: displayedType(variable),
      size,
    });
  }

  const [first, last] = whole ? [start, bounds(cur)[1]] : bounds(root);
  const span: Span = [mapping[first - start], mapping[last - start]];
  const [prefix, suffix] = paneParts(source, span, emptyInitializer);
  const text = source.slice(span[0], span[1]);

  function toPane(offset: number): number {
    const position = mapping[offset - start];
    return position < span[0] ? position : position - span[0] + prefix.length;
  }

  function locate(item: AstNode): Span {
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
  const names = new Set([...Object.keys(state), ...Object.keys(references)]);
  const typed = [...(left !== null ? typedParts(left, locate, names) : []), ...typedParts(root, locate, names)].sort(
    compareTyped
  );
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
      destination: [toPane(nameOffset!), toPane(nameOffset!) + declared!.length],
      typed,
    });
  }

  let target = declared;
  let destination: Span | null = null;
  let designation: Reduction[] = [];
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
  let slot: Span | null = null;
  if (declared) {
    destination = [toPane(nameOffset!), toPane(nameOffset!) + declared.length];
    slot = [0, destination[1]];
  } else if (left === null && isPlainObject(value)) {
    throw new Unsupported('only integer and pointer output is supported');
  } else if (left === null && integerType(root)?.size === 1) {
    throw new Unsupported('std::cout prints a one-byte integer as a character');
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
    typed,
    slot,
    type: declared ? displayedType(variable) : null,
    size,
  });
}

function storedAt(value: any, path: string[], newValue: any): any {
  if (path.length === 0) {
    return newValue;
  }
  return { ...value, [path[0]]: storedAt(value[path[0]], path.slice(1), newValue) };
}

export function _after(statement: Statement, state: Record<string, any>): Record<string, any> {
  if (hooks.after) {
    return hooks.after(statement, state);
  }
  return defaultAfter(statement, state);
}

export function defaultAfter(statement: Statement, state: Record<string, any>): Record<string, any> {
  const after = { ...state };
  if (statement.target !== null) {
    const [owner, ...path] = statement.target.split('.');
    after[owner] = storedAt(after[owner], path, statement.value);
  }
  return after;
}

const PREAMBLE = '#include <iostream>\n#include <cstdint>\nusing namespace std;\nint main() {\n';

// Clang's ways of saying that a value of one type cannot be stored where another is needed.
// After an alias Clang adds what it stands for, `'size_t *' (aka 'unsigned long *')`.
const AKA = String.raw`(?: \(aka '[^']+'\))?`;
const MISMATCHES = [
  String.raw`cannot initialize a variable of type '(?<to>[^']+)'${AKA} with an? \w+ of type '(?<from>[^']+)'`,
  String.raw`assigning to '(?<to>[^']+)'${AKA} from (?:incompatible type )?'(?<from>[^']+)'`,
  String.raw`no viable conversion from '(?<from>[^']+)'${AKA} to '(?<to>[^']+)'`,
  // A struct on the left: overload resolution fails, and the note names the types.
  String.raw`no viable overloaded '='; note: .*?no known conversion from '(?<from>[^']+)'${AKA} ` +
    String.raw`to '(?:const )?(?<to>[^'&]+?)(?: &)?' for 1st argument`,
].map(pattern => new RegExp(pattern));

/**
 * A last statement that does not compile because its value does not fit its slot.
 *
 * `source` is the statement and `span` its value, for the code highlight; `pane` is the
 * statement in the lessons' notation, `slot` and `value` its two typed parts there.
 */
export interface Mismatch {
  source: string;
  span: Span;
  pane: string;
  slot: Span;
  value: Span;
  needed: string;
  given: string;
}

/** The last index of `character` before `end`, or -1. */
function lastBefore(text: string, character: string, end: number): number {
  return end > 0 ? text.lastIndexOf(character, end - 1) : -1;
}

const leading = (text: string): number => text.length - text.trimStart().length;

/**
 * Split a body whose last statement is a type mismatch into what runs and the mismatch.
 *
 * Clang reports the value, the declared name when the value follows `=`, or the `=` itself
 * when the slot is a struct; everything before the value, up to the previous statement, is
 * the slot. Any other error, or one that is not in the last statement, stays unsupported.
 */
export function _mismatch(body: string, error: IllFormed): [string, Mismatch] {
  const found = MISMATCHES.map(pattern => pattern.exec(error.message)).find(Boolean)?.groups;
  let at = error.offset === null ? -1 : error.offset - PREAMBLE.length;
  if (!found || at < 0 || at >= body.length) throw error;
  const end = body.indexOf(';', at);
  let start = Math.max(lastBefore(body, ';', at), lastBefore(body, '}', at)) + 1;
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
  const braced = body.slice(start, at).trimEnd().endsWith('{');
  const written = body.slice(at, end).trimEnd();
  const valueEnd = braced ? written.replace(/\}$/, '').trimEnd() : written;
  const span: Span = [mapping[at - start], mapping[at - start + valueEnd.length]];
  const [prefix, suffix] = paneParts(source, span, false);
  const slot = prefix.trimEnd().replace(/=$/, '').trimEnd();
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
      given: displayed(found.from),
    },
  ];
}

export function analyzeWithFrontend(
  source: string,
  frontend: CompilerFrontend
): [Statement[], Record<string, RecordInfo>] {
  const program = PREAMBLE + source + '\n}\n';
  const ast = frontend.mainAst(program);
  const records = layoutsFromFrontend(ast, program, frontend);
  const statements: Statement[] = [];
  let state: Record<string, any> = {};
  const references: Record<string, string> = {};
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
    if (statement.bound && statement.declared) {
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

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function _normalize(
  addresses: Record<string, number>,
  sizes: Record<string, number>
): Record<string, number> {
  const alignment = Math.max(...Object.values(sizes));
  const lowest = Math.min(...Object.values(addresses));
  const base = lowest - pyMod(lowest, alignment);
  const result: Record<string, number> = {};
  for (const [name, address] of Object.entries(addresses)) {
    result[name] = FIRST_ADDRESS + address - base;
  }
  return result;
}

function withoutReferenceSlots(
  real: Record<string, number>,
  variables: TraceVariable[]
): Record<string, number> {
  const packed = storageAddresses(variables);
  const names = variables.map(v => v.name);
  const sortedReal = [...names].sort((a, b) => real[a] - real[b]);
  const sortedPacked = [...names].sort((a, b) => packed[a] - packed[b]);
  if (sortedReal.some((n, i) => n !== sortedPacked[i])) {
    throw new Unsupported('runtime order of the variables disagrees with their declarations');
  }
  return packed;
}

/**
 * Check every live leaf, including unchanged fields, against GDB after each statement.
 *
 * A struct and its first field can share an address. Keep the statically typed target and
 * verify its address rather than trying to recover an ambiguous target from that number.
 */
export function _observed(
  execution: Execution,
  predicted: Record<string, any>[],
  variables: TraceVariable[],
  references: Record<string, string>
): [Record<string, number>, Record<string, any>[]] {
  const cells = leaves(variables);
  const addresses: Record<string, number> = {};
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
        const base = cell.object_address!;
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
      const refTarget = references[name];
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

function spaceless(text: string): string {
  return text.replace(/\s+/g, '');
}

/** The pane as reductions replace parts of its original text, innermost first. */
class Pane {
  original: string;
  edits: [number, number, string][];
  // The typed parts, in original coordinates; `slot` is one of them.
  typed: Typed[];
  slot: Span | null;

  constructor(text: string, typed: Typed[] = [], slot: Span | null = null) {
    this.original = text;
    this.edits = []; // [start, end, text] in original coordinates
    this.typed = [...typed];
    this.slot = slot;
  }

  /** The typed parts of the current text, in order. */
  get types(): TypedPart[] {
    return [...this.typed].sort(compareTyped).map(([[start, end], type]) => {
      const part: TypedPart = { span: this.locate(start, end), type };
      if (this.slot && this.slot[0] === start && this.slot[1] === end) part.slot = true;
      return part;
    });
  }

  /**
   * The original `[start, end)` is now one value of `type`: its parts are no longer. Inside a
   * typed part (the `rs` of `rs.f`) nothing changes: the part keeps its type.
   */
  retype(start: number, end: number, type: string | null): void {
    const same = ([begin, finish]: Span): boolean => begin === start && finish === end;
    if (this.typed.some(([span]) => span[0] <= start && end <= span[1] && !same(span))) return;
    const kept = type || this.typed.find(([span]) => same(span))?.[1];
    this.typed = this.typed.filter(([span]) => !(start <= span[0] && span[1] <= end));
    if (kept) this.typed.push([[start, end], kept]);
  }

  get text(): string {
    const parts: string[] = [];
    let cursor = 0;
    for (const [start, end, newText] of this.edits) {
      parts.push(this.original.slice(cursor, start), newText);
      cursor = end;
    }
    return parts.join('') + this.original.slice(cursor);
  }

  locate(start: number, end: number): Span {
    const shift = (at: number): number => {
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

  read(start: number, end: number): string {
    const [first, last] = this.locate(start, end);
    return this.text.slice(first, last);
  }

  /**
   * Replace the original `[start, end)`; returns the span it covered in the old text. The new
   * text has `type`, or keeps the type the span had as a whole.
   */
  replace(start: number, end: number, newText: string, type: string | null = null): Span {
    const span = this.locate(start, end);
    this.retype(start, end, type);
    const filtered = this.edits.filter(edit => !(start <= edit[0] && edit[1] <= end));
    filtered.push([start, end, newText]);
    filtered.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.edits = filtered;
    return span;
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
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

/** Turns analyzed statements and their (observed) states into unified trace steps. */
class Renderer {
  addresses: Record<string, number>;
  // Types are drawn only where an example asks for them: elsewhere they are noise.
  types: boolean;
  refs: Record<string, string> | null;
  order: string[];
  steps: TraceStep[];
  stdout: string;
  real: Record<string, number>;
  realStdout: string;

  constructor(
    addresses: Record<string, number>,
    cells: Record<string, unknown> | null = null,
    real: Record<string, number> | null = null,
    hasReferences = false,
    types = false
  ) {
    this.addresses = addresses;
    this.types = types;
    this.refs = hasReferences ? {} : null;
    const keys = Object.keys(cells ?? addresses);
    this.order = keys.sort((a, b) => addresses[a] - addresses[b]);
    this.steps = [];
    this.stdout = '';
    this.real = real ?? addresses;
    this.realStdout = '';
  }

  printed(pointer: Pointer, addresses: Record<string, number>): string {
    if (pointer.target === null) {
      return '0';
    }
    const address = addresses[pointer.target];
    if (addresses === this.real && this.real !== this.addresses) {
      return `0x${address.toString(16)}`;
    }
    return `0x${address.toString(16).padStart(16, '0')}`;
  }

  show(value: any): string {
    if (isPlainObject(value)) {
      return `{${Object.values(value)
        .map(item => this.show(item))
        .join(', ')}}`;
    }
    return String(this.stored(value));
  }

  stored(value: any): number {
    if (value instanceof Pointer) {
      return value.target ? this.addresses[value.target] : 0;
    }
    return value;
  }

  add(
    line: number,
    pane: Pane,
    expr: Span | null,
    state: Record<string, any>,
    op: any = null,
    hold = 1.0
  ): void {
    const flat = _flatten(state);
    const values: Record<string, StoredCellValue> = {};
    for (const name of this.order) {
      values[name] = !Object.hasOwn(flat, name)
        ? null
        : flat[name] === null
          ? UNKNOWN
          : this.stored(flat[name]);
    }
    const targets: Record<string, string> = {};
    for (const [name, value] of Object.entries(flat)) {
      if (value instanceof Pointer && value.target) {
        targets[name] = value.target;
      }
    }
    const step: TraceStep = {
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
    this.retyped(step, pane);
    if (this.refs !== null) {
      step.refs = { ...this.refs };
    }
    this.steps.push(step);
  }

  /** Give a step the pane's types, in a trace that shows them. */
  retyped(step: TraceStep, pane: Pane): void {
    const types = this.types ? pane.types : [];
    if (types.length) step.types = types;
    else delete step.types;
  }

  statement(
    line: number,
    statement: Statement,
    before: Record<string, any>,
    after: Record<string, any>
  ): void {
    const typed: Typed[] = statement.slot ? [...statement.typed, [statement.slot, statement.type!]] : statement.typed;
    const pane = new Pane(statement.pane, typed, statement.slot);
    const expr = statement.expr;
    const writes = statement.target !== null && statement.result !== null;
    this.add(line, pane, expr, writes ? before : after);
    for (const reduction of statement.reductions) {
      let text: string;
      let op: Record<string, any>;
      if (reduction.kind === 'read') {
        text = (reduction.record ?? '') + this.show(load(before, reduction.name!));
        op = { kind: 'read', name: reduction.name, value: text };
      } else if (reduction.kind === 'addr') {
        text = String(this.addresses[reduction.name!]);
        op = { kind: 'addr', name: reduction.name, value: text };
      } else if (reduction.kind === 'alias') {
        text = reduction.spelling!;
        op = { kind: 'alias', name: reduction.name, target: text };
      } else if (reduction.kind === 'deref') {
        text = (reduction.value ?? load(before, reduction.name!)).target;
        op = { kind: 'deref', target: text, via: reduction.name };
      } else if (reduction.kind === 'convert' && this.types) {
        text = this.show(reduction.value);
        op = { kind: 'convert', value: text, from: reduction.source, to: reduction.type };
      } else {
        text = reduction.spelling ?? (reduction.record ?? '') + this.show(reduction.value);
        op = { kind: 'eval', value: text };
        // A brace list of plain values is already its value, however it is spaced.
        if (
          isPlainObject(reduction.value) &&
          spaceless(pane.read(reduction.span[0], reduction.span[1])) === spaceless(text)
        ) {
          text = pane.read(reduction.span[0], reduction.span[1]);
        }
      }
      // A typed conversion is a step even when the digits stay: the type is what changes.
      // Untyped, it is an evaluation like any other, seen only when the text changes.
      if (pane.read(reduction.span[0], reduction.span[1]) !== text || op.kind === 'convert') {
        op.span = pane.replace(reduction.span[0], reduction.span[1], text, reduction.type);
        this.add(line, pane, expr, before, op);
      } else {
        // No step of its own, but the text now reads as one value of its type.
        pane.retype(reduction.span[0], reduction.span[1], reduction.type);
        this.retyped(this.steps[this.steps.length - 1], pane);
      }
    }
    if (statement.result === null) {
      return;
    }
    if (statement.bound && statement.declared && statement.destination) {
      this.refs![statement.declared] = statement.bound;
      const op = {
        kind: 'bind' as const,
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
        kind: 'eval' as const,
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
          kind: 'eval' as const,
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
    const name = statement.target!;
    const old = load(before, name, true);
    const op = {
      kind: 'write' as const,
      name,
      value: text,
      span,
      destination: pane.locate(statement.destination![0], statement.destination![1]),
    };
    const redirected =
      old instanceof Pointer && Boolean(old.target) && !valuesEqual(old, load(after, name));
    this.add(line, pane, expr, after, op, redirected ? 1.6 : 1.2);
  }

  /** The statement as written, then its value's type against the type its slot needs. */
  mismatch(line: number, mismatch: Mismatch, state: Record<string, any>): void {
    const typed: Typed[] = [
      [mismatch.slot, mismatch.needed],
      [mismatch.value, mismatch.given],
    ];
    const pane = new Pane(mismatch.pane, typed, mismatch.slot);
    this.add(line, pane, mismatch.value, state);
    const op: ClashOperation = {
      kind: 'clash',
      span: [...mismatch.value],
      destination: [...mismatch.slot],
      from: mismatch.given,
      to: mismatch.needed,
    };
    this.add(line, pane, mismatch.value, state, op);
  }
}

export interface TraceOptions {
  runtime?: boolean;
  /**
   * The pane and memory carry types, a conversion is a step of its own, and a last statement
   * whose types do not fit is shown as a final step that does not run.
   */
  types?: boolean;
  frontend: CompilerFrontend;
  executor?: RuntimeExecutor | null;
  directory?: string;
}

/**
 * Trace a snippet into a validated unified-format trace, rejecting unsupported constructs.
 *
 * With `runtime: false` (probing) nothing is executed: values are the predicted ones and the
 * layout is Clang's usual -O0 layout.
 */
export function traceWithFrontend(source: string, options: TraceOptions): ExecutionTrace {
  const { runtime = true, types = false, frontend, executor = hooks.execute, directory } = options;
  let body = _body(source);
  let mismatch: Mismatch | null = null;
  let statements: Statement[];
  let records: Record<string, RecordInfo>;
  try {
    [statements, records] = analyzeWithFrontend(body, frontend);
  } catch (error) {
    if (!types || !(error instanceof IllFormed)) throw error;
    // A last statement whose types do not fit is shown, not run: the rest is traced.
    [body, mismatch] = _mismatch(body, error);
    [statements, records] = analyzeWithFrontend(body, frontend);
  }
  const predicted: Record<string, any>[] = [];
  let state: Record<string, any> = {};
  for (const statement of statements) {
    state = _after(statement, state);
    predicted.push(state);
  }
  const declarations = statements.filter(s => s.declared);
  const variables: TraceVariable[] = [];
  const references: Record<string, TraceReference> = {};
  let top = -8;
  const fieldColors: Record<string, number> = {};
  for (let color = 0; color < declarations.length; color++) {
    const declaration = declarations[color];
    const name = declaration.declared!;
    if (declaration.bound) {
      references[name] = traceReference(name, color);
      continue;
    }
    const record = declaration.record ? records[declaration.record] : undefined;
    const size = record ? record.size : declaration.size!;
    const alignment = record ? record.alignment : size;
    top = floorDiv(top - size, alignment) * alignment;
    if (record) {
      const fieldsOf = (rec: RecordInfo): TraceField[] => {
        const flds: TraceField[] = [];
        for (const item of rec.fields) {
          if (!Object.hasOwn(fieldColors, item.name)) {
            fieldColors[item.name] = Object.keys(fieldColors).length;
          }
          const shade = fieldColors[item.name];
          if (item.kind === 'struct') {
            flds.push(
              structField(
                item.name,
                item.type!,
                item.offset,
                item.size,
                fieldsOf(records[item.type!]),
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
      variables.push(
        scalar(name, top, size, declaration.pointer ? 'ptr' : 'int', color, types ? declaration.type : null)
      );
    }
  }
  let addresses: Record<string, number>;
  let states: Record<string, any>[];
  let execution: Execution | null = null;
  if (runtime) {
    if (!executor) {
      throw new Unsupported('runtime executor is required when runtime=true');
    }
    const scopes: ScopeEntry[][] = [];
    const bound: Record<string, string> = {};
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const row = predicted[i];
      if (statement.bound && statement.declared) {
        bound[statement.declared] = statement.bound;
      }
      scopes.push([
        ...Object.entries(_flatten(row)).map(([name, value]): ScopeEntry => [name, value !== null]),
        ...Object.keys(bound).map((name): ScopeEntry => [name, REFERENCE]),
      ]);
    }
    execution = executor(
      statements.map(s => s.source),
      scopes,
      directory
    );
    [addresses, states] = _observed(execution, predicted, variables, bound);
  } else {
    addresses = storageAddresses(variables);
    states = predicted;
  }
  const real = addresses;
  if (Object.keys(references).length > 0) {
    addresses = withoutReferenceSlots(addresses, variables);
  }
  const alignment = Math.max(
    ...Object.values(records).map(r => r.alignment),
    ...declarations.filter(d => !d.record && !d.bound).map(d => d.size!),
    4
  );
  addresses = _normalize(addresses, { ABI: alignment });
  for (const variable of variables) {
    variable.address = addresses[variable.name];
  }
  variables.sort((a, b) => a.address - b.address);

  const shown: [Statement, Record<string, any>][] = [];
  for (let i = 0; i < statements.length; i++) {
    if (!DEFINITION.test(statements[i].source)) {
      shown.push([statements[i], states[i]]);
    }
  }
  if (shown.length === 0) {
    throw new Unsupported('a snippet of only struct definitions has nothing to step through');
  }
  const hasRefs = Object.keys(references).length > 0;
  const renderer = new Renderer(addresses, leaves(variables), real, hasRefs, types);
  let previous: Record<string, any> = {};
  for (let line = 0; line < shown.length; line++) {
    const [statement, after] = shown[line];
    renderer.statement(line, statement, previous, after);
    previous = after;
  }
  if (runtime && execution && renderer.realStdout !== execution.stdout) {
    throw new Unsupported('runtime output disagrees with the expression trace');
  }
  const shownStatements: { source: string; span: Span | null }[] = shown.map(([s]) => s);
  if (mismatch) {
    renderer.mismatch(shownStatements.length, mismatch, previous);
    shownStatements.push(mismatch);
  }
  renderer.steps[renderer.steps.length - 1].hold = 3;
  const result: ExecutionTrace = {
    format: FORMAT,
    source: shownStatements.map(s => s.source),
    spans: shownStatements.map(s => (s.span ? ([...s.span] as Span) : null)),
    variables,
    steps: renderer.steps,
  };
  const structs = definitions(body);
  if (Object.keys(structs).length > 0) {
    result.types = structs;
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
