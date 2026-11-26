// Static struct memory layout view: the struct's fields above a tape of its bytes.
//
// Every field, padding run and byte carries a key; hovering, focusing or clicking one links
// everything with the same key across the field list and the tape. Alignment is shown only
// when it inserted padding: `alignof = max(field sizes)`, slot edges and slot offsets.
import type { LayoutField, LayoutRecord, LayoutTrace } from '../core/trace_format.ts';
import { FIELD_COLOURS, themeName } from './constants.ts';
import { esc } from './svg.ts';

/** A field, or the padding between fields or after the last one. */
interface Span {
  offset: number;
  size: number;
  /** Index into `record.fields`; absent for padding. */
  field?: number;
}

// Groups a key can belong to besides its own: any padding, or the widest fields.
const PADDING = 'pad';
const WIDEST = 'widest';
const WHOLE = 'all';

// Field names stack in at most this many rows above the tape (player.css reserves them).
const LABEL_ROWS = 3;
const LABEL_GAP = 6; // CSS pixels between names in one row

function spansOf(record: LayoutRecord): Span[] {
  const spans: Span[] = [];
  let end = 0;
  record.fields.forEach((field, index) => {
    if (field.offset > end) spans.push({ offset: end, size: field.offset - end });
    spans.push({ offset: field.offset, size: field.size, field: index });
    end = field.offset + field.size;
  });
  if (record.size > end) spans.push({ offset: end, size: record.size - end });
  return spans;
}

const paddingBytes = (record: LayoutRecord): number =>
  record.size - record.fields.reduce((sum, field) => sum + field.size, 0);

const colour = (index: number): string => `cv-field-${index % FIELD_COLOURS}`;

const fieldAlign = (field: LayoutField): number => field.alignment ?? field.size;

function formatFieldDecl(type: string, name: string): string {
  const arr = /^(.+?)\s*((?:\[\d+\])+)$/.exec(type.trim());
  if (arr) return `${esc(arr[1])} <b>${esc(name)}</b>${esc(arr[2])};`;
  return `${esc(type)} <b>${esc(name)}</b>;`;
}

class RecordView {
  readonly record: LayoutRecord;
  readonly index: number;
  readonly words: { padding: string };
  readonly spans: Span[];
  readonly padded: boolean;
  readonly widest: number;

  constructor(record: LayoutRecord, index: number, words: { padding: string }) {
    this.record = record;
    this.index = index;
    this.words = words;
    this.spans = spansOf(record);
    this.padded = paddingBytes(record) > 0;
    this.widest = Math.max(...record.fields.map(fieldAlign));
  }

  key(span: Span): string {
    return span.field === undefined ? `pad:${span.offset}` : String(span.field);
  }

  groups(span: Span): string {
    if (span.field === undefined) return PADDING;
    return this.isWidest(this.record.fields[span.field]) ? WIDEST : '';
  }

  isWidest(field: LayoutField): boolean {
    return this.padded && fieldAlign(field) === this.widest;
  }

  /** Attributes that link an element: its key and the groups it belongs to. */
  link(key: string, groups = ''): string {
    return ` data-layout-key="${this.index}:${key}"` + (groups ? ` data-layout-groups="${groups}"` : '');
  }

  button(key: string, cls: string, body: string, groups = '', label = ''): string {
    const aria = label ? ` aria-label="${esc(label)}"` : '';
    return (
      `<button type="button" class="cv-layout-target ${cls}" aria-pressed="false"` +
      `${this.link(key, groups)}${aria}>${body}</button>`
    );
  }

  fieldList(): string {
    const name = esc(this.record.name);
    const rows = this.spans.map(span => {
      if (span.field === undefined) {
        const text = `${esc(this.words.padding)} ×${span.size}`;
        return this.button(
          this.key(span),
          'cv-layout-row cv-layout-padding',
          `<i class="cv-layout-swatch cv-hatch"></i><span>${text}</span>`,
          this.groups(span),
          `${this.words.padding}: ${span.size} B, +${span.offset}`
        );
      }
      const field = this.record.fields[span.field];
      return this.button(
        this.key(span),
        `cv-layout-row ${colour(span.field)}`,
        `<i class="cv-layout-swatch"></i><span>${formatFieldDecl(field.type, field.name)}</span>`,
        this.groups(span),
        `${field.type} ${field.name}: ${field.size} B, +${field.offset}`
      );
    });
    return (
      `<div class="cv-layout-fields">` +
      this.button(WHOLE, 'cv-layout-row cv-layout-struct', `struct <b>${name}</b> {`) +
      rows.join('') +
      `<span class="cv-layout-close">};</span></div>`
    );
  }

