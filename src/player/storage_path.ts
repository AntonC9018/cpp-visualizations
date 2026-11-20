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

/** The levels of a walk as the pane spells them, or null when it does not. */
export function paneLevels(walk: string[], spelled: string): string[] | null {
  const levels = walk.map(codeName);
  return levels.length > 1 && levels.every(level => spelled.startsWith(level)) ? levels : null;
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
