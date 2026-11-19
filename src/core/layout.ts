// Static, compiler-derived layouts; never execute the example's statements (isomorphic core).

import { type CompilerFrontend, Unsupported } from './errors.ts';
import { layoutsFromFrontend } from './records.ts';
import { SourceFile } from './source.ts';
import { FORMAT, type LayoutField, type LayoutTrace, validate } from './trace_format.ts';

export function traceLayout(source: string, frontend: CompilerFrontend): LayoutTrace {
  const file = new SourceFile(source, frontend);
  const [ast] = file.ast(frontend);
  const records = layoutsFromFrontend(ast, file.program, frontend, { layoutOnly: true });
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
