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
import { T } from './constants.ts';

export const stores = (op: TraceOperation): boolean =>
  op.kind === 'write' || op.kind === 'bind';

export const departure = (op: TraceOperation): number =>
  stores(op) ? T.writeHold : op.kind === 'print' ? 0.2 : T.prepare;

export function arrival(op: TraceOperation): number {
  if (op.kind === 'deref') return T.prepare + T.follow;
  if (op.kind === 'eval' || op.kind === 'alias') return T.evaluate;
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
