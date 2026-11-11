// Layout eligibility gates that must remain true even for compiler-valid inputs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ExecutionTrace } from '../src/core/trace_format.ts';
import * as fixtures from '../src/node/fixtures.ts';
import * as generate from '../src/node/generate.ts';
import { Unsupported } from '../src/node/tracing.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function applicable(trace: ExecutionTrace, snippet: string | null = null): void {
  generate.applicable(trace, snippet === null ? trace.source.join('\n') : snippet);
}

describe('LayoutEligibilityTests', () => {
  const baseTrace = fixtures.reassign();

  function changed(addresses: Record<string, number>): ExecutionTrace {
    const trace = structuredClone(baseTrace);
    for (const variable of trace.variables) {
      if (Object.hasOwn(addresses, variable.name)) {
        variable.address = addresses[variable.name];
      }
    }
    return trace;
  }

  test('ordinary_examples_fit', () => {
    applicable(baseTrace);
    applicable(fixtures.double_pointer());
  });

  test('alignment_padding_above_a_pointer_fits', () => {
    applicable(changed({ p: 64, b: 80, a: 76 }));
  });

  test('address_gaps_cannot_be_drawn_as_adjacent_cells', () => {
    const cases: Array<Record<string, number>> = [{ b: 72, p: 80 }, { p: 80 }];
    for (const addresses of cases) {
      assert.throws(
        () => applicable(changed(addresses)),
        (err: unknown) => err instanceof Unsupported && /noncontiguous/.test(err.message)
      );
    }
  });

  test('long_names_sources_and_panes_are_accepted', () => {
    let trace = structuredClone(baseTrace);
    const renamed: Record<string, string> = { a: 'copiedValue', b: 'copiedPointer' };
    for (const variable of trace.variables) {
      variable.name = renamed[variable.name] ?? variable.name;
    }
    generate._storage_is_contiguous(trace.variables);
    trace = structuredClone(baseTrace);
    trace.source = [...trace.source, ...trace.source, ...trace.source];
    trace.steps[trace.steps.length - 1].pane = 'x'.repeat(60);
    applicable(trace);
  });
});

describe('SpacingTests', () => {
  test('spacing_inside_a_statement_is_rejected', () => {
    const trace = fixtures.reassign();
    for (const snippet of ['int     *     d{ &value };', '     *     d = 6;', 'int a  = 5;']) {
      assert.throws(
        () => applicable(trace, snippet),
        (err: unknown) => err instanceof Unsupported && /spacing/.test(err.message)
      );
    }
  });

  test('indentation_literals_and_comments_keep_their_spacing', () => {
    applicable(
      fixtures.reassign(),
      '    int a{ 5 };\nstd::cout << "a  b";  // two  spaces\nchar c{ \'  \' };'
    );
  });
});

describe('RevisionTests', () => {
  test('every_imported_tracer_module_is_hashed', () => {
    const hashed = new Set(generate.TRACER_SOURCES.map(p => resolve(p)));
    const pending = [join(ROOT, 'generate.mjs')];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const filePath = pending.pop()!;
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const rel = relative(ROOT, filePath);
      assert.ok(
        hashed.has(filePath),
        `${rel} is imported by the tracer but not hashed`
      );
      const text = readFileSync(filePath, 'utf8');
      for (const match of text.matchAll(
        /^\s*(?:import|export)\s+[\s\S]*?from\s+['"](\.[^'"]+)['"]/gm
      )) {
        const target = resolve(dirname(filePath), match[1]);
        if (existsSync(target) && target.startsWith(ROOT)) {
          pending.push(target);
        }
      }
    }
  });
});
