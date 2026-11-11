// Clang-backed aggregate record validation and layout extraction.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Unsupported, run, tool } from './toolchain.mjs';

export class Record {
  constructor(name, size, alignment, fields) {
    this.name = name;
    this.size = size;
    this.alignment = alignment;
    this.fields = fields;
    Object.freeze(this);
  }
}

export function typeSpelling(node) {
  const qualified = node?.type?.qualType ?? '';
  return qualified.replace(/^(const )?struct /, '$1');
}

export function typeName(node) {
  return typeSpelling(node).replace(/^const /, '');
}

export function canonicalType(node) {
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

function isPointer(node) {
  return canonicalType(node).endsWith('*');
}

export function layouts(ast, directory, { layoutOnly = false } = {}) {
  const definitions = {};
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
    const fields = [];
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

  const result = run([
    tool('CLANGXX', 'clang++'),
    '-std=c++20',
    '-fsyntax-only',
    '-Xclang',
    '-fdump-record-layouts-complete',
    join(directory, 'source.cpp'),
  ]);
  if (result.returncode) {
    throw new Unsupported('Clang could not obtain struct layouts');
  }
  const records = {};
  const canonicals = {};
  for (const block of result.stdout.split('*** Dumping AST Record Layout')) {
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
    const fields = [];
    const recordCanonicals = [];
    for (let i = 0; i < rows.length; i++) {
      const offset = Number.parseInt(rows[i][1], 10);
      const member = rows[i][3];
      const node = nodes[i];
      const spelling = typeSpelling(node);
      const nested = !layoutOnly && Object.hasOwn(definitions, spelling) ? spelling : null;
      const item = {
        name: member,
        offset,
        kind: nested ? 'struct' : isPointer(node) ? 'ptr' : 'int',
      };
      if (layoutOnly || nested) {
        item.type = spelling;
      }
      fields.push(item);
      recordCanonicals.push(
        item.kind === 'struct' ? null : isPointer(node) ? 'void *' : canonicalType(node)
      );
    }
    records[name] = new Record(
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
        .filter(Boolean)
    ),
  ].sort();
  const probe = join(directory, 'sizes.cpp');
  writeFileSync(
    probe,
    types.map((value, i) => `enum { __course_${i} = sizeof(${value}) };\n`).join('')
  );
  const sizes = run([
    tool('CLANGXX', 'clang++'),
    '-std=c++20',
    '-fsyntax-only',
    '-Xclang',
    '-ast-dump=json',
    probe,
  ]);
  if (sizes.returncode) {
    throw new Unsupported('Clang could not obtain field sizes');
  }
  const tree = JSON.parse(sizes.stdout);
  const values = {};
  function constant(item) {
    if (item.kind === 'ConstantExpr') {
      return Number.parseInt(item.value, 10);
    }
    return constant(item.inner[0]);
  }
  function walkTree(node) {
    if (node.kind === 'EnumConstantDecl') {
      values[node.name] = constant(node);
    }
    for (const child of node.inner ?? []) {
      walkTree(child);
    }
  }
  walkTree(tree);
  for (const [name, record] of Object.entries(records)) {
    const recCanonicals = canonicals[name];
    for (let i = 0; i < record.fields.length; i++) {
      const item = record.fields[i];
      const canonical = recCanonicals[i];
      item.size =
        canonical === null
          ? records[item.type].size
          : values[`__course_${types.indexOf(canonical)}`];
    }
  }
  return records;
}
