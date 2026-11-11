// The unified trace format (version 1) shared by the tracer and the site player.
//
// A trace lists the source lines, the objects in memory and the visible evaluation states.
// `validate` checks a trace; `Builder` writes traces by hand, the way the lessons explain an
// evaluation. The compiler-backed tracer (`tracing.ts`) emits the format directly.
// `player/README.md` documents every field.

export const FORMAT = 1;
export type ScalarKind = 'int' | 'ptr';
export const SCALAR_KINDS: readonly ScalarKind[] = ['int', 'ptr'];
export const STRUCT = 'struct' as const;
export type OperationKind = 'read' | 'addr' | 'deref' | 'eval' | 'write' | 'print' | 'bind' | 'alias';
export const OPERATIONS: readonly OperationKind[] = [
  'read',
  'addr',
  'deref',
  'eval',
  'write',
  'print',
  'bind',
  'alias',
];
export const UNKNOWN = '?' as const;
export type StoredCellValue = number | typeof UNKNOWN | null;
export type Span = [number, number];

export interface ScalarField {
  name: string;
  offset: number;
  size: number;
  kind: ScalarKind;
  color: number;
  type?: string;
}

export interface StructField {
  name: string;
  type: string;
  offset: number;
  size: number;
  kind: typeof STRUCT;
  color: number;
  fields: TraceField[];
}

export type TraceField = ScalarField | StructField;

export interface ScalarVariable {
  name: string;
  address: number;
  size: number;
  kind: ScalarKind;
  color: number;
}

export interface StructVariable {
  name: string;
  type: string;
  address: number;
  size: number;
  kind: typeof STRUCT;
  color: number;
  fields: TraceField[];
}

export type TraceVariable = ScalarVariable | StructVariable;

export interface TraceReference {
  name: string;
  color: number;
}

export type ReadOperation = {
  kind: 'read';
  name: string;
  value: string;
  span: Span;
};

export type AddrOperation = {
  kind: 'addr';
  name: string;
  value: string;
  span: Span;
};

export type DerefOperation = {
  kind: 'deref';
  target: string;
  via: string;
  span: Span;
};

export type EvalOperation = {
  kind: 'eval';
  value: string;
  span: Span;
};

export type WriteOperation = {
  kind: 'write';
  name: string;
  value: string;
  span: Span;
  destination: Span;
};

export type PrintOperation = {
  kind: 'print';
  value: string;
  span: Span;
};

export type BindOperation = {
  kind: 'bind';
  name: string;
  target: string;
  span: Span;
  destination: Span;
};

export type AliasOperation = {
  kind: 'alias';
  name: string;
  target: string;
  span: Span;
};

export type TraceOperation =
  | ReadOperation
  | AddrOperation
  | DerefOperation
  | EvalOperation
  | WriteOperation
  | PrintOperation
  | BindOperation
  | AliasOperation;

export interface TraceStep {
  line: number;
  pane: string;
  expr?: Span | null;
  values: Record<string, StoredCellValue>;
  targets: Record<string, string>;
  refs?: Record<string, string>;
  stdout: string;
  hold: number;
  op: TraceOperation | null;
}

export interface ExecutionTrace {
  format: number;
  kind?: undefined;
  title?: string;
  source: string[];
  spans?: (Span | null)[];
  types?: Record<string, string>;
  variables: TraceVariable[];
  references?: TraceReference[];
  steps: TraceStep[];
}

export interface LayoutField {
  name: string;
  offset: number;
  size: number;
  kind: ScalarKind;
  type: string;
}

export interface LayoutRecord {
  name: string;
  size: number;
  alignment: number;
  fields: LayoutField[];
}

export interface LayoutTrace {
  format: number;
  kind: 'layout';
  records: LayoutRecord[];
}

export type AnyTrace = ExecutionTrace | LayoutTrace;

const IDENTIFIER = /^[A-Za-z_]\w*$/;

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}

const WHITESPACE_SPELLINGS: Record<string, string> = {
  'std::endl': '\n',
  endl: '\n',
  "'\\n'": '\n',
  "'\\t'": '\t',
  "' '": ' ',
};

export function whitespaceOutput(spelling: string): string | null {
  return Object.hasOwn(WHITESPACE_SPELLINGS, spelling) ? WHITESPACE_SPELLINGS[spelling] : null;
}

