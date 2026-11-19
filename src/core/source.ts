// Source coordinates and display text come from Clang's preprocessed token stream.
import { type AstNode, type AstRangeEndpoint, type CompilerFrontend, Unsupported, sourceCoordinates } from './errors.ts';
import type { Span } from './trace_format.ts';

export interface SourceToken {
  kind: string;
  start: number;
  end: number;
}

export function readTokens(dump: string, file: string, source: string): SourceToken[] {
  const { lines, offsets } = sourceCoordinates(source);
  const tokens: SourceToken[] = [];
  let physicalEof = false;
  // DumpTokens quotes original spellings, which can themselves contain quotes and newlines.
  const entry = /^(\w+) '([\s\S]*?)'\t[^\n]*?\tLoc=<([^\n]*)>\r?$/gm;
  for (const [, kind, spelling, location] of dump.matchAll(entry)) {
    if (!location.startsWith(file + ':')) continue;
    const coordinates = /^(\d+):(\d+)(.*)$/.exec(location.slice(file.length + 1));
    if (!coordinates) continue;
    const [, line, column, expansion] = coordinates;
    if (expansion) throw new Unsupported('macro-expanded statements are not supported');
    const start = offsets[lines[Number(line) - 1] + Number(column) - 1];
    if (kind === 'eof') {
      physicalEof = start === source.length || /^\r?\n$|^\r$/.test(source.slice(start));
      continue;
    }
    // The token dump reports presumed locations (e.g. following #line).
    if (!spelling || start < (tokens.at(-1)?.end ?? 0) || source.slice(start, start + spelling.length) !== spelling) {
      throw new Unsupported('Clang did not report a source spelling for a token');
    }
    tokens.push({ kind, start, end: start + spelling.length });
  }
  if (!physicalEof) throw new Unsupported('Clang did not report physical source locations');
  return tokens;
}

export const HEADERS = '#include <iostream>\n#include <cstdint>\n#include <cstddef>\n';

export function arrayHeader(source: string, frontend?: CompilerFrontend): string {
  return /\barray\b/.test(source) ? (frontend?.arrayPreamble ?? '#include <array>\n') : '';
}

export class SourceFile {
  readonly program: string;
  readonly tokens: SourceToken[];
  readonly fragment: boolean;
  private readonly source: string;
  private readonly shift: number;

  constructor(source: string, frontend: CompilerFrontend) {
    if (!source.trim() || source.length > 10_000) throw new Unsupported('empty or oversized snippet');
    if (/\\[ \t\f\v]*(?:\r\n?|\n)/.test(source)) {
      throw new Unsupported('a backslash at the end of a line (a line splice) is not supported');
    }

    const headers = HEADERS + arrayHeader(source, frontend) + 'using namespace std;\n';
    const tokens = frontend.tokens(headers + source).filter(token => token.start >= headers.length)
      .map(token => ({ ...token, start: token.start - headers.length, end: token.end - headers.length }));
    // A function declarator followed by a body distinguishes a complete program from a
    // fragment calling a function. Clang checks the declarator and body after this choice.
    this.fragment = !tokens.some((token, i) => {
      if (source.slice(token.start, token.end) !== 'main' || tokens[i + 1]?.kind !== 'l_paren') return false;
      const close = tokens.findIndex((next, j) => j > i + 1 && next.kind === 'r_paren');
      return close !== -1 && tokens[close + 1]?.kind === 'l_brace';
    });
    const first = tokens[0]?.start ?? source.length;
    const prefix = this.fragment
      ? headers + source.slice(0, first) + '\nint main() {\n'
      : headers;
    this.program = prefix + source.slice(this.fragment ? first : 0) + (this.fragment ? '\n}\n' : '\n');
    this.source = source;
    this.shift = prefix.length - (this.fragment ? first : 0);
    this.tokens = tokens.map(token => ({ ...token, start: token.start + this.shift, end: token.end + this.shift }));
  }

  /** Blank a statement while keeping source coordinates and line endings intact. */
  without(start: number, end: number, frontend: CompilerFrontend): SourceFile {
    const first = start - this.shift;
    const last = end - this.shift;
    const blank = this.source.slice(first, last).replace(/[^\r\n]/g, ' ');
    return new SourceFile(this.source.slice(0, first) + blank + this.source.slice(last), frontend);
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

  ast(frontend: CompilerFrontend): [AstNode, AstNode] {
    const { offsets } = sourceCoordinates(this.program);
    const main = frontend.mainAst(this.program);
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
      return [body, main];
    }

    const [start, end] = bounds(main);
    if (this.tokens.some(token => token.start >= end)) {
      throw new Unsupported('declarations after main are unsupported');
    }

    const globals: AstNode[] = [];
    const leading = this.tokens.filter(token => token.end <= start);
    for (let i = 0; i < leading.length;) {
      const token = leading[i];
      const next = leading[i + 1];
      if (token.kind === 'using' && next?.kind === 'namespace' &&
          this.program.slice(leading[i + 2]?.start, leading[i + 2]?.end) === 'std' &&
          leading[i + 3]?.kind === 'semi') {
        i += 4;
        continue;
      }
      if (token.kind !== 'struct' || next?.kind !== 'identifier') {
        throw new Unsupported('only struct definitions may precede main');
      }
      const name = this.program.slice(next.start, next.end);
      const record = frontend.astDump(this.program, name).find(node =>
        node.kind === 'CXXRecordDecl' && node.completeDefinition &&
        offsets[node.range?.begin?.offset ?? -1] === token.start);
      if (record) useCharacterOffsets(record, offsets);
      if (!record) throw new Unsupported('only struct definitions may precede main');
      const [, finish] = bounds(record);
      const semi = leading.findIndex(item => item.start >= finish);
      if (semi < 0 || leading[semi].kind !== 'semi') throw new Unsupported('only struct definitions may precede main');
      globals.push({ kind: 'DeclStmt', inner: [record], range: record.range });
      i = semi + 1;
    }
    return [{ ...body, inner: [...globals, ...(body.inner ?? [])] }, main];
  }
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

export function requireMain(nodes: AstNode[]): AstNode {
  const matches = nodes.filter(node =>
    node.kind === 'FunctionDecl' && node.name === 'main' &&
    node.inner?.some(child => child.kind === 'CompoundStmt'));
  if (matches.length !== 1) throw new Unsupported('expected one main function');
  return matches[0];
}
