// Node wrapper for Clang record layout extraction.
import type { AstNode } from '../core/errors.ts';
import {
  Record as RecordLayout,
  type RecordFieldInfo,
  canonicalType,
  layoutsFromFrontend,
  typeName,
  typeSpelling,
} from '../core/records.ts';
import { createClangFrontend } from './toolchain.ts';

export {
  RecordLayout as Record,
  type RecordFieldInfo,
  canonicalType,
  layoutsFromFrontend,
  typeName,
  typeSpelling,
};

export function layouts(
  ast: AstNode,
  directory: string,
  { layoutOnly = false }: { layoutOnly?: boolean } = {}
): Record<string, RecordLayout> {
  const frontend = createClangFrontend(directory);
  return layoutsFromFrontend(ast, '', frontend, { layoutOnly });
}