// Building blocks ------------------------------------------------------------------------------

export function scalar(
  name: string,
  address: number,
  size = 4,
  kind: ScalarKind = 'int',
  color = 0
): ScalarVariable {
  return { name, address, size, kind, color };
}

export function struct(
  name: string,
  type_: string,
  address: number,
  size: number,
  fields: TraceField[],
  color = 0
): StructVariable {
  return { name, type: type_, address, size, kind: 'struct', color, fields };
}

export function reference(name: string, color = 0): TraceReference {
  return { name, color };
}

export function field(
  name: string,
  offset: number,
  size = 4,
  kind: ScalarKind = 'int',
  color = 0
): ScalarField {
  return { name, offset, size, kind, color };
}

export function structField(
  name: string,
  type_: string,
  offset: number,
  size: number,
  fields: TraceField[],
  color = 0
): StructField {
  return { name, type: type_, offset, size, kind: STRUCT, color, fields };
}

type WalkItem = TraceVariable | TraceField;

function* walk(variables: TraceVariable[]): Generator<[string, number, WalkItem]> {
  function* visit(prefix: string, base: number, item: WalkItem): Generator<[string, number, WalkItem]> {
    const name = prefix + item.name;
    const itemOffset = 'offset' in item ? item.offset : item.address;
    const address = base + (itemOffset ?? 0);
    yield [name, address, item];
    if (item.kind === STRUCT) {
      for (const inner of item.fields) {
        yield* visit(name + '.', address, inner);
      }
    }
  }
  for (const variable of variables) {
    yield* visit('', 0, variable);
  }
}

export function leaves(variables: TraceVariable[]): Record<string, ScalarVariable | ScalarField> {
  const result: Record<string, ScalarVariable | ScalarField> = {};
  for (const [name, , item] of walk(variables)) {
    if (item.kind !== STRUCT) {
      result[name] = item;
    }
  }
  return result;
}

export function addresses(variables: TraceVariable[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, address] of walk(variables)) {
    result[name] = address;
  }
  return result;
}

export function cellsOf(variables: TraceVariable[], name: string): string[] {
  return Object.keys(leaves(variables)).filter(leaf => leaf === name || leaf.startsWith(name + '.'));
}

// Validation -----------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pyRepr(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return JSON.stringify(value);
}

function pyListRepr(items: unknown[]): string {
  return `[${items.map(pyRepr).join(', ')}]`;
}

function check(condition: unknown, where: string, message: string): asserts condition {
  if (!condition) {
    throw new FormatError(`${where}: ${message}`);
  }
}

function checkKeys(
  value: unknown,
  where: string,
  required: string[],
  optional: string[] = []
): asserts value is Record<string, any> {
  check(isPlainObject(value), where, 'expected an object');
  const keys = Object.keys(value);
  const reqSet = new Set(required);
  const optSet = new Set(optional);
  const missing = [...reqSet].filter(k => !Object.hasOwn(value, k)).sort();
  const unknown = keys.filter(k => !reqSet.has(k) && !optSet.has(k)).sort();
  check(missing.length === 0, where, `missing ${pyListRepr(missing)}`);
  check(unknown.length === 0, where, `unknown ${pyListRepr(unknown)}`);
}

function natural(value: unknown, where: string, positive = false): asserts value is number {
  check(
    Number.isInteger(value) && typeof value === 'number' && value >= (positive ? 1 : 0),
    where,
    positive ? 'expected a positive integer' : 'expected a non-negative integer'
  );
}

function checkSpan(value: unknown, text: string, where: string, empty = false): Span {
  check(
    Array.isArray(value) && value.length === 2 && value.every(v => Number.isInteger(v) && typeof v === 'number'),
    where,
    'expected [start, end]'
  );
  const [start, end] = value as [number, number];
  check(
    0 <= start && start <= end && end <= text.length && (empty || start < end),
    where,
    `[${start}, ${end}] is outside ${pyRepr(text)}`
  );
  return [start, end];
}

