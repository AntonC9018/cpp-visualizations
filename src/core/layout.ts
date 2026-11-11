// Static, compiler-derived layouts; never execute the example's statements (isomorphic core).

import { type CompilerFrontend, Unsupported } from './errors.ts';
import { layoutsFromFrontend } from './records.ts';
import { _body } from './tracing.ts';
import { FORMAT, type LayoutField, type LayoutTrace, validate } from './trace_format.ts';

export function traceLayout(source: string, frontend: CompilerFrontend): LayoutTrace {
  const body = _body(source);
  const program =
    '#include <iostream>\n#include <cstdint>\n#include <cstddef>\n' +
    'using namespace std;\nint main() {\n' +
    body +
    '\n}\n';
  const ast = frontend.mainAst(program);
  const records = layoutsFromFrontend(ast, program, frontend, { layoutOnly: true });
  if (Object.keys(records).length === 0) {
    throw new Unsupported('layout requires at least one plain struct definition');
  }
  const result: LayoutTrace = {
    format: FORMAT,
    kind: 'layout',
    records: Object.values(records).map(record => ({
      name: record.name,
      size: record.size,
      alignment: record.alignment,
      fields: record.fields as LayoutField[],
    })),
  };
  validate(result);
  return result;
}
