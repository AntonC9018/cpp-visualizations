// Interactive step-by-step execution player view.
import type { ExecutionTrace } from '../core/trace_format.ts';
import {
  FIELD_COLOURS,
  type IconName,
  KEYWORDS,
  MAX_SCALE,
  PALETTE,
  type Palette,
  type PlayerStrings,
  STACK_BELOW,
  T,
  VARIABLE_COLOURS,
  icon,
  strings,
  themeName,
} from './constants.ts';
import { type Geometry, type TypeTarget, geometry } from './geometry.ts';
import { type PreparedModel, activeVariables, arrival, prepare, stepSeconds } from './model.ts';
import { type SceneContext, describe, lineTargets, placeLineTargets, scene } from './scene.ts';
import { esc } from './svg.ts';

export class Player {
  host: HTMLElement;
  m: PreparedModel;
  S: PlayerStrings;
  index: number;
  elapsed: number;
  duration: number;
  rate: number;
  running: boolean;
  continuous: boolean;
  pristine: boolean;
  animated: boolean;
  frame: number;
  last: number;
  stale: boolean;
  root!: HTMLDivElement;
  svg!: SVGSVGElement;
  scene!: SVGGElement;
  lines!: Element[];
  playButton!: HTMLButtonElement;
  scrub!: HTMLInputElement;
  count!: HTMLSpanElement;
  status!: HTMLDivElement;
  typeBox!: HTMLDivElement;
  stacked: boolean | null;
  observer: ResizeObserver | null = null;
  P!: Palette;
  g!: Geometry;
  shownType: TypeTarget | null;

  constructor(host: HTMLElement, trace: ExecutionTrace) {
    this.host = host;
    this.m = prepare(trace);
    this.S = strings();
    this.index = 0;
    this.elapsed = 0;
    this.duration = 0;
    this.rate = 1;
    this.running = false;
    this.continuous = false;
    this.pristine = true;
    this.animated = false;
    this.frame = 0;
    this.last = 0;
    this.stale = false;
    this.stacked = null;
    this.shownType = null;
    this.build();
    this.theme();
    this.settle(0);
  }

