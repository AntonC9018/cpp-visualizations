// Wrapping and row geometry for the source shown in the execution player.
import { CODE_CHAR, CODE_GUTTER, LINE } from './constants.ts';

interface SourceRow {
  start: number;
  end: number;
  indent: number;
}

export interface CodeRow extends SourceRow {
  y: number;
}

// Keep source offsets so highlights and line controls can follow the wrapped text.
function wrapLine(source: string, columns: number): SourceRow[] {
  if (source.length <= columns) return [{ start: 0, end: source.length, indent: 0 }];
  const breaks: { at: number; penalty: number }[] = [];
  let braces = 0;
  let templates = 0;
  const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<<|>>|->|::|\w+|[ \t]+|./g;
  for (const { 0: token, index } of source.matchAll(tokens)) {
    const at = index + token.length;
    if (token === '<') templates++;
    if (token === '>' || token === '>>') templates = Math.max(0, templates - token.length);
    if (token === '{') braces++;
    if (token === '}') braces = Math.max(0, braces - 1);
    if (!/^[ \t]+$|^[,<{]$/.test(token)) continue;
    if (/^\s*[;,)\]}]/.test(source.slice(at))) continue;
    const penalty = templates * 8 + Math.max(0, braces - 1) * 6 - (token === '{' && braces === 1 ? 6 : 0);
    breaks.push({ at, penalty });
  }

  const rows: SourceRow[] = [];
  let start = 0;
  while (start < source.length) {
    const indent = rows.length ? 2 : 0;
    const limit = start + columns - indent;
    let end = source.length;
    if (limit < source.length) {
      let best = -Infinity;
      end = breaks.find(point => point.at > limit)?.at ?? source.length;
      for (const point of breaks) {
        if (point.at <= start) continue;
        if (point.at > limit) break;
        const score = point.at - point.penalty;
        if (score >= best) {
          best = score;
          end = point.at;
        }
      }
    }
    const stop = start + source.slice(start, end).trimEnd().length;
    if (stop > start) rows.push({ start, end: stop, indent });
    start = end;
    while (source[start] === ' ' || source[start] === '\t') start++;
  }
  return rows.length ? rows : [{ start: 0, end: 0, indent: 0 }];
}

const CONTINUATION = 33;
const CODE_INSET = CODE_GUTTER + 30;

export function codeLayout(source: string[], columns = Infinity) {
  const rows = source.map(line => wrapLine(line, columns));
  const longest = Math.max(...rows.flatMap(line => line.map(row => row.end - row.start + row.indent)));
  const continuations = rows.reduce((count, line) => count + line.length - 1, 0);
  return {
    rows,
    width: Math.max(300, CODE_INSET + longest * CODE_CHAR),
    height: 44 + source.length * LINE + continuations * CONTINUATION,
  };
}

export function columnsForCode(width: number): number {
  return Math.max(12, Math.floor((width - CODE_INSET) / CODE_CHAR));
}

export function placeCodeRows(rows: SourceRow[][], firstY: number): CodeRow[][] {
  let y = firstY;
  return rows.map(line => line.map((row, i) => {
    const placed = { ...row, y };
    y += i + 1 < line.length ? CONTINUATION : LINE;
    return placed;
  }));
}
