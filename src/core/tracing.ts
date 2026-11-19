// Compiler-backed execution traces of flat integer, pointer and aggregate struct examples (isomorphic core).
//
// Clang supplies syntax, types and record layouts via `CompilerFrontend`. A strict AST whitelist
// predicts each statement's effects without executing arbitrary C++. An optional `RuntimeExecutor`
// (such as GDB in Node) verifies every live scalar and struct field after every statement.

import { arrayType, codeName, elementLabel, operatorName, resolveArrayAliases } from './arrays.ts';
import { type AstNode, type CompilerFrontend, IllFormed, NeedsFlag, Unsupported } from './errors.ts';
import { COMPOUND_OPERATORS, openCompound } from './compound.ts';
import { SourceFile, arrayHeader, bounds } from './source.ts';
import { INTEGERS, Integer, bareSpelling, integerName, integerSpelled } from './integers.ts';
import type { Flags } from './settings.ts';
import {
  type Record as RecordInfo,
  type RecordFieldInfo,
  canonicalType,
  displayed,
  displayedType,
  layoutsFromFrontend,
  recordName,
  typeSpelling,
} from './records.ts';
import { displayNumber, formatFloat } from './floats.ts';
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
  type TraceOperation,
  UNKNOWN,
  addresses as storageAddresses,
  contiguous,
  field as traceField,
  leaves,
  reference as traceReference,
  scalar,
  struct,
  structField,
  validate,
  whitespaceOutput,
} from './trace_format.ts';

export { INTEGERS, Integer } from './integers.ts';

export { IllFormed, NeedsFlag, Unsupported };

export interface CellInput {
  address: number;
  size: number;
  pointer: boolean;
  value: number | null;
  objectAddress?: number | null;
  objectSize?: number | null;
  reference?: boolean;
}

export class Cell {
  address: number;
  size: number;
  pointer: boolean;
  value: number | null;
  objectAddress: number | null;
  objectSize: number | null;
  reference: boolean;

  constructor({
    address,
    size,
    pointer,
    value,
    objectAddress = null,
    objectSize = null,
    reference = false,
  }: CellInput) {
    this.address = address;
    this.size = size;
    this.pointer = pointer;
    this.value = value;
    this.objectAddress = objectAddress;
    this.objectSize = objectSize;
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
  /** The state after a statement, from the state before it; tests swap it to break predictions. */
  after: (statement: Statement, state: State) => State;
} = {
  execute: null,
  after: (statement, state) => storeResult(statement, state),
};

const FIRST_ADDRESS = 64;
const POINTER_SIZE = 8;
// JSON numbers are doubles in the player: larger magnitudes would not be drawn exactly.
const MAX_EXACT = 2n ** 53n;
const MAX_STATEMENTS = 20;
const MAX_VARIABLES = 8;
// Values -----------------------------------------------------------------------------------

export const FLOATINGS: Readonly<Record<string, { size: number; round: (value: number) => number }>> =
  Object.freeze({
    float: Object.freeze({ size: 4, round: (value: number) => Math.fround(value) }),
    double: Object.freeze({ size: 8, round: (value: number) => value }),
  });

function floatNamed(spelling: string, records: unknown = {}): { size: number; round: (value: number) => number } | null {
  const bare = spelling.replace(/^const /, '').replace(/^std::/, '');
  if (hasRecord(records, bare)) return null;
  return Object.hasOwn(FLOATINGS, bare) ? FLOATINGS[bare] : null;
}

function floatType(node: AstNode | null | undefined, records: unknown = {}): { size: number; round: (value: number) => number } | null {
  return floatNamed(canonicalType(node), records);
}

export class Pointer {
  target: string | null;

  constructor(target: string | null = null) {
    this.target = target;
    Object.freeze(this);
  }
}

/** An operation before the pane says where it happens. */
type Unplaced<T> = T extends unknown ? Omit<T, 'span'> : never;

/** A struct's value: its fields' values by name. */
export interface StructValue {
  [field: string]: Value;
}

/** What a variable or field holds: an integer, a pointer, a struct, or null until initialized. */
export type Value = number | Pointer | StructValue | null;

/** Every variable's value by name, between two statements. */
export type State = Record<string, Value>;

/** The pointer a value must be where the types say it is one. */
function asPointer(value: Value): Pointer {
  if (!(value instanceof Pointer)) throw new Error('expected a pointer value');
  return value;
}

/** A field of a value the types say is a struct. */
function fieldOf(value: Value, field: string): Value {
  if (!isPlainObject(value)) throw new Error(`expected a struct value with the field ${field}`);
  return value[field];
}

function isPlainObject(value: unknown): value is StructValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Pointer);
}