function checkFields(owner: Record<string, any>, here: string): void {
  check(typeof owner.type === 'string' && owner.type.length > 0, here, 'type must be a name');
  const fields = owner.fields;
  check(Array.isArray(fields) && fields.length > 0, `${here}.fields`, 'expected a nonempty list');
  const seen = new Set<string>();
  let end = 0;
  for (let position = 0; position < fields.length; position++) {
    const item = fields[position];
    const spot = `${here}.fields[${position}]`;
    const nested = isPlainObject(item) && item.kind === STRUCT;
    const req = ['name', 'offset', 'size', 'kind', 'color', ...(nested ? ['type', 'fields'] : [])];
    checkKeys(item, spot, req);
    check(IDENTIFIER.test(String(item.name)), spot, 'name is not an identifier');
    check(!seen.has(item.name), spot, `duplicate field ${pyRepr(item.name)}`);
    seen.add(item.name);
    check(
      nested || (SCALAR_KINDS as readonly string[]).includes(item.kind),
      spot,
      "kind must be one of ('int', 'ptr') or struct"
    );
    natural(item.offset, `${spot}.offset`);
    natural(item.size, `${spot}.size`, true);
    natural(item.color, `${spot}.color`);
    check(item.offset >= end, spot, 'fields must be ordered and must not overlap');
    end = item.offset + item.size;
    if (nested) {
      checkFields(item, spot);
    }
  }
  check(end <= owner.size, here, 'fields exceed the struct size');
}

