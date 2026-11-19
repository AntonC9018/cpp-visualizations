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
  /\s+|\.?\d(?:[eEpP][+-]|[\w.'])*|[A-Za-z_]\w*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|->\*?|\.\*|::|\+\+|--|<=>|<%|%>|<:(?!:(?![:>]))|:>|<<=?|>>=?|[<>=!]=|&&|\|\||[-+*/%^&|]=|[\s\S]/g;

/** The brackets digraphs spell. */
const DIGRAPHS: Record<string, string> = { '<:': '[', ':>': ']', '<%': '{', '%>': '}' };

/** The operators that bind tighter than each compound operator's binary form. */
const TIGHTER: Record<string, readonly string[]> = { '+': ['*', '/', '%'], '-': ['*', '/', '%'] };

/** Keywords that take an operand after them, as a prefix operator does. */
const PREFIX = ['sizeof', 'alignof', 'new', 'delete', 'throw', 'not', 'compl', 'co_await'];

/** Keywords spelling a binary operator. */
const BINARY = ['and', 'or', 'bitand', 'bitor', 'xor', 'not_eq', 'and_eq', 'or_eq', 'xor_eq'];

/** The casts whose name is always followed by template arguments. */
const CASTS = ['static_cast', 'dynamic_cast', 'const_cast', 'reinterpret_cast'];

/**
 * Whether `right`, the right side of `a operator= right`, keeps parentheses once opened: unless
 * every operator at its top level binds tighter than `operator`, `a = 5 * b + c` would compute
 * something else. Only a named cast surely opens template arguments with `<`; any other `<` and
 * `>` count as comparisons, which at worst adds parentheses that change nothing, while taking a
 * comparison for brackets could hide an operator that needs them.
 */
export function groups(operator: string, right: string): boolean {
  const tighter = TIGHTER[operator] ?? [];
  const open: string[] = []; // the brackets the tokens so far leave open
  let operand = false; // whether the tokens so far end in an operand, so an operator is binary
  let template = false; // whether a `<` here opens template arguments
  for (const [spelled] of right.matchAll(TOKEN)) {
    if (/^\s/.test(spelled)) continue;
    const token = DIGRAPHS[spelled] ?? spelled;
    const opensTemplate = template;
    template = false;
    if (token === '++' || token === '--') continue;
    if ('([{'.includes(token) || (opensTemplate && token === '<')) {
      open.push(token);
      operand = false;
    } else if (')]}'.includes(token) || (open.at(-1) === '<' && (token === '>' || token === '>>'))) {
      const closes = token === '>>' && open.at(-2) === '<' ? 2 : 1;
      open.length -= closes;
      operand = true;
    } else if (['.', '->', '.*', '->*', '::'].includes(token) || PREFIX.includes(token)) {
      operand = false;
    } else if (/^[\w."']/.test(token) && !BINARY.includes(token)) {
      operand = true;
      template = CASTS.includes(token);
    } else {
      if (open.length === 0 && operand && !tighter.includes(token)) return true;
      operand = false;
    }
  }
  return false;
}
