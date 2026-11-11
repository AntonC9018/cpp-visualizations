// SVG and SMIL animation markup helpers for the browser player.
import { CHAR, EASE, EVAL_CHAR } from './constants.ts';

export const round = (value: number): number => Math.round(value * 100) / 100;

const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, ch => ESC_MAP[ch] ?? ch);

// Printed whitespace (`std::endl`) travels as a visible glyph.
export const glyphs = (value: unknown): string =>
  String(value).replace(/\n/g, '↵').replace(/\t/g, '⇥').replace(/ /g, '␣');

export const format = (template: string, values: Record<string, unknown>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

// textLength pins every glyph run to the advance the layout assumes, whatever the font.
export function text(
  x: number,
  y: number,
  value: unknown,
  size: number,
  color: string,
  anchor = 'start'
): string {
  const str = String(value);
  if (!str.trim()) return '';
  const length =
    str.length > 1
      ? ` textLength="${round(str.length * size * CHAR)}" lengthAdjust="spacing"`
      : '';
  return (
    `<text x="${round(x)}" y="${round(y)}" font-size="${size}" fill="${color}" ` +
    `text-anchor="${anchor}" xml:space="preserve"${length}>${esc(str)}</text>`
  );
}

export function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke = 'none',
  radius = 8,
  width = 3
): string {
  return (
    `<rect x="${round(x)}" y="${round(y)}" width="${round(Math.max(0, w))}" ` +
    `height="${round(h)}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
  );
}

export const show = (at: number): string =>
  `<set attributeName="opacity" to="1" begin="${round(at)}s" fill="freeze"/>`;

export const hide = (at: number): string =>
  `<set attributeName="opacity" to="0" begin="${round(at)}s" fill="freeze"/>`;

export const fade = (from: number, to: number, dur = 0.5, begin = 0): string =>
  `<animate attributeName="opacity" from="${from}" ` +
  `to="${to}" dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;

export const animateAttr = (
  name: string,
  from: number | string,
  to: number | string,
  dur = 0.45,
  begin = 0
): string =>
  `<animate attributeName="${name}" ` +
  `from="${typeof from === 'number' ? round(from) : from}" to="${typeof to === 'number' ? round(to) : to}" ` +
  `dur="${dur}s" begin="${round(begin)}s" ${EASE} fill="freeze"/>`;

export const animated = (element: string, animations: string): string => {
  if (!animations) return element;
  const tagMatch = element.match(/^<(\w+)/);
  const tag = tagMatch ? tagMatch[1] : 'g';
  return element.replace(/\/>$/, '>' + animations + '</' + tag + '>');
};

export const pulse = (begin: number): string =>
  `<animateTransform attributeName="transform" type="scale" values="1;1.14;1" ` +
  `keyTimes="0;0.45;1" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" ` +
  `begin="${round(begin)}s" dur="0.65s" fill="freeze"/>`;

export const markBox = (
  x: number,
  y: number,
  length: number,
  stroke: string,
  fill: string
): string =>
  `<rect x="${round(x - 3)}" y="${round(y - 32)}" ` +
  `width="${round(length * EVAL_CHAR + 6)}" height="42" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;

// Starts `from` units right of its place and slides home after `begin`.
export const settle = (markup: string, from: number, begin: number): string =>
  from
    ? `<g transform="translate(${round(from)} 0)"><animateTransform attributeName="transform" ` +
      `type="translate" from="${round(from)} 0" to="0 0" begin="${round(begin)}s" dur="0.3s" ` +
      `${EASE} fill="freeze"/>${markup}</g>`
    : markup;

export const glide = (markup: string, dx: number, begin: number, dur: number): string =>
  dx
    ? `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${round(dx)} 0" ` +
      `begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>${markup}</g>`
    : markup;

// Scales markup about a point, from `from` to `to`, during [begin, begin + dur].
export const scaleAbout = (
  markup: string,
  x: number,
  y: number,
  from: number,
  to: number,
  begin: number,
  dur: number
): string =>
  `<g transform="translate(${round(x)} ${round(y)})">` +
  `<g transform="scale(${from})"><animateTransform attributeName="transform" type="scale" ` +
  `from="${from}" to="${to}" begin="${round(begin)}s" dur="${dur}s" ${EASE} fill="freeze"/>` +
  `<g transform="translate(${round(-x)} ${round(-y)})">${markup}</g></g></g>`;
