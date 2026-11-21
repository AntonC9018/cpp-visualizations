// Player model and timing: flattens execution trace storage into leaf cells and struct groups.
import { codeName } from '../core/arrays.ts';
import type {
  AddrOperation,
  ExecutionTrace,
  Span,
  TraceField,
  TraceOperation,
  TraceReference,
  TraceStep,
  TraceVariable,
} from '../core/trace_format.ts';
import { chainDelay, chainOf, memoryWalk } from './storage_path.ts';
import { T, TYPE_COLOURS } from './constants.ts';

export const stores = (op: TraceOperation): boolean =>
  op.kind === 'write' || op.kind === 'bind';

export type WalkingOperation = Extract<TraceOperation, { kind: 'read' | 'write' | 'addr' }>;

const walks = (op: TraceOperation): op is WalkingOperation =>
  op.kind === 'read' || op.kind === 'write' || op.kind === 'addr';

/**
 * The walks that do not start at the top of their chain, recorded by `prepare`. They are kept by
 * operation, not on the model, as an operation's timing (`departure`, `arrival`) follows from it
 * alone wherever it is drawn; `prepare` gives each step an operation of its own for this.
 */
const shortWalks = new WeakMap<TraceOperation, string[]>();

/**
 * The levels a read, write or address walks through memory, `a` → `a.f` → `a.f.[0]`. One that
 * goes on from where an earlier step of its statement already arrived starts there: `q->g`,
 * once `b.n.g`, walks no further, and nor does the write of `s.a += 1` after its read.
 */
export const walkOf = (op: WalkingOperation): string[] => shortWalks.get(op) ?? chainOf(op.name);

/** When a walk lands on the last level of its chain. */
export const landing = (op: WalkingOperation): number => memoryWalk(walkOf(op), arrival(op)).at(-1)![0];

/**
 * The conversions that open their operator's, recorded by `prepare`: the operator lights first,
 * as the `+` of `a + a` does before either `a` is promoted.
 */
const opening = new WeakSet<TraceOperation>();

/** When an operation's own animation starts: after its operator lights, for the first conversion. */
export const lead = (op: TraceOperation): number => (opening.has(op) ? T.operator : 0);

/** Whether step `i` converts for the operator step `i - 1` converted for, as the second `a` of `a + a`. */
export function continuesOperator(steps: TraceStep[], i: number): boolean {
  const op = steps[i]?.op;
  const last = steps[i - 1]?.op;
  if (op?.kind !== 'convert' || !op.operator || last?.kind !== 'convert' || !last.operator || i < 2) return false;
  // The operator moves along when the last conversion, before it, changed the text's length.
  const shift = last.operator[0] >= last.span[1] ? steps[i - 1].pane.length - steps[i - 2].pane.length : 0;
  return op.operator[0] === last.operator[0] + shift;
}

export const departure = (op: TraceOperation): number =>
  (stores(op) ? T.writeHold : op.kind === 'print' ? 0.2 : T.prepare) +
  (walks(op) ? chainDelay(walkOf(op)) : 0);

/** The extra 1× time a multi-level storage walk adds to step `i`'s animation. */
export function stepWalkSeconds(steps: TraceStep[], i: number): number {
  const op = steps[i]?.op;
  return op && walks(op) ? chainDelay(walkOf(op)) : 0;
}

export function arrival(op: TraceOperation): number {
  if (op.kind === 'deref') return T.prepare + T.follow;
  if (op.kind === 'eval' || op.kind === 'alias' || op.kind === 'convert') return lead(op) + T.evaluate;
  if (op.kind === 'clash') return T.clash;
  if (op.kind === 'print') return 0.9;
  return departure(op) + T.travel;
}

export const opSeconds = (op: TraceOperation): number =>
  arrival(op) + T.settle + (stores(op) ? 0.5 : 0);

