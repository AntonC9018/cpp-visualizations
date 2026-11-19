// `a += b` as the plain assignment it stands for: one spelling, which the tracer writes and the
// validator expects.
import type { Span } from './trace_format.ts';

/** The compound assignments traced: those whose operator the tracer evaluates on its own. */
export const COMPOUND_OPERATORS: readonly string[] = ['+', '-', '*', '/', '%'];

export interface Opened {
  /** The opened pane. */
  text: string;
  /** Where the left operand stands in it. */
  left: Span;
  /** Where the right operand starts in it, and where it started in the pane as written. */
  right: number;
  from: number;
}

/**
 * `pane` with `operator=` at `span` opened around `left`: `a += b` becomes `a = 5 + b`, and
 * `a *= b + c` becomes `a = 5 * (b + c)` when `grouped`. The right operand runs to the end of
 * the pane; spaces around the operators are always single, so no tokens run together.
 */
export function openCompound(pane: string, span: Span, left: string, operator: string, grouped: boolean): Opened {
  const [start, end] = span;
  const head = pane.slice(0, start).trimEnd() + ' = ';
  const rest = pane.slice(end);
  const from = end + rest.length - rest.trimStart().length;
  const middle = `${head}${left} ${operator} ${grouped ? '(' : ''}`;
  return {
    text: middle + pane.slice(from) + (grouped ? ')' : ''),
    left: [head.length, head.length + left.length],
    right: middle.length,
    from,
  };
}

/** C++ tokens, longest first: pp-numbers, names, literals, then operators. */
const TOKEN =
  /\s+|\.?\d(?:[eEpP][+-]|[\w.'])*|[A-Za-z_]\w*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|->\*?|\.\*|::|\+\+|--|<=>|<<=?|>>=?|[<>=!]=|&&|\|\||[-+*/%^&|]=|[\s\S]/g;

/** The operators that bind tighter than each compound operator's binary form. */
const TIGHTER: Record<string, readonly string[]> = { '+': ['*', '/', '%'], '-': ['*', '/', '%'] };

/**
 * Whether `right`, the right side of `a operator= right`, keeps parentheses once opened: unless
 * every operator at its top level binds tighter than `operator`, `a = 5 * b + c` would compute
 * something else.
 */
export function groups(operator: string, right: string): boolean {
  const tighter = TIGHTER[operator] ?? [];
  let depth = 0;
  let operand = false; // whether the tokens so far end in an operand, so an operator is binary
  let cast = false; // whether a `<` opens the type of a named cast
  for (const [token] of right.matchAll(TOKEN)) {
    if (/^\s/.test(token) || token === '++' || token === '--') continue;
    if ('([{'.includes(token) || (cast && token === '<')) {
      depth++;
      operand = cast = false;
    } else if (')]}'.includes(token) || (depth > 0 && token === '>')) {
      depth--;
      operand = true;
    } else if (['.', '->', '.*', '->*', '::'].includes(token)) {
      operand = false;
    } else if (/^[\w."']/.test(token)) {
      operand = true;
      cast = /_cast$/.test(token);
    } else {
      if (depth === 0 && operand && !tighter.includes(token)) return true;
      operand = false;
    }
  }
  return false;
}
