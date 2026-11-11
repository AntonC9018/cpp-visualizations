// Isomorphic domain error raised for any C++ snippet or construct outside the supported subset.

export class Unsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unsupported';
  }
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
  kind?: string;
  name?: string;
}

export interface AstNode {
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
}

export interface CompilerFrontend {
  mainAst(program: string): AstNode;
  recordLayoutsDump(program: string): string;
  typeSizes(types: string[]): Record<string, number>;
}