  facts(): string {
    const { record } = this;
    const size = this.button(WHOLE, 'cv-layout-fact cv-layout-strong', `sizeof ${record.size}`);
    if (!this.padded) return `<div class="cv-layout-facts">${size}</div>`;
    const sizes = record.fields
      .map((field, index) => {
        const widest = this.isWidest(field) ? ' cv-layout-widest' : '';
        return `<b class="${colour(index)}${widest}">${fieldAlign(field)}</b>`;
      })
      .join(', ');
    const alignment = this.button(
      WIDEST,
      'cv-layout-fact',
      `alignof = max(${sizes}) = <b>${record.alignment}</b>`,
      '',
      `alignof ${record.alignment}`
    );
    const padding = this.button(
      PADDING,
      'cv-layout-fact',
      `<i class="cv-layout-swatch cv-hatch"></i> ${esc(this.words.padding)} ${paddingBytes(record)} B`
    );
    return `<div class="cv-layout-facts">${size}${alignment}${padding}</div>`;
  }

  tape(): string {
    const { record } = this;
    const columns = (span: Span): string => `grid-column:${span.offset + 1} / span ${span.size}`;
    const labels = this.spans
      .filter(span => span.field !== undefined)
      .map(span => {
        const field = record.fields[span.field!];
        return (
          `<span class="cv-layout-label ${colour(span.field!)}"${this.link(this.key(span), this.groups(span))}` +
          ` style="${columns(span)}"><b>${esc(field.name)}</b></span>`
        );
      });
    // One hatched block per padding run under its bytes, so the stripes tile across bytes.
    const padding = this.spans
      .filter(span => span.field === undefined)
      .map(
        span =>
          `<span class="cv-layout-gap cv-hatch"${this.link(this.key(span), PADDING)} style="${columns(span)}"></span>`
      );
    const bytes = this.spans.flatMap(span => {
      const field = span.field !== undefined ? record.fields[span.field] : null;
      const elemSize = field?.count && field.count > 1 && field.alignment ? field.alignment : 0;
      return Array.from({ length: span.size }, (_, i) => {
        const offset = span.offset + i;
        const classes = [
          'cv-byte',
          span.field === undefined ? 'cv-byte-padding' : colour(span.field),
          i === 0 ? 'cv-byte-start' : '',
          elemSize > 0 && i > 0 && i % elemSize === 0 ? 'cv-byte-elem' : '',
          this.padded && offset % record.alignment === 0 ? 'cv-byte-slot' : '',
          offset === record.size - 1 ? 'cv-byte-last' : '',
        ].filter(Boolean);
        return `<span class="${classes.join(' ')}"${this.link(this.key(span), this.groups(span))} style="grid-column:${offset + 1}"></span>`;
      });
    });
    // Offsets at slot edges when alignment matters, otherwise where each field starts.
    const marks = this.padded
      ? Array.from({ length: record.size / record.alignment }, (_, i) => i * record.alignment)
      : record.fields.map(field => field.offset);
    const ticks = marks.map(
      offset => `<span class="cv-layout-tick" style="grid-column:${offset + 1}">${offset}</span>`
    );
    ticks.push(
      `<span class="cv-layout-tick cv-layout-tick-end" style="grid-column:${record.size}">${record.size}</span>`
    );
    return (
      `<div class="cv-layout-tape" aria-hidden="true" style="--cv-bytes:${record.size}">` +
      `${labels.join('')}${padding.join('')}${bytes.join('')}${ticks.join('')}</div>`
    );
  }

  html(): string {
    return (
      `<section class="cv-layout-record" data-layout-record="${this.index}">` +
      `${this.fieldList()}${this.facts()}${this.tape()}</section>`
    );
  }
}

export class Layout {
  host: HTMLElement;
  root: HTMLDivElement;
  locked: string | null = null;
  stale = false;
  private resize: ResizeObserver | null = null;

