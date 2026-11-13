// Interactive browser playground driving Clang WASM tracing + Layout/Player rendering.
import { Unsupported } from '../core/errors.ts';
import type { AnyTrace } from '../core/trace_format.ts';
import type { VisualizationHost } from '../player/index.ts';
import { Layout } from '../player/layout_view.ts';
import { Player } from '../player/player_view.ts';
import { DEFAULT_CACHE_NAME, DEFAULT_WASM_URL, type WasmLoadProgress } from './cache.ts';
import { ClangWasmClient, type ClientTraceResult } from './client.ts';
import type { TraceMode } from './wasm_frontend.ts';

export interface PlaygroundPreset {
  id: string;
  mode: TraceMode;
  label: { en: string; ru: string };
  source: string;
}

export const PRESETS: readonly PlaygroundPreset[] = [
  {
    id: 'double-pointer',
    mode: 'trace',
    label: { en: 'Double pointer (**pp)', ru: 'Указатель на указатель (**pp)' },
    source: [
      'int a = 5;',
      'int b = 6;',
      'int* p = &a;',
      'int** pp = &p;',
      '**pp = 7;',
      'std::cout << a << std::endl;',
    ].join('\n'),
  },
  {
    id: 'struct-shallow-copy',
    mode: 'trace',
    label: { en: 'Struct & shallow pointer copy', ru: 'Структура и поверхностное копирование' },
    source: [
      'struct S {',
      '  int x;',
      '  int* p;',
      '};',
      'int a = 1;',
      'S s{2, &a};',
      'S t = s;',
      'S* ptr = &s;',
      'ptr->x = 3;',
      '*t.p = 7;',
      'std::cout << s.x << std::endl;',
    ].join('\n'),
  },
  {
    id: 'references',
    mode: 'trace',
    label: { en: 'References as aliases', ru: 'Ссылки как псевдонимы' },
    source: [
      'int a = 10;',
      'int& ref = a;',
      'ref = 25;',
      'int* p = &ref;',
      '*p = 42;',
      'std::cout << a << std::endl;',
    ].join('\n'),
  },
  {
    id: 'nested-struct',
    mode: 'trace',
    label: { en: 'Nested struct & designated init', ru: 'Вложенная структура и поля' },
    source: [
      'struct N { int f; int g; };',
      'struct A { int* p; N n; int f; };',
      'int v = 1;',
      'A a{ .p = &v, .n = { .f = 2 } };',
      'A b{a};',
      'N* q = &b.n;',
      'q->g = 9;',
      'int* r = &a.n.f;',
      '*r = 4;',
      'std::cout << b.n.g << std::endl;',
    ].join('\n'),
  },
  {
    id: 'layout-padding',
    mode: 'layout',
    label: { en: 'Struct padding & alignment', ru: 'Выравнивание и заполнение полей' },
    source: [
      'struct Packet {',
      '  uint8_t tag;',
      '  int value;',
      '  uint8_t flags;',
      '};',
    ].join('\n'),
  },
  {
    id: 'layout-pointers',
    mode: 'layout',
    label: { en: '64-bit pointer fields layout', ru: 'Раскладка полей с указателями' },
    source: [
      'struct Node {',
      '  int8_t kind;',
      '  int* next;',
      '  size_t count;',
      '  uint64_t id;',
      '};',
    ].join('\n'),
  },
];

const CUSTOM_PRESET_ID = '__custom__';

interface UiCopy {
  title: string;
  subtitle: string;
  modeTrace: string;
  modeLayout: string;
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
  hintTrace: string;
  hintLayout: string;
  emptyPlaceholder: string;
}

