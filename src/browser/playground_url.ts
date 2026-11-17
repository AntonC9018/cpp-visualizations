// The playground's trace in its URL, so a link reopens it: the code, or the preset it matches,
// the template, and each flag of `settings.ts` as `?flag=1`.
import {
  DEFAULT_TEMPLATE,
  FLAG_NAMES,
  type Flags,
  type Template,
  isTemplate,
} from '../core/settings.ts';
import { type PlaygroundPreset, PRESETS } from './presets.ts';

/** Parameters the playground reads for itself; a flag must not take one of these names. */
export const RESERVED_PARAMS = ['code', 'preset', 'template', 'mode', 'theme', 'lang', 'wasm', 'worker'];

// `mode` named the template in links made before the playground shared the tracer's names.
const LEGACY_TEMPLATES: Record<string, Template> = { trace: 'expression-timeline', layout: 'layout' };

export interface PlaygroundState {
  source: string;
  template: Template;
  /** The flags chosen, kept when the template changes; a trace uses those its template takes. */
  flags: Flags;
}

function templateNamed(name: string | null): Template | null {
  if (name === null) return null;
  return isTemplate(name) ? name : (LEGACY_TEMPLATES[name] ?? null);
}

/** The preset with this code and template, if the code is still a preset's. */
export function matchingPreset(state: Omit<PlaygroundState, 'flags'>): PlaygroundPreset | undefined {
  return PRESETS.find(p => p.source === state.source && p.settings.template === state.template);
}

/** The first preset of a template: what the playground opens with for it. */
export function firstPreset(template: Template): PlaygroundPreset {
  return PRESETS.find(p => p.settings.template === template) ?? PRESETS[0];
}

/** What a link asks for; anything it leaves out comes from the preset it names, or the first. */
export function readState(params: URLSearchParams): PlaygroundState {
  const preset = PRESETS.find(p => p.id === params.get('preset'));
  const template =
    templateNamed(params.get('template')) ??
    templateNamed(params.get('mode')) ??
    preset?.settings.template ??
    DEFAULT_TEMPLATE;
  const fallback = preset ?? firstPreset(template);
  const flags: Flags = {};
  for (const flag of FLAG_NAMES) {
    if (params.has(flag) ? params.get(flag) === '1' : fallback.settings.flags[flag]) {
      flags[flag] = true;
    }
  }
  const source = params.has('code') ? (params.get('code') ?? '') : fallback.source;
  return { source, template, flags };
}

/** Record the state in `params`, naming a preset instead of its code. */
export function writeState(params: URLSearchParams, state: PlaygroundState): void {
  const preset = matchingPreset(state);
  if (!preset) {
    params.set('code', state.source);
    params.delete('preset');
  } else {
    params.delete('code');
    if (preset === PRESETS[0]) params.delete('preset');
    else params.set('preset', preset.id);
  }
  params.delete('mode');
  params.set('template', state.template);
  for (const flag of FLAG_NAMES) {
    if (state.flags[flag]) params.set(flag, '1');
    else params.delete(flag);
  }
}
