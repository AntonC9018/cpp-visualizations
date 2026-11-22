// How a trace is drawn: the default view, or the one a trace asks for.
import { BITS_VIEW } from './bits_view.ts';
import { MAX_SCALE, STACK_BELOW } from './constants.ts';
import type { GeometryOptions } from './geometry.ts';
import { type PreparedModel, stepSeconds } from './model.ts';
import { PUNNING_VIEW } from './punning_view.ts';
import { type SceneContext, scene } from './scene.ts';

export interface TraceView {
  geometry?(m: PreparedModel): GeometryOptions;
  /** CSS pixels: narrower players stack code above memory. */
  stackBelow: number;
  /** CSS pixels per unit at most. */
  maxScale: number;
  /** Whether memory has a byte order the player lets the reader switch. */
  byteOrder: boolean;
  scene(c: SceneContext): string;
  stepSeconds(m: PreparedModel, index: number): number;
}

export const DEFAULT_VIEW: TraceView = {
  stackBelow: STACK_BELOW,
  maxScale: MAX_SCALE,
  byteOrder: false,
  scene,
  stepSeconds: (m, index) => stepSeconds(m.steps, index),
};

export const viewOf = (m: PreparedModel): TraceView =>
  m.trace.punning ? PUNNING_VIEW : m.trace.bits ? BITS_VIEW : DEFAULT_VIEW;
