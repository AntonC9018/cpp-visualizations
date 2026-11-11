// Geometry, timing, palette, and localization constants for the browser player.

export const CHAR = 0.602; // monospace advance, in em
export const CODE_SIZE = 25;
export const PANE_SIZE = 30;
export const CODE_CHAR = CODE_SIZE * CHAR;
export const EVAL_CHAR = PANE_SIZE * CHAR;
export const LINE = 56;
export const CELL = 64;
export const MARGIN = 28;
export const MEMORY_WIDTH = 600;
export const MAX_BYTE = 28;

// Struct frames hug their cells; neighbouring frames just touch.
export const FRAME = { side: 4, top: 36, bottom: 40, stroke: 2.5 } as const;
export const GAP = 2 * FRAME.side + FRAME.stroke;

// A struct holding a struct: the inner frame keeps NEST clear of its neighbours, and the
// outer frame rises by RISE around it, leaving room below for the inner frame's name.
export const NEST = 10;
export const RISE = { top: 10, bottom: 34 } as const;

export interface TagStyle {
  size: number;
  step: number;
}

// A reference is a second name: a tag under the name of what it is bound to. Tags of one
// name stack `step` apart; those of a field sit inside the struct's frame, which grows.
export const TAG: { top: TagStyle; field: TagStyle } = {
  top: { size: 24, step: 40 },
  field: { size: 19, step: 32 },
};

export const STACK_BELOW = 600; // CSS pixels: narrower players stack code above memory
export const MAX_SCALE = 0.6; // CSS pixels per unit: short traces do not blow up
export const DIM = 0.5; // opacity of variables the statement does not involve

export const T = {
  prepare: 0.55,
  travel: 1.1,
  settle: 0.6,
  follow: 0.9,
  writeHold: 0.8,
  copyBegin: 0.15,
  copyTravel: 1.0,
  evaluate: 0.6,
} as const;

export const KEYWORDS = new Set(['int', 'std', 'cout', 'endl', 'struct', 'auto', 'const']);
export const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.2 1"';

export const PALETTE = [
  'bg',
  'panel',
  'pane',
  'fg',
  'muted',
  'grey',
  'context',
  'read',
  'read-fill',
  'write',
  'write-fill',
  'deref-fill',
  'highlight',
  'dead-fill',
  'dead-stroke',
  'gap-stroke',
  'tether',
] as const;

export const VARIABLE_COLOURS = 5;
export const FIELD_COLOURS = 4;

export interface Palette {
  outputLabel: string;
  bg: string;
  panel: string;
  pane: string;
  fg: string;
  muted: string;
  grey: string;
  context: string;
  read: string;
  readFill: string;
  write: string;
  writeFill: string;
  derefFill: string;
  highlight: string;
  deadFill: string;
  deadStroke: string;
  gapStroke: string;
  tether: string;
  vars: string[];
  fields: string[];
}

export interface PlayerStrings {
  play: string;
  pause: string;
  back: string;
  next: string;
  replay: string;
  reset: string;
  speed: string;
  scrub: string;
  output: string;
  stage: string;
  jump: string;
  copy: string;
  read: string;
  addr: string;
  deref: string;
  eval: string;
  write: string;
  print: string;
  bind: string;
  alias: string;
  blank: Record<string, string>;
  error: string;
}

export const STRINGS: Record<string, PlayerStrings> = {
  en: {
    play: 'Play',
    pause: 'Pause',
    back: 'Back',
    next: 'Next',
    replay: 'Replay step',
    reset: 'Reset',
    speed: 'Playback speed',
    scrub: 'Execution step',
    output: 'Output:',
    stage: 'Code, memory and expression evaluation',
    jump: 'Jump to line {line}: {code}',
    copy: 'Line {line}: {code}',
    read: 'Read {name}: {value}',
    addr: 'Take the address of {name}: {value}',
    deref: 'Follow the address in {via} to {target}',
    eval: 'Evaluate: {value}',
    write: 'Store {value} in {name}',
    print: 'Print {value}',
    bind: '{name} becomes another name for {target}',
    alias: '{name} is another name for {target}',
    blank: { '\n': 'Print a newline', '\t': 'Print a tab', ' ': 'Print a space' },
    error: 'This visualization could not be loaded.',
  },
  ru: {
    play: 'Пуск',
    pause: 'Пауза',
    back: 'Назад',
    next: 'Далее',
    replay: 'Повторить шаг',
    reset: 'Сначала',
    speed: 'Скорость',
    scrub: 'Шаг выполнения',
    output: 'Вывод:',
    stage: 'Код, память и вычисление выражения',
    jump: 'Перейти к строке {line}: {code}',
    copy: 'Строка {line}: {code}',
    read: 'Чтение {name}: {value}',
    addr: 'Адрес {name}: {value}',
    deref: 'Переход по адресу из {via} к {target}',
    eval: 'Вычисление: {value}',
    write: 'Запись {value} в {name}',
    print: 'Вывод {value}',
    bind: '{name} становится ещё одним именем для {target}',
    alias: '{name} — другое имя для {target}',
    blank: { '\n': 'Вывод перевода строки', '\t': 'Вывод табуляции', ' ': 'Вывод пробела' },
    error: 'Не удалось загрузить визуализацию.',
  },
};

export type IconName = 'play' | 'pause' | 'back' | 'next' | 'replay' | 'reset';

export const ICONS: Record<IconName, string> = {
  play: '<path d="M5 3.5v13l11-6.5z"/>',
  pause: '<path d="M5 3.5h3.5v13H5zM11.5 3.5H15v13h-3.5z"/>',
  back: '<path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  next: '<path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  replay:
    '<path d="M15.5 10a5.5 5.5 0 1 1-1.8-4.1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.8 2.6v4.6h-4.6z"/>',
  reset: '<path d="M4 4h2.2v12H4zM16 4v12l-8.5-6z"/>',
};

export function themeName(): 'light' | 'dark' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function strings(): PlayerStrings {
  const lang = (document.documentElement.lang || 'en').toLowerCase().split('-')[0];
  return STRINGS[lang] || STRINGS.en;
}

export function icon(name: IconName): string {
  return `<svg class="cv-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="currentColor">${ICONS[name]}</svg>`;
}