/**
 * Whether step `i` opens a statement. Each statement opens with a step that has no operation,
 * so two in a row on one line are still two.
 */
export const opensStatement = (steps: TraceStep[], i: number): boolean =>
  i === 0 || !steps[i].op || steps[i - 1].line !== steps[i].line;

/** The steps of the statement that step `i` belongs to. */
export function statementSteps(steps: TraceStep[], i: number): number[] {
  let start = i;
  while (!opensStatement(steps, start)) start--;
  let end = i;
  while (end + 1 < steps.length && !opensStatement(steps, end + 1)) end++;
  return Array.from({ length: end - start + 1 }, (_, k) => start + k);
}

/** A statement's first step copies its line from the code into the pane. */
export const copies = (steps: TraceStep[], i: number): boolean => !steps[i].op;

export const copyBegin = (_steps: TraceStep[], i: number): number =>
  i > 0 ? 0.3 : T.copyBegin;

export function animationSeconds(steps: TraceStep[], i: number): number {
  const step = steps[i];
  if (step.op) return opSeconds(step.op);
  return copies(steps, i) ? copyBegin(steps, i) + T.copyTravel + 0.25 : 0;
}

export const stepSeconds = (steps: TraceStep[], i: number): number =>
  steps[i].hold + animationSeconds(steps, i);

export interface ModelLeaf {
  name: string;
  label: string;
  group: string | null;
  address: number;
  size: number;
  kind: 'int' | 'ptr' | 'struct';
  color: number;
  fieldColor?: number;
  type?: string;
  floating?: true;
  children?: undefined;
  fields?: undefined;
}

export interface ModelGroup {
  name: string;
  label: string;
  type: string;
  address: number;
  size: number;
  color: number;
  fieldColor: number | null;
  top: string;
  parent: string | null;
  children: Array<ModelLeaf | ModelGroup>;
  fields: string[];
  rise: number;
}

export type ModelItem = ModelLeaf | ModelGroup;

export interface PreparedModel {
  trace: ExecutionTrace;
  // Each type's colour index, and whether any pane is typed (else nothing is labelled).
  typeColours: Map<string, number>;
  typed: boolean;
  steps: TraceStep[];
  source: string[];
  spans: Array<Span | null>;
  types: Record<string, string>;
  references: TraceReference[];
  leaves: ModelLeaf[];
  groups: ModelGroup[];
  tops: ModelItem[];
  top: string[];
  rise: number;
  /** What each step reaches, by name, and when it lights it up; null for nothing. */
  reach: Array<Reach | null>;
}

