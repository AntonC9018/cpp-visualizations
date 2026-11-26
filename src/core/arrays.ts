// Clang's std::array specializations and the corresponding trace storage paths.
import { type AstNode, Unsupported } from './errors.ts';

export function arrayType(spelling: string): { name: string; element: string; count: number } | null {
  const type = spelling.replace(/\b(?:struct|class|enum) /g, '').replace(/^const /, '');
  const match = /^(?:std::)?array<(.+), (\d+)>$/.exec(type);
  if (!match) return null;
  const element = arrayType(match[1])?.name ?? match[1];
  const count = Number(match[2]);
  return { name: `std::array<${element}, ${count}>`, element, count };
}

export function elementLabel(index: number): string {
  return `[${index}]`;
}

/** Storage paths have a dot between every component, even before an array index. */
export function codeName(path: string): string {
  return path.replaceAll('.[', '[');
}

export function operatorName(node: AstNode): string | undefined {
  return node.inner?.[0]?.inner?.[0]?.referencedDecl?.name;
}

const libraryAlias = /\b(?:value_type|const_pointer|pointer)\b/;

function needsConcreteType(spelling: string): boolean {
  return libraryAlias.test(spelling) || (
    /^(?:const )?(?:std::)?array</.test(spelling) &&
    !arrayType(spelling.replace(/ [*&]+$/, ''))
  );
}

/**
 * Clang's JSON stops desugaring at a pointer or reference to a deduced specialization
 * or library typedef. Recover its concrete type from the expression or local declaration.
 */
export function resolveArrayAliases(ast: AstNode): void {
  const locals = new Map<string, string>();
  function visit(node: AstNode): void {
    for (const child of node.inner ?? []) visit(child);
    for (const child of node.array_filler ?? []) visit(child);
    const type = node.type;
    if (!type) return;
    const spelling = type.desugaredQualType ?? type.qualType ?? '';
    if (needsConcreteType(spelling)) {
      const child = node.inner?.[0];
      let resolved: string | undefined;
      if (
        node.kind === 'CXXMemberCallExpr' && child?.kind === 'MemberExpr' &&
        child.name === 'data'
      ) {
        const receiver = child.inner?.[0]?.type;
        const receiverType = receiver?.desugaredQualType ?? receiver?.qualType ?? '';
        const array = arrayType(receiverType.replace(/ \*$/, ''));
        if (array) {
          const qualified = receiverType.startsWith('const ');
          const element = array.element;
          resolved = element.endsWith('*')
            ? element + (qualified ? 'const *' : '*')
            : (qualified ? 'const ' : '') + element + ' *';
        }
      } else if (node.kind === 'DeclRefExpr') {
        const id = node.referencedDecl?.id;
        resolved = id ? locals.get(id)?.replace(/ &$| &&$/, '') : undefined;
      } else {
        const childType = child?.type?.desugaredQualType ?? child?.type?.qualType;
        if (childType && !needsConcreteType(childType)) {
          if (node.kind === 'UnaryOperator' && node.opcode === '&') {
            const pointee = childType.replace(/^([\w: ]+) const$/, 'const $1');
            resolved = pointee.endsWith('*') ? pointee + '*' : pointee + ' *';
          } else if (node.kind === 'VarDecl') {
            resolved = childType + (spelling.endsWith('&') ? ' &' : '');
          } else if (
            (node.kind === 'ImplicitCastExpr' &&
              (node.castKind === 'NoOp' || node.castKind === 'LValueToRValue')) ||
            node.kind === 'ParenExpr' ||
            (node.kind === 'InitListExpr' && node.inner?.length === 1)
          ) {
            resolved = childType;
          }
        }
      }
      if (resolved) node.type = { ...type, desugaredQualType: resolved };
    }
    if (node.kind === 'VarDecl' && node.id) {
      locals.set(node.id, node.type?.desugaredQualType ?? spelling);
    }
  }
  visit(ast);
}

const MAX_ARRAY_ELEMENTS = 32;
const MAX_ARRAY_CELLS = 64;

export function checkArrayExtent(count: number, cells: number): void {
  if (count < 1 || count > MAX_ARRAY_ELEMENTS || cells > MAX_ARRAY_CELLS) {
    throw new Unsupported(
      `std::array requires 1–${MAX_ARRAY_ELEMENTS} elements and at most ${MAX_ARRAY_CELLS} scalar cells`
    );
  }
}
