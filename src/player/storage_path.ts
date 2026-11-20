import { codeName } from '../core/arrays.ts';

export const CHAIN_STEP = 0.7;
/** How long memory trails the pane at each level of a walk. */
export const CHAIN_LEAD = 0.35;

/** `a.f.[0]` → `a`, `a.f`, `a.f.[0]`. */
export function chainOf(name: string): string[] {
  const parts = name.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

/** The extra time a walk along these levels holds back the value. */
export function chainDelay(levels: string[]): number {
  return levels.length > 1 ? (levels.length - 1) * CHAIN_STEP + CHAIN_LEAD : 0;
}

/**
 * Where each level of a walk ends in the pane, counted from `from`: `&(a).n. g` ends `a`, `a.n`
 * and `a.n.g` 3, 6 and 9 characters in. Null for a walk of one level, or one the pane does not
 * spell there. A leading `&`, and spaces or parentheses between the names, spell the same chain.
 */
export function paneLevels(walk: string[], pane: string, from: number): number[] | null {
  if (walk.length < 2) return null;
  const tokens = (level: string): string[] => codeName(level).match(/\w+|\S/g) ?? [];
  const spelled = tokens(walk.at(-1)!);
  const ends: number[] = [];
  let at = pane[from] === '&' ? from + 1 : from;
  let k = 0;
  for (const level of walk) {
    for (const count = tokens(level).length; k < count; k++) {
      while (/[\s()]/.test(pane[at] ?? '')) at++;
      if (!pane.startsWith(spelled[k], at)) return null;
      at += spelled[k].length;
    }
    ends.push(at - from);
  }
  return /\w/.test(pane[at] ?? '') ? null : ends;
}

/** Memory's windows along a walk whose value arrives at `at`. */
export const memoryWalk = (levels: string[], at: number): Array<[number, number]> =>
  walkWindows(levels.length, at + 0.15, CHAIN_LEAD);

/**
 * Each level's window: shown from `begin`, gone at `leave` (the last stays until `end`).
 * The pane's windows start at 0; memory's are offset by CHAIN_LEAD, so they alternate.
 */
export function walkWindows(count: number, end: number, offset = 0): Array<[number, number]> {
  const start = count > 1 ? offset : 0;
  return Array.from({ length: count }, (_, k) => [
    start + k * CHAIN_STEP,
    k === count - 1 ? end : start + (k + 1) * CHAIN_STEP,
  ]);
}