export function prepare(trace: ExecutionTrace): PreparedModel {
  if (!trace || trace.format !== 1) {
    throw new Error('unsupported trace format ' + (trace && trace.format));
  }
  const variables = [...trace.variables].sort((a, b) => a.address - b.address);
  const leaves: ModelLeaf[] = [];
  const groups: ModelGroup[] = [];
  const tops: ModelItem[] = [];

  const struct = (
    item: TraceVariable | TraceField,
    name: string,
    address: number,
    variable: TraceVariable,
    parent: string | null
  ): ModelGroup => {
    const group: ModelGroup = {
      name,
      label: item.name,
      type: 'type' in item && item.type ? item.type : '',
      address,
      size: item.size,
      color: variable.color,
      fieldColor: parent ? (item.color ?? null) : null,
      top: variable.name,
      parent,
      children: [],
      fields: [],
      rise: 0,
    };
    groups.push(group);
    const itemFields = 'fields' in item && item.fields ? item.fields : [];
    for (const field of itemFields) {
      const at = address + field.offset;
      const path = name + '.' + field.name;
      if (field.kind === 'struct') {
        const inner = struct(field, path, at, variable, name);
        group.rise = Math.max(group.rise, inner.rise + 1);
        group.children.push(inner);
      } else {
        const leaf: ModelLeaf = {
          name: path,
          label: field.name,
          group: variable.name,
          address: at,
          size: field.size,
          kind: field.kind,
          color: variable.color,
          fieldColor: field.color,
          ...(field.floating ? { floating: true as const } : {}),
        };
        leaves.push(leaf);
        group.children.push(leaf);
      }
    }
    group.fields = group.children.map(child => child.name);
    return group;
  };

  for (const variable of variables) {
    if (variable.kind === 'struct') {
      tops.push(struct(variable, variable.name, variable.address, variable, null));
    } else {
      const leaf: ModelLeaf = {
        ...variable,
        label: variable.name,
        group: null,
        children: undefined,
        fields: undefined,
      };
      leaves.push(leaf);
      tops.push(leaf);
    }
  }
  const top = variables.map(variable => variable.name);
  const model: PreparedModel = {
    trace,
    typeColours: typeColours(trace),
    typed: trace.steps.some(step => step.types),
    // Each step's own operation, which its walk is recorded by.
    steps: trace.steps.map(step => (step.op ? { ...step, op: { ...step.op } } : step)),
    source: trace.source,
    spans: trace.spans || [],
    types: trace.types || {},
    references: trace.references || [],
    leaves,
    groups,
    tops,
    top,
    rise: Math.max(0, ...groups.map(group => group.rise)),
    reach: [],
  };
  const continuations = model.steps.map((_, j) => continuation(model, j));
  recordShortWalks(model, continuations);
  model.steps.forEach((step, i) => {
    if (step.op?.kind === 'convert' && step.op.operator && !continuesOperator(model.steps, i)) opening.add(step.op);
  });
  model.reach = model.steps.map((_, j) => reachedIn(model, j, continuations[j]));
  return model;
}

/** The walks that start below the top of their chain, where an earlier step arrived. */
function recordShortWalks(m: PreparedModel, continuations: number[]): void {
  m.steps.forEach((step, j) => {
    const op = step.op;
    if (!op) return;
    // What goes on from a dereference or alias starts where it arrived.
    const next = m.steps[continuations[j]]?.op;
    if ((op.kind === 'deref' || op.kind === 'alias') && next && walks(next)) {
      shortWalks.set(next, chainOf(next.name).slice(chainOf(op.target).length - 1));
    }
    // The write of `s.a += 1` lands where its read already walked.
    if (op.kind === 'read' && op.compound) {
      const write = statementSteps(m.steps, j).find(k => k > j && m.steps[k].op?.kind === 'write');
      const written = write === undefined ? null : m.steps[write].op;
      if (written?.kind === 'write' && written.name === op.name) shortWalks.set(written, [op.name]);
    }
    // An address the pane does not spell with `&`, as `a.data()`, has no chain to walk.
    if (op.kind === 'addr' && m.steps[j - 1]?.pane[op.span[0]] !== '&') shortWalks.set(op, [op.name]);
  });
}

/**
 * A type's colour follows from its name, so it is the same in every example: `int` has the
 * first, and two types that would share one in a trace take neighbouring colours.
 */
function typeColours(trace: ExecutionTrace): Map<string, number> {
  const types = new Set(
    [
      'int',
      ...trace.variables.map(variable => variable.type),
      ...trace.steps.flatMap(step => (step.types ?? []).map(part => part.type)),
    ].filter((type): type is string => Boolean(type))
  );
  const colours = new Map<string, number>();
  const taken = new Set<number>();
  for (const type of types) {
    let index =
      type === 'int'
        ? 0
        : [...type].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) % 9973, 7) % TYPE_COLOURS;
    while (taken.has(index) && taken.size < TYPE_COLOURS) index = (index + 1) % TYPE_COLOURS;
    taken.add(index);
    colours.set(type, index);
  }
  return colours;
}

/**
 * The variables step `i` involves: those its pane still names, a reference's with it, and what
 * its operation reads, writes, binds or goes through. One whose value went into the pane is no
 * longer involved once the statement moves on, as `a` in `A b = a` is while `b` is written.
 */
