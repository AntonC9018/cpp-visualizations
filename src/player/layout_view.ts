// Static struct memory layout view: stable buttons preserve keyboard focus across theme changes.
import type { LayoutTrace } from '../core/trace_format.ts';
import { FIELD_COLOURS, themeName } from './constants.ts';
import { esc } from './svg.ts';

export class Layout {
  host: HTMLElement;
  root: HTMLDivElement;
  locked: string | null = null;
  stale = false;

  constructor(host: HTMLElement, trace: LayoutTrace) {
    if (trace.format !== 1 || !trace.records?.length) throw new Error('Invalid layout');
    this.host = host;
    this.root = document.createElement('div');
    this.root.className = 'cv-player cv-layout not-content';
    const ru = (document.documentElement.lang || '').startsWith('ru');
    const padding = ru ? 'Выравнивание' : 'Padding';
    this.root.innerHTML = trace.records
      .map((record, ri) => {
        const key = (fi: number | string): string => `${ri}:${fi}`;
        const button = (
          fi: number | string,
          label: string,
          cls = '',
          description = ''
        ): string =>
          `<button type="button" class="cv-layout-target ${cls}"` +
          ` data-layout-key="${key(fi)}" aria-pressed="false"${description ? ` aria-label="${esc(description)}" title="${esc(description)}"` : ''}>${label}</button>`;
        const rows =
          button('all', esc(`struct ${record.name}`), 'cv-layout-row') +
          record.fields
            .map((f, fi) =>
              button(
                fi,
                esc(`${f.type} ${f.name};`) + `<small>+${f.offset} · ${f.size} B</small>`,
                `cv-layout-row cv-field-${fi % FIELD_COLOURS}`
              )
            )
            .join('') +
          button('all', esc(`sizeof(${record.name}) = ${record.size}`), 'cv-layout-row');
        const bytes = Array.from({ length: record.size }, (_, offset) => {
          const fi = record.fields.findIndex(
            f => offset >= f.offset && offset < f.offset + f.size
          );
          const label = fi < 0 ? padding : record.fields[fi].name;
          return button(
            fi < 0 ? 'pad' : fi,
            `<span aria-hidden="true">${offset}</span><small>${fi < 0 ? '▧' : esc(label)}</small>`,
            `cv-byte ${fi < 0 ? 'cv-padding' : `cv-field-${fi % FIELD_COLOURS}`}`,
            `+${offset}: ${label}`
          );
        }).join('');
        return (
          `<section class="cv-layout-record" data-layout-record="${ri}">` +
          `<div class="cv-layout-code">${rows}</div><div class="cv-layout-bytes">` +
          `<p>alignof(${esc(record.name)}) = ${record.alignment}</p>` +
          `<div class="cv-layout-memory" style="--cv-slot:${record.alignment}">${bytes}</div>` +
          `<p>${esc(padding)}: ▧ · ${record.size - record.fields.reduce((sum, f) => sum + f.size, 0)} B</p></div></section>`
        );
      })
      .join('');
    host.append(this.root);
    this.lock(null);
    const target = (event: Event): HTMLElement | null =>
      ((event.target as Element | null)?.closest('[data-layout-key]') as HTMLElement | null) ??
      null;
    this.root.addEventListener('pointerover', event =>
      this.highlight(target(event)?.dataset.layoutKey ?? null)
    );
    this.root.addEventListener('pointerleave', () => this.restore());
    this.root.addEventListener('focusin', event =>
      this.highlight(target(event)?.dataset.layoutKey ?? null)
    );
    this.root.addEventListener('focusout', () => queueMicrotask(() => this.restore()));
    this.root.addEventListener('click', event => {
      const key = target(event)?.dataset.layoutKey ?? null;
      this.lock(this.locked === key ? null : key);
      this.restore();
    });
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        this.lock(null);
        this.highlight(null);
      }
    });
    this.refresh();
  }

  lock(key: string | null): void {
    this.locked = key;
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-layout-key]')) {
      element.setAttribute('aria-pressed', String(element.dataset.layoutKey === key));
    }
  }

  restore(): void {
    const active = document.activeElement as HTMLElement | null;
    this.highlight(
      this.locked || (this.root.contains(active) ? (active?.dataset.layoutKey ?? null) : null)
    );
  }

  highlight(key: string | null): void {
    const [record, field] = (key || '').split(':');
    for (const section of this.root.querySelectorAll<HTMLElement>('[data-layout-record]')) {
      section.classList.toggle('cv-layout-active', section.dataset.layoutRecord === record);
    }
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-layout-key]')) {
      const [r, f] = (element.dataset.layoutKey || '').split(':');
      element.classList.toggle('cv-linked', r === record && (field === 'all' || f === field));
    }
  }

  refresh(): void {
    this.root.dataset.cvTheme = themeName();
  }

  pause(): void {}

  disconnect(): void {}
}