  constructor(host: HTMLElement, trace: LayoutTrace) {
    if (trace.format !== 1 || !trace.records?.length) throw new Error('Invalid layout');
    this.host = host;
    this.root = document.createElement('div');
    this.root.className = 'cv-player cv-layout not-content';
    const ru = (document.documentElement.lang || '').startsWith('ru');
    const words = { padding: ru ? 'выравнивание' : 'padding' };
    this.root.innerHTML = trace.records
      .map((record, index) => new RecordView(record, index, words).html())
      .join('');
    host.append(this.root);
    this.listen();
    this.refresh();
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.arrangeLabels());
      this.resize.observe(this.root);
    }
  }

  private listen(): void {
    const keyOf = (event: Event): string | null =>
      ((event.target as Element | null)?.closest('[data-layout-key]') as HTMLElement | null)
        ?.dataset.layoutKey ?? null;
    this.root.addEventListener('pointerover', event => this.highlight(keyOf(event) ?? this.locked));
    this.root.addEventListener('pointerleave', () => this.restore());
    this.root.addEventListener('focusin', event => this.highlight(keyOf(event)));
    this.root.addEventListener('focusout', () => queueMicrotask(() => this.restore()));
    this.root.addEventListener('click', event => {
      const key = keyOf(event);
      if (key === null) return;
      this.lock(this.locked === key ? null : key);
      this.restore();
    });
    // Bytes take no focus, so a lock made by clicking one is cleared from anywhere.
    document.addEventListener('keydown', this.escape);
  }

  private escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.locked === null && !this.root.contains(document.activeElement)) return;
    this.lock(null);
    this.highlight(null);
  };

  lock(key: string | null): void {
    this.locked = key;
    for (const element of this.root.querySelectorAll<HTMLElement>('button[data-layout-key]')) {
      element.setAttribute('aria-pressed', String(element.dataset.layoutKey === key));
    }
  }

  restore(): void {
    const active = document.activeElement as HTMLElement | null;
    const focused = this.root.contains(active) ? (active?.dataset.layoutKey ?? null) : null;
    this.highlight(this.locked ?? focused);
  }

  /** Links everything sharing `key`, or belonging to the group it names, and dims the rest. */
  highlight(key: string | null): void {
    const [record, ...rest] = (key ?? '').split(':');
    const target = rest.join(':');
    for (const section of this.root.querySelectorAll<HTMLElement>('[data-layout-record]')) {
      section.classList.toggle('cv-layout-active', key !== null && section.dataset.layoutRecord === record);
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-layout-key]')) {
      const [r, ...own] = (element.dataset.layoutKey ?? '').split(':');
      const groups = (element.dataset.layoutGroups ?? '').split(' ');
      const linked =
        key !== null &&
        r === record &&
        (target === WHOLE || own.join(':') === target || groups.includes(target));
      element.classList.toggle('cv-linked', linked);
    }
  }

  /**
   * Stacks field names above the tape in as few rows as keep them apart: a name wider than its
   * field would otherwise run into the next one. A name that would leave the tape is right-aligned.
   */
  arrangeLabels(): void {
    for (const tape of this.root.querySelectorAll<HTMLElement>('.cv-layout-tape')) {
      const labels = [...tape.querySelectorAll<HTMLElement>('.cv-layout-label')];
      for (const label of labels) {
        label.style.gridRow = '1';
        label.classList.remove('cv-layout-label-end');
      }
      const right = tape.getBoundingClientRect().right;
      const rowEnds: number[] = [];
      for (const label of labels) {
        const text = label.firstElementChild!.getBoundingClientRect();
        let left = label.getBoundingClientRect().left;
        if (left + text.width > right) {
          label.classList.add('cv-layout-label-end');
          left = right - text.width;
        }
        let row = rowEnds.findIndex(end => end <= left);
        if (row < 0) row = Math.min(rowEnds.length, LABEL_ROWS - 1);
        rowEnds[row] = left + text.width + LABEL_GAP;
        label.style.gridRow = String(row + 1);
      }
    }
  }

  refresh(): void {
    this.root.dataset.cvTheme = themeName();
    this.arrangeLabels();
  }

  pause(): void {}

  disconnect(): void {
    this.resize?.disconnect();
    document.removeEventListener('keydown', this.escape);
  }
}
