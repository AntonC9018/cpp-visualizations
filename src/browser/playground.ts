// Interactive browser playground driving Clang WASM tracing + Layout/Player rendering.
//
// Its templates and flags are those of `../core/settings.ts`: a button each, in the URL, and in
// the worker's request as they are, so a new one appears here without touching this file.
import { NeedsFlag, Unsupported } from '../core/errors.ts';
import {
  FLAG_NAMES,
  type Flag,
  TEMPLATE_NAMES,
  TEMPLATES,
  FLAGS,
  type Template,
  type TraceSettings,
  flagsFor,
  isFlag,
  takesFlag,
} from '../core/settings.ts';
import type { AnyTrace } from '../core/trace_format.ts';
import type { VisualizationHost } from '../player/index.ts';
import { Layout } from '../player/layout_view.ts';
import { Player } from '../player/player_view.ts';
import { DEFAULT_CACHE_NAME, DEFAULT_WASM_URL, type WasmLoadProgress } from './cache.ts';
import { ClangWasmClient, type ClientTraceResult } from './client.ts';
import { firstPreset, matchingPreset, readState, writeState } from './playground_url.ts';
import { PRESETS } from './presets.ts';

export { PRESETS, type PlaygroundPreset } from './presets.ts';

const CUSTOM_PRESET_ID = '__custom__';

interface UiCopy {
  title: string;
  subtitle: string;
  presetLabel: string;
  customPreset: string;
  themeDark: string;
  themeLight: string;
  langLabel: string;
  editorLabel: string;
  run: string;
  running: string;
  shortcut: string;
  clearCache: string;
  cacheCleared: string;
  checkingCache: string;
  downloading: (loadedMb: string, totalMb: string | null) => string;
  compiling: string;
  readyCached: (sizeMb: string, ms: number | null) => string;
  readyDownloaded: (sizeMb: string, ms: number | null) => string;
  traceTime: (ms: number) => string;
  emptyPlaceholder: string;
  /** The error's button that turns on the flag the snippet needs, by the flag's label. */
  turnOn: (flag: string) => string;
  /** What follows such an error's diagnostic. */
  needsFlag: (flag: string) => string;
}

const UI_COPY: Record<'en' | 'ru', UiCopy> = {
  en: {
    title: 'C++ Memory & Layout Playground',
    subtitle: 'Compiled in-browser with Clang 21 WebAssembly — no backend required.',
    presetLabel: 'Example',
    customPreset: 'Custom code',
    themeDark: 'Dark',
    themeLight: 'Light',
    langLabel: 'RU',
    editorLabel: 'C++ body (runs inside int main())',
    run: 'Visualize',
    running: 'Compiling…',
    shortcut: 'Ctrl+Enter / Cmd+Enter to run',
    clearCache: 'Clear WASM cache',
    cacheCleared: 'WASM cache cleared — next run will re-download',
    checkingCache: 'Checking browser WASM cache…',
    downloading: (loadedMb, totalMb) =>
      totalMb
        ? `Downloading Clang WASM (${loadedMb} / ${totalMb} MB)…`
        : `Downloading Clang WASM (${loadedMb} MB)…`,
    compiling: 'Compiling WebAssembly module…',
    readyCached: (sizeMb, ms) =>
      ms !== null
        ? `Clang WASM ready · cached (${sizeMb} MB, ${ms} ms)`
        : `Clang WASM ready · cached (${sizeMb} MB)`,
    readyDownloaded: (sizeMb, ms) =>
      ms !== null
        ? `Clang WASM ready · downloaded & cached (${sizeMb} MB, ${ms} ms)`
        : `Clang WASM ready · downloaded & cached (${sizeMb} MB)`,
    traceTime: ms => `Traced in ${ms} ms`,
    emptyPlaceholder: 'Write a C++ snippet on the left and press Visualize.',
    turnOn: flag => `Turn on ${flag}`,
    needsFlag: flag => `; with ${flag} on, the trace shows why`,
  },
  ru: {
    title: 'Песочница памяти и раскладки C++',
    subtitle: 'Компиляция прямо в браузере через Clang 21 WebAssembly — без сервера.',
    presetLabel: 'Пример',
    customPreset: 'Свой код',
    themeDark: 'Тёмная',
    themeLight: 'Светлая',
    langLabel: 'EN',
    editorLabel: 'Код C++ (выполняется внутри int main())',
    run: 'Визуализировать',
    running: 'Компиляция…',
    shortcut: 'Ctrl+Enter / Cmd+Enter для запуска',
    clearCache: 'Очистить кэш WASM',
    cacheCleared: 'Кэш WASM очищен — следующий запуск загрузит модуль заново',
    checkingCache: 'Проверка кэша WASM в браузере…',
    downloading: (loadedMb, totalMb) =>
      totalMb
        ? `Загрузка Clang WASM (${loadedMb} / ${totalMb} МБ)…`
        : `Загрузка Clang WASM (${loadedMb} МБ)…`,
    compiling: 'Компиляция WebAssembly модуля…',
    readyCached: (sizeMb, ms) =>
      ms !== null
        ? `Clang WASM готов · из кэша (${sizeMb} МБ, ${ms} мс)`
        : `Clang WASM готов · из кэша (${sizeMb} МБ)`,
    readyDownloaded: (sizeMb, ms) =>
      ms !== null
        ? `Clang WASM готов · загружен и кэширован (${sizeMb} МБ, ${ms} мс)`
        : `Clang WASM готов · загружен и кэширован (${sizeMb} МБ)`,
    traceTime: ms => `Готово за ${ms} мс`,
    emptyPlaceholder: 'Введите фрагмент C++ слева и нажмите «Визуализировать».',
    turnOn: flag => `Включить «${flag}»`,
    needsFlag: flag => `; если включить «${flag}», трасса покажет причину`,
  },
};