/** The integer type a spelling names, unless the snippet has a struct of that name. */
function integerNamed(spelling: string, records: unknown = {}): Integer | null {
  if (hasRecord(records, spelling.replace(/^const /, '').replace(/^std::/, ''))) return null;
  return integerSpelled(spelling);
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

/**
 * How a value of a type is shown: a float's byte size, `null` for an integer or a pointer, or a
 * record's shape for each of its fields.
 */
export type Shape = number | null | { readonly [field: string]: Shape };

function recordShape(record: RecordInfo, records: unknown): Shape {
  return Object.fromEntries(
    record.fields.map(field => {
      const nested = field.kind === 'struct' && field.type ? getRecord(records, field.type) : undefined;
      return [field.name, nested ? recordShape(nested, records) : field.floating ? field.size : null];
    })
  );
}

function shapeOf(node: AstNode | null | undefined, records: unknown): Shape {
  const float = floatType(node, records);
  if (float) return float.size;
  const record = pointerDepth(node, records) ? undefined : getRecord(records, recordName(node));
  return record ? recordShape(record, records) : null;
}

function getRecord(records: unknown, name: string): RecordInfo | undefined {
  if (!records || Array.isArray(records) || records instanceof Set) return undefined;
  const map = records as Record<string, RecordInfo>;
  return Object.hasOwn(map, name) ? map[name] : undefined;
}

/** How many pointer levels lie over an integer, float, void or a supported struct. */
export function pointerDepth(node: AstNode | null | undefined, records: unknown = {}): number {
  const qualified = typeSpelling(node);
  const intMatch = /^(const )?([\w: ]+?)(?: (\*+))?$/.exec(canonicalType(node));
  if (
    intMatch &&
    (integerNamed(intMatch[2], records) ||
      floatNamed(intMatch[2], records) ||
      (intMatch[2] === 'void' && Boolean(intMatch[3]))) &&
    !(intMatch[1] && intMatch[3])
  ) {
    return (intMatch[3] || '').length;
  }
  const recordType = recordName(node);
  if (hasRecord(records, recordType)) {
    return 0;
  }
  const pointerType = canonicalType(node).replace(/^struct /, '');
  const recPtrMatch = /^(\w+|(?:std::)?array<.+>) (\*+)$/.exec(pointerType);
  if (recPtrMatch && (hasRecord(records, recPtrMatch[1]) || arrayType(recPtrMatch[1]))) {
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

// Source display ---------------------------------------------------------------------------

export { arrayHeader, bounds };

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

// Evaluation -------------------------------------------------------------------------------

/**
 * One rewrite of the pane: the part at `span`, which indexes the statement's original pane,
 * becomes a value of `type`; inner reductions come first.
 * - `read`: the value of `name`; a struct value that has a type on its own keeps it in front,
 *   and `record` names it. With `compound`, it is the left operand of `a += b` read as it opens
 *   into `a = 5 + b`: the read replaces the hidden copy of `a`, and the operator shows it.
 * - `addr`: the address of `name`.
 * - `deref`: the name of the variable that the pointer `name` points to (`value`, when known).
 * - `alias`: what the reference `name` is bound to, `spelling`.
 * - `eval`: `value`, with `record` as for `read`.
 * - `convert`: a value of the type `source` becomes the `value` it has in `type`, even when it
 *   reads the same.
 */
export type Reduction = { readonly span: Span; readonly type: string; readonly shape: Shape } & (
  | {
      readonly kind: 'read';
      readonly name: string;
      readonly record: string | null;
      readonly compound?: string;
    }
  | { readonly kind: 'addr'; readonly name: string }
  | { readonly kind: 'deref'; readonly name: string; readonly value: Pointer | null }
  | { readonly kind: 'alias'; readonly name: string; readonly target: string }
  | { readonly kind: 'select'; readonly name: string }
  | { readonly kind: 'eval'; readonly value: Value; readonly record: string | null }
  | { readonly kind: 'convert'; readonly value: number | Pointer; readonly source: string }
);

/** A reduction's own fields, one shape per kind: the evaluator adds where it is and its type. */
type ReductionDetails = Reduction extends infer R ? (R extends unknown ? Omit<R, 'span' | 'type' | 'shape'> : never) : never;

function load(state: State, name: string, missing = false): Value {
  const [owner, ...path] = name.split('.');
  if (!missing && !Object.hasOwn(state, owner)) {
    throw new Error(`KeyError: ${owner}`);
  }
  let value = state[owner];
  for (const member of path) {
    value = fieldOf(value, member);
  }
  return value;
}

function flatten(state: State): State {
  const cells: State = {};
  for (const [name, value] of Object.entries(state)) {
    if (isPlainObject(value)) {
      const sub: State = {};
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

function filled(item: RecordInfo | RecordFieldInfo, records: Record<string, RecordInfo>, zero = false): Value {
  const record: RecordInfo | null =
    item && 'fields' in item && Array.isArray(item.fields)
      ? item
      : 'kind' in item && item.kind === 'struct' && item.type
        ? records[item.type]
        : null;
  if (record) {
    const res: State = {};
    for (const inner of record.fields) {
      res[inner.name] = filled(inner, records, zero);
    }
    return res;
  }
  return !zero ? null : ('kind' in item && item.kind === 'ptr' ? new Pointer() : 0);
}

function operandIsPointer(node: AstNode | null | undefined): boolean {
  return canonicalType(node).endsWith('*');
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
  state: State;
  locate: (item: AstNode) => Span;
  reductions: Reduction[];
  records: Record<string, RecordInfo>;
  references: Record<string, string>;
  storageTypes: Record<string, string>;
  temporary: boolean;

  constructor(
    state: State,
    locate: (item: AstNode) => Span,
    records: Record<string, RecordInfo>,
    references: Record<string, string> = {},
    storageTypes: Record<string, string> = {}
  ) {
    this.state = state;
    this.locate = locate;
    this.reductions = [];
    this.records = records;
    this.references = references;
    this.storageTypes = storageTypes;
    this.temporary = false;
  }

  /** A type spelling with its pointee and integer typedefs resolved: `uint8_t *` is `unsigned char *`. */
  private storageType(spelling: string): { base: string; stars: number } {
    const [, base, stars] = /^(.*?)((?:\s*\*)*)$/.exec(spelling.replace(/^struct /, '').trim())!;
    const name = base.trim();
    const integer = hasRecord(this.records, bareSpelling(name)) ? null : integerName(name);
    return { base: integer ?? name, stars: stars.replace(/\s/g, '').length };
  }

  /** Rejects reading `target` through a pointer to another type, such as a cast `void*`. */
  private checkPointeeType(pointer: AstNode, target: string): void {
    if (!Object.hasOwn(this.storageTypes, target)) {
      throw new Unsupported(`the storage type of ${target} is unknown`);
    }
    const through = this.storageType(canonicalType(pointer));
    const held = this.storageType(this.storageTypes[target]);
    if (through.base !== held.base || through.stars !== held.stars + 1) {
      const spell = ({ base, stars }: { base: string; stars: number }) =>
        stars ? `${base} ${'*'.repeat(stars)}` : base;
      throw new Unsupported(
        `dereferencing a pointer to ${spell({ ...through, stars: through.stars - 1 })} ` +
          `when ${target} holds ${spell(held)}`
      );
    }
  }

  private reduce(node: AstNode, details: ReductionDetails): void {
    this.reduceAt(this.locate(node), node, details);
  }

  /** A reduction at `span` to a value of the type of `typed`, a node or just its type. */
  private reduceAt(span: Span, typed: AstNode, details: ReductionDetails): void {
    this.reductions.push({
      ...details,
      span,
      type: displayedType(typed),
      shape: shapeOf(typed, this.records),
    });
  }

  /**
   * `left op= right`, already designated as `target`: the value it holds, read into the pane's
   * hidden copy of `left` at `copy`; the right side, then its parentheses at `group`, if any;
   * then the operation over `result` in the type Clang computes it in, and back in the type of
   * `left`.
   */
  compound(node: AstNode, target: string, copy: Span, result: Span, group: Span | null): number {
    const [left, right] = node.inner!;
    const operator = node.opcode!.slice(0, -1);
    const held = this.load(target);
    if (typeof held !== 'number') {
      throw new Unsupported('pointer arithmetic and comparison are not supported');
    }
    this.reduceAt(copy, left, { kind: 'read', name: target, record: null, compound: operator });
    const computation: AstNode = { type: node.computeLHSType };
    const resultType: AstNode = { type: node.computeResultType };
    const operand = this.convertedAt(copy, held, computation, left);
    const other = this.numericOperand(right);
    if (group) this.reduceAt(group, right, { kind: 'eval', value: other, record: null });
    const value = this.operate(resultType, operator, operand, other);
    this.reduceAt(result, resultType, { kind: 'eval', value, record: null });
    return this.convertedAt(result, value, left, resultType);
  }

  /** `node`, which designates `target`, spelled as `target` is: `(s.x)` becomes `s.x`. */
  respell(node: AstNode, target: string, written: string): void {
    const span = this.locate(node);
    const spelled = this.reductions.some(item => item.span[0] === span[0] && item.span[1] === span[1]);
    if (!spelled && written !== codeName(target)) this.reduce(node, { kind: 'select', name: target });
  }

  /** `value`, of the type of `source`, in the type of `node`; a step at `span` if the type changes. */
  private convertedAt(span: Span, value: number, node: AstNode, source: AstNode): number {
    if (displayedType(node) === displayedType(source)) return value;
    const converted = this.conversion(node, source)(value);
    this.reduceAt(span, node, { kind: 'convert', value: converted, source: displayedType(source) });
    return converted;
  }

  /** A brace list inside another one is part of its value, not an evaluation of its own. */
  private absorb(child: AstNode | undefined, value: Value): void {
    const last = this.reductions[this.reductions.length - 1];
    const list = child?.kind === 'InitListExpr' ||
      (child?.kind === 'CXXFunctionalCastExpr' && arrayType(canonicalType(child)));
    if (list && last?.kind === 'eval' && last.value === value) {
      this.reductions.pop();
    }
  }

  private load(name: string): Value {
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
      this.reduce(node, { kind: 'alias', name, target: this.references[name] });
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

  private arrayAccess(node: AstNode): { object: AstNode; array: NonNullable<ReturnType<typeof arrayType>>; member: AstNode | null; args: AstNode[] } | null {
    const [callee, ...operands] = node.inner ?? [];
    if (node.kind === 'CXXOperatorCallExpr' && operatorName(node) === 'operator[]') {
      const [object, ...args] = operands;
      const array = arrayType(canonicalType(object));
      if (array && args.length === 1) return { object, array, member: null, args };
    }
    if (node.kind === 'CXXMemberCallExpr' && callee?.kind === 'MemberExpr') {
      const [object] = callee.inner ?? [];
      const array = arrayType(canonicalType(object).replace(/ \*$/, ''));
      if (array && object) return { object, array, member: callee, args: operands };
    }
    return null;
  }

  private arrayObject(object: AstNode, arrow = false): string {
    const base = object.kind === 'ImplicitCastExpr' && object.castKind === 'NoOp'
      ? object.inner![0] : object;
    if (!arrow) return this.lvalue(base);
    const [value, via] = this.rvalue(base);
    const pointer = asPointer(value);
    if (via === null || pointer.target === null) {
      throw new Unsupported('array member access requires a non-null pointer variable');
    }
    this.checkPointeeType(base, pointer.target);
    return pointer.target;
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
    const access = this.arrayAccess(node);
    if (access && !access.member) {
      const owner = this.arrayObject(access.object);
      const indexNode = access.args[0];
      // The library takes size_t. A negative index is outside the array before conversion.
      const index = this.integerOperand(indexNode.castKind === 'IntegralCast' ? indexNode.inner![0] : indexNode);
      if (index < 0 || index >= access.array.count) {
        throw new Unsupported(`std::array index ${index} is out of bounds`);
      }
      const name = `${owner}.${elementLabel(index)}`;
      this.reduce(outer ?? node, { kind: 'select', name });
      return name;
    }
    if (kind === 'MemberExpr' && children.length === 1) {
      if (node.isArrow) {
        const [value, via] = this.rvalue(children[0]);
        if (via === null) {
          throw new Unsupported('arrow access requires a pointer variable');
        }
        const pointer = asPointer(value);
        if (pointer.target === null) {
          throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
        }
        this.checkPointeeType(children[0], pointer.target);
        const name = `${pointer.target}.${node.name}`;
        this.reduce(outer ?? node, { kind: 'deref', name: via, value: new Pointer(name) });
        return name;
      }
      return `${this.lvalue(children[0])}.${node.name}`;
    }
    if (kind === 'UnaryOperator' && node.opcode === '*' && children.length === 1) {
      const [value, via] = this.rvalue(children[0]);
      if (via === null) {
        throw new Unsupported('only dereferencing a pointer variable is supported, not a computed address');
      }
      const pointer = asPointer(value);
      if (pointer.target === null) {
        throw new Unsupported(`dereferencing the null pointer ${via} is undefined`);
      }
      this.checkPointeeType(children[0], pointer.target);
      this.reduce(outer ?? node, { kind: 'deref', name: via, value: null });
      return pointer.target;
    }
    throw new Unsupported(`unsupported assignable expression: ${kind}`);
  }

  rvalue(node: AstNode): [Value, string | null] {
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
        pointerDepth(node, this.records);
        const name = this.lvalue(children[0]);
        const value = this.load(name);
        this.reduce(node, { kind: 'read', name, record: null });
        return [value, name];
      }
      if (cast === 'NullToPointer' && pointerDepth(node, this.records)) {
        const literal = children[0];
        if (
          literal?.kind === 'CXXNullPtrLiteralExpr' ||
          (literal?.kind === 'IntegerLiteral' && literal?.value === '0')
        ) {
          this.reduce(node, { kind: 'eval', value: new Pointer(), record: null });
          return [new Pointer(), null];
        }
      }
      if (cast === 'NoOp') {
        return this.rvalue(children[0]);
      }
      rejectPointerOperator(children[0]);
      if (
        cast === 'IntegralCast' ||
        cast === 'IntegralToFloating' ||
        cast === 'FloatingToIntegral' ||
        cast === 'FloatingCast' ||
        (cast === 'BitCast' && canonicalType(node) === 'void *')
      ) {
        return [this.convert(node, children[0]), null];
      }
      throw new Unsupported(`implicit ${cast} conversions are outside this category`);
    }
    if (kind === 'CXXStaticCastExpr' && children.length === 1) {
      // Clang spells the conversion as implicit casts inside the written one: one step.
      let operand = children[0];
      while (
        operand?.kind === 'ImplicitCastExpr' &&
        (operand.castKind === 'IntegralCast' ||
          operand.castKind === 'IntegralToFloating' ||
          operand.castKind === 'FloatingToIntegral' ||
          operand.castKind === 'FloatingCast' ||
          operand.castKind === 'NoOp' ||
          (operand.castKind === 'BitCast' && canonicalType(operand) === 'void *')) &&
        (operand.inner ?? []).length === 1
      ) {
        operand = operand.inner![0];
      }
      return [this.convert(node, operand), null];
    }
    if (kind === 'UnaryExprOrTypeTraitExpr' && node.name === 'sizeof') {
      const target = node.argType ? { type: node.argType } : children[0];
      if (!target) throw new Unsupported('malformed sizeof expression');
      const argument = stripParentheses(target);
      const stringExtent = argument.kind === 'StringLiteral' &&
        /^const (?:char|char8_t)\[(\d+)\]$/.exec(canonicalType(argument));
      const size = stringExtent ? Number(stringExtent[1]) : this.byteSizeOf(target);
      this.reduce(node, { kind: 'eval', value: size, record: null });
      return [size, null];
    }
    const access = this.arrayAccess(node);
    if (access?.member && access.args.length === 0) {
      const { object, array, member } = access;
      if (member.name === 'data' || member.name === 'size') {
        const owner = this.arrayObject(object, member.isArrow);
        if (member.name === 'size') {
          this.reduce(node, { kind: 'eval', value: array.count, record: null });
          return [array.count, null];
        }
        const name = `${owner}.${elementLabel(0)}`;
        pointerDepth(node, this.records);
        this.reduce(node, { kind: 'addr', name });
        return [new Pointer(name), null];
      }
    }
    const depth = pointerDepth(node, this.records);
    const record = !depth ? getRecord(this.records, recordName(node)) : null;
    if (record) {
      const array = arrayType(record.name);
      const displayRecord = array ? null : record.name;
      if (kind === 'CXXFunctionalCastExpr' && children.length === 1) {
        const [value] = this.rvalue(children[0]);
        this.absorb(children[0], value);
        this.reduce(node, { kind: 'eval', value, record: displayRecord });
        return [value, null];
      }
      if (kind === 'InitListExpr') {
        const value: State = {};
        // The semantic list for std::array contains one backing C array. Clang's
        // JSON puts a filler followed by the explicit items in array_filler when short.
        const storage = array ? children[0] : null;
        const elements = array
          ? (storage?.array_filler?.slice(1) ?? storage?.inner ?? [])
          : children;
        for (const [i, item] of record.fields.entries()) {
          const child = elements[i];
          if (!child || child.kind === 'ImplicitValueInitExpr') {
            value[item.name] = filled(item, this.records, true);
          } else {
            const [childVal] = this.rvalue(child);
            value[item.name] = childVal;
            this.absorb(child, childVal);
          }
        }
        this.reduce(node, { kind: 'eval', value, record: null });
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
        (access && !access.member) ||
        (kind === 'UnaryOperator' && node.opcode === '*')
      ) {
        const name = this.lvalue(node);
        const value = this.load(name);
        if (Object.values(flatten({ [name]: value })).some(item => item === null)) {
          throw new Unsupported(`reading uninitialized struct ${name}`);
        }
        this.reduce(node, { kind: 'read', name, record: displayRecord });
        return [value, name];
      }
    }
    if (kind === 'IntegerLiteral') {
      return [exact(BigInt(node.value ?? '0')), null];
    }
    if (kind === 'FloatingLiteral') {
      const float = floatType(node, this.records);
      if (!float) throw new Unsupported(`unsupported floating literal type ${typeSpelling(node)}`);
      const value = float.round(Number(node.value ?? '0'));
      if (!Number.isFinite(value)) throw new Unsupported('non-finite floating-point value');
      return [value, null];
    }
    if (kind === 'InitListExpr' || kind === 'CXXFunctionalCastExpr') {
      return [this.braces(node, depth), null];
    }
    let value: Value;
    if (kind === 'ParenExpr' && children.length === 1) {
      [value] = this.rvalue(children[0]);
    } else if (kind === 'UnaryOperator' && node.opcode === '&' && children.length === 1) {
      if (children[0]?.kind !== 'DeclRefExpr' && children[0]?.kind !== 'MemberExpr' &&
          !this.arrayAccess(stripParentheses(children[0]))) {
        throw new Unsupported('only the address of a variable is supported');
      }
      const name = this.lvalue(children[0]);
      this.reduce(node, { kind: 'addr', name });
      return [new Pointer(name), null];
    } else if (
      kind === 'UnaryOperator' &&
      (node.opcode === '+' || node.opcode === '-') &&
      children.length === 1 &&
      !depth
    ) {
      const float = floatType(node, this.records);
      if (float) {
        const operand = this.numericOperand(children[0]);
        value = float.round(node.opcode === '+' ? operand : -operand);
      } else {
        const operand = BigInt(this.integerOperand(children[0]));
        value = exact(integerTypeOf(node).result(node.opcode === '+' ? operand : -operand));
      }
    } else if (kind === 'UnaryOperator' && node.opcode === '~' && children.length === 1 && !depth) {
      // Every bit of the (promoted) operand flips; this never overflows, even when signed.
      value = exact(integerTypeOf(node).wrap(~BigInt(this.integerOperand(children[0]))));
    } else if (
      kind === 'BinaryOperator' &&
      ['+', '-', '*', '/', '%'].includes(node.opcode ?? '') &&
      children.length === 2
    ) {
      rejectPointerOperator(node);
      value = this.operate(node, node.opcode!, this.numericOperand(children[0]), this.numericOperand(children[1]));
    } else {
      throw new Unsupported(`unsupported expression: ${kind} ${node?.opcode ?? ''}`.trimEnd());
    }
    this.reduce(node, { kind: 'eval', value, record: null });
    return [value, null];
  }

  /** `left operation right`, both evaluated, in the integer or floating type of `node`. */
  private operate(node: AstNode, operation: string, left: number, right: number): number {
    const float = floatType(node, this.records);
    if (float) return Evaluator.floatArithmetic(float, operation, left, right);
    if (!Number.isInteger(left) || !Number.isInteger(right)) {
      throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || 'this type'}`);
    }
    return Evaluator.arithmetic(integerTypeOf(node), operation, left, right);
  }

  private byteSizeOf(node: AstNode): number {
    if (pointerDepth(node, this.records) > 0) return POINTER_SIZE;
    const record = getRecord(this.records, recordName(node));
    if (record) return record.size;
    const int = integerType(node, this.records);
    if (int) return int.size;
    const float = floatType(node, this.records);
    if (float) return float.size;
    throw new Unsupported(`cannot determine size of ${typeSpelling(node)}`);
  }

  private numericOperand(node: AstNode): number {
    const [value] = this.rvalue(node);
    if (typeof value !== 'number') {
      throw new Unsupported('pointer arithmetic and comparison are not supported');
    }
    return value;
  }

  private integerOperand(node: AstNode): number {
    const value = this.numericOperand(node);
    if (!Number.isInteger(value)) {
      throw new Unsupported(`only integer arithmetic is supported, not ${typeSpelling(node) || 'this type'}`);
    }
    return value;
  }

  /** `operand` converted to the integer, float or pointer type of `node`, a cast written or implied. */
  private convert(node: AstNode, operand: AstNode): number | Pointer {
    const depth = pointerDepth(node, this.records);
    const operandDepth = pointerDepth(operand, this.records);
    let value: number | Pointer;
    if (depth > 0 && operandDepth > 0 && (canonicalType(node) === 'void *' || canonicalType(operand) === 'void *')) {
      const [ptr] = this.rvalue(operand);
      value = asPointer(ptr);
    } else {
      value = this.conversion(node, operand)(this.numericOperand(operand));
    }
    const source = displayedType(operand);
    if (source === displayedType(node)) {
      // `static_cast<int>` of an int changes nothing: the cast just goes away.
      this.reduce(node, { kind: 'eval', value, record: null });
    } else {
      this.reduce(node, { kind: 'convert', value, source });
    }
    return value;
  }

  /** How a number of the type of `source` becomes one of the type of `node`. */
  private conversion(node: AstNode, source: AstNode): (value: number) => number {
    const targetInt = integerType(node, this.records);
    const targetFloat = floatType(node, this.records);
    const sourceInt = integerType(source, this.records);
    const sourceFloat = floatType(source, this.records);
    if (targetInt && sourceInt) {
      return value => exact(targetInt.wrap(BigInt(value)));
    }
    if (targetFloat && (sourceInt || sourceFloat)) {
      return value => {
        const rounded = targetFloat.round(value);
        if (!Number.isFinite(rounded)) throw new Unsupported('non-finite floating-point value');
        return rounded;
      };
    }
    if (targetInt && sourceFloat) {
      return value => {
        const truncated = Math.trunc(value);
        if (!Number.isFinite(truncated) || !targetInt.holds(BigInt(truncated))) {
          throw new Unsupported('floating-point conversion overflows integer type');
        }
        return exact(BigInt(truncated));
      };
    }
    throw new Unsupported('only conversions between integer types are supported');
  }

  private braces(node: AstNode, depth: number): Value {
    const children = node.inner ?? [];
    let value: Value;
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
    this.reduce(node, { kind: 'eval', value, record: null });
    return value;
  }

  private static floatArithmetic(
    type: { size: number; round: (value: number) => number },
    operation: string,
    left: number,
    right: number
  ): number {
    let raw: number;
    if (operation === '+') raw = left + right;
    else if (operation === '-') raw = left - right;
    else if (operation === '*') raw = left * right;
    else if (operation === '/') raw = left / right;
    else throw new Unsupported(`only integer arithmetic is supported, not ${operation}`);
    const res = type.round(raw);
    if (!Number.isFinite(res)) {
      throw new Unsupported('undefined floating-point division');
    }
    return res;
  }

  private static arithmetic(type: Integer, operation: string, left: number, right: number): number {
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

/**
 * The edits that make original pane text first show as written: `a = a + b` reads `a += b`
 * until the compound read opens it.
 */
export type Fold = [number, number, string][];

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
  value: Value;
  reductions: Reduction[];
  target: string | null;
  destination: Span | null;
  declared: string | null;
  pointer: boolean;
  record: string | null;
  outputSuffix: string | null;
  printed: string | null;
  temporary: boolean;
  bound: string | null;
  typed: Typed[];
  slot: Span | null;
  type: string | null;
  size: number | null;
  shape: Shape;
  fold: Fold | null;
  signs: Map<number, string>;
  definition: [string, string] | null;

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
    outputSuffix = null,
    printed = null,
    temporary = false,
    bound = null,
    typed = [],
    slot = null,
    type = null,
    size = null,
    shape = null,
    fold = null,
    signs = new Map(),
    definition = null,
  }: {
    source: string;
    span: Span | null;
    pane: string;
    expr?: Span | null;
    result?: Span | null;
    value?: Value;
    reductions?: Reduction[];
    target?: string | null;
    destination?: Span | null;
    declared?: string | null;
    pointer?: boolean;
    record?: string | null;
    outputSuffix?: string | null;
    printed?: string | null;
    temporary?: boolean;
    bound?: string | null;
    typed?: Typed[];
    slot?: Span | null;
    type?: string | null;
    size?: number | null;
    shape?: Shape;
    fold?: Fold | null;
    signs?: Map<number, string>;
    definition?: [string, string] | null;
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
    this.outputSuffix = outputSuffix;
    this.printed = printed;
    this.temporary = temporary;
    this.bound = bound;
    this.typed = typed;
    this.slot = slot;
    this.type = type;
    this.size = size;
    this.shape = shape;
    this.fold = fold;
    this.signs = signs;
    this.definition = definition;
  }
}

/**
 * The parts of an expression that have a type before anything is evaluated: local names (a
 * field access by `.` whole), literals and aggregate brace lists. Compound expressions get
 * theirs when reduced.
 */
function typedParts(
  node: AstNode,
  locate: (item: AstNode) => Span,
  names: Set<string>,
  records: Record<string, RecordInfo>
): Typed[] {
  if (node.kind === 'UnaryExprOrTypeTraitExpr') return [];
  let plain = node;
  while (plain?.kind === 'MemberExpr' && !plain.isArrow && (plain.inner ?? []).length === 1) {
    plain = plain.inner![0];
  }
  const local = plain?.kind === 'DeclRefExpr' && names.has(plain.referencedDecl?.name ?? '');
  const aggregate =
    (node.kind === 'InitListExpr' || node.kind === 'CXXFunctionalCastExpr') &&
    hasRecord(records, recordName(node));
  if (
    local ||
    aggregate ||
    node.kind === 'IntegerLiteral' ||
    node.kind === 'FloatingLiteral' ||
    node.kind === 'CXXNullPtrLiteralExpr'
  ) {
    return [[locate(node), displayedType(node)]];
  }
  const children = node.array_filler?.slice(1) ?? node.inner ?? [];
  return children.flatMap(child => typedParts(child, locate, names, records));
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

function recordPaths(
  prefix: string,
  rec: RecordInfo,
  records: Record<string, RecordInfo>,
  storageTypes: Record<string, string>
): void {
  for (const field of rec.fields) {
    const path = `${prefix}.${field.name}`;
    if (field.canonical) storageTypes[path] = field.canonical;
    if (field.kind === 'struct' && field.type && Object.hasOwn(records, field.type)) {
      recordPaths(path, records[field.type], records, storageTypes);
    }
  }
}

function analyzeStatement(
  node: AstNode,
  file: SourceFile,
  state: State,
  records: Record<string, RecordInfo>,
  references: Record<string, string>,
  storageTypes: Record<string, string> = {}
): Statement {
  let cur = node;
  while (cur?.kind === 'ExprWithCleanups' && (cur.inner ?? []).length === 1) {
    cur = cur.inner![0];
  }
  const [start, end] = bounds(cur);
  const finish = file.statementEnd(end);
  const [display, mapping] = file.display(start, end);
  const source = finish > end ? display + ';' : display;
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
        definition: [children[0].name!, recordSource(file, start, finish)],
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
      pointerDepth({ type: referred }, records);
    } else {
      pointer = pointerDepth(variable, records) > 0;
      size = pointer ? POINTER_SIZE : ((integerType(variable, records) ?? floatType(variable, records))?.size ?? null);
    }
    const aggregate = recordName(variable);
    record = !reference && !pointer && Object.hasOwn(records, aggregate) ? aggregate : null;
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
    if (!reference && declared) {
      if (record) {
        storageTypes[declared] = record;
        recordPaths(declared, records[record], records, storageTypes);
      } else {
        storageTypes[declared] = canonicalType(variable).replace(/^struct /, "");
      }
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
      operatorName(cur) === 'operator=' &&
      Object.hasOwn(records, recordName(cur)))
  ) {
    const inner = cur.inner!;
    left = inner[inner.length - 2];
    root = inner[inner.length - 1];
    pointerDepth(left, records);
    if (left.kind === 'ParenExpr' && stripParentheses(left).kind === 'DeclRefExpr') {
      throw new Unsupported('a parenthesized variable as assignment target is not supported');
    }
    whole =
      left.kind !== 'DeclRefExpr' ||
      Object.hasOwn(references, left.referencedDecl?.name ?? '');
  } else if (cur.kind === 'CompoundAssignOperator') {
    return analyzeCompound(cur, source, (offset: number) => mapping[offset - start], file, {
      state,
      records,
      references,
      storageTypes,
    });
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
      (root.castKind === 'BitCast' || root.castKind === 'NoOp') &&
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
      shape: shapeOf(variable, records),
    });
  }

  const [first, last] = whole ? [start, bounds(cur)[1]] : bounds(root);
  const span: Span = [mapping[first - start], mapping[last - start]];
  let [prefix, suffix] = paneParts(source, span, emptyInitializer);
  let removed = 0;
  if (record && arrayType(record)) {
    if (prefix.trimEnd().endsWith(declared!)) prefix = prefix.trimEnd() + ' = ';
    // Long template spellings stay in the source, where they do not crowd the pane.
    const name = mapping[nameOffset! - start];
    if (name > 21) {
      removed = name;
      prefix = prefix.slice(removed);
    }
  }
  const text = source.slice(span[0], span[1]);
  const written = prefix + text + suffix;
  // Array brace lists use the same compact spacing in initializers and assignments.
  const braceSpaces = arrayType(canonicalType(root))
    ? [...written.matchAll(/(?<=\{) +| +(?=\})/g)]
    : [];
  const pane = braceSpaces.length ? written.replace(/(?<=\{) +| +(?=\})/g, '') : written;

  function paneOffset(at: number): number {
    return at - braceSpaces.reduce((total, space) =>
      total + Math.max(0, Math.min(space[0].length, at - space.index)), 0);
  }

  function toPane(offset: number): number {
    const position = mapping[offset - start];
    return paneOffset(position < span[0] ? position - removed : position - span[0] + prefix.length);
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
      pane,
      expr: [paneOffset(prefix.length), paneOffset(prefix.length + text.length)],
      result: locate(root),
      outputSuffix: outSuffix,
      printed,
    });
  }

  const evaluator = new Evaluator(state, locate, records, references, storageTypes);
  const names = new Set([...Object.keys(state), ...Object.keys(references)]);
  const typed = [
    ...(left !== null ? typedParts(left, locate, names, records) : []),
    ...typedParts(root, locate, names, records),
  ].sort(compareTyped);
  if (reference) {
    const bound = evaluator.lvalue(root);
    evaluator.respell(root, bound, pane.slice(...locate(root)));
    if (evaluator.temporary) {
      throw new Unsupported('a reference bound to a temporary is not supported');
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
      destination: [toPane(nameOffset!), toPane(nameOffset!) + declared!.length],
      typed,
      slot: [0, toPane(nameOffset!) + declared!.length],
      type: displayedType(variable),
    });
  }

  let target = declared;
  let destination: Span | null = null;
  let designation: Reduction[] = [];
  if (left !== null) {
    target = evaluator.lvalue(left);
    destination = locate(left);
    evaluator.respell(left, target, pane.slice(...destination));
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
    temporary: evaluator.temporary && !target?.includes('.[') && !arrayType(canonicalType(left)),
    typed,
    slot,
    type: declared ? displayedType(variable) : null,
    size,
    shape: shapeOf(declared ? variable : root, records),
    signs: file.signs(start, end, toPane),
  });
}

/**
 * `a += b` as `a = a + b`: the pane's original text spells the second form, folded to show the
 * first until the compound read of `a` opens it.
 */
function analyzeCompound(
  node: AstNode,
  source: string,
  toSource: (offset: number) => number,
  file: SourceFile,
  context: {
    state: State;
    records: Record<string, RecordInfo>;
    references: Record<string, string>;
    storageTypes: Record<string, string>;
  }
): Statement {
  const { state, records, references, storageTypes } = context;
  const spelling = node.opcode!;
  const operator = spelling.slice(0, -1);
  if (!COMPOUND_OPERATORS.includes(operator)) {
    throw new Unsupported(`unsupported compound assignment ${spelling}`);
  }
  const [left, right] = node.inner ?? [];
  if (!left || !right || pointerDepth(left, records) > 0) {
    throw new Unsupported('pointer arithmetic and comparison are not supported');
  }
  if (left.kind === 'ParenExpr' && stripParentheses(left).kind === 'DeclRefExpr') {
    throw new Unsupported('a parenthesized variable as assignment target is not supported');
  }
  const written = source.replace(/;$/, '').replace(/\s+$/, '');
  const [l0, l1] = bounds(left).map(toSource);
  const [r0] = bounds(right).map(toSource);
  const token = file.tokens.find(token => toSource(token.start) >= l1);
  const t0 = token ? toSource(token.start) : -1;
  if (t0 < 0 || t0 + spelling.length > r0 || written.slice(t0, t0 + spelling.length) !== spelling) {
    throw new Unsupported('macro-expanded statements are not supported');
  }
  const t1 = t0 + spelling.length;
  const copied = written.slice(l0, l1);
  let top = right;
  while (top.kind === 'ImplicitCastExpr' && top.inner?.length === 1) top = top.inner[0];
  const grouped = top.kind === 'BinaryOperator' &&
    !((operator === '+' || operator === '-') && ['*', '/', '%'].includes(top.opcode!));
  const opened = openCompound(written, [t0, t1], copied, operator, grouped);
  const pane = opened.text;
  const toPane = (offset: number): number => {
    const at = toSource(offset);
    return at >= opened.from ? at - opened.from + opened.right : at;
  };
  const locate = (item: AstNode): Span => {
    const [b0, b1] = bounds(item);
    return [toPane(b0), toPane(b1)];
  };
  const copy = opened.left;
  const result: Span = [copy[0], pane.length];
  // Shown as written: the operator stands in for the copy of `a`, the spaces around it for the
  // rest of the hidden text, and the closing parenthesis is not there yet.
  const head = written.slice(0, t0).trimEnd().length;
  const fold: Fold = [
    [head, copy[0], written.slice(head, t0)],
    [copy[0], copy[1], spelling],
    [copy[1], opened.right, written.slice(t1, opened.from)],
    ...(grouped ? [[pane.length - 1, pane.length, ''] as [number, number, string]] : []),
  ];

  const evaluator = new Evaluator(state, locate, records, references, storageTypes);
  const names = new Set([...Object.keys(state), ...Object.keys(references)]);
  const typed = [
    ...typedParts(left, locate, names, records),
    ...typedParts(right, locate, names, records),
  ].sort(compareTyped);
  // The written order: the target, its old value, then the right side.
  const target = evaluator.lvalue(left);
  evaluator.respell(left, target, copied);
  const group: Span | null = grouped ? [opened.right - 1, pane.length] : null;
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
    shape: shapeOf(left, records),
    signs: file.signs(bounds(right)[0], bounds(right)[1], toPane),
  });
}

function storedAt(value: Value, path: string[], newValue: Value): Value {
  if (path.length === 0) {
    return newValue;
  }
  const struct = value as StructValue;
  return { ...struct, [path[0]]: storedAt(fieldOf(struct, path[0]), path.slice(1), newValue) };
}

export function storeResult(statement: Statement, state: State): State {
  const after = { ...state };
  if (statement.target !== null) {
    const [owner, ...path] = statement.target.split('.');
    after[owner] = storedAt(after[owner], path, statement.value);
  }
  return after;
}

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

/** Split off a final ill-typed statement using Clang's token locations. */
function cutMismatch(file: SourceFile, error: IllFormed, frontend: CompilerFrontend): [SourceFile, Mismatch] {
  const found = MISMATCHES.map(pattern => pattern.exec(error.message)).find(Boolean)?.groups;
  const at = error.offset;
  if (!found || at === null) throw error;
  const { tokens, program } = file;
  let point = tokens.findIndex(token => token.start === at);
  if (point < 0) throw error;
  const finish = tokens.findIndex((token, i) => i > point && token.kind === 'semi');
  if (finish < 0) throw error;
  const tail = tokens.slice(finish + 1).map(token => program.slice(token.start, token.end)).join(' ');
  if (tail !== (file.fragment ? '' : '}') && tail !== (file.fragment ? 'return 0 ;' : 'return 0 ; }')) {
    throw error;
  }

  let begin = point - 1;
  while (begin >= 0 && tokens[begin].kind !== 'semi') begin--;
  if (begin < 0) throw error;
  const start = tokens[begin + 1].start;
  if (tokens[point].kind === 'equal') {
    point++;
  } else if (tokens[point - 1]?.kind !== 'equal' && tokens[point - 1]?.kind !== 'l_brace') {
    if (tokens[point].kind !== 'identifier' || tokens[point + 1]?.kind !== 'equal') throw error;
    point += 2;
  }
  const braced = tokens[point - 1].kind === 'l_brace' && tokens[finish - 1].kind === 'r_brace';
  const end = tokens[finish].end;
  const [source, mapping] = file.display(start, end);
  const span: Span = [mapping[tokens[point].start - start], mapping[tokens[finish - (braced ? 2 : 1)].end - start]];
  const [prefix, suffix] = paneParts(source, span, false);
  const slot = prefix.trimEnd().replace(/=$/, '').trimEnd();
  if (suffix.trim() || !slot || source.includes('"') || source.includes("'")) throw error;
  const text = source.slice(...span);
  return [
    file.without(start, end, frontend),
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

function recordSource({ program }: SourceFile, start: number, finish: number): string {
  const line = Math.max(program.lastIndexOf('\n', start - 1), program.lastIndexOf('\r', start - 1)) + 1;
  const indent = program.slice(line, start);
  return dedent((/^[ \t]*$/.test(indent) ? indent : '') + program.slice(start, finish).replace(/\r\n?/g, '\n'));
}

/**
 * The integer aliases the program spells that the builtin table does not know (`streamsize`),
 * by bare spelling, with the builtin type Clang resolved each to.
 */
function integerAliases(node: AstNode, found: Record<string, string> = {}): Record<string, string> {
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

/** The program's statements, its records and the integer aliases it spells. */
export function analyzeWithFrontend(
  source: string,
  frontend: CompilerFrontend
): [Statement[], Record<string, RecordInfo>, Record<string, string>] {
  return analyzeSource(new SourceFile(source, frontend), frontend);
}

function analyzeSource(
  file: SourceFile,
  frontend: CompilerFrontend
): [Statement[], Record<string, RecordInfo>, Record<string, string>] {
  const ast = file.ast(frontend);
  resolveArrayAliases(ast);
  const records = layoutsFromFrontend(ast, file.program, frontend);
  const statements: Statement[] = [];
  let state: State = {};
  const references: Record<string, string> = {};
  const storageTypes: Record<string, string> = {};
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
    if (node.kind === 'DeclStmt' && node.inner?.length === 1 &&
        node.inner[0].kind === 'UsingDirectiveDecl' && node.inner[0].nominatedNamespace?.name === 'std') continue;
    const statement = analyzeStatement(node, file, state, records, references, storageTypes);
    if (statement.declared && statements.some(earlier => earlier.temporary)) {
      throw new Unsupported(
        'a declaration after a materialized temporary needs a separate memory-layout visualization'
      );
    }
    statements.push(statement);
    if (statements.length > MAX_STATEMENTS) {
      throw new Unsupported('too many statements');
    }
    state = hooks.after(statement, state);
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
  return [statements, records, integerAliases(ast)];
}

// Memory -----------------------------------------------------------------------------------

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function normalizeAddresses(
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

/**
 * The declared layout, without the slots the program holds but the drawing does not show:
 * a reference's storage, or a temporary such as the right side of `*p = { 3, 4 }`.
 */
function withoutHiddenSlots(
  real: Record<string, number>,
  variables: TraceVariable[]
): Record<string, number> | null {
  const packed = storageAddresses(variables);
  const names = variables.map(v => v.name);
  const sortedReal = [...names].sort((a, b) => real[a] - real[b]);
  const sortedPacked = [...names].sort((a, b) => packed[a] - packed[b]);
  return sortedReal.every((n, i) => n === sortedPacked[i]) ? packed : null;
}

/**
 * Check every live leaf, including unchanged fields, against GDB after each statement.
 *
 * A struct and its first field can share an address. Keep the statically typed target and
 * verify its address rather than trying to recover an ambiguous target from that number.
 */
export function observeExecution(
  execution: Execution,
  predicted: State[],
  variables: TraceVariable[],
  references: Record<string, string>
): [Record<string, number>, State[]] {
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
        const base = cell.objectAddress!;
        if (!Object.hasOwn(addresses, owner)) {
          addresses[owner] = base;
        }
        if (
          cell.objectSize !== owners[owner].size ||
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
    const expected = flatten(predicted[i]);
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
      if (row[name].value !== bits || (bits === 0 && !Object.is(row[name].value, bits))) {
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
  fold: Fold;

  constructor(text: string, typed: Typed[] = [], slot: Span | null = null, fold: Fold | null = null) {
    this.fold = fold ?? [];
    this.edits = this.fold.map(edit => [...edit]); // [start, end, text] in original coordinates
    this.original = text;
    this.typed = [...typed];
    this.slot = slot;
  }

  /**
   * Show the original text the fold hid, with `[start, end)` replaced; returns the span that
   * `[start, end)` covered in the folded text.
   */
  unfold(start: number, end: number, newText: string, type: string): Span {
    const span = this.locate(start, end);
    this.edits = this.edits.filter(edit => !this.fold.some(([s, e]) => s === edit[0] && e === edit[1]));
    this.fold = [];
    this.replace(start, end, newText, type);
    return span;
  }

  /** The typed parts of the current text, in order. */
  get types(): TypedPart[] {
    return [...this.typed].sort(compareTyped).map(([[start, end], type]) => {
      const part: TypedPart = { span: this.locate(start, end), type };
      if (this.slot && this.slot[0] === start && this.slot[1] === end) part.slot = true;
      return part;
    });
  }

  /** Whether `[start, end)` lies strictly inside one of the pane's typed parts. */
  insideTyped(start: number, end: number): boolean {
    const same = ([begin, finish]: Span): boolean => begin === start && finish === end;
    return this.typed.some(([span]) => span[0] <= start && end <= span[1] && !same(span));
  }

  /**
   * The original `[start, end)` is now one value of `type`: its parts are no longer. Inside a
   * typed part (the `rs` of `rs.f`) nothing changes: the part keeps its type.
   */
  retype(start: number, end: number, type: string | null): void {
    const same = ([begin, finish]: Span): boolean => begin === start && finish === end;
    if (this.insideTyped(start, end)) return;
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

  show(value: Value, shape: Shape): string {
    if (isPlainObject(value)) {
      const fields = shape !== null && typeof shape === 'object' ? shape : {};
      return `{${Object.entries(value)
        .map(([field, item]) => this.show(item, fields[field] ?? null))
        .join(', ')}}`;
    }
    return displayNumber(this.stored(value), typeof shape === 'number' ? shape : null);
  }

  stored(value: Value): number {
    if (value instanceof Pointer) {
      return value.target ? this.addresses[value.target] : 0;
    }
    if (typeof value !== 'number') throw new Error('only an integer or a pointer is stored in a cell');
    return value;
  }

  add(
    line: number,
    pane: Pane,
    expr: Span | null,
    state: State,
    op: TraceOperation | null = null,
    hold = 1.0
  ): void {
    const flat = flatten(state);
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
    before: State,
    after: State
  ): void {
    const typed: Typed[] = statement.slot ? [...statement.typed, [statement.slot, statement.type!]] : statement.typed;
    const pane = new Pane(statement.pane, typed, statement.slot, statement.fold);
    const expr = statement.expr;
    const writes = statement.target !== null && statement.result !== null;
    this.add(line, pane, expr, writes ? before : after);
    for (const reduction of statement.reductions) {
      let text: string;
      let op: Unplaced<TraceOperation>;
      if (reduction.kind === 'read' && reduction.compound) {
        text = this.show(load(before, reduction.name), reduction.shape);
        const [start, end] = reduction.span;
        const span = pane.unfold(start, end, text, reduction.type);
        const op = { kind: 'read' as const, name: reduction.name, value: text, compound: reduction.compound };
        this.add(line, pane, expr, before, { ...op, span });
        continue;
      }
      if (reduction.kind === 'read') {
        text =
          (reduction.record ?? '') +
          this.show(load(before, reduction.name), reduction.shape);
        op = { kind: 'read', name: reduction.name, value: text };
      } else if (reduction.kind === 'addr') {
        text = String(this.addresses[reduction.name]);
        op = { kind: 'addr', name: reduction.name, value: text };
      } else if (reduction.kind === 'alias') {
        text = codeName(reduction.target);
        op = { kind: 'alias', name: reduction.name, target: reduction.target };
      } else if (reduction.kind === 'select') {
        text = codeName(reduction.name);
        op = { kind: 'eval', value: text };
      } else if (reduction.kind === 'deref') {
        // Only a pointer that is not null is ever dereferenced.
        const target = (reduction.value ?? asPointer(load(before, reduction.name))).target!;
        text = codeName(target);
        op = { kind: 'deref', target, via: reduction.name };
      } else if (
        reduction.kind === 'convert' &&
        this.types &&
        !pane.insideTyped(reduction.span[0], reduction.span[1])
      ) {
        text = this.show(reduction.value, reduction.shape);
        op = { kind: 'convert', value: text, from: reduction.source, to: reduction.type };
      } else {
        text =
          (reduction.kind === 'eval' ? (reduction.record ?? '') : '') +
          this.show(reduction.value, reduction.shape);
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
      const sign = statement.signs.get(reduction.span[0]);
      if (sign && text.startsWith(sign)) text = '(' + text + ')';
      if (pane.read(reduction.span[0], reduction.span[1]) !== text || op.kind === 'convert') {
        const span = pane.replace(reduction.span[0], reduction.span[1], text, reduction.type);
        this.add(line, pane, expr, before, { ...op, span });
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
    if (typeof statement.value === 'number') {
      const shown =
        statement.outputSuffix !== null && typeof statement.shape === 'number'
          ? formatFloat(statement.value)
          : this.show(statement.value, statement.shape);
      if (pane.read(statement.result[0], statement.result[1]) !== shown) {
        const op = {
          kind: 'eval' as const,
          value: shown,
          span: pane.replace(statement.result[0], statement.result[1], shown),
        };
        this.add(line, pane, expr, before, op);
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
        const op = {
          kind: 'eval' as const,
          value: text,
          span: pane.replace(statement.result[0], statement.result[1], text),
        };
        this.add(line, pane, expr, before, op);
        span = pane.locate(statement.result[0], statement.result[1]);
      }
    }
    if (statement.outputSuffix !== null) {
      this.realStdout += real + statement.outputSuffix;
      this.stdout += text + statement.outputSuffix;
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
  mismatch(line: number, mismatch: Mismatch, state: State): void {
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

/**
 * How to trace, with the flags of `settings.ts`. `types`: the pane and memory carry types, a
 * conversion is a step of its own, and a last statement whose types do not fit is shown as a
 * final step that does not run. `bits`: the player draws integers as bytes and bits; it implies
 * `types` and takes integer variables only.
 */
export interface TraceOptions extends Flags {
  runtime?: boolean;
  frontend: CompilerFrontend;
  executor?: RuntimeExecutor | null;
  directory?: string;
  /** The caller's own checks, which throw: a flag is suggested only for a trace they accept. */
  accept?: (trace: ExecutionTrace) => void;
}

/**
 * Whether a snippet that does not compile, with `error`, traces once types show its last
 * statement's mismatch. Nothing runs: the probe only predicts.
 */
function tracesWithTypes(source: string, options: TraceOptions, error: IllFormed): boolean {
  if (!MISMATCHES.some(pattern => pattern.test(error.message))) return false;
  try {
    const traced = traceWithFrontend(source, { ...options, types: true, runtime: false });
    options.accept?.(traced);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trace a snippet into a validated unified-format trace, rejecting unsupported constructs.
 *
 * With `runtime: false` (probing) nothing is executed: values are the predicted ones and the
 * layout is Clang's usual -O0 layout.
 */
export function traceWithFrontend(source: string, options: TraceOptions): ExecutionTrace {
  const { runtime = true, bits = false, frontend, executor = hooks.execute, directory } = options;
  const types = bits || (options.types ?? false);
  let file = new SourceFile(source, frontend);
  let mismatch: Mismatch | null = null;
  let statements: Statement[];
  let records: Record<string, RecordInfo>;
  let aliases: Record<string, string>;
  try {
    [statements, records, aliases] = analyzeSource(file, frontend);
  } catch (error) {
    if (!(error instanceof IllFormed)) throw error;
    if (!types) {
      throw tracesWithTypes(source, options, error) ? new NeedsFlag(error.message, 'types', error.offset) : error;
    }
    // A last statement whose types do not fit is shown, not run: the rest is traced.
    [file, mismatch] = cutMismatch(file, error, frontend);
    [statements, records, aliases] = analyzeSource(file, frontend);
  }
  const predicted: State[] = [];
  let state: State = {};
  for (const statement of statements) {
    state = hooks.after(statement, state);
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
      const fieldsOf = (rec: RecordInfo, prefix: string): TraceField[] => {
        const flds: TraceField[] = [];
        for (const item of rec.fields) {
          const path = `${prefix}.${item.name}`;
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
                fieldsOf(records[item.type!], path),
                shade
              )
            );
          } else {
            flds.push(traceField(item.name, item.offset, item.size, item.kind, shade, Boolean(item.floating)));
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
          declaration.pointer ? 'ptr' : 'int',
          color,
          types ? declaration.type : null,
          typeof declaration.shape === 'number'
        )
      );
    }
  }
  if (
    bits &&
    (Object.keys(references).length > 0 ||
      variables.some(v => v.kind !== 'int' || !integerSpelled(v.type ?? '', aliases)))
  ) {
    throw new Unsupported('bits draw integer variables only');
  }
  let addresses: Record<string, number>;
  let states: State[];
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
        ...Object.entries(flatten(row)).map(([name, value]): ScopeEntry => [name, value !== null]),
        ...Object.keys(bound).map((name): ScopeEntry => [name, REFERENCE]),
      ]);
    }
    execution = executor(
      statements.map(s => s.source),
      scopes,
      directory
    );
    [addresses, states] = observeExecution(execution, predicted, variables, bound);
  } else {
    addresses = storageAddresses(variables);
    states = predicted;
  }
  const real = addresses;
  // A reference's slot is always dropped; a gap elsewhere only when the order allows it, and
  // `applicable` rejects the trace otherwise.
  const packed = withoutHiddenSlots(real, variables);
  if (Object.keys(references).length > 0) {
    if (!packed) {
      throw new Unsupported('runtime order of the variables disagrees with their declarations');
    }
    addresses = packed;
  } else if (packed && !contiguous(variables.map(v => ({ address: real[v.name], size: v.size })))) {
    addresses = packed;
  }
  const alignment = Math.max(
    ...Object.values(records).map(r => r.alignment),
    ...declarations.filter(d => !d.record && !d.bound).map(d => d.size!),
    4
  );
  addresses = normalizeAddresses(addresses, { ABI: alignment });
  for (const variable of variables) {
    variable.address = addresses[variable.name];
  }
  variables.sort((a, b) => a.address - b.address);

  const shown: [Statement, State][] = [];
  for (let i = 0; i < statements.length; i++) {
    if (!statements[i].definition) {
      shown.push([statements[i], states[i]]);
    }
  }
  if (shown.length === 0) {
    throw new Unsupported('a snippet of only struct definitions has nothing to step through');
  }
  const hasRefs = Object.keys(references).length > 0;
  const renderer = new Renderer(addresses, leaves(variables), real, hasRefs, types);
  let previous: State = {};
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
  const structs = Object.fromEntries(statements.flatMap(s => s.definition ? [s.definition] : []));
  if (Object.keys(structs).length > 0) {
    result.types = structs;
  }
  if (hasRefs) {
    result.references = Object.values(references);
  }
  if (bits) {
    result.bits = true;
    // Only the aliases the trace spells, so it stays independent of the preamble.
    const spelled = new Set(
      [
        ...variables.map(v => (v.kind === 'int' ? v.type : undefined)),
        ...renderer.steps.flatMap(step => [
          ...(step.types ?? []).map(part => part.type),
          ...(step.op?.kind === 'convert' ? [step.op.from, step.op.to] : []),
        ]),
      ]
        .filter((type): type is string => Boolean(type))
        .map(bareSpelling)
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