const UI_COPY: Record<'en' | 'ru', UiCopy> = {
  en: {
    title: 'C++ Memory & Layout Playground',
    subtitle: 'Compiled in-browser with Clang 21 WebAssembly — no backend required.',
    modeTrace: 'Execution trace',
    modeLayout: 'Struct layout',
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
    hintTrace:
      'Supported: int, int*/int**, structs, nested structs, references, and single-value std::cout.',
    hintLayout:
      'Supported: plain structs with uint8_t, int8_t, int, size_t, uint64_t, and pointers.',
    emptyPlaceholder: 'Write a C++ snippet on the left and press Visualize.',
  },
  ru: {
    title: 'Песочница памяти и раскладки C++',
    subtitle: 'Компиляция прямо в браузере через Clang 21 WebAssembly — без сервера.',
    modeTrace: 'Трассировка выполнения',
    modeLayout: 'Раскладка структур',
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
    hintTrace:
      'Поддерживается: int, int*/int**, структуры, вложенные структуры, ссылки и вывод в std::cout.',
    hintLayout:
      'Поддерживается: простые структуры с uint8_t, int8_t, int, size_t, uint64_t и указателями.',
    emptyPlaceholder: 'Введите фрагмент C++ слева и нажмите «Визуализировать».',
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
  setMode(mode: TraceMode): void;
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

  const queryPresetId = params.get('preset');
  const queryPreset = queryPresetId ? PRESETS.find(p => p.id === queryPresetId) : undefined;
  const hasQueryCode = params.has('code');
  const queryCode = params.get('code');
  const queryMode = params.get('mode');

  let mode: TraceMode =
    queryMode === 'layout' || queryMode === 'trace'
      ? queryMode
      : (queryPreset?.mode ?? 'trace');
  const initialPreset = queryPreset ?? PRESETS.find(p => p.mode === mode) ?? PRESETS[0];

  const cfg = resolveConfig(root);

  root.innerHTML = `
    <header class="pg-header">
      <div class="pg-brand">
        <h1 class="pg-title"></h1>
        <p class="pg-subtitle"></p>
      </div>
      <div class="pg-header-actions">
        <div class="pg-segmented" role="group" aria-label="Visualization mode">
          <button type="button" class="pg-mode-btn" data-mode="trace"></button>
          <button type="button" class="pg-mode-btn" data-mode="layout"></button>
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
          <p class="pg-hint"></p>
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
  const modeTraceBtn = root.querySelector('[data-mode="trace"]') as HTMLButtonElement;
  const modeLayoutBtn = root.querySelector('[data-mode="layout"]') as HTMLButtonElement;
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
  const hintEl = root.querySelector('.pg-hint') as HTMLParagraphElement;
  const runBtn = root.querySelector('.pg-run-btn') as HTMLButtonElement;
  const errorBox = root.querySelector('.pg-error-box') as HTMLDivElement;
  const emptyBox = root.querySelector('.pg-empty-box') as HTMLDivElement;
  const visHost = root.querySelector('.pg-vis-host') as HTMLDivElement;

  editor.value = hasQueryCode ? (queryCode ?? '') : initialPreset.source;

  let currentView: Player | Layout | null = null;
  let lastTrace: AnyTrace | null = null;
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

  function matchingPreset(source: string = editor.value): PlaygroundPreset | undefined {
    return PRESETS.find(p => p.source === source && p.mode === mode);
  }

  function syncUrl(): void {
    const url = new URL(window.location.href);
    const matched = matchingPreset();
    if (!matched) {
      url.searchParams.set('code', editor.value);
      url.searchParams.delete('preset');
    } else {
      url.searchParams.delete('code');
      if (matched.id !== PRESETS[0].id) {
        url.searchParams.set('preset', matched.id);
      } else {
        url.searchParams.delete('preset');
      }
    }
    url.searchParams.set('mode', mode);
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
    const matched = matchingPreset();
    presetSelect.innerHTML = '';
    if (!matched) {
      const customOpt = document.createElement('option');
      customOpt.value = CUSTOM_PRESET_ID;
      customOpt.textContent = copy.customPreset;
      presetSelect.append(customOpt);
    }
    for (const preset of PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = `[${preset.mode === 'layout' ? 'Layout' : 'Trace'}] ${preset.label[lang]}`;
      presetSelect.append(opt);
    }
    presetSelect.value = matched ? matched.id : CUSTOM_PRESET_ID;
  }

  function renderStrings(): void {
    const lang = getLang();
    const theme = getTheme();
    const copy = UI_COPY[lang];

    titleEl.textContent = copy.title;
    subtitleEl.textContent = copy.subtitle;
    modeTraceBtn.textContent = copy.modeTrace;
    modeLayoutBtn.textContent = copy.modeLayout;
    modeTraceBtn.classList.toggle('is-active', mode === 'trace');
    modeLayoutBtn.classList.toggle('is-active', mode === 'layout');
    modeTraceBtn.setAttribute('aria-pressed', String(mode === 'trace'));
    modeLayoutBtn.setAttribute('aria-pressed', String(mode === 'layout'));

    presetLabelEl.textContent = copy.presetLabel;
    populatePresets();

    langBtn.textContent = copy.langLabel;
    themeBtn.textContent = theme === 'dark' ? copy.themeLight : copy.themeDark;
    editorLabelEl.textContent = copy.editorLabel;
    shortcutEl.textContent = copy.shortcut;
    hintEl.textContent = mode === 'trace' ? copy.hintTrace : copy.hintLayout;
    runBtn.textContent = isRunning ? copy.running : copy.run;
    runBtn.disabled = isRunning;
    clearCacheBtn.textContent = copy.clearCache;
    emptyBox.textContent = copy.emptyPlaceholder;

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
      const result = await client.trace(source, { mode });
      if (seq !== activeRunSeq) return;
      lastLoadMeta = result.load;
      lastDurationMs = result.durationMs;
      mountTrace(result.trace);
    } catch (err) {
      if (seq !== activeRunSeq) return;
      clearVisualization();
      emptyBox.hidden = true;
      errorBox.hidden = false;
      const prefix = err instanceof Unsupported ? `${err.name}: ` : '';
      const message = err instanceof Error ? err.message : String(err);
      errorBox.textContent = `${prefix}${message}`;
      lastTrace = null;
    } finally {
      if (seq === activeRunSeq) {
        isRunning = false;
        renderStrings();
      }
    }
  }

  function setMode(nextMode: TraceMode): void {
    if (mode === nextMode) return;
    mode = nextMode;
    renderStrings();
  }

  function switchMode(nextMode: TraceMode): void {
    const selectedPreset = PRESETS.find(p => p.id === presetSelect.value);
    setMode(nextMode);
    if (selectedPreset && selectedPreset.mode !== nextMode) {
      const firstForMode = PRESETS.find(p => p.mode === nextMode)!;
      editor.value = firstForMode.source;
      populatePresets();
    }
    syncUrl();
    void run();
  }

  modeTraceBtn.addEventListener('click', () => {
    switchMode('trace');
  });

  modeLayoutBtn.addEventListener('click', () => {
    switchMode('layout');
  });

  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find(p => p.id === presetSelect.value);
    if (!preset) return;
    mode = preset.mode;
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
    setMode,
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