export function activeVariables(m: PreparedModel, i: number): Set<string> {
  const step = m.steps[i];
  const active = paneVariables(m, step);
  const op = step.op as Partial<Record<'name' | 'target' | 'via', string>> | null;
  for (const name of [op?.name, op?.target, op?.via]) {
    if (name) active.add(name.split('.')[0]);
  }
  return active;
}

/**
 * A name in a pane, or a literal to skip: a field's name after `.` or `->` and a scope's after
 * `::`, however spaced, are not a variable's, and nor is anything quoted.
 */
const PANE_NAME = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?<!\w)(?<!(?:\.|->|::)\s*)[A-Za-z_]\w*(\s*\{)?/g;

/** The variables a pane names, and the variable a reference it names is bound to. */
export function paneVariables(m: PreparedModel, step: TraceStep): Set<string> {
  const named = new Set<string>();
  const refs = step.refs || {};
  // A struct's type that opens a brace list, as the `N` of `A{1, N{2, 3}}`, is not a variable.
  const records = new Set(m.groups.map(group => group.type));
  for (const [token, brace] of step.pane.matchAll(PANE_NAME)) {
    const name = brace ? token.slice(0, -brace.length) : token;
    if (/^["']/.test(name) || (brace && records.has(name))) continue;
    if (m.top.includes(name)) named.add(name);
    if (Object.hasOwn(refs, name) && refs[name]) {
      named.add(name);
      named.add(refs[name].split('.')[0]);
    }
  }
  return named;
}

interface Reach {
  name: string;
  at: number;
}

/** The storage an operation gets to, by name, and when: where it lights that storage up. */
function reached(op: TraceOperation | null): Reach | null {
  if (!op) return null;
  switch (op.kind) {
    // A read or address lights the cell as its walk lands on the last level, a write as its
    // value lands.
    case 'read':
    case 'addr':
      return { name: op.name, at: landing(op) };
    case 'write':
      return { name: op.name, at: arrival(op) };
    // A binding highlights its storage from the start.
    case 'bind':
      return { name: op.target, at: 0 };
    case 'deref':
    case 'alias':
      return { name: op.target, at: arrival(op) - 0.15 };
    default:
      return null;
  }
}

const topOf = (leaf: ModelLeaf): string => leaf.group ?? leaf.name;
const covers = (name: string, cell: string): boolean => cell === name || cell.startsWith(name + '.');

/** The address of a struct: its walk outlines it whole, and it lights none of its cells. */
const addressOfStruct = (m: PreparedModel, op: TraceOperation | null): op is AddrOperation =>
  op?.kind === 'addr' && m.groups.some(group => group.name === op.name);

/**
 * What step `j` reaches, given the step that goes on from it. A dereference or alias whose
 * struct the statement goes on into, as `(*p).a` does, reaches none of it: the field does.
 */
function reachedIn(m: PreparedModel, j: number, next: number): Reach | null {
  const op = m.steps[j].op;
  if (addressOfStruct(m, op)) return null;
  const target = reached(op);
  if (!target || (op?.kind !== 'deref' && op?.kind !== 'alias')) return target;
  const after = m.steps[next]?.op ?? null;
  if (addressOfStruct(m, after)) return null;
  const later = reached(after);
  return later && later.name !== target.name ? null : target;
}

/**
 * The later step of the statement that reads, writes, binds or takes the address of what
 * dereference or alias `j` arrived at, or a field of it, from where `j` left it in the pane, as
 * `(s).a` does; -1 when none does, or `j` is neither.
 */
function continuation(m: PreparedModel, j: number): number {
  const op = m.steps[j].op;
  if (op?.kind !== 'deref' && op?.kind !== 'alias') return -1;
  const name = op.target;
  let at = op.span[0];
  for (let k = j + 1; k < m.steps.length && !opensStatement(m.steps, k); k++) {
    const op = m.steps[k].op;
    if (!op || !('span' in op)) continue;
    const later = reached(op)?.name;
    // A compound read opens at its operator; the field it reads stands before it.
    const [from, to] =
      op.kind === 'write' ? op.destination : op.kind === 'read' && op.compound ? [0, op.span[0]] : op.span;
    if (later && covers(name, later) && from <= at && at < to) return k;
    if (m.steps[k].pane === m.steps[k - 1].pane) continue;
    const [s, e] = op.span;
    if (at >= e) {
      at += m.steps[k].pane.length - m.steps[k - 1].pane.length;
    } else if (at >= s) {
      // A rewrite around the struct, as `(s).a` to `s.a`, keeps it only if it now starts there.
      const spelled = codeName(name);
      const pane = m.steps[k].pane;
      if (!pane.startsWith(spelled, s) || /\w/.test(pane[s + spelled.length] ?? '')) return -1;
      at = s;
    }
  }
  return -1;
}

/**
 * The variables and cells lit as step `i` ends. Every variable the step involves is lit, and a
 * scalar with it. A struct's cells light only as the statement's operations reach them; what a
 * read or address reached stays lit for that step alone, as its value goes into the pane, and
 * what the rest reached to the statement's end.
 */
function litAt(m: PreparedModel, i: number): Set<string> {
  const tops = activeVariables(m, i);
  const names: string[] = [];
  for (const j of statementSteps(m.steps, i)) {
    const op = m.steps[j].op;
    const name = m.reach[j]?.name;
    if (j > i || !name) continue;
    const handsOn = op?.kind === 'addr' || (op?.kind === 'read' && !op.compound);
    if (j === i || !handsOn) names.push(name);
  }
  const op = m.steps[i].op;
  if (op?.kind === 'deref') names.push(op.via);
  const shown = new Set(tops);
  for (const leaf of m.leaves) {
    if (!tops.has(topOf(leaf))) continue;
    if (!leaf.group || names.some(name => covers(name, leaf.name))) shown.add(leaf.name);
  }
  // A nested struct's frame lights with the first of its cells to light, or whole as its address
  // is taken.
  for (const group of m.groups) {
    const taken = addressOfStruct(m, op) && op.name === group.name;
    const inner = m.leaves.some(leaf => shown.has(leaf.name) && covers(group.name, leaf.name));
    if (group.parent && (taken || inner)) shown.add(group.name);
  }
  return shown;
}

/**
 * What a step lights, by variable and cell name: `now` as it ends, `before` as it starts, and
 * when each change begins. What dims does so at once; what the step reaches lights as it gets
 * there.
 */
export interface Focus {
  now: Set<string>;
  before: Set<string>;
  begin: Map<string, number>;
}

export function stepFocus(m: PreparedModel, i: number, animate: boolean): Focus {
  const now = litAt(m, i);
  const begin = new Map<string, number>();
  if (!animate || i === 0) return { now, before: now, begin };
  const before = litAt(m, i - 1);
  const op = m.steps[i].op;
  // What lights does so as the step gets there; a struct it only passes through, as the `b` of
  // `(*q).f`, as the dereference arrives.
  const target = m.reach[i] ?? reached(op);
  if (target) {
    for (const name of now) {
      if (!before.has(name) && (covers(name, target.name) || covers(target.name, name))) {
        begin.set(name, target.at);
      }
    }
  }
  // What dims does so at once, unless the pane still names it until the step rewrites it, as
  // `a` in `a.size()`.
  if (op && !opensStatement(m.steps, i)) {
    const named = paneVariables(m, m.steps[i - 1]);
    const still = paneVariables(m, m.steps[i]);
    for (const name of before) {
      const top = name.split('.')[0];
      if (!now.has(name) && named.has(top) && !still.has(top)) begin.set(name, arrival(op));
    }
  }
  return { now, before, begin };
}
