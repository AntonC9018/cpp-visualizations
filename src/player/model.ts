// Player model and timing: flattens execution trace storage into leaf cells and struct groups.
import type {
  ExecutionTrace,
  Span,
  TraceField,
  TraceOperation,
  TraceReference,
  TraceStep,
  TraceVariable,
} from '../core/trace_format.ts';
import { chainDelay, memoryWalk } from './storage_path.ts';
import { T, TYPE_COLOURS } from './constants.ts';

export const stores = (op: TraceOperation): boolean =>
  op.kind === 'write' || op.kind === 'bind';

export const departure = (op: TraceOperation): number =>
  (stores(op) ? T.writeHold : op.kind === 'print' ? 0.2 : T.prepare) +
  (op.kind === 'read' || op.kind === 'write' ? chainDelay(op.name) : 0);

export function arrival(op: TraceOperation): number {
  if (op.kind === 'deref') return T.prepare + T.follow;
  if (op.kind === 'eval' || op.kind === 'alias' || op.kind === 'convert') return T.evaluate;
  if (op.kind === 'clash') return T.clash;
  if (op.kind === 'print') return 0.9;
  return departure(op) + T.travel;
}

export const opSeconds = (op: TraceOperation): number =>
  arrival(op) + T.settle + (stores(op) ? 0.5 : 0);

export const copies = (steps: TraceStep[], i: number): boolean =>
  !steps[i].op && (i === 0 || steps[i - 1].line !== steps[i].line);

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
  return {
    trace,
    typeColours: typeColours(trace),
    typed: trace.steps.some(step => step.types),
    steps: trace.steps,
    source: trace.source,
    spans: trace.spans || [],
    types: trace.types || {},
    references: trace.references || [],
    leaves,
    groups,
    tops,
    top,
    rise: Math.max(0, ...groups.map(group => group.rise)),
  };
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

// Variables the current statement involves stay bright; the rest dim to half. A pointer's
// target joins once evaluation reaches it.
export function activeVariables(m: PreparedModel, i: number): Set<string> {
  const line = m.steps[i].line;
  const active = new Set<string>();
  const refs = m.steps[i].refs || {};
  for (const token of m.source[line].match(/\b[A-Za-z_]\w*\b/g) || []) {
    if (m.top.includes(token)) active.add(token);
    if (Object.prototype.hasOwnProperty.call(refs, token) && refs[token]) {
      active.add(token);
      active.add(refs[token].split('.')[0]);
    }
  }
  for (let j = i; j >= 0 && m.steps[j].line === line; j--) {
    const op = m.steps[j].op;
    if (!op) continue;
    for (const key of ['name', 'target', 'via'] as const) {
      if (key in op) {
        const val = (op as unknown as Record<string, string | undefined>)[key];
        if (val) active.add(val.split('.')[0]);
      }
    }
  }
  return active;
}

/** The storage an operation gets to, by name, and when: where it lights that storage up. */
function reached(op: TraceOperation | null): { name: string; at: number } | null {
  if (!op) return null;
  switch (op.kind) {
    // A read lights the cell as its walk lands on the last level, a write as its value lands.
    case 'read':
      return { name: op.name, at: memoryWalk(op.name, arrival(op)).at(-1)![0] };
    case 'write':
      return { name: op.name, at: arrival(op) };
    // An address and a binding highlight their storage from the start.
    case 'addr':
      return { name: op.name, at: 0 };
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

/** The first step of the statement that step `i` belongs to. */
function statementStart(m: PreparedModel, i: number): number {
  let start = i;
  while (start > 0 && m.steps[start - 1].line === m.steps[i].line) start--;
  return start;
}

/**
 * What step `j` reaches. A dereference or alias whose struct the statement goes on into, as
 * `(*p).a` does, reaches none of it: the field does.
 */
function reachedIn(m: PreparedModel, j: number): { name: string; at: number } | null {
  const target = reached(m.steps[j].op);
  const op = m.steps[j].op;
  if (!target || (op?.kind !== 'deref' && op?.kind !== 'alias')) return target;
  return goesInto(m, j, target.name) ? null : target;
}

/**
 * Whether a later step of the statement reads or writes a field of `name` right where step `j`
 * left it in the pane: the struct it named was only the way to that field.
 */
function goesInto(m: PreparedModel, j: number, name: string): boolean {
  let at = (m.steps[j].op as { span: Span }).span[0];
  for (let k = j + 1; k < m.steps.length && m.steps[k].line === m.steps[j].line; k++) {
    const op = m.steps[k].op;
    if (!op || !('span' in op)) continue;
    const later = reached(op)?.name;
    const where = op.kind === 'write' ? op.destination[0] : op.span[0];
    if (later && later !== name && covers(name, later) && where === at) return true;
    if (m.steps[k].pane === m.steps[k - 1].pane) continue;
    const [s, e] = op.span;
    if (at >= e) at += m.steps[k].pane.length - m.steps[k - 1].pane.length;
    else if (at >= s) return false;
  }
  return false;
}

/**
 * The variables and cells lit as step `i` ends. Every variable the statement uses is lit, and a
 * scalar with it; a struct's cells light only as the statement's operations reach them, and
 * stay lit to its end.
 */
function litAt(m: PreparedModel, i: number): Set<string> {
  const tops = activeVariables(m, i);
  const start = statementStart(m, i);
  const names: string[] = [];
  for (let j = start; j <= i; j++) {
    const name = reachedIn(m, j)?.name;
    if (name) names.push(name);
  }
  const shown = new Set(tops);
  for (const leaf of m.leaves) {
    if (!tops.has(topOf(leaf))) continue;
    if (!leaf.group || names.some(name => covers(name, leaf.name))) shown.add(leaf.name);
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
  const target = reachedIn(m, i);
  if (target) {
    const top = target.name.split('.')[0];
    for (const name of now) {
      if (!before.has(name) && (name === top || covers(target.name, name))) begin.set(name, target.at);
    }
  }
  return { now, before, begin };
}
