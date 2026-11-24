// Clang-backed aggregate record validation and layout extraction (isomorphic core).

import { arrayType, checkArrayExtent, elementLabel } from './arrays.ts';
import { type AstNode, type CompilerFrontend, Unsupported } from './errors.ts';
import { integerSpelled } from './integers.ts';
import type { ScalarKind } from './trace_format.ts';

export interface RecordFieldInfo {
  name: string;
  offset: number;
  kind: ScalarKind | 'struct';
  type?: string;
  canonical?: string;
  size: number;
  alignment?: number;
  count?: number;
  floating?: boolean;
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

/** Clang's spelling of a type as the lessons write it: `int*`, `A**`, `std::byte`. */
export function displayed(spelling: string): string {
  return spelling
    .replace(/^(const )?struct /, '$1')
    .replace(/\s+(?=[*&])/g, '')
    .replace(/^std::(?!byte\b)/, '');
}

export function displayedType(node: AstNode | null | undefined): string {
  const spelling = typeSpelling(node);
  const canonical = canonicalType(node);
  return displayed(
    /^(?:const )?std::array</.test(canonical) || /\b(?:value_type|size_type|const_pointer|pointer)\b/.test(spelling)
      ? canonical
      : spelling
  );
}

export function typeName(node: AstNode | null | undefined): string {
  return typeSpelling(node).replace(/^const /, '');
}

export function canonicalType(node: AstNode | null | undefined): string {
  const qualified = node?.type ?? {};
  const spelling = qualified.desugaredQualType ?? qualified.qualType ?? '';
  return spelling.replace(/^([\w: ]+) const$/, 'const $1');
}

export function recordName(node: AstNode | null | undefined): string {
  const canonical = canonicalType(node);
  return arrayType(canonical)?.name ??
    (/^value_type$/.test(typeName(node)) ? canonical.replace(/^const /, '') : typeName(node));
}

const LAYOUT_SPELLINGS = [
  'uint8_t',
  'int8_t',
  'int',
  'size_t',
  'uint64_t',
  'byte',
  'std::uint8_t',
  'std::int8_t',
  'std::size_t',
  'std::uint64_t',
  'std::byte',
];
const BUILTIN_INTEGERS = [
  'signed char',
  'unsigned char',
  'int',
  'unsigned long',
  'unsigned long long',
  'std::byte',
];

const MAX_LAYOUT_ARRAY_ELEMENTS = 64;

interface LayoutArrayInfo {
  kind: 'c' | 'std';
  arrayName?: string;
  count: number;
  isPtr: boolean;
  elemCanonical: string;
}

function isAllowedLayoutScalar(qualified: string, canonical: string): boolean {
  return (
    (LAYOUT_SPELLINGS.includes(qualified) && BUILTIN_INTEGERS.includes(canonical)) ||
    /^(?:const )?[\w:]+ \*+$/.test(qualified)
  );
}

function parseLayoutArray(qualified: string, canonical: string): LayoutArrayInfo | null {
  const cArr = /^(.+?)\s*((?:\[\d+\])+)$/.exec(canonical);
  if (cArr) {
    const dims = [...cArr[2].matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
    let count = 1;
    for (const d of dims) {
      if (d < 1) throw new Unsupported('array fields in structs must have positive length');
      count *= d;
      if (count > MAX_LAYOUT_ARRAY_ELEMENTS) {
        throw new Unsupported(`array fields in struct layouts support at most ${MAX_LAYOUT_ARRAY_ELEMENTS} elements`);
      }
    }
    const elemCanonical = cArr[1].trim();
    const qArr = /^(.+?)\s*((?:\[\d+\])+)$/.exec(qualified);
    const elemAllowed = qArr
      ? isAllowedLayoutScalar(qArr[1].trim(), elemCanonical)
      : BUILTIN_INTEGERS.includes(elemCanonical) || elemCanonical.endsWith('*');
    if (!elemAllowed) return null;
    return { kind: 'c', count, isPtr: elemCanonical.endsWith('*'), elemCanonical };
  }
  const top = arrayType(canonical);
  if (!top) return null;
  let cur = top;
  let count = 1;
  while (true) {
    if (cur.count < 1) throw new Unsupported('array fields in structs must have positive length');
    count *= cur.count;
    if (count > MAX_LAYOUT_ARRAY_ELEMENTS) {
      throw new Unsupported(`array fields in struct layouts support at most ${MAX_LAYOUT_ARRAY_ELEMENTS} elements`);
    }
    const inner = arrayType(cur.element);
    if (!inner) break;
    cur = inner;
  }
  const elemCanonical = cur.element;
  const isPtr = elemCanonical.endsWith('*');
  if (!BUILTIN_INTEGERS.includes(elemCanonical) && !(isPtr && /^(?:const )?[\w: ]+\*+$/.test(elemCanonical))) {
    return null;
  }
  return { kind: 'std', arrayName: top.name, count, isPtr, elemCanonical };
}

function sizeProbeType(canonical: string): string {
  return canonical === 'std::byte' ? 'unsigned char' : canonical;
}

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
  const arrayTypes = new Set<string>();
  const layoutArrays = new Map<AstNode, LayoutArrayInfo>();
  if (!layoutOnly) {
    function collectType(spelling: string): void {
      const array = arrayType(spelling);
      if (!array || arrayTypes.has(array.name)) return;
      checkArrayExtent(array.count, array.count);
      arrayTypes.add(array.name);
      collectType(array.element);
    }
    function collect(node: AstNode): void {
      collectType(canonicalType(node));
      if (node.argType) collectType(canonicalType({ type: node.argType }));
      for (const child of node.inner ?? []) collect(child);
      for (const child of node.array_filler ?? []) collect(child);
    }
    collect(ast);
  }
  if (Object.keys(definitions).length === 0 && arrayTypes.size === 0) {
    return {};
  }
  const floatSpelled = (spelling: string): boolean => spelling === 'float' || spelling === 'double';
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
      const base = canonical.replace(/^struct /, '').replace(/ \*+$/, '');
      const isPtr = canonical.endsWith('*') && !qualified.startsWith('const ');
      const shadowed = Object.hasOwn(definitions, qualified.replace(/^const /, '').replace(/^std::/, '').replace(/ \*+$/, ''));
      let allowed =
        (!shadowed && (Boolean(integerSpelled(canonical)) || floatSpelled(canonical)) && !qualified.startsWith('const ')) ||
        (isPtr &&
          ((!shadowed && (Boolean(integerSpelled(base)) || floatSpelled(base))) ||
            base === 'void' ||
            Object.hasOwn(definitions, base) ||
            Boolean(arrayType(base))));
      allowed ||= Object.hasOwn(definitions, qualified) && qualified !== name;
      allowed ||= arrayTypes.has(recordName(child));
      if (layoutOnly) {
        const arr = parseLayoutArray(qualified, canonical);
        allowed = isAllowedLayoutScalar(qualified, canonical) || arr !== null;
        if (arr) {
          layoutArrays.set(child, arr);
          if (arr.arrayName) arrayTypes.add(arr.arrayName);
        }
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
  const arrayLayouts = new Map<string, { size: number; alignment: number }>();
  const canonicals: Record<string, (string | null)[]> = {};
  const layoutArrayRefs: Record<string, (LayoutArrayInfo | null)[]> = {};
  for (const block of dumpOutput.split('*** Dumping AST Record Layout')) {
    const header = /^\s*0 \| struct (\S[^\n]*)$/m.exec(block);
    if (!header) continue;
    const name = header[1].trimEnd();
    const sizes = /\[sizeof=(\d+), dsize=\d+, align=(\d+),/.exec(block);
    const array = arrayType(name);
    if (array && arrayTypes.has(array.name) && sizes) {
      arrayLayouts.set(array.name, { size: Number(sizes[1]), alignment: Number(sizes[2]) });
    }
    if (!Object.hasOwn(definitions, name)) continue;
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
    const recordArrays: (LayoutArrayInfo | null)[] = [];
    for (let i = 0; i < rows.length; i++) {
      const offset = Number.parseInt(rows[i][1], 10);
      const member = rows[i][3];
      const node = nodes[i];
      const spelling = typeSpelling(node);
      const arr = layoutOnly ? (layoutArrays.get(node) ?? null) : null;
      const nestedName = recordName(node);
      const nested = !layoutOnly && (Object.hasOwn(definitions, nestedName) || arrayTypes.has(nestedName))
        ? nestedName
        : null;
      const item: RecordFieldInfo = {
        name: member,
        offset,
        kind: arr ? (arr.isPtr ? 'ptr' : 'int') : nested ? 'struct' : isPointer(node) ? 'ptr' : 'int',
        size: 0,
        ...(arr ? { count: arr.count } : {}),
        ...(!layoutOnly ? { canonical: canonicalType(node).replace(/^struct /, '') } : {}),
        ...(floatSpelled(canonicalType(node)) ? { floating: true } : {}),
      };
      if (layoutOnly || nested) {
        item.type = nested ?? spelling;
      }
      fields.push(item);
      recordArrays.push(arr);
      if (arr) {
        recordCanonicals.push(
          arr.kind === 'std' ? null : arr.isPtr ? 'void *' : sizeProbeType(arr.elemCanonical)
        );
      } else {
        recordCanonicals.push(
          item.kind === 'struct' ? null : isPointer(node) ? 'void *' : sizeProbeType(canonicalType(node))
        );
      }
    }
    records[name] = new RecordLayout(
      name,
      Number.parseInt(sizes[1], 10),
      Number.parseInt(sizes[2], 10),
      fields
    );
    canonicals[name] = recordCanonicals;
    layoutArrayRefs[name] = recordArrays;
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

  const sizesMap = types.length ? frontend.typeSizes(types) : {};
  const leafCounts = new Map<string, number>();
  function countCells(name: string): number {
    const known = leafCounts.get(name);
    if (known !== undefined) return known;
    const array = arrayType(name);
    if (array) {
      const layout = arrayLayouts.get(name);
      if (!layout || layout.size % array.count !== 0) {
        throw new Unsupported(`Clang omitted a contiguous layout for ${name}`);
      }
      const nested = arrayType(array.element) || Object.hasOwn(records, array.element);
      const scalarElem = /^(?:(?:signed|unsigned) char|(?:unsigned )?(?:short|int|long(?: long)?)|float|double|std::byte)$/;
      const pointee = /^(.*) \*+$/.exec(array.element)?.[1];
      const pointer = pointee !== undefined && (
        scalarElem.test(pointee) || pointee === 'void' || Object.hasOwn(records, pointee) || Boolean(arrayType(pointee))
      );
      if (!nested && !pointer && !scalarElem.test(array.element)) {
        throw new Unsupported(`unsupported std::array element type ${array.element}`);
      }
      const count = array.count * (nested ? countCells(array.element) : 1);
      checkArrayExtent(array.count, count);
      const size = layout.size / array.count;
      const isFloatElem = floatSpelled(array.element);
      const fields: RecordFieldInfo[] = Array.from({ length: array.count }, (_, index) => ({
        name: elementLabel(index),
        offset: index * size,
        kind: nested ? 'struct' : pointer ? 'ptr' : 'int',
        ...(nested ? { type: array.element } : {}),
        ...(!layoutOnly ? { canonical: array.element } : {}),
        ...(isFloatElem ? { floating: true } : {}),
        size,
      }));
      records[name] = new RecordLayout(name, layout.size, layout.alignment, fields);
      leafCounts.set(name, count);
      return count;
    }
    const count = records[name].fields.reduce(
      (total, field) => total + (field.kind === 'struct' ? countCells(field.type!) : 1), 0
    );
    leafCounts.set(name, count);
    return count;
  }
  if (!layoutOnly) {
    for (const name of arrayTypes) countCells(name);
  }
  for (const [name, record] of Object.entries(records)) {
    const recCanonicals = canonicals[name];
    const recArrays = layoutArrayRefs[name];
    if (!recCanonicals) continue;
    for (let i = 0; i < record.fields.length; i++) {
      const item = record.fields[i];
      const canonical = recCanonicals[i];
      const arr = recArrays?.[i] ?? null;
      if (arr) {
        if (arr.kind === 'std') {
          const layout = arrayLayouts.get(arr.arrayName!);
          if (!layout || layout.size !== arr.count * layout.alignment) {
            throw new Unsupported(`Clang omitted a contiguous layout for ${arr.arrayName}`);
          }
          item.size = layout.size;
          item.alignment = layout.alignment;
        } else {
          const elemSize = sizesMap[canonical!];
          item.size = elemSize * arr.count;
          item.alignment = elemSize;
        }
      } else {
        item.size =
          canonical === null
            ? records[item.type!].size
            : sizesMap[canonical];
      }
    }
  }
  return records;
}
