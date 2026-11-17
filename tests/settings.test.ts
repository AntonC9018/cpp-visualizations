// Tests that every template and flag of the settings registry reaches each way of asking for a
// trace: the command line, lesson tags, and the playground's presets and URL.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { RESERVED_PARAMS, readState, writeState } from '../src/browser/playground_url.ts';
import { PRESETS } from '../src/browser/presets.ts';
import { Unsupported } from '../src/core/errors.ts';
import {
  DEFAULT_TEMPLATE,
  FLAG_NAMES,
  TEMPLATE_NAMES,
  flagsFor,
  flagsOf,
  parseSettings,
} from '../src/core/settings.ts';
import { main, settingsUsage } from '../src/node/generate.ts';
import { scanDocument } from '../src/node/discover.ts';

describe('SettingsTests', () => {
  test('parsing_checks_templates_flags_and_which_template_takes_a_flag', () => {
    assert.deepEqual(parseSettings(null, []), { template: DEFAULT_TEMPLATE, flags: {} });
    assert.deepEqual(parseSettings(null, ['types']), {
      template: 'expression-timeline',
      flags: { types: true },
    });
    assert.throws(() => parseSettings('memory', []), /unknown template 'memory'/);
    assert.throws(() => parseSettings(null, ['colours']), /unknown flag 'colours'/);
    assert.throws(() => parseSettings('layout', ['types']), Unsupported);
  });

  test('a_view_keeps_flags_across_templates_but_traces_with_those_taken', () => {
    assert.deepEqual(flagsFor('layout', { types: true }), {});
    assert.deepEqual(flagsFor('expression-timeline', { types: true }), { types: true });
  });

  test('every_template_and_flag_has_a_preset_so_the_wasm_parity_test_covers_it', () => {
    for (const template of TEMPLATE_NAMES) {
      assert.ok(PRESETS.some(p => p.settings.template === template), template);
    }
    for (const flag of FLAG_NAMES) {
      assert.ok(PRESETS.some(p => p.settings.flags[flag]), flag);
    }
  });
});

describe('SettingsReachEveryEntryPoint', () => {
  test('the_command_line_takes_every_flag', () => {
    const directory = mkdtempSync(join(tmpdir(), 'settings-'));
    try {
      const path = join(directory, 'snippet.cpp');
      writeFileSync(path, 'int a{ 1 };\nint b = a;\n');
      for (const template of TEMPLATE_NAMES) {
        for (const flag of flagsOf(template)) {
          let stderr = '';
          const status = main(['probe', '--source', path, '--template', template, `--${flag}`], {
            stdout: { write: () => true },
            stderr: { write: chunk => (stderr += chunk) },
          });
          assert.equal(status, 0, `${template} --${flag}: ${stderr}`);
        }
      }
      for (const flag of FLAG_NAMES) {
        assert.match(settingsUsage(), new RegExp(`--${flag}\\b`));
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('a_tag_names_every_flag_as_a_bare_attribute', () => {
    for (const flag of FLAG_NAMES) {
      const text =
        '```cpp\nint a{ 5 };\n```\n<details>\n<summary>Trace</summary>\n\n' +
        `<!-- <visualization ${flag}> -->\n<!-- </visualization> -->\n\n</details>\n`;
      const result = scanDocument(text);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.tags[0].flags, [flag]);
    }
  });

  test('the_playground_url_keeps_every_flag_and_no_flag_takes_a_reserved_name', () => {
    for (const flag of FLAG_NAMES) {
      assert.ok(!RESERVED_PARAMS.includes(flag), flag);
      const template = TEMPLATE_NAMES.find(t => flagsOf(t).includes(flag))!;
      const params = new URLSearchParams();
      writeState(params, { source: 'int a{ 1 };', template, flags: { [flag]: true } });
      assert.equal(params.get(flag), '1');
      assert.deepEqual(readState(params), { source: 'int a{ 1 };', template, flags: { [flag]: true } });
    }
  });

  test('the_playground_reads_links_from_before_the_shared_template_names', () => {
    const params = new URLSearchParams({ mode: 'trace', code: 'int a{ 1 };' });
    assert.equal(readState(params).template, 'expression-timeline');
    assert.equal(readState(new URLSearchParams({ mode: 'layout' })).template, 'layout');
  });

  test('a_preset_link_brings_its_flags_unless_the_link_says_otherwise', () => {
    const preset = PRESETS.find(p => Object.keys(p.settings.flags).length > 0)!;
    const [flag] = Object.keys(preset.settings.flags);
    assert.deepEqual(readState(new URLSearchParams({ preset: preset.id })).flags, preset.settings.flags);
    assert.deepEqual(readState(new URLSearchParams({ preset: preset.id, [flag]: '0' })).flags, {});
  });
});
