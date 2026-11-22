// What a trace can be asked for: its template and the flags it takes. Every way of asking reads
// them from here (a lesson tag's attributes, the command-line options of `generate.mjs` and
// `discover.mjs`, and the playground's buttons and URL), so a new flag reaches all of them once
// it is listed below and the tracer reads it from its options. Plain data, no tracer: the
// playground's page loads it without the compiler.
import { Unsupported } from './errors.ts';

export interface Localized {
  en: string;
  ru: string;
}

export interface TemplateInfo {
  /** The playground's name for it. */
  label: Localized;
}

export interface FlagInfo {
  /** The templates that take it. */
  templates: readonly Template[];
  /** The playground's button. */
  label: Localized;
  /** What it changes, for the button's tooltip and the command-line help. */
  description: Localized;
}

export const TEMPLATES = {
  'expression-timeline': {
    label: { en: 'Execution trace', ru: 'Трассировка выполнения' },
  },
  layout: {
    label: { en: 'Struct layout', ru: 'Раскладка структур' },
  },
} as const satisfies Record<string, TemplateInfo>;

export type Template = keyof typeof TEMPLATES;

/** The template of a tag that names none. */
export const DEFAULT_TEMPLATE: Template = 'expression-timeline';

export const FLAGS = {
  types: {
    templates: ['expression-timeline'],
    label: { en: 'Types', ru: 'Типы' },
    description: {
      en: 'Show the type of every value, and a last statement whose types do not fit',
      ru: 'Показывать тип каждого значения и последнюю инструкцию с несовместимыми типами',
    },
  },
  bits: {
    templates: ['expression-timeline'],
    label: { en: 'Bits', ru: 'Биты' },
    description: {
      en: 'Show the bytes of every integer in memory and its bits as it is converted; implies types',
      ru: 'Показывать байты каждого целого в памяти и его биты при преобразовании; включает типы',
    },
  },
  punning: {
    templates: ['expression-timeline'],
    label: { en: 'Pointer punning', ru: 'Реинтерпретация указателей' },
    description: {
      en: 'Trace reading or writing through a pointer to another integer type on a byte-accurate memory strip',
      ru: 'Показывать чтение и запись через указатель на другой целочисленный тип на побайтовой карте памяти',
    },
  },
} as const satisfies Record<string, FlagInfo>;

export type Flag = keyof typeof FLAGS;

/** The flags a trace is made with; a missing one is off. */
export type Flags = { [F in Flag]?: boolean };

export interface TraceSettings {
  template: Template;
  flags: Flags;
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as Template[];
export const FLAG_NAMES = Object.keys(FLAGS) as Flag[];

export function isTemplate(name: string): name is Template {
  return Object.hasOwn(TEMPLATES, name);
}

export function isFlag(name: string): name is Flag {
  return Object.hasOwn(FLAGS, name);
}

export function takesFlag(template: Template, flag: Flag): boolean {
  return (FLAGS[flag].templates as readonly Template[]).includes(template);
}

/** The flags `template` takes, in the order they are listed. */
export function flagsOf(template: Template): Flag[] {
  return FLAG_NAMES.filter(flag => takesFlag(template, flag));
}

/** The flags that are on, in the order they are listed. */
export function enabledFlags(flags: Flags): Flag[] {
  return FLAG_NAMES.filter(flag => flags[flag]);
}

/** `flags` without those `template` does not take, for a view that keeps them across templates. */
export function flagsFor(template: Template, flags: Flags): Flags {
  return Object.fromEntries(flagsOf(template).filter(flag => flags[flag]).map(flag => [flag, true]));
}

/**
 * Settings from names as a tag or a command line spells them, checked: an unknown template or
 * flag, or a flag its template does not take, is unsupported.
 */
export function parseSettings(template: string | null, flags: readonly string[]): TraceSettings {
  const chosen = template ?? DEFAULT_TEMPLATE;
  if (!isTemplate(chosen)) {
    throw new Unsupported(`unknown template '${chosen}'`);
  }
  const parsed: Flags = {};
  for (const flag of flags) {
    if (!isFlag(flag)) {
      throw new Unsupported(`unknown flag '${flag}'`);
    }
    if (!takesFlag(chosen, flag)) {
      throw new Unsupported(`the ${chosen} template does not take '${flag}'`);
    }
    parsed[flag] = true;
  }
  return { template: chosen, flags: parsed };
}

/** Check settings that did not come from `parseSettings`, such as a worker's request. */
export function checkSettings(settings: TraceSettings): TraceSettings {
  return parseSettings(settings.template, enabledFlags(settings.flags));
}
