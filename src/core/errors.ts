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
 * The first error in Clang's diagnostics for `program`, without the temporary path, which
 * differs between runs. Assigning to a struct fails overload resolution, and only the note
 * that follows says which types did not fit, so it joins the message.
 */
export function illFormed(stderr: string, program: string): IllFormed {
  const diagnostics = stderr.split(/\r?\n/);
  const index = diagnostics.findIndex(line => line.includes('error:'));
  if (index < 0) return new IllFormed('error: ill-formed C++');
  const diagnostic = diagnostics[index];
  const place = /^.*?:(\d+):(\d+): error:/.exec(diagnostic);
  let offset: number | null = null;
  if (place) {
    const lines = program.split(/(?<=\n)/);
    offset =
      lines.slice(0, Number(place[1]) - 1).reduce((total, line) => total + line.length, 0) +
      Number(place[2]) -
      1;
  }
  let message = diagnostic.slice(diagnostic.indexOf('error:'));
  if (message === "error: no viable overloaded '='") {
    const note = diagnostics.slice(index + 1).find(line => line.includes('note:') || line.includes('error:')) ?? '';
    if (note.includes('note:') && note.includes('copy assignment operator')) {
      message += '; ' + note.slice(note.indexOf('note:'));
    }
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
  range?: AstRange;
  loc?: AstRangeEndpoint;
  referencedDecl?: AstReferencedDecl;
  inner?: AstNode[];
  array_filler?: AstNode[];
}

export interface CompilerFrontend {
  /** Declaration text for frontends that cannot include the native <array> header. */
  arrayPreamble?: string;
  mainAst(program: string): AstNode;
  recordLayoutsDump(program: string): string;
  typeSizes(types: string[]): Record<string, number>;
}
