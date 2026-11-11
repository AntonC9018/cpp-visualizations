// Static, compiler-derived layouts; never execute the example's statements.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { layouts } from './records.mjs';
import { Unsupported } from './toolchain.mjs';
import { _body, _main_ast } from './tracing.mjs';
import { FORMAT, validate } from './trace_format.mjs';

export function trace(source) {
  const body = _body(source);
  const temporary = mkdtempSync(join(tmpdir(), 'course-layout-'));
  let records;
  try {
    const program =
      '#include <iostream>\n#include <cstdint>\n#include <cstddef>\n' +
      'using namespace std;\nint main() {\n' +
      body +
      '\n}\n';
    records = layouts(_main_ast(program, temporary), temporary, { layoutOnly: true });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (Object.keys(records).length === 0) {
    throw new Unsupported('layout requires at least one plain struct definition');
  }
  const result = {
    format: FORMAT,
    kind: 'layout',
    records: Object.values(records).map(record => ({
      name: record.name,
      size: record.size,
      alignment: record.alignment,
      fields: record.fields,
    })),
  };
  validate(result);
  return result;
}
