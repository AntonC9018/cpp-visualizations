// Clang-backed aggregate record validation and layout extraction (isomorphic core).

import { type AstNode, type CompilerFrontend, Unsupported } from './errors.ts';
import type { ScalarKind } from './trace_format.ts';

export interface RecordFieldInfo {
  name: string;
  offset: number;
  kind: ScalarKind | 'struct';
  type?: string;
  size: number;
}

class RecordLayout {
  name: string;
  size: number;
  alignment: number;
  fields: RecordFieldInfo[];

  constructor(name: string, size: number, alignment: number, fields: RecordFieldInfo[]) {
    this.name = name;
    this.size = size;
    this.alignment = alignment;
    this.fields = fields;
    Object.freeze(this);
  }
}

export { RecordLayout as Record };

export function typeSpelling(node: AstNode | null | undefined): string {
  const qualified = node?.type?.qualType ?? '';
  return qualified.replace(/^(const )?struct /, '$1');
}

export function typeName(node: AstNode | null | undefined): string {
  return typeSpelling(node).replace(/^const /, '');
}

export function canonicalType(node: AstNode | null | undefined): string {
  const qualified = node?.type ?? {};
  return qualified.desugaredQualType ?? qualified.qualType ?? '';
}

const LAYOUT_SPELLINGS = [
  'uint8_t',
  'int8_t',
  'int',
  'size_t',
  'uint64_t',
  'std::uint8_t',
  'std::int8_t',
  'std::size_t',
  'std::uint64_t',
];
const BUILTIN_INTEGERS = [
  'signed char',
  'unsigned char',
  'int',
  'unsigned long',
  'unsigned long long',
];

function isPointer(node: AstNode): boolean {
  return canonicalType(node).endsWith('*');
}

export function extractEnumConstantSizes(tree: AstNode, types: string[]): Record<string, number> {
  const enumValues: Record<string, number> = {};
  function constant(item: AstNode): number {
    if (item.kind === 'ConstantExpr') {
      return Number.parseInt(item.value ?? '0', 10);
    }
    return constant(item.inner![0]);
  }
  function walkTree(node: AstNode): void {
    if (node.kind === 'EnumConstantDecl' && node.name) {
      enumValues[node.name] = constant(node);
    }
    for (const child of node.inner ?? []) {
      walkTree(child);
    }
  }
  walkTree(tree);
  const result: Record<string, number> = {};
  for (let i = 0; i < types.length; i++) {
    result[types[i]] = enumValues[`__course_${i}`];
  }
  return result;
}

export function layoutsFromFrontend(
  ast: AstNode,
  program: string,
  frontend: CompilerFrontend,
  { layoutOnly = false }: { layoutOnly?: boolean } = {}
): Record<string, RecordLayout> {
  const definitions: Record<string, AstNode> = {};
  for (const statement of ast?.inner ?? []) {
    const inner = statement?.kind === 'DeclStmt' ? (statement.inner ?? []) : [];
    for (const node of inner) {
      if (node?.kind === 'CXXRecordDecl' && node.completeDefinition) {
        const name = node.name;
        if (!name || Object.hasOwn(definitions, name)) {
          throw new Unsupported('structs require unique names');
        }
        definitions[name] = node;
      }
    }
  }
  if (Object.keys(definitions).length === 0) {
    return {};
  }
  for (const [name, node] of Object.entries(definitions)) {
    if (node.tagUsed !== 'struct' || (node.bases && node.bases.length > 0)) {
      throw new Unsupported('only plain aggregate structs without inheritance are supported');
    }
    const fields: AstNode[] = [];
    for (const child of node.inner ?? []) {
      if (child.isImplicit) continue;
      if (child.kind !== 'FieldDecl') {
        throw new Unsupported(`struct ${name}: methods, attributes and nested types are unsupported`);
      }
      const qualified = typeSpelling(child);
      const canonical = canonicalType(child);
      let allowed = qualified === 'int' || /^int \*+$/.test(qualified);
      allowed ||= Object.keys(definitions).some(record => qualified === `${record} *`);
      allowed ||= Object.hasOwn(definitions, qualified) && qualified !== name;
      if (layoutOnly) {
        allowed = LAYOUT_SPELLINGS.includes(qualified) && BUILTIN_INTEGERS.includes(canonical);
        allowed ||= /^(?:const )?[\w:]+ \*+$/.test(qualified);
      }
      if (!allowed) {
        throw new Unsupported(`struct ${name}.${child.name}: unsupported field type ${qualified}`);
      }
      if (child.isBitfield || (child.inner && child.inner.length > 0) || !child.name) {
        throw new Unsupported(`struct ${name}: bitfields, attributes and default initializers are unsupported`);
      }
      fields.push(child);
    }
    if (fields.length === 0) {
      throw new Unsupported('empty structs are unsupported');
    }
  }

  const dumpOutput = frontend.recordLayoutsDump(program);
  const records: Record<string, RecordLayout> = {};
  const canonicals: Record<string, (string | null)[]> = {};
  for (const block of dumpOutput.split('*** Dumping AST Record Layout')) {
    const header = /^\s*0 \| struct (\w+)\s*$/m.exec(block);
    if (!header || !Object.hasOwn(definitions, header[1])) continue;
    const name = header[1];
    const sizes = /\[sizeof=(\d+), dsize=\d+, align=(\d+),/.exec(block);
    const rows = [...block.matchAll(/^\s*(\d+) \|   (\S.*?) (\w+)\s*$/gm)];
    const nodes = (definitions[name].inner ?? []).filter(c => c.kind === 'FieldDecl');
    if (
      !sizes ||
      rows.length !== nodes.length ||
      rows.some((row, i) => row[3] !== nodes[i].name)
    ) {
      throw new Unsupported(`Clang returned an incomplete layout for ${name}`);
    }
    const fields: RecordFieldInfo[] = [];
    const recordCanonicals: (string | null)[] = [];
    for (let i = 0; i < rows.length; i++) {
      const offset = Number.parseInt(rows[i][1], 10);
      const member = rows[i][3];
      const node = nodes[i];
      const spelling = typeSpelling(node);
      const nested = !layoutOnly && Object.hasOwn(definitions, spelling) ? spelling : null;
      const item: RecordFieldInfo = {
        name: member,
        offset,
        kind: nested ? 'struct' : isPointer(node) ? 'ptr' : 'int',
        size: 0,
      };
      if (layoutOnly || nested) {
        item.type = spelling;
      }
      fields.push(item);
      recordCanonicals.push(
        item.kind === 'struct' ? null : isPointer(node) ? 'void *' : canonicalType(node)
      );
    }
    records[name] = new RecordLayout(
      name,
      Number.parseInt(sizes[1], 10),
      Number.parseInt(sizes[2], 10),
      fields
    );
    canonicals[name] = recordCanonicals;
  }

  const defKeys = Object.keys(definitions);
  const recKeys = Object.keys(records);
  if (defKeys.length !== recKeys.length || !defKeys.every(k => Object.hasOwn(records, k))) {
    throw new Unsupported('Clang omitted a struct layout');
  }

  const types = [
    ...new Set(
      Object.values(canonicals)
        .flat()
        .filter((v): v is string => Boolean(v))
    ),
  ].sort();

  const sizesMap = frontend.typeSizes(types);
  for (const [name, record] of Object.entries(records)) {
    const recCanonicals = canonicals[name];
    for (let i = 0; i < record.fields.length; i++) {
      const item = record.fields[i];
      const canonical = recCanonicals[i];
      item.size =
        canonical === null
          ? records[item.type!].size
          : sizesMap[canonical];
    }
  }
  return records;
}
