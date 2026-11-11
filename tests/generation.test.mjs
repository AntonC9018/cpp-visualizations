// Layout eligibility gates that must remain true even for compiler-valid inputs.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as generate from '../generate.mjs';
import * as fixtures from '../player/fixtures.mjs';
import { Unsupported } from '../tracing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function applicable(trace, snippet = null) {
  generate.applicable(trace, snippet === null ? trace.source.join('\n') : snippet);
}

describe('LayoutEligibilityTests', () => {
  const baseTrace = fixtures.reassign();

  function changed(addresses) {
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
    for (const addresses of [{ b: 72, p: 80 }, { p: 80 }]) {
      assert.throws(
        () => applicable(changed(addresses)),
        err => err instanceof Unsupported && /noncontiguous/.test(err.message)
      );
    }
  });

  test('long_names_sources_and_panes_are_accepted', () => {
    let trace = structuredClone(baseTrace);
    const renamed = { a: 'copiedValue', b: 'copiedPointer' };
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
        err => err instanceof Unsupported && /spacing/.test(err.message)
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
    const hashed = new Set(generate.TRACER_SOURCES.map(p => basename(p)));
    const local = new Set(
      readdirSync(ROOT)
        .filter(f => f.endsWith('.mjs'))
        .map(f => basename(f, '.mjs'))
    );
    const pending = ['generate'];
    const seen = new Set();
    while (pending.length > 0) {
      const name = pending.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      assert.ok(
        hashed.has(`${name}.mjs`),
        `${name} is imported by the tracer but not hashed`
      );
      const text = readFileSync(join(ROOT, `${name}.mjs`), 'utf8');
      for (const match of text.matchAll(/^\s*import\s+[\s\S]*?from\s+['"]\.\/(\w+)\.mjs['"]/gm)) {
        if (local.has(match[1])) {
          pending.push(match[1]);
        }
      }
    }
  });
});
