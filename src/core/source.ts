// Source coordinates and display text come from Clang's preprocessed token stream.
import {
  type AstNode, type AstRangeEndpoint, type CompilerFrontend, IllFormed, type Macros, Unsupported, sourceCoordinates,
} from './errors.ts';
import type { Span } from './trace_format.ts';

export interface SourceToken {
  kind: string;
  start: number;
  end: number;
}

export interface TokenizedSource {
  tokens: SourceToken[];
  includes: string[];
}

export function readTokens(
  dump: string,
  file: string,
  source: string,
  { ignoreExpansions = false }: { ignoreExpansions?: boolean } = {}
): TokenizedSource {
  const { lines, offsets } = sourceCoordinates(source);
  const tokens: SourceToken[] = [];
  let physicalEof = false;
  let cursor = 0;
  const includes: string[] = [];
  // DumpTokens quotes original spellings, which can themselves contain quotes and newlines.
  const entry = /^(\w+) '([\s\S]*?)'\t[^\n]*?\tLoc=<([^\n]*)>\r?$/gm;
  for (const match of dump.matchAll(entry)) {
    const [record, kind, spelling, location] = match;
    if (match.index > cursor + 2) {
      for (const [, path] of dump.slice(cursor, match.index).matchAll(/^\. ([^\r\n]+)$/gm)) {
        includes.push(path);
      }
    }
    cursor = match.index + record.length;
    if (!location.startsWith(file + ':')) continue;
    const coordinates = /^(\d+):(\d+)(.*)$/.exec(location.slice(file.length + 1));
    if (!coordinates) continue;
    const [, line, column, expansion] = coordinates;
    const start = offsets[lines[Number(line) - 1] + Number(column) - 1];
    if (expansion) {
      if (!ignoreExpansions) throw new Unsupported('macro-expanded statements are not supported');
      // Layouts can ignore expansions in the executable body. Keep their location
      // so a macro-generated declaration outside main cannot be silently discarded.
      if (start !== undefined && tokens.at(-1)?.start !== start) {
        tokens.push({ kind: 'macro', start, end: start });
      }
      continue;
    }
    if (kind === 'eof') {
      physicalEof = start === source.length ||
        (start !== undefined && /^(?:\r\n|\r|\n)$/.test(source.slice(start)));
      continue;
    }
    // The token dump reports presumed locations (e.g. following #line).
    if (start === undefined || !spelling || start < (tokens.at(-1)?.end ?? 0) || source.slice(start, start + spelling.length) !== spelling) {
      throw new Unsupported('Clang did not report a source spelling for a token');
    }
    tokens.push({ kind, start, end: start + spelling.length });
  }
  if (!physicalEof) throw new Unsupported('Clang did not report physical source locations');
  return { tokens, includes };
}