function checkVariables(
  variables: unknown,
  where: string
): Record<string, ScalarVariable | ScalarField> {
  check(Array.isArray(variables) && variables.length > 0, where, 'expected a nonempty list');
  const names = new Set<string>();
  const ranges: [number, number, string][] = [];
  for (let index = 0; index < variables.length; index++) {
    const variable = variables[index];
    const here = `${where}[${index}]`;
    const struct_ = isPlainObject(variable) && variable.kind === 'struct';
    const req = ['name', 'address', 'size', 'kind', 'color', ...(struct_ ? ['type', 'fields'] : [])];
    checkKeys(variable, here, req);
    check(IDENTIFIER.test(String(variable.name)), here, 'name is not an identifier');
    check(!names.has(variable.name), here, `duplicate variable ${pyRepr(variable.name)}`);
    names.add(variable.name);
    natural(variable.address, `${here}.address`);
    natural(variable.size, `${here}.size`, true);
    natural(variable.color, `${here}.color`);
    ranges.push([variable.address, variable.address + variable.size, variable.name]);
    if (!struct_) {
      check(
        (SCALAR_KINDS as readonly string[]).includes(variable.kind),
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
  return leaves(variables as TraceVariable[]);
}

function checkReferences(
  references: unknown,
  variables: TraceVariable[],
  where: string
): Set<string> {
  check(Array.isArray(references) && references.length > 0, where, 'expected a nonempty list');
  const names = new Set<string>();
  const taken = new Set(variables.map(v => v.name));
  for (let index = 0; index < references.length; index++) {
    const item = references[index];
    const here = `${where}[${index}]`;
    checkKeys(item, here, ['name', 'color']);
    check(IDENTIFIER.test(String(item.name)), here, 'name is not an identifier');
    check(!names.has(item.name) && !taken.has(item.name), here, `duplicate name ${pyRepr(item.name)}`);
    names.add(item.name);
    natural(item.color, `${here}.color`);
  }
  return names;
}

function checkValue(value: unknown, where: string): void {
  check(
    value === null || value === UNKNOWN || (Number.isInteger(value) && typeof value === 'number'),
    where,
    'a value is an integer, "?" (declared, unknown) or null (no storage yet)'
  );
}

function replacement(before: string, after: string, span: Span, where: string): string {
  const [start, end] = span;
  const tail = before.length - end;
  check(
    after.length >= start + tail &&
      after.slice(0, start) === before.slice(0, start) &&
      after.slice(after.length - tail) === before.slice(end),
    where,
    `${pyRepr(after)} is not ${pyRepr(before)} with ${pyRepr(before.slice(start, end))} replaced`
  );
  const replaced = after.slice(start, after.length - tail);
  check(replaced.length > 0, where, 'the replacement is empty');
  return replaced;
}

const LITERAL = /^-?\d+$/;

function stored(text: string, where: string): (number | string)[] {
  const braced = /^(?:[A-Za-z_]\w*)?\{[\s\S]*\}$/.test(text);
  const inner = braced ? text.slice(text.indexOf('{')) : text;
  const items = braced ? inner.replace(/[{}]/g, '').split(',').map(s => s.trim()) : [inner];
  const result: (number | string)[] = [];
  for (const item of items) {
    check(
      item === 'nullptr' || item === UNKNOWN || LITERAL.test(item),
      where,
      `${pyRepr(inner)} is not a value: expected an integer, nullptr, "?" or {…} of them`
    );
    result.push(item === 'nullptr' ? 0 : item === UNKNOWN ? item : Number.parseInt(item, 10));
  }
  return result;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

interface StorageContext {
  variables: TraceVariable[];
  cells: Record<string, ScalarVariable | ScalarField>;
  addresses: Record<string, number>;
  references: Set<string>;
  cellsOf(name: string): string[];
}

function checkMemory(
  op: Record<string, any>,
  step: Record<string, any>,
  previous: Record<string, any>,
  storage: StorageContext,
  where: string
): void {
  const { kind, name } = op;
  if (kind === 'addr') {
    const address = storage.addresses[name];
    check(
      arraysEqual(stored(op.value, where), [address]),
      `${where}.value`,
      `the address of ${name} is ${address}, not ${pyRepr(op.value)}`
    );
    return;
  }
  const cells = storage.cellsOf(name);
  const values = (kind === 'write' ? step : previous).values;
  const expected = cells.map(cell => values[cell]);
  const shown =
    cells.length === 1 && cells[0] === name ? String(expected[0]) : `{${expected.map(String).join(', ')}}`;
  const when = kind === 'write' ? 'after the write' : 'before the read';
  check(
    arraysEqual(stored(op.value, where), expected),
    `${where}.value`,
    `${name} holds ${shown} ${when}, not ${pyRepr(op.value)}`
  );
}

function checkPointers(step: Record<string, any>, storage: StorageContext, where: string): void {
  for (const [name, target] of Object.entries(step.targets)) {
    check(storage.cells[name]?.kind === 'ptr', `${where}.targets.${name}`, 'only pointers have targets');
    check(
      Object.hasOwn(storage.addresses, target as string),
      `${where}.targets.${name}`,
      `unknown variable ${pyRepr(target)}`
    );
  }
  for (const [name, cell] of Object.entries(storage.cells)) {
    if (cell.kind !== 'ptr') continue;
    const value = step.values[name];
    const target = step.targets[name];
    if (target !== undefined && target !== null) {
      const address = storage.addresses[target];
      check(
        value === address,
        `${where}.targets.${name}`,
        `${name} holds ${pyRepr(value)}, but ${target} is at ${address}`
      );
    } else {
      check(
        typeof value !== 'number' || value === 0,
        `${where}.targets.${name}`,
        `${name} holds the address ${value} but points nowhere`
      );
    }
  }
}

function refs(step: Record<string, any>): Record<string, string> {
  return step.refs ?? {};
}

function checkReferenceOp(
  op: Record<string, any>,
  step: Record<string, any>,
  previous: Record<string, any>,
  storage: StorageContext,
  where: string
): void {
  const { kind, name, target } = op;
  check(storage.references.has(name), `${where}.name`, `unknown reference ${pyRepr(name)}`);
  check(Object.hasOwn(storage.addresses, target), `${where}.target`, `unknown variable ${pyRepr(target)}`);
  if (kind === 'alias') {
    check(refs(previous)[name] === target, where, `${name} is not bound to ${target}`);
    const span = checkSpan(op.span, previous.pane, `${where}.span`);
    const [start, end] = span;
    check(previous.pane.slice(start, end) === name, `${where}.span`, 'does not cover the name');
    const replaced = replacement(previous.pane, step.pane, span, where);
    check(replaced === target, where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(target)}`);
    return;
  }
  check(step.pane === previous.pane, where, 'a bind does not change the pane');
  check(
    !Object.hasOwn(refs(previous), name) && refs(step)[name] === target,
    where,
    `${name} must become bound to ${target}`
  );
  for (const [key, text] of [
    ['span', target],
    ['destination', name],
  ] as const) {
    const [start, end] = checkSpan(op[key], step.pane, `${where}.${key}`);
    check(step.pane.slice(start, end) === text, `${where}.${key}`, `does not cover ${pyRepr(text)}`);
  }
}

function unchangedPane(
  op: Record<string, any>,
  step: Record<string, any>,
  previous: Record<string, any>,
  where: string
): void {
  const { kind } = op;
  check(step.pane === previous.pane, where, `a ${kind} does not change the pane`);
  const [start, end] = checkSpan(op.span, step.pane, `${where}.span`);
  const covered = step.pane.slice(start, end);
  check(
    covered === op.value || (kind === 'print' && whitespaceOutput(covered) === op.value),
    `${where}.span`,
    'does not cover the value'
  );
  if (kind === 'write') {
    const [dStart, dEnd] = checkSpan(op.destination, step.pane, `${where}.destination`);
    check(step.pane.slice(dStart, dEnd) === op.name, `${where}.destination`, 'does not cover the name');
  } else {
    const printed = step.stdout.slice(previous.stdout.length);
    check(
      printed.startsWith(op.value) && printed.slice(op.value.length).trim() === '',
      where,
      'stdout must grow by the printed value and optional whitespace'
    );
  }
}

function checkOperation(
  op: unknown,
  step: Record<string, any>,
  previous: Record<string, any>,
  storage: StorageContext,
  where: string
): void {
  check(
    isPlainObject(op) && (OPERATIONS as readonly string[]).includes(op.kind),
    where,
    `kind must be one of (${OPERATIONS.map(pyRepr).join(', ')})`
  );
  const kind = op.kind as OperationKind;
  const fieldMap: Record<OperationKind, string[]> = {
    read: ['name', 'value', 'span'],
    addr: ['name', 'value', 'span'],
    deref: ['target', 'via', 'span'],
    eval: ['value', 'span'],
    write: ['name', 'value', 'span', 'destination'],
    print: ['value', 'span'],
    bind: ['name', 'target', 'span', 'destination'],
    alias: ['name', 'target', 'span'],
  };
  const fields = fieldMap[kind];
  checkKeys(op, where, [...fields, 'kind']);
  for (const key of fields.filter(k => ['name', 'target', 'via', 'value'].includes(k))) {
    check(typeof op[key] === 'string' && op[key].length > 0, `${where}.${key}`, 'expected text');
  }
  if (kind === 'bind' || kind === 'alias') {
    checkReferenceOp(op, step, previous, storage, where);
    return;
  }
  for (const key of ['name', 'via']) {
    if (Object.hasOwn(op, key)) {
      check(
        Object.hasOwn(storage.addresses, op[key]),
        `${where}.${key}`,
        `unknown variable ${pyRepr(op[key])}`
      );
    }
  }
  if (kind === 'deref') {
    check(
      Object.hasOwn(storage.addresses, op.target),
      `${where}.target`,
      `unknown variable ${pyRepr(op.target)}`
    );
    check(storage.cells[op.via]?.kind === 'ptr', `${where}.via`, 'must be a pointer');
    const pointee = previous.targets[op.via];
    check(
      pointee !== undefined && (op.target === pointee || op.target.startsWith(pointee + '.')),
      where,
      `${op.via} does not point to ${op.target}`
    );
  }
  if (['read', 'addr', 'deref', 'eval'].includes(kind)) {
    const span = checkSpan(op.span, previous.pane, `${where}.span`);
    const replaced = replacement(previous.pane, step.pane, span, where);
    const expected = kind === 'deref' ? op.target : op.value;
    check(replaced === expected, where, `the replacement ${pyRepr(replaced)} is not ${pyRepr(expected)}`);
  } else {
    unchangedPane(op, step, previous, where);
  }
  if (['read', 'addr', 'write'].includes(kind)) {
    checkMemory(op, step, previous, storage, where);
  }
}

function shallowEqualObj(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && a[k] === b[k]);
}

function checkChanges(
  step: Record<string, any>,
  previous: Record<string, any>,
  storage: StorageContext,
  where: string
): void {
  const op = step.op || {};
  const written = new Set(op.kind === 'write' ? storage.cellsOf(op.name) : []);
  for (const [name, value] of Object.entries(step.values)) {
    const old = previous.values[name];
    check(
      value === old || written.has(name) || (!step.op && old === null && value === UNKNOWN),
      `${where}.values.${name}`,
      'only a write, or a declaration ("?"), changes a value'
    );
  }
  const targetNames = new Set([...Object.keys(step.targets), ...Object.keys(previous.targets)]);
  for (const name of targetNames) {
    check(
      step.targets[name] === previous.targets[name] || written.has(name),
      `${where}.targets.${name}`,
      'only a write changes where a pointer points'
    );
  }
  check(
    step.stdout === previous.stdout || op.kind === 'print',
    `${where}.stdout`,
    'only a print changes the output'
  );
  const bound = op.kind === 'bind' ? { [op.name]: op.target } : {};
  check(
    shallowEqualObj(refs(step), { ...refs(previous), ...bound }),
    `${where}.refs`,
    'only a bind changes what a reference is bound to, and only once'
  );
}

function roundUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function checkLayout(trace: unknown): asserts trace is LayoutTrace {
  checkKeys(trace, 'layout', ['format', 'kind', 'records']);
  check(trace.format === FORMAT, 'layout.format', `expected ${FORMAT}`);
  const records = trace.records;
  check(Array.isArray(records) && records.length > 0, 'layout.records', 'expected nonempty list');
  const names = new Set<string>();
  for (const record of records) {
    checkKeys(record, 'record', ['name', 'size', 'alignment', 'fields']);
    const { name } = record;
    check(typeof name === 'string' && IDENTIFIER.test(name), 'record', 'invalid name');
    check(!names.has(name), 'record', 'duplicate name');
    names.add(name);
    natural(record.size, `${name}.size`, true);
    natural(record.alignment, `${name}.alignment`, true);
    const align = record.alignment;
    check([1, 4, 8].includes(align), name, 'invalid alignment');
    const fields = record.fields;
    check(Array.isArray(fields) && fields.length > 0, name, 'expected nonempty fields');
    const seen = new Set<string>();
    let end = 0;
    for (const item of fields) {
      checkKeys(item, name, ['name', 'offset', 'size', 'kind', 'type']);
      check(typeof item.name === 'string' && IDENTIFIER.test(item.name), name, 'invalid field name');
      check(!seen.has(item.name), name, 'duplicate field');
      seen.add(item.name);
      check(typeof item.type === 'string' && item.type.length > 0, name, 'invalid field type');
      check((SCALAR_KINDS as readonly string[]).includes(item.kind), name, 'invalid field kind');
      natural(item.offset, `${name}.offset`);
      natural(item.size, `${name}.size`, true);
      const { size } = item;
      check([1, 4, 8].includes(size) && (item.kind !== 'ptr' || size === 8), name, 'unsupported field size');
      const expectedOffset = roundUp(end, size);
      check(
        item.offset === expectedOffset,
        name,
        `field ${item.name} must start at offset ${expectedOffset}`
      );
      end = item.offset + size;
    }
    const widest = Math.max(...fields.map((item: LayoutField) => item.size));
    check(align === widest, name, `alignment must be ${widest}, the widest field`);
    const expectedSize = roundUp(end, align);
    check(
      record.size === expectedSize,
      name,
      `size must be ${expectedSize}, the last field end rounded to alignment`
    );
  }
}

export function validate(trace: unknown): asserts trace is AnyTrace {
  if (isPlainObject(trace) && trace.kind === 'layout') {
    checkLayout(trace);
    return;
  }
  checkKeys(
    trace,
    'trace',
    ['format', 'source', 'variables', 'steps'],
    ['title', 'spans', 'types', 'references']
  );
  check(trace.format === FORMAT, 'trace.format', `expected ${FORMAT}`);
  const { source } = trace;
  check(
    Array.isArray(source) && source.length > 0 && source.every(line => typeof line === 'string'),
    'trace.source',
    'expected nonempty list of lines'
  );
  if (Object.hasOwn(trace, 'title')) {
    check(typeof trace.title === 'string', 'trace.title', 'expected text');
  }
  if (Object.hasOwn(trace, 'spans')) {
    check(
      Array.isArray(trace.spans) && trace.spans.length === source.length,
      'trace.spans',
      'expected one entry per source line'
    );
    for (let index = 0; index < trace.spans.length; index++) {
      const span = trace.spans[index];
      if (span !== null) {
        checkSpan(span, source[index], `trace.spans[${index}]`);
      }
    }
  }
  if (Object.hasOwn(trace, 'types')) {
    check(
      isPlainObject(trace.types) &&
        Object.keys(trace.types).length > 0 &&
        Object.entries(trace.types).every(
          ([k, v]) => typeof k === 'string' && typeof v === 'string' && v.length > 0
        ),
      'trace.types',
      'expected struct names mapped to their definitions'
    );
  }
  const variables = trace.variables as TraceVariable[];
  const cells = checkVariables(variables, 'trace.variables');
  const references = Object.hasOwn(trace, 'references')
    ? checkReferences(trace.references, variables, 'trace.references')
    : new Set<string>();
  const storage: StorageContext = {
    variables,
    cells,
    addresses: addresses(variables),
    references,
    cellsOf(name: string) {
      return cellsOf(variables, name);
    },
  };
  const { steps } = trace;
  check(Array.isArray(steps) && steps.length > 0, 'trace.steps', 'expected a nonempty list');
  const sortedCellNames = Object.keys(cells).sort();
  let previous: Record<string, any> | null = null;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const where = `trace.steps[${index}]`;
    checkKeys(
      step,
      where,
      ['line', 'pane', 'values', 'targets', 'stdout', 'hold', 'op'],
      ['expr', 'refs']
    );
    check(
      Number.isInteger(step.line) && typeof step.line === 'number' && 0 <= step.line && step.line < source.length,
      `${where}.line`,
      'not a source line'
    );
    check(typeof step.pane === 'string', `${where}.pane`, 'expected text');
    if (step.expr !== undefined && step.expr !== null) {
      checkSpan(step.expr, step.pane, `${where}.expr`, true);
    }
    check(
      isPlainObject(step.values) &&
        arraysEqual(Object.keys(step.values).sort(), sortedCellNames),
      `${where}.values`,
      `expected exactly ${pyListRepr(sortedCellNames)}`
    );
    for (const [name, value] of Object.entries(step.values)) {
      checkValue(value, `${where}.values.${name}`);
    }
    check(isPlainObject(step.targets), `${where}.targets`, 'expected an object');
    checkPointers(step, storage, where);
    check(typeof step.stdout === 'string', `${where}.stdout`, 'expected text');
    check(
      typeof step.hold === 'number' && !Number.isNaN(step.hold) && step.hold >= 0,
      `${where}.hold`,
      'expected seconds'
    );
    const stepRefs = refs(step);
    check(
      isPlainObject(stepRefs) &&
        Object.entries(stepRefs).every(
          ([name, target]) => references.has(name) && Object.hasOwn(storage.addresses, target)
        ),
      `${where}.refs`,
      'expected references mapped to variables'
    );
    if (previous === null) {
      check(
        step.op === null && Object.keys(stepRefs).length === 0,
        `${where}.op`,
        'the first step has no operation and no bound reference'
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

// Hand-written traces --------------------------------------------------------------------------

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

export class Builder {
  source: string[];
  variables: TraceVariable[];
  title: string | null;
  cells: Record<string, ScalarVariable | ScalarField>;
  values: Record<string, StoredCellValue>;
  targets: Record<string, string>;
  steps: TraceStep[];
  pane: string;
  line: number;
  stdout: string;
  carry: string | ['address', string] | null;

  constructor(source: string[], variables: TraceVariable[], title: string | null = null) {
    this.source = source;
    this.variables = variables;
    this.title = title;
    this.cells = leaves(variables);
    this.values = Object.fromEntries(Object.keys(this.cells).map(name => [name, null]));
    this.targets = {};
    this.steps = [];
    this.pane = '';
    this.line = 0;
    this.stdout = '';
    this.carry = null;
  }

  _add(op: TraceOperation | null = null, hold = 1.0): void {
    this.steps.push({
      line: this.line,
      pane: this.pane,
      values: { ...this.values },
      targets: { ...this.targets },
      op,
      stdout: this.stdout,
      hold,
    });
  }

  _value(name: string): string {
    if (Object.hasOwn(this.values, name)) {
      return String(this.values[name]);
    }
    return `{${cellsOf(this.variables, name).map(cell => String(this.values[cell])).join(', ')}}`;
  }

  _find(token: string): number {
    let pattern = escapeRegExp(token);
    if (isWordChar(token[0])) {
      pattern = '(?<![\\w.>])' + pattern;
    }
    if (isWordChar(token[token.length - 1])) {
      pattern += '(?![\\w.])';
    }
    const match = new RegExp(pattern).exec(this.pane);
    if (!match) {
      throw new Error(`${pyRepr(token)} is not in ${pyRepr(this.pane)}`);
    }
    return match.index;
  }

  _replace(token: string, newText: string): Span {
    const start = this._find(token);
    this.pane = this.pane.slice(0, start) + newText + this.pane.slice(start + token.length);
    return [start, start + token.length];
  }

  statement(line: number, pane: string | null = null): this {
    this.line = line;
    const stripped = this.source[line].replace(/;+$/, '');
    this.pane = pane ?? stripped.replace(/(\w)\s*\{\s*(.*?)\s*\}$/, '$1 = $2');
    this._add();
    return this;
  }

  declare(name: string): this {
    for (const cell of cellsOf(this.variables, name)) {
      this.values[cell] = UNKNOWN;
    }
    this.steps[this.steps.length - 1].values = { ...this.values };
    return this;
  }

  read(name: string, token: string | null = null): this {
    const value = this._value(name);
    const span = this._replace(token ?? name, value);
    this._carry(span, name);
    this._add({ kind: 'read', name, value, span });
    return this;
  }

  _carry(span: Span, source: string | ['address', string] | null): void {
    const idx = this.pane.lastIndexOf('= ');
    const threshold = idx + (idx !== -1 ? 2 : 0);
    if (span[0] >= threshold) {
      this.carry = source;
    }
  }

  address(name: string): this {
    const value = String(this._address(name));
    const span = this._replace('&' + name, value);
    this._carry(span, ['address', name]);
    this._add({ kind: 'addr', name, value, span });
    return this;
  }

  _address(name: string): number {
    const dot = name.indexOf('.');
    const owner = dot === -1 ? name : name.slice(0, dot);
    const member = dot === -1 ? '' : name.slice(dot + 1);
    const variable = this.variables.find(item => item.name === owner)!;
    if (!member || variable.kind !== STRUCT) {
      return variable.address;
    }
    const fld = variable.fields.find(item => item.name === member)!;
    return variable.address + fld.offset;
  }

  deref(token: string, target: string, via: string): this {
    const span = this._replace(token, target);
    this._carry(span, null);
    this._add({ kind: 'deref', target, via, span });
    return this;
  }

  evaluate(token: string, value: number | string): this {
    const str = String(value);
    this._add({ kind: 'eval', value: str, span: this._replace(token, str) });
    return this;
  }

  write(name: string, hold = 1.2): this {
    const start = this.pane.lastIndexOf('= ') + 2;
    const text = this.pane.slice(start);
    const values = text.startsWith('{')
      ? text.replace(/^[{}]+|[{}]+$/g, '').split(', ')
      : [text];
    const cells = cellsOf(this.variables, name);
    const sources: (string | null)[] =
      typeof this.carry === 'string'
        ? cellsOf(this.variables, this.carry)
        : Array(cells.length).fill(null);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const value = values[i];
      const source = sources[i];
      this.values[cell] =
        value === 'nullptr'
          ? 0
          : /^-?\d+$/.test(value)
            ? Number.parseInt(value, 10)
            : (value as typeof UNKNOWN);
      delete this.targets[cell];
      if (Array.isArray(this.carry)) {
        this.targets[cell] = this.carry[1];
      } else if (source && Object.hasOwn(this.targets, source)) {
        this.targets[cell] = this.targets[source];
      }
    }
    this.carry = null;
    const targetMatch = new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?=\\s*=)`).exec(this.pane)!;
    const target = targetMatch.index;
    this._add(
      {
        kind: 'write',
        name,
        value: text,
        span: [start, this.pane.length],
        destination: [target, target + name.length],
      },
      hold
    );
    return this;
  }

  print(name: string, hold = 1.2): this {
    this.read(name);
    const value = this._value(name);
    const start = this.pane.indexOf('<< ') + 3;
    this.stdout += value + (this.pane.includes('endl') ? '\n' : '');
    this._add({ kind: 'print', value, span: [start, start + value.length] }, hold);
    return this;
  }

  build(): ExecutionTrace {
    this.steps[this.steps.length - 1].hold = 3;
    const trace: ExecutionTrace = {
      format: FORMAT,
      source: this.source,
      variables: this.variables,
      steps: this.steps,
    };
    if (this.title) {
      trace.title = this.title;
    }
    validate(trace);
    return trace;
  }
}
