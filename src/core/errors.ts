import type { SourceToken } from './source.ts';

// Isomorphic domain error raised for any C++ snippet or construct outside the supported subset.

export class Unsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unsupported';
  }
}

/** The snippet does not compile. `offset` is where in the program Clang reports it. */
export class IllFormed extends Unsupported {
  readonly offset: number | null;

  constructor(diagnostic: string, offset: number | null = null) {
    super(diagnostic);
    this.name = 'IllFormed';
    this.offset = offset;
  }
}

/**
 * The snippet does not compile as it is, but traces with `flag` on: with `types`, a last statement
 * whose types do not fit is shown instead of run.
 */
export class NeedsFlag extends IllFormed {
  /** Clang's error, without the hint. */
  readonly diagnostic: string;
  readonly flag: string;

  constructor(diagnostic: string, flag: string, offset: number | null = null) {
    super(`${diagnostic}; with ${flag} on (--${flag}), the trace shows why`, offset);
    this.name = 'NeedsFlag';
    this.diagnostic = diagnostic;
    this.flag = flag;
  }
}

/** Clang reports physical byte columns, while TypeScript slices by UTF-16 code units. */
export function sourceCoordinates(source: string): { lines: number[]; offsets: number[] } {
  const lines = [0, ...Array.from(source.matchAll(/\r\n|\r|\n/g), match => match.index + match[0].length)];
  const offsets = [0];
  let character = 0;
  for (const point of source) {
    const code = point.codePointAt(0)!;
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    for (let i = 1; i < bytes; i++) offsets.push(character);
    character += point.length;
    offsets.push(character);
  }
  return { lines: lines.map(character => offsets.indexOf(character)), offsets };
}

/**
 * The first error in Clang's diagnostics for `program`, without the temporary path, which
 * differs between runs. Assigning to a struct fails overload resolution, and only the note
 * that follows says which types did not fit, so it joins the message.
 */
export function illFormed(stderr: string, program: string): IllFormed {
  const diagnostics = stderr.split(/\r?\n/);
  const messageLine = /^(?:.*?:\d+:\d+: )?(?:fatal )?error:/;
  const index = diagnostics.findIndex(line => messageLine.test(line));
  if (index < 0) return new IllFormed('error: ill-formed C++');
  const diagnostic = diagnostics[index];
  const place = /^.*?:(\d+):(\d+): (?:fatal )?error:/.exec(diagnostic);
  let offset: number | null = null;
  if (place) {
    const { lines, offsets } = sourceCoordinates(program);
    const line = lines[Number(place[1]) - 1];
    if (line !== undefined) offset = offsets[line + Number(place[2]) - 1] ?? null;
  }
  let message = diagnostic.slice(diagnostic.indexOf('error:'));
  const note = diagnostics.slice(index + 1).find(line => /^(?:.*?:\d+:\d+: )?note:/.test(line));
  if (note && message === "error: no viable overloaded '='" && note.includes('copy assignment operator')) {
    message += '; ' + note.slice(note.indexOf('note:'));
  } else if (note && message.includes('not a constant expression')) {
    message += ' (' + note.slice(note.indexOf('note:') + 'note: '.length) + ')';
  }
  return new IllFormed(message, offset);
}

export interface AstRangeEndpoint {
  offset?: number;
  tokLen?: number;
}

export interface AstRange {
  begin?: AstRangeEndpoint;
  end?: AstRangeEndpoint;
}

export interface AstType {
  qualType?: string;
  desugaredQualType?: string;
}

export interface AstReferencedDecl {
  id?: string;
  kind?: string;
  name?: string;
}

export interface AstNode {
  id?: string;
  kind?: string;
  name?: string;
  value?: string;
  opcode?: string;
  castKind?: string;
  tagUsed?: string;
  completeDefinition?: boolean;
  isImplicit?: boolean;
  isBitfield?: boolean;
  isArrow?: boolean;
  storageClass?: string;
  constexpr?: boolean;
  bases?: unknown[];
  type?: AstType;
  argType?: AstType;
  // A compound assignment's operand and result types, `int` for `char c; c += 1`.
  computeLHSType?: AstType;
  computeResultType?: AstType;
  range?: AstRange;
  loc?: AstRangeEndpoint;
  referencedDecl?: AstReferencedDecl;
  nominatedNamespace?: AstReferencedDecl;
  inner?: AstNode[];
  array_filler?: AstNode[];
}

export interface CompilerFrontend {
  /** Declaration text for frontends that cannot include the native <array> header. */
  arrayPreamble?: string;
  tokens(program: string, options?: { ignoreExpansions?: boolean }): SourceToken[];
  astDump(program: string, filter: string, standard?: 'c++20' | 'c++2c'): AstNode[];
  mainAst(program: string): AstNode;
  recordLayoutsDump(program: string): string;
  typeSizes(types: string[]): Record<string, number>;
}
