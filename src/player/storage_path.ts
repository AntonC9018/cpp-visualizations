import { codeName } from '../core/arrays.ts';

export const CHAIN_STEP = 0.7;
/** How long memory trails the pane at each level of a walk. */
export const CHAIN_LEAD = 0.35;

/** `a.f.[0]` → `a`, `a.f`, `a.f.[0]`. */
export function chainOf(name: string): string[] {
  const parts = name.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

/** The extra time a chained read or write waits before its value moves. */
export function chainDelay(name: string | undefined): number {
  const count = name ? chainOf(name).length : 1;
  return count > 1 ? (count - 1) * CHAIN_STEP + CHAIN_LEAD : 0;
}

/** The levels of a chain as the pane spells them from `start`, or null when it does not. */
export function paneLevels(name: string, spelled: string): string[] | null {
  const levels = chainOf(name).map(codeName);
  return levels.length > 1 && levels.every(level => spelled.startsWith(level)) ? levels : null;
}

/** Memory's windows along a chained read or write whose value arrives at `at`. */
export const memoryWalk = (name: string, at: number): Array<[number, number]> =>
  walkWindows(chainOf(name).length, at + 0.15, CHAIN_LEAD);

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