export interface PlaygroundConfig {
  wasmUrl?: string;
  workerUrl?: string;
  workerType?: WorkerType;
  cacheName?: string;
}

export interface PlaygroundController {
  client: ClangWasmClient;
  run(): Promise<void>;
  setTemplate(template: Template): void;
  setFlag(flag: Flag, on: boolean): void;
  clearCache(): Promise<boolean>;
}

declare global {
  interface Window {
    CoursePlaygroundConfig?: PlaygroundConfig;
    CoursePlayground?: PlaygroundController;
  }
}

function getLang(): 'en' | 'ru' {
  return (document.documentElement.lang || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function getTheme(): 'dark' | 'light' {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function resolveConfig(root: HTMLElement): Required<PlaygroundConfig> {
  const params = new URLSearchParams(window.location.search);
  const globalCfg = window.CoursePlaygroundConfig ?? {};
  const wasmUrl =
    params.get('wasm') ||
    root.dataset.wasmUrl ||
    document.documentElement.dataset.wasmUrl ||
    globalCfg.wasmUrl ||
    DEFAULT_WASM_URL;
  const workerUrl =
    params.get('worker') ||
    root.dataset.workerUrl ||
    globalCfg.workerUrl ||
    new URL('./clang-worker.js', import.meta.url).href;
  const workerType =
    (root.dataset.workerType as WorkerType | undefined) || globalCfg.workerType || 'classic';
  const cacheName =
    root.dataset.cacheName || globalCfg.cacheName || DEFAULT_CACHE_NAME;
  return { wasmUrl, workerUrl, workerType, cacheName };
}

export function initPlayground(root: HTMLElement): PlaygroundController {
  const params = new URLSearchParams(window.location.search);
  const queryTheme = params.get('theme');
  if (queryTheme === 'light' || queryTheme === 'dark') {
    document.documentElement.dataset.theme = queryTheme;
  } else if (!document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = getTheme();
  }
  const queryLang = params.get('lang');
  if (queryLang === 'en' || queryLang === 'ru') {
    document.documentElement.lang = queryLang;
  } else if (!document.documentElement.lang) {
    document.documentElement.lang = 'en';
  }

  const state = readState(params);

  const cfg = resolveConfig(root);

  root.innerHTML = `
    <header class="pg-header">
      <div class="pg-brand">
        <h1 class="pg-title"></h1>
        <p class="pg-subtitle"></p>
      </div>
      <div class="pg-header-actions">
        <div class="pg-segmented" role="group" aria-label="Visualization template">
          ${TEMPLATE_NAMES.map(t => `<button type="button" class="pg-mode-btn" data-template="${t}"></button>`).join('')}
        </div>
        <div class="pg-flags" role="group" aria-label="Trace flags">
          ${FLAG_NAMES.map(f => `<button type="button" class="pg-btn pg-flag-btn" data-flag="${f}"></button>`).join('')}
        </div>
        <label class="pg-preset-wrap">
          <span class="pg-preset-label"></span>
          <select class="pg-preset-select"></select>
        </label>
        <button type="button" class="pg-btn pg-lang-btn"></button>
        <button type="button" class="pg-btn pg-theme-btn"></button>
      </div>
    </header>
    <div class="pg-status-bar">
      <div class="pg-wasm-status" data-state="idle">
        <span class="pg-status-dot" aria-hidden="true"></span>
        <span class="pg-status-text"></span>
      </div>
      <div class="pg-status-meta">
        <span class="pg-trace-time"></span>
        <button type="button" class="pg-btn pg-btn-subtle pg-clear-cache-btn"></button>
      </div>
    </div>
    <main class="pg-workspace">
      <section class="pg-editor-pane">
        <div class="pg-pane-head">
          <label class="pg-editor-label" for="pg-source"></label>
          <span class="pg-shortcut"></span>
        </div>
        <textarea id="pg-source" class="pg-editor" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        <div class="pg-editor-foot">
          <button type="button" class="pg-btn pg-btn-primary pg-run-btn"></button>
        </div>
      </section>
      <section class="pg-output-pane">
        <div class="pg-error-box" hidden></div>
        <div class="pg-empty-box"></div>
        <div class="course-visualization pg-vis-host"></div>
      </section>
    </main>
  `;

  const titleEl = root.querySelector('.pg-title') as HTMLHeadingElement;
  const subtitleEl = root.querySelector('.pg-subtitle') as HTMLParagraphElement;
  const templateBtns = new Map(
    TEMPLATE_NAMES.map(t => [t, root.querySelector(`[data-template="${t}"]`) as HTMLButtonElement])
  );
  const flagBtns = new Map(
    FLAG_NAMES.map(f => [f, root.querySelector(`[data-flag="${f}"]`) as HTMLButtonElement])
  );
  const presetLabelEl = root.querySelector('.pg-preset-label') as HTMLSpanElement;
  const presetSelect = root.querySelector('.pg-preset-select') as HTMLSelectElement;
  const langBtn = root.querySelector('.pg-lang-btn') as HTMLButtonElement;
  const themeBtn = root.querySelector('.pg-theme-btn') as HTMLButtonElement;
  const wasmStatusBox = root.querySelector('.pg-wasm-status') as HTMLDivElement;
  const wasmStatusText = root.querySelector('.pg-status-text') as HTMLSpanElement;
  const traceTimeEl = root.querySelector('.pg-trace-time') as HTMLSpanElement;
  const clearCacheBtn = root.querySelector('.pg-clear-cache-btn') as HTMLButtonElement;
  const editorLabelEl = root.querySelector('.pg-editor-label') as HTMLLabelElement;
  const shortcutEl = root.querySelector('.pg-shortcut') as HTMLSpanElement;
  const editor = root.querySelector('#pg-source') as HTMLTextAreaElement;
  const runBtn = root.querySelector('.pg-run-btn') as HTMLButtonElement;
  const errorBox = root.querySelector('.pg-error-box') as HTMLDivElement;
  const emptyBox = root.querySelector('.pg-empty-box') as HTMLDivElement;
  const visHost = root.querySelector('.pg-vis-host') as HTMLDivElement;

  editor.value = state.source;

  let currentView: Player | Layout | null = null;
  let lastTrace: AnyTrace | null = null;
  let lastError: unknown = null;
  // The source the last error is about: its action applies only while the editor still holds it.
  let errorSource: string | null = null;
  let lastDurationMs: number | null = null;
  let lastLoadMeta: ClientTraceResult['load'] | null = null;
  let isRunning = false;
  let activeRunSeq = 0;

  const client = new ClangWasmClient({
    wasmUrl: cfg.wasmUrl,
    workerUrl: cfg.workerUrl,
    workerType: cfg.workerType,
    cacheName: cfg.cacheName,
    onProgress: handleProgress,
  });

  /** The settings the next trace is made with: the chosen flags its template takes. */
  function settings(): TraceSettings {
    return { template: state.template, flags: flagsFor(state.template, state.flags) };
  }

  function syncUrl(): void {
    const url = new URL(window.location.href);
    state.source = editor.value;
    writeState(url.searchParams, state);
    url.searchParams.set('theme', getTheme());
    url.searchParams.set('lang', getLang());
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function handleProgress(progress: WasmLoadProgress): void {
    const copy = UI_COPY[getLang()];
    wasmStatusBox.dataset.state = progress.phase;
    if (progress.phase === 'checking-cache') {
      wasmStatusText.textContent = copy.checkingCache;
    } else if (progress.phase === 'downloading') {
      const loaded = formatMb(progress.loadedBytes ?? 0);
      const total = progress.totalBytes ? formatMb(progress.totalBytes) : null;
      wasmStatusText.textContent = copy.downloading(loaded, total);
    } else if (progress.phase === 'compiling') {
      wasmStatusText.textContent = copy.compiling;
    } else if (progress.phase === 'ready') {
      const size = formatMb(progress.totalBytes ?? progress.loadedBytes ?? 0);
      wasmStatusText.textContent = progress.fromCache
        ? copy.readyCached(size, null)
        : copy.readyDownloaded(size, null);
    }
  }

  function populatePresets(): void {
    const lang = getLang();
    const copy = UI_COPY[lang];
    const matched = matchingPreset({ source: editor.value, template: state.template });
    presetSelect.innerHTML = '';
    if (!matched) {
      const customOpt = document.createElement('option');
      customOpt.value = CUSTOM_PRESET_ID;
      customOpt.textContent = copy.customPreset;
      presetSelect.append(customOpt);
    }
    for (const template of TEMPLATE_NAMES) {
      const group = document.createElement('optgroup');
      group.label = TEMPLATES[template].label[lang];
      for (const preset of PRESETS.filter(p => p.settings.template === template)) {
        const opt = document.createElement('option');
        opt.value = preset.id;
        opt.textContent = preset.label[lang];
        group.append(opt);
      }
      if (group.children.length) presetSelect.append(group);
    }
    presetSelect.value = matched ? matched.id : CUSTOM_PRESET_ID;
  }

  function renderStrings(): void {
    const lang = getLang();
    const theme = getTheme();
    const copy = UI_COPY[lang];

    titleEl.textContent = copy.title;
    subtitleEl.textContent = copy.subtitle;
    for (const [template, btn] of templateBtns) {
      const active = template === state.template;
      btn.textContent = TEMPLATES[template].label[lang];
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    for (const [flag, btn] of flagBtns) {
      const on = Boolean(state.flags[flag]);
      btn.textContent = FLAGS[flag].label[lang];
      btn.title = FLAGS[flag].description[lang];
      btn.hidden = !takesFlag(state.template, flag);
      btn.setAttribute('aria-pressed', String(on));
    }

    presetLabelEl.textContent = copy.presetLabel;
    populatePresets();

    langBtn.textContent = copy.langLabel;
    themeBtn.textContent = theme === 'dark' ? copy.themeLight : copy.themeDark;
    editorLabelEl.textContent = copy.editorLabel;
    shortcutEl.textContent = copy.shortcut;
    runBtn.textContent = isRunning ? copy.running : copy.run;
    runBtn.disabled = isRunning;
    clearCacheBtn.textContent = copy.clearCache;
    emptyBox.textContent = copy.emptyPlaceholder;
    if (!errorBox.hidden) renderError();

    if (lastLoadMeta) {
      const size = formatMb(lastLoadMeta.byteLength);
      wasmStatusBox.dataset.state = 'ready';
      wasmStatusText.textContent = lastLoadMeta.fromCache
        ? copy.readyCached(size, lastLoadMeta.elapsedMs)
        : copy.readyDownloaded(size, lastLoadMeta.elapsedMs);
    } else if (wasmStatusBox.dataset.state === 'idle') {
      wasmStatusText.textContent = copy.checkingCache;
    }

    traceTimeEl.textContent =
      lastDurationMs !== null ? copy.traceTime(lastDurationMs) : '';
  }

  /** The last run's error, and a button that turns on the flag it needs, if any. */
  function renderError(): void {
    const err = lastError;
    const lang = getLang();
    if (err instanceof NeedsFlag && isFlag(err.flag) && takesFlag(state.template, err.flag)) {
      const flag = err.flag;
      const label = FLAGS[flag].label[lang];
      errorBox.replaceChildren(`IllFormed: ${err.diagnostic}`);
      if (errorSource !== editor.value) return;
      errorBox.append(UI_COPY[lang].needsFlag(label));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pg-btn pg-error-action';
      button.textContent = UI_COPY[lang].turnOn(label);
      button.addEventListener('click', () => {
        // The button goes with the error: focus moves to the flag's own toggle.
        flagBtns.get(flag)?.focus();
        setFlag(flag, true);
      });
      errorBox.append(button);
      return;
    }
    const prefix = err instanceof Unsupported ? `${err.name}: ` : '';
    const message = err instanceof Error ? err.message : String(err);
    errorBox.replaceChildren(`${prefix}${message}`);
  }

  function clearVisualization(): void {
    if (currentView) {
      currentView.disconnect();
      currentView = null;
    }
    delete (visHost as VisualizationHost).cvPlayer;
    visHost.innerHTML = '';
  }

  function mountTrace(trace: AnyTrace): void {
    clearVisualization();
    emptyBox.hidden = true;
    errorBox.hidden = true;
    if (trace.kind === 'layout') {
      currentView = new Layout(visHost, trace);
    } else {
      currentView = new Player(visHost, trace);
    }
    (visHost as VisualizationHost).cvPlayer = currentView;
    lastTrace = trace;
  }

  async function run(): Promise<void> {
    const seq = ++activeRunSeq;
    const source = editor.value;
    isRunning = true;
    renderStrings();
    errorBox.hidden = true;

    try {
      const result = await client.trace(source, settings());
      if (seq !== activeRunSeq) return;
      lastLoadMeta = result.load;
      lastDurationMs = result.durationMs;
      mountTrace(result.trace);
    } catch (err) {
      if (seq !== activeRunSeq) return;
      clearVisualization();
      emptyBox.hidden = true;
      errorBox.hidden = false;
      lastError = err;
      errorSource = source;
      renderError();
      lastTrace = null;
    } finally {
      if (seq === activeRunSeq) {
        isRunning = false;
        renderStrings();
      }
    }
  }

  function setTemplate(template: Template): void {
    if (state.template === template) return;
    const selected = PRESETS.find(p => p.id === presetSelect.value);
    state.template = template;
    if (selected) {
      // A preset of the other template means nothing here: open this template's first one.
      const preset = firstPreset(template);
      editor.value = preset.source;
      state.flags = { ...preset.settings.flags };
    }
    renderStrings();
    syncUrl();
    void run();
  }

  function setFlag(flag: Flag, on: boolean): void {
    if (Boolean(state.flags[flag]) === on) return;
    state.flags = { ...state.flags, [flag]: on };
    renderStrings();
    syncUrl();
    void run();
  }

  for (const [template, btn] of templateBtns) {
    btn.addEventListener('click', () => setTemplate(template));
  }
  for (const [flag, btn] of flagBtns) {
    btn.addEventListener('click', () => setFlag(flag, !state.flags[flag]));
  }

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find(p => p.id === presetSelect.value);
    if (!preset) return;
    state.template = preset.settings.template;
    state.flags = { ...preset.settings.flags };
    editor.value = preset.source;
    renderStrings();
    syncUrl();
    void run();
  });

  themeBtn.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    currentView?.refresh();
    renderStrings();
    syncUrl();
  });

  langBtn.addEventListener('click', () => {
    const next = getLang() === 'en' ? 'ru' : 'en';
    document.documentElement.lang = next;
    renderStrings();
    syncUrl();
    if (lastTrace) {
      const stepIndex = currentView instanceof Player ? currentView.index : null;
      mountTrace(lastTrace);
      if (currentView instanceof Player && stepIndex !== null) {
        currentView.settle(stepIndex);
      }
    }
  });

  runBtn.addEventListener('click', () => {
    syncUrl();
    void run();
  });

  editor.addEventListener('input', () => {
    populatePresets();
    syncUrl();
    if (!errorBox.hidden) renderError();
  });

  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      syncUrl();
      void run();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText('  ', start, end, 'end');
      populatePresets();
      syncUrl();
      if (!errorBox.hidden) renderError();
    }
  });

  async function clearCache(): Promise<boolean> {
    const cleared = await client.clearCache();
    lastLoadMeta = null;
    wasmStatusBox.dataset.state = 'idle';
    wasmStatusText.textContent = UI_COPY[getLang()].cacheCleared;
    return cleared;
  }

  clearCacheBtn.addEventListener('click', () => {
    void clearCache();
  });

  renderStrings();
  const controller: PlaygroundController = {
    client,
    run,
    setTemplate,
    setFlag,
    clearCache,
  };
  window.CoursePlayground = controller;

  void run();
  return controller;
}

if (typeof document !== 'undefined') {
  const mount = (): void => {
    const root = document.getElementById('playground-root');
    if (root && !root.dataset.pgMounted) {
      root.dataset.pgMounted = 'true';
      initPlayground(root);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
}