/** The macros `-E -dD` output defines anywhere, also those it later undefines. */
export function definedMacros(preprocessed: string): Macros {
  const objects: string[] = [];
  const functions: string[] = [];
  for (const [, name, parameters] of preprocessed.matchAll(/^#define (\w+)(\(?)/gm)) {
    (parameters ? functions : objects).push(name);
  }
  // Copied, as matches can be slices that keep the whole output alive.
  const copy = (names: string[]): Set<string> => new Set(JSON.parse(JSON.stringify(names)) as string[]);
  return { objects: copy(objects), functions: copy(functions) };
}

/** Remember up to `limit` results by key, forgetting the oldest first. */
export function memo<V>(limit: number): (key: string, compute: () => V) => V {
  const entries = new Map<string, V>();
  return (key, compute) => {
    let value = entries.get(key);
    if (value === undefined) {
      value = compute();
      if (entries.size >= limit) entries.delete(entries.keys().next().value!);
      entries.set(key, value);
    }
    return value;
  };
}

/** The C++ standard library's headers, which a snippet cannot redefine. */
const STANDARD_HEADERS = new Set([
  'algorithm', 'any', 'array', 'atomic', 'barrier', 'bit', 'bitset', 'cassert', 'cctype', 'cerrno',
  'cfenv', 'cfloat', 'charconv', 'chrono', 'cinttypes', 'climits', 'clocale', 'cmath', 'codecvt',
  'compare', 'complex', 'concepts', 'condition_variable', 'coroutine', 'csetjmp', 'csignal',
  'cstdarg', 'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'cuchar', 'cwchar',
  'cwctype', 'deque', 'exception', 'execution', 'expected', 'filesystem', 'flat_map', 'flat_set',
  'format', 'forward_list', 'fstream', 'functional', 'future', 'generator', 'initializer_list',
  'iomanip', 'ios', 'iosfwd', 'iostream', 'istream', 'iterator', 'latch', 'limits', 'list',
  'locale', 'map', 'mdspan', 'memory', 'memory_resource', 'mutex', 'new', 'numbers', 'numeric',
  'optional', 'ostream', 'print', 'queue', 'random', 'ranges', 'ratio', 'regex',
  'scoped_allocator', 'semaphore', 'set', 'shared_mutex', 'source_location', 'span', 'spanstream',
  'sstream', 'stack', 'stacktrace', 'stdexcept', 'stdfloat', 'stop_token', 'streambuf', 'string',
  'string_view', 'syncstream', 'system_error', 'thread', 'tuple', 'type_traits', 'typeindex',
  'typeinfo', 'unordered_map', 'unordered_set', 'utility', 'valarray', 'variant', 'vector',
  'version',
]);

/** Whether `program` only includes standard headers, whose macros never change. */
export function includesOnlyStandardHeaders(program: string): boolean {
  return program.split('\n').every(line => !line || STANDARD_HEADERS.has(/^#include <(.*)>$/.exec(line)?.[1] ?? ''));
}

export const HEADERS = '#include <iostream>\n#include <cstdint>\n#include <cstddef>\n';

export function arrayHeader(source: string): string {
  return /\barray\b/.test(source) ? '#include <array>\n' : '';
}

/** The tokens Clang lexed, in source coordinates, and the headers the replay needs. */
interface Lexed {
  tokens: SourceToken[];
  includes: string;
  /**
   * Spans of `#include <…>` lines a fragment moves before its generated `main`. Only a source
   * without other directives lists them: there, nothing else can depend on where they are.
   */
  includeLines: Span[];
}

/** Precedes a fragment, which may name the standard library's declarations unqualified. */
const USING_STD = 'using namespace std;\n';

// Lines end at \r and \n alone, as Clang reads them: U+2028 continues a comment.
const INCLUDE_LINE = /(?<![^\r\n])[ \t]*(?:#|%:)[ \t]*include[ \t]*<([^<>\r\n]+)>[ \t]*(?:\/\/[^\r\n]*)?(?![^\r\n])/g;

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/**
 * Lex `source` with Clang. Include lines alone cannot choose which tokens are active, and the
 * headers' tokens are nearly all of Clang's dump, so such a source is lexed with them blanked,
 * unless it spells a macro they define. Any other directive may test a header's macros:
 * that source is lexed after the convenience headers, and -H names the headers the C++20
 * preprocessor selected. A fragment's late includes move before its `main`, where their
 * declarations and macros apply to the statements before them too. Only a standard header is
 * moved, as its overloads hardly depend on the order, and only if the source spells none of
 * its macros.
 */
function lex(source: string, frontend: CompilerFrontend, array: string, ignoreExpansions: boolean): Lexed {
  const lines = [...source.matchAll(INCLUDE_LINE)];
  const includeLines = lines.map((line): Span => [line.index, line.index + line[0].length]);
  const directives = source.match(/#|%:/g)?.length ?? 0;
  // A comment or raw string could hide what looks like an include line.
  if (directives === 0 || (directives === lines.length && !/\/\*|R"/.test(source))) {
    let text = source;
    for (const [start, end] of includeLines) text = text.slice(0, start) + blank(text.slice(start, end)) + text.slice(end);
    const includes = HEADERS + array + lines.map(line => `#include <${line[1]}>\n`).join('');
    const { tokens } = frontend.tokens(text, { ignoreExpansions });
    const first = tokens[0]?.start ?? source.length;
    const hoisted = mainDefinition(tokens, text) ? [] : lines.filter(line => line.index > first);
    if (hoisted.some(line => !STANDARD_HEADERS.has(line[1]))) {
      throw new Unsupported('an #include after the first statement must name a standard C++ header');
    }
    const macros = definedBy(frontend, includes);
    if (macros && !spellsMacro(tokens, text, macros)) return { tokens, includes, includeLines };
    if (macros && hoisted.length) {
      throw new Unsupported('a macro from a header included after the first statement is not supported');
    }
  }
  // The same lines as before the program's own, so `__LINE__` selects the same branches.
  const context = HEADERS + array + USING_STD;
  const lexed = frontend.tokens(context + source, { ignoreExpansions });
  const includes = lexed.includes.map(path => {
    if (path.includes('>')) throw new Unsupported('Clang reported an unsupported include path');
    return `#include <${path}>\n`;
  }).join('');
  const tokens = lexed.tokens.filter(token => token.start >= context.length)
    .map(token => ({ ...token, start: token.start - context.length, end: token.end - context.length }));
  return {
    tokens,
    includes,
    includeLines: [],
  };
}

/** The macros `includes` define, or null for headers Clang cannot read: lexing them reports it. */
function definedBy(frontend: CompilerFrontend, includes: string): Macros | null {
  try {
    return frontend.macros(includes);
  } catch (error) {
    if (error instanceof IllFormed) return null;
    throw error;
  }
}

/**
 * Whether a token would expand a macro, which the blanked lines left unexpanded. A function-like
 * macro's name expands only before a parenthesis.
 */
function spellsMacro(tokens: SourceToken[], text: string, { objects, functions }: Macros): boolean {
  return tokens.some((token, i) => {
    const spelling = text.slice(token.start, token.end);
    return objects.has(spelling) || (functions.has(spelling) && tokens[i + 1]?.kind === 'l_paren');
  });
}

/** The token index of `main` and of the `{` opening its body, if `main` is defined. */
function mainDefinition(tokens: SourceToken[], source: string): { name: number; body: number } | null {
  // A function declarator followed by a body distinguishes a complete program from a
  // fragment calling a function. Clang checks the declarator and body after this choice.
  for (let i = 0; i < tokens.length; i++) {
    if (source.slice(tokens[i].start, tokens[i].end) !== 'main' || tokens[i + 1]?.kind !== 'l_paren') continue;
    const close = tokens.findIndex((next, j) => j > i + 1 && next.kind === 'r_paren');
    if (close !== -1 && tokens[close + 1]?.kind === 'l_brace') return { name: i, body: close + 1 };
  }
  return null;
}

const GLOBALS_NAMESPACE = '__course_globals';

export class SourceFile {
  readonly program: string;
  readonly replayPreamble: string;
  readonly tokens: SourceToken[];
  readonly fragment: boolean;
  /** The index of the first token of `main`'s body. */
  readonly bodyStart: number;
  private readonly source: string;
  private readonly lexed: Lexed;
  /** The array header before the source, kept by `without` so lines keep their numbers. */
  private readonly array: string;
  private readonly shift: number;

  constructor(
    source: string,
    frontend: CompilerFrontend,
    { ignoreExpansions = false, kept }: { ignoreExpansions?: boolean; kept?: { lexed: Lexed; array: string } } = {}
  ) {
    if (!source.trim() || source.length > 10_000) throw new Unsupported('empty or oversized snippet');
    if (/\\[ \t\f\v]*(?:\r\n?|\n)/.test(source)) {
      throw new Unsupported('a backslash at the end of a line (a line splice) is not supported');
    }
    this.array = kept?.array ?? arrayHeader(source);
    this.lexed = kept?.lexed ?? lex(source, frontend, this.array, ignoreExpansions);
    const { tokens } = this.lexed;
    const spell = (token: SourceToken): string => source.slice(token.start, token.end);
    if (tokens.some(token => token.kind === 'identifier' && !/^[A-Za-z_]\w*$/.test(spell(token)))) {
      throw new Unsupported('identifiers outside ASCII letters, digits and underscores are not supported');
    }

    const main = mainDefinition(tokens, source);
    this.fragment = main === null;
    this.bodyStart = main ? main.body + 1 : 0;
    const headers = HEADERS + this.array;
    const first = tokens[0]?.start ?? source.length;
    // A blank line in place of a fragment's using-directive, so lines keep the numbers
    // the token pass saw.
    let prefix = headers + '\n';
    let body = source;
    if (this.fragment) {
      // An include inside the generated main would declare the header's names there.
      const late = this.lexed.includeLines.filter(([start]) => start >= first);
      body = source.slice(first);
      for (const [start, end] of late) {
        body = body.slice(0, start - first) + blank(source.slice(start, end)) + body.slice(end - first);
      }
      prefix = headers + USING_STD + source.slice(0, first) +
        late.map(([start, end]) => source.slice(start, end) + '\n').join('') + 'int main() { ';
    }
    this.program = prefix + body + (this.fragment ? '\n}\n' : '\n');
    this.source = source;
    this.shift = prefix.length - (this.fragment ? first : 0);
    this.tokens = tokens.map(token => ({ ...token, start: token.start + this.shift, end: token.end + this.shift }));

    // A complete program says itself whether it uses namespace std, and a global name such as
    // `data` is ambiguous under a using-directive the program does not have. One in main
    // is replayed in place.
    if (main) {
      let depth = 0;
      let globals = 0;
      for (let i = 0; i < main.name; i++) {
        depth += tokens[i].kind === 'l_brace' ? 1 : tokens[i].kind === 'r_brace' ? -1 : 0;
        if (depth === 0 && tokens[i].kind === 'semi') globals = i + 1;
      }
      this.replayPreamble = this.lexed.includes + tokens.slice(0, globals).map(spell).join(' ') + '\n';
    } else {
      this.replayPreamble = this.lexed.includes + USING_STD;
    }
  }

  /** Blank a statement while keeping source coordinates and line endings intact. */
  without(start: number, end: number, frontend: CompilerFrontend): SourceFile {
    const first = start - this.shift;
    const last = end - this.shift;
    const source = this.source.slice(0, first) + this.blankTokens(start, end) + this.source.slice(last);
    // Blanking active tokens under the same headers changes neither directives nor the others.
    const lexed = { ...this.lexed, tokens: this.lexed.tokens.filter(token => token.start < first || token.end > last) };
    return new SourceFile(source, frontend, { kept: { lexed, array: this.array } });
  }

  /** Remove only active tokens, leaving directives, comments and line breaks in place. */
  blankTokens(start: number, end: number): string {
    let at = start;
    const parts: string[] = [];
    for (const token of this.tokens) {
      if (token.start < start || token.end > end) continue;
      parts.push(this.program.slice(at, token.start));
      parts.push(this.program.slice(token.start, token.end).replace(/[^\r\n]/g, ' '));
      at = token.end;
    }
    return parts.join('') + this.program.slice(at, end);
  }

  /** The spellings of the tokens within the range, without the spacing between them. */
  tokenText(start: number, end: number): string {
    return this.tokens.filter(token => token.start >= start && token.end <= end)
      .map(token => this.program.slice(token.start, token.end)).join('');
  }

  /** End at the next preprocessed semicolon when the AST's range leaves it out. */
  statementEnd(end: number): number {
    const next = this.tokens.find(token => token.start >= end);
    return next?.kind === 'semi' ? next.end : end;
  }

  /** Compact gaps for the pane. Keep the spelling and interior spacing of each token. */
  display(start: number, end: number): [string, number[]] {
    const mapping: number[] = [];
    let text = '';
    let last = start;
    for (const token of this.tokens) {
      if (token.start < start || token.end > end) continue;
      if (last < token.start && text) {
        mapping.fill(text.length, last - start, token.start - start);
        text += ' ';
      }
      for (let offset = token.start; offset <= token.end; offset++) {
        mapping[offset - start] = text.length + offset - token.start;
      }
      text += this.program.slice(token.start, token.end);
      last = token.end;
    }
    if (mapping[0] === undefined || mapping[end - start] === undefined) {
      throw new Unsupported('Clang did not report physical source locations for the statement');
    }
    return [text, mapping];
  }

  /** Whether pane formatting would collapse deliberate horizontal spacing between tokens. */
  preservesSpacing(): boolean {
    return !this.tokens.some((token, i) =>
      i > 0 && /^[ \t]{2,}$/.test(this.program.slice(this.tokens[i - 1].end, token.start)));
  }

  /** Single signs Clang found directly before another token. */
  signs(start: number, end: number, locate: (offset: number) => number): Map<number, string> {
    const signs = new Map<number, string>();
    for (let i = 1; i < this.tokens.length; i++) {
      const { kind, start: before, end: after } = this.tokens[i - 1];
      const token = this.tokens[i];
      if (before >= start && token.start < end && after === token.start && (kind === 'plus' || kind === 'minus')) {
        signs.set(locate(token.start), kind === 'plus' ? '+' : '-');
      }
    }
    return signs;
  }

  ast(frontend: CompilerFrontend): [AstNode, number] {
    const { offsets } = sourceCoordinates(this.program);
    const main = mainAst(frontend, this.program);
    useCharacterOffsets(main, offsets);
    const body = (main.inner ?? []).find(node => node.kind === 'CompoundStmt');
    if (!body) throw new Unsupported('main has no supported body');
    if (main.inner?.some(node => node.kind === 'ParmVarDecl')) {
      throw new Unsupported('only a parameterless main is supported');
    }
    if (this.fragment) {
      if (bounds(body)[1] !== this.program.length - 1) {
        throw new Unsupported('declarations outside main are unsupported');
      }
      return [body, 0];
    }

    const [start, end] = bounds(main);
    if (this.tokens.some(token => token.start >= end)) {
      throw new Unsupported('declarations after main are unsupported');
    }

    const globals: AstNode[] = [];
    const leading = this.tokens.filter(token => token.end <= start);
    const spell = (token: SourceToken): string => this.program.slice(token.start, token.end);
    let records: AstNode[] | null = null;
    for (let i = 0; i < leading.length;) {
      const token = leading[i];
      const next = leading[i + 1];
      if (usesNamespaceStd(leading, i, spell)) {
        i += 4;
        continue;
      }
      if (token.kind === 'macro') throw new Unsupported('macro-expanded declarations outside main are unsupported');
      if (token.kind !== 'struct' || next?.kind !== 'identifier') {
        throw new Unsupported('only struct definitions may precede main');
      }
      records ??= this.globalRecords(frontend, token.start, start);
      const record = records.find(node =>
        node.kind === 'CXXRecordDecl' && node.completeDefinition && node.range?.begin?.offset === token.start);
      if (!record) throw new Unsupported('only struct definitions may precede main');
      const [, finish] = bounds(record);
      const semi = leading.findIndex(item => item.start >= finish);
      if (semi < 0 || leading[semi].kind !== 'semi') throw new Unsupported('only struct definitions may precede main');
      globals.push({ kind: 'DeclStmt', inner: [record], range: record.range });
      i = semi + 1;
    }
    return [{ ...body, inner: [...globals, ...(body.inner ?? [])] }, globals.length];
  }

  /**
   * The declarations from `from` up to `main` at `to`. Clang's AST filter matches every name
   * containing its text, the standard library's too, so they are dumped from a namespace
   * that no other name contains. Using-declarations bring the records back for main, which
   * finds them there as the program's own, even qualified, and a using-directive among them
   * is repeated for main. The namespace opens and closes within lines, so `__LINE__` and
   * conditionals spanning the program read as in the program.
   */
  private globalRecords(frontend: CompilerFrontend, from: number, to: number): AstNode[] {
    const spell = (token: SourceToken): string => this.program.slice(token.start, token.end);
    const names = new Set<string>();
    let opensStd = false;
    let depth = 0;
    const leading = this.tokens.filter(token => token.start >= from && token.end <= to);
    leading.forEach((token, i) => {
      depth += token.kind === 'l_brace' ? 1 : token.kind === 'r_brace' ? -1 : 0;
      if (depth !== 0) return;
      if (token.kind === 'struct' && leading[i + 1]?.kind === 'identifier') names.add(spell(leading[i + 1]));
      opensStd ||= usesNamespaceStd(leading, i, spell);
    });
    const open = `namespace ${GLOBALS_NAMESPACE} { `;
    const declarations = [...names].map(name => `using ${GLOBALS_NAMESPACE}::${name}; `).join('') +
      (opensStd ? 'using namespace std; ' : '');
    const probe = this.program.slice(0, from) + open + this.program.slice(from, to) +
      '} ' + declarations + this.program.slice(to);
    let nodes: AstNode[];
    try {
      nodes = frontend.astDump(probe, GLOBALS_NAMESPACE);
    } catch (error) {
      // The program itself compiled, so the namespace is what broke it, as around an #include.
      if (error instanceof IllFormed) throw new Unsupported('only struct definitions may precede main');
      throw error;
    }
    const namespace = nodes.find(node => node.kind === 'NamespaceDecl' && node.name === GLOBALS_NAMESPACE);
    if (!namespace) return [];
    // Types name the records as the program does, outside the namespace.
    const unqualified = JSON.parse(JSON.stringify(namespace).replaceAll(`${GLOBALS_NAMESPACE}::`, '')) as AstNode;
    useCharacterOffsets(unqualified, sourceCoordinates(probe).offsets.map(offset => offset - open.length));
    return unqualified.inner ?? [];
  }
}

/** Whether the tokens at `i` spell `using namespace std;`. */
function usesNamespaceStd(tokens: SourceToken[], i: number, spell: (token: SourceToken) => string): boolean {
  return tokens[i]?.kind === 'using' && tokens[i + 1]?.kind === 'namespace' &&
    tokens[i + 2] !== undefined && spell(tokens[i + 2]) === 'std' && tokens[i + 3]?.kind === 'semi';
}

function useCharacterOffsets(node: AstNode, offsets: number[]): void {
  const convert = (place: AstRangeEndpoint | undefined): void => {
    if (place?.offset === undefined) return;
    const start = offsets[place.offset];
    if (place.tokLen !== undefined) place.tokLen = offsets[place.offset + place.tokLen] - start;
    place.offset = start;
  };
  convert(node.loc);
  convert(node.range?.begin);
  convert(node.range?.end);
  for (const child of [...(node.inner ?? []), ...(node.array_filler ?? [])]) useCharacterOffsets(child, offsets);
}

export function bounds(node: AstNode | null | undefined): Span {
  const first = node?.range?.begin;
  const last = node?.range?.end;
  if (typeof first?.offset !== 'number' || typeof last?.offset !== 'number' || typeof last.tokLen !== 'number') {
    throw new Unsupported('macro-expanded or implicit source ranges are not supported');
  }
  return [first.offset, last.offset + last.tokLen];
}

export function parseAstDump(stdout: string): AstNode[] {
  // Clang writes adjacent top-level JSON objects when an AST filter matches multiple declarations.
  try {
    return stdout.trim() ? stdout.trim().split(/\n(?=\{)/).map(json => JSON.parse(json) as AstNode) : [];
  } catch {
    throw new Unsupported('Clang returned invalid AST JSON');
  }
}

/** The definition of `main` in `program`. */
export function mainAst(frontend: CompilerFrontend, program: string): AstNode {
  return requireMain(frontend.astDump(program, 'main'));
}

export function requireMain(nodes: AstNode[]): AstNode {
  const matches = nodes.filter(node =>
    node.kind === 'FunctionDecl' && node.name === 'main' &&
    node.inner?.some(child => child.kind === 'CompoundStmt'));
  if (matches.length !== 1) throw new Unsupported('expected one main function');
  return matches[0];
}