  build(): void {
    const S = this.S;
    const root = document.createElement('div');
    root.className = 'cv-player not-content';
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', this.m.trace.title || S.stage);
    const button = (action: string, label: string, iconName: IconName, extra = ''): string =>
      `<button type="button" class="cv-button${extra}" ` +
      `data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}` +
      `<span class="cv-label">${esc(label)}</span></button>`;
    root.innerHTML =
      '<div class="cv-view">' +
      `<svg class="cv-stage" role="group" aria-label="${esc(S.stage)}" xmlns="http://www.w3.org/2000/svg">` +
      `<g class="cv-scene" aria-hidden="true"></g><g class="cv-lines">${lineTargets(this.m, S)}</g></svg>` +
      '<div class="cv-type" aria-hidden="true" hidden></div></div>' +
      '<div class="cv-controls"><div class="cv-transport">' +
      button('play', S.play, 'play', ' cv-primary') +
      button('back', S.back, 'back') +
      button('next', S.next, 'next') +
      button('replay', S.replay, 'replay', ' cv-icon-only') +
      `<select class="cv-speed" aria-label="${esc(S.speed)}" title="${esc(S.speed)}">` +
      [0.5, 1, 1.5, 2]
        .map(v => `<option value="${v}"${v === 1 ? ' selected' : ''}>${v}×</option>`)
        .join('') +
      '</select>' +
      button('reset', S.reset, 'reset', ' cv-reset') +
      '</div>' +
      `<div class="cv-progress"><input class="cv-scrub" type="range" min="0" max="${this.m.steps.length - 1}" value="0" ` +
      `step="1" aria-label="${esc(S.scrub)}"><span class="cv-count"></span></div></div>` +
      '<div class="cv-status" aria-live="polite"></div>';
    this.host.append(root);
    this.root = root;
    this.svg = root.querySelector('.cv-stage') as SVGSVGElement;
    this.scene = root.querySelector('.cv-scene') as SVGGElement;
    this.lines = [...root.querySelectorAll('.cv-line')];
    this.playButton = root.querySelector('[data-action=play]') as HTMLButtonElement;
    this.scrub = root.querySelector('.cv-scrub') as HTMLInputElement;
    this.count = root.querySelector('.cv-count') as HTMLSpanElement;
    this.status = root.querySelector('.cv-status') as HTMLDivElement;
    root.querySelector('.cv-transport')!.addEventListener('click', event => {
      const target = (event.target as Element | null)?.closest('[data-action]') as HTMLElement | null;
      if (target && target.dataset.action) {
        this.invokeAction(target.dataset.action);
      }
    });
    root.querySelector('.cv-speed')!.addEventListener('change', event => {
      this.rate = Number((event.target as HTMLSelectElement).value);
    });
    this.scrub.addEventListener('input', () => {
      this.pristine = false;
      this.settle(Number(this.scrub.value));
    });
    this.svg.addEventListener('click', event => {
      const line = (event.target as Element | null)?.closest('[data-line]') as HTMLElement | null;
      if (line && line.dataset.line !== undefined) {
        this.line(Number(line.dataset.line));
      }
    });
    root.addEventListener('keydown', event => this.key(event));
    this.typeBox = root.querySelector('.cv-type') as HTMLDivElement;
    this.svg.addEventListener('pointermove', event => this.hoverType(event));
    this.svg.addEventListener('pointerdown', event => this.hoverType(event));
    this.svg.addEventListener('pointerleave', () => this.hoverType(null));
    this.stacked = null;
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(() => {
        if (this.arrangement() !== this.stacked) this.refresh();
      });
      this.observer.observe(root);
    }
  }

  private invokeAction(action: string): void {
    switch (action) {
      case 'play':
        this.play();
        break;
      case 'back':
        this.back();
        break;
      case 'next':
        this.next();
        break;
      case 'replay':
        this.replay();
        break;
      case 'reset':
        this.reset();
        break;
      case 'end':
        this.end();
        break;
    }
  }

  key(event: KeyboardEvent): void {
    const target = event.target as Element | null;
    if (!target) return;
    const lineEl = target.closest('[data-line]') as HTMLElement | null;
    if (lineEl && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.line(Number(lineEl.dataset.line));
      return;
    }
    if (target.matches('input, select, textarea')) return;
    const actions: Record<string, string> = {
      ArrowLeft: 'back',
      ArrowRight: 'next',
      Home: 'reset',
      End: 'end',
    };
    if (actions[event.key]) {
      event.preventDefault();
      this.invokeAction(actions[event.key]);
    } else if (event.key === ' ' && !target.matches('button')) {
      event.preventDefault();
      this.play();
    }
  }

  hoverType(event: PointerEvent | null): void {
    const targets = this.g ? this.g.typeTargets : [];
    let hit: TypeTarget | null = null;
    if (event && targets.length) {
      const matrix = this.svg.getScreenCTM();
      if (matrix) {
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        hit =
          targets.find(
            t =>
              point.x >= t.x &&
              point.x <= t.x + t.w &&
              point.y >= t.y &&
              point.y <= t.y + t.h
          ) ?? null;
      }
    }
    this.svg.style.cursor = hit ? 'help' : '';
    if (!hit) {
      this.typeBox.hidden = true;
      this.shownType = null;
      return;
    }
    if (this.shownType !== hit) {
      this.shownType = hit;
      this.typeBox.innerHTML =
        '<pre>' +
        this.m.types[hit.type]
          .split(/(\b[A-Za-z_]\w*\b)/)
          .map(token => {
            const field = this.g.field(token);
            return field
              ? `<span style="color:${field.fieldColor}">${esc(token)}</span>`
              : KEYWORDS.has(token)
                ? `<span class="cv-type-keyword">${esc(token)}</span>`
                : esc(token);
          })
          .join('') +
        '</pre>';
      this.typeBox.hidden = false;
      const view = this.typeBox.parentElement!.getBoundingClientRect();
      const stage = this.svg.getBoundingClientRect();
      const scale = stage.width / this.g.width;
      const box = this.typeBox;
      const left = stage.left - view.left + (hit.x + hit.w / 2) * scale - box.offsetWidth / 2;
      const top = stage.top - view.top + hit.y * scale - box.offsetHeight - 6;
      box.style.left = `${Math.max(4, Math.min(view.width - box.offsetWidth - 4, left))}px`;
      box.style.top = `${top >= 4 ? top : stage.top - view.top + (hit.y + hit.h) * scale + 6}px`;
    }
  }

  arrangement(): boolean {
    const width = this.root.clientWidth;
    return width > 0 && width < STACK_BELOW;
  }

  theme(): void {
    this.root.dataset.cvTheme = themeName();
    const style = getComputedStyle(this.root);
    const read = (name: string): string => style.getPropertyValue('--cv-' + name).trim();
    const P: Record<string, any> = { outputLabel: this.S.output };
    for (const name of PALETTE) {
      const camel = name.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
      P[camel] = read(name) || '#808080';
    }
    P.vars = Array.from({ length: VARIABLE_COLOURS }, (_, i) => read('var-' + i) || '#808080');
    P.fields = Array.from({ length: FIELD_COLOURS }, (_, i) => read('field-' + i) || '#808080');
    this.P = P as Palette;
  }

  refresh(): void {
    this.theme();
    this.render(this.animated);
    if (this.animated) this.seek(this.elapsed);
  }

  render(animate: boolean): void {
    this.stacked = this.arrangement();
    const steps = this.m.steps;
    const step = steps[this.index];
    const prev = this.index ? steps[this.index - 1] : null;
    const g = (this.g = geometry(this.m, this.P, this.stacked));
    const now = activeVariables(this.m, this.index);
    const before = animate && this.index ? activeVariables(this.m, this.index - 1) : now;
    const begin = new Map<string, number>();
    if (animate && step.op && step.op.kind === 'deref') {
      begin.set(step.op.target.split('.')[0], arrival(step.op) - 0.15);
    }
    const c: SceneContext = {
      m: this.m,
      g,
      P: this.P,
      S: this.S,
      index: this.index,
      step,
      prev,
      animate,
      op: animate ? step.op : null,
      focus: { now, before, begin },
    };
    this.animated = animate;
    this.svg.setAttribute('viewBox', `0 0 ${Math.ceil(g.width)} ${Math.ceil(g.height)}`);
    this.svg.style.maxWidth = `${Math.ceil(g.width * MAX_SCALE)}px`;
    this.scene.innerHTML = `<rect width="100%" height="100%" fill="${this.P.bg}"/>` + scene(c);
    placeLineTargets(g, this.lines);
    this.finishPaths();
    this.seek(0);
    this.update(describe(c));
  }

  finishPaths(): void {
    for (const path of this.scene.querySelectorAll<SVGGeometryElement & HTMLElement>(
      '[data-grow],[data-follow]'
    )) {
      const length = path.getTotalLength();
      const grow = path.dataset.grow !== undefined;
      const begin = Number(grow ? path.dataset.grow : path.dataset.follow);
      const dur = grow ? 0.6 : T.follow;
      path.setAttribute('stroke-dasharray', `${length} ${length}`);
      path.setAttribute('stroke-dashoffset', String(length));
      const add = (attributes: Record<string, string | number>): void => {
        const animation = document.createElementNS(this.svg.namespaceURI, 'animate');
        for (const [key, value] of Object.entries(attributes)) {
          animation.setAttribute(key, String(value));
        }
        path.append(animation);
      };
      add({
        attributeName: 'stroke-dashoffset',
        from: length,
        to: 0,
        begin: begin + 's',
        dur: dur + 's',
        calcMode: 'spline',
        keyTimes: '0;1',
        keySplines: '0.4 0 0.2 1',
        fill: 'freeze',
      });
      if (!grow) {
        add({
          attributeName: 'opacity',
          from: 1,
          to: 0,
          begin: begin + dur + 0.25 + 's',
          dur: '0.4s',
          fill: 'freeze',
        });
      }
    }
  }

  seek(seconds: number): void {
    this.svg.pauseAnimations();
    this.svg.setCurrentTime(seconds);
  }

  update(description?: string): void {
    const last = this.m.steps.length - 1;
    this.playButton.querySelector('.cv-icon')!.outerHTML = icon(this.running ? 'pause' : 'play');
    const label = this.running ? this.S.pause : this.S.play;
    this.playButton.querySelector('.cv-label')!.textContent = label;
    this.playButton.setAttribute('aria-label', label);
    this.playButton.title = label;
    for (const [action, disabled] of [
      ['back', this.index === 0],
      ['next', this.index === last],
    ] as const) {
      const button = this.root.querySelector(`[data-action=${action}]`) as HTMLButtonElement;
      if (disabled && document.activeElement === button) {
        this.root.focus({ preventScroll: true });
      }
      button.disabled = disabled;
    }
    this.scrub.value = String(this.index);
    this.count.textContent = `${this.index + 1} / ${last + 1}`;
    if (description !== undefined && this.status.textContent !== description) {
      this.status.textContent = description;
    }
  }

  settle(index: number): void {
    this.stop();
    this.continuous = false;
    this.index = Math.max(0, Math.min(this.m.steps.length - 1, index));
    this.elapsed = this.duration = 0;
    this.render(false);
  }

  start(index: number, autoplay = false): void {
    this.stop();
    this.pristine = false;
    this.continuous = autoplay;
    this.index = index;
    this.elapsed = 0;
    this.duration = stepSeconds(this.m.steps, index);
    this.render(true);
    if (this.duration > 0 || autoplay) this.resume();
  }

  resume(): void {
    this.running = true;
    this.last = performance.now();
    this.update();
    if (!this.frame) this.frame = requestAnimationFrame(now => this.tick(now));
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  pause(): void {
    this.stop();
    this.update();
  }

  disconnect(): void {
    this.pause();
    this.observer?.disconnect();
    this.observer = null;
  }

  tick(now: number): void {
    this.frame = 0;
    if (!this.running) return;
    this.elapsed = Math.min(
      this.duration,
      this.elapsed + ((now - this.last) / 1000) * this.rate
    );
    this.last = now;
    if (this.animated) this.seek(this.elapsed);
    if (this.elapsed < this.duration) {
      this.frame = requestAnimationFrame(time => this.tick(time));
      return;
    }
    this.running = false;
    if (this.continuous && this.index < this.m.steps.length - 1) {
      this.start(this.index + 1, true);
    } else {
      this.continuous = false;
      this.render(false);
      this.elapsed = this.duration;
      this.update();
    }
  }

  get finished(): boolean {
    return this.elapsed >= this.duration;
  }

  play(): void {
    if (this.running) return this.pause();
    const last = this.m.steps.length - 1;
    if (this.pristine || (this.index === last && this.finished)) {
      this.start(0, true);
    } else if (this.finished) {
      this.start(this.index + 1, true);
    } else {
      this.continuous = true;
      this.resume();
    }
  }

  next(): void {
    if (this.index < this.m.steps.length - 1) this.start(this.index + 1);
  }

  back(): void {
    this.pristine = false;
    this.settle(this.index - 1);
  }

  replay(): void {
    this.start(this.index);
  }

  reset(): void {
    this.pristine = true;
    this.settle(0);
  }

  end(): void {
    this.pristine = false;
    this.settle(this.m.steps.length - 1);
  }

  line(line: number): void {
    const index = this.m.steps.findIndex(step => step.line === line);
    if (index >= 0) {
      this.pristine = false;
      this.settle(index);
    }
  }

  inspect(index: number, seconds: number | null = null): void {
    if (seconds === null) return this.settle(index);
    this.start(index);
    this.stop();
    this.continuous = false;
    if (this.animated) this.seek(seconds);
    this.elapsed = seconds;
    this.update();
  }
}
