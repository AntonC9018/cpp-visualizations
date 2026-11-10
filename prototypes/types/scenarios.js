/* PROTOTYPE. Hand-written traces for the type examples (lab 3 conversions, lab 4 pointer
 * types), built per variant.
 *
 * Panes are written with their types marked up: `[expr|type]`, nested freely.
 *   [A** p|@A**]      a declaration: its type is the slot's
 *   [7.0|double~int]  this value has just been converted from int
 * `build(scenario, variant)` returns a trace in the player's format plus the extensions:
 *   variable.type, trace.typeColors {type: colour index}, trace.variant
 *   step.types  [{s, e, type, height, decl, from}]   the typed spans of step.pane
 *   op convert  {span, value, from, to}              a value changes type (and maybe value)
 *   op cast     {span, value, to}                    variant C: the compiler's conversion, spelled
 *   op clash    {span, destination, name, value, leftType, rightType, at, as, reading, peel, message}
 */
(() => {
  'use strict';

  function parse(markup) {
    let text = '';
    const types = [];
    function node(i) {
      const s = text.length;
      let height = 0;
      i++;
      while (markup[i] !== '|') {
        if (markup[i] === '[') { const inner = node(i); i = inner.i; height = Math.max(height, inner.height + 1); }
        else text += markup[i++];
      }
      const close = markup.indexOf(']', i);
      let type = markup.slice(i + 1, close), from = null;
      const decl = type[0] === '@';
      if (decl) type = type.slice(1);
      if (type.includes('~')) [type, from] = type.split('~');
      types.push({ s, e: text.length, type, height, decl, from });
      return { i: close + 1, height };
    }
    for (let i = 0; i < markup.length;) {
      if (markup[i] === '[') i = node(i).i;
      else text += markup[i++];
    }
    return { text, types };
  }

  function build(scenario, variant) {
    const leaves = [];
    for (const v of scenario.variables) {
      if (v.kind === 'struct') for (const f of v.fields) leaves.push(v.name + '.' + f.name);
      else leaves.push(v.name);
    }
    const state = { values: Object.fromEntries(leaves.map(name => [name, null])), targets: {}, stdout: '',
      line: 0, pane: '', types: [], expr: [0, 0] };
    const steps = [];
    const push = (op, hold = 1.0) => steps.push({ line: state.line, pane: state.pane, types: state.types,
      expr: [...state.expr], op, hold, stdout: state.stdout, values: { ...state.values }, targets: { ...state.targets } });
    function show(markup) {
      const { text, types } = parse(markup);
      const start = text.includes(' = ') ? text.indexOf(' = ') + 3 : text.indexOf('<< ') + 3;
      const end = text.endsWith(' << std::endl') ? text.length - 13 : text.length;
      Object.assign(state, { pane: text, types, expr: [start, end] });
    }
    // The occurrence of `was` whose replacement by `value` turns the old pane into the new one.
    function changed(before, was, value) {
      for (let at = before.indexOf(was); at >= 0; at = before.indexOf(was, at + 1)) {
        if (before.slice(0, at) + value + before.slice(at + was.length) === state.pane) return [at, at + was.length];
      }
      throw new Error(`"${was}" → "${value}" does not turn "${before}" into "${state.pane}"`);
    }
    const token = name => {
      const at = state.pane.search(new RegExp(`\\b${name}\\b`));
      return [at, at + name.length];
    };
    for (const [kind, ...rest] of scenario.steps) {
      if (kind === 'line') {
        state.line = rest[0];
        show(rest[1]);
        push(null, 0.6);
      } else if (kind === 'write') {
        const [name, value, set, target] = rest, at = state.pane.lastIndexOf(value);
        Object.assign(state.values, set);
        if (target) state.targets[name] = target;
        push({ kind, name, value, span: [at, at + value.length], destination: token(name) });
      } else if (kind === 'print') {
        const at = state.pane.lastIndexOf(rest[0], state.expr[1]);
        state.stdout += rest[0] + '\n';
        push({ kind, value: rest[0], span: [at, at + rest[0].length] });
      } else if (kind === 'clash') {
        const at = state.pane.lastIndexOf(rest[0].value);
        push({ kind, ...rest[0], span: [at, at + rest[0].value.length], destination: token(rest[0].name) }, 2.5);
      } else {
        const [markup, op] = rest, before = state.pane;
        if (op.only && op.only !== variant) continue;
        show(markup);
        const { was, only, ...fields } = op;
        push({ kind, ...fields, span: changed(before, was, op.value) });
      }
    }
    return { format: 1, variant, title: scenario.title, source: scenario.source, variables: scenario.variables,
      types: scenario.types, typeColors: scenario.typeColors, steps };
  }

  const scalar = (name, type, address, size, color, kind = 'int') => ({ name, type, address, size, color, kind });
  const TYPE_COLORS = { int: 0, double: 1, uint32_t: 5, uint8_t: 2, A: 4, 'A*': 3, 'A**': 1 };

  const scenarios = [
    {
      title: 'A cast changes the expression type',
      note: 'Lab 3, example 2. An explicit `static_cast`, then the implicit conversion of `2` before the division, '
        + 'then the same division on two `int`s.',
      source: ['int value{ 7 };', 'double half{ static_cast<double>(value) / 2 };', 'int integerHalf{ value / 2 };',
        'std::cout << half << std::endl;', 'std::cout << integerHalf << std::endl;'],
      variables: [scalar('value', 'int', 64, 4, 0), scalar('half', 'double', 72, 8, 1), scalar('integerHalf', 'int', 80, 4, 2)],
      typeColors: TYPE_COLORS,
      steps: [
        ['line', 0, '[int value|@int] = [7|int]'],
        ['write', 'value', '7', { value: 7 }],
        ['line', 1, '[double half|@double] = [[static_cast<double>([value|int])|double] / [2|int]|double]'],
        ['read', '[double half|@double] = [[static_cast<double>([7|int])|double] / [2|int]|double]', { name: 'value', was: 'value', value: '7' }],
        ['convert', '[double half|@double] = [[7.0|double~int] / [2|int]|double]', { was: 'static_cast<double>(7)', value: '7.0', from: 'int', to: 'double' }],
        ['cast', '[double half|@double] = [[7.0|double] / [static_cast<double>([2|int])|double]|double]', { only: 'C', was: '2', value: 'static_cast<double>(2)', to: 'double' }],
        ['convert', '[double half|@double] = [[7.0|double] / [2.0|double~int]|double]', { only: 'C', was: 'static_cast<double>(2)', value: '2.0', from: 'int', to: 'double' }],
        ['convert', '[double half|@double] = [[7.0|double] / [2.0|double~int]|double]', { only: 'A', was: '2', value: '2.0', from: 'int', to: 'double' }],
        ['convert', '[double half|@double] = [[7.0|double] / [2.0|double~int]|double]', { only: 'B', was: '2', value: '2.0', from: 'int', to: 'double' }],
        ['eval', '[double half|@double] = [3.5|double]', { was: '7.0 / 2.0', value: '3.5' }],
        ['write', 'half', '3.5', { half: '3.5' }],
        ['line', 2, '[int integerHalf|@int] = [[value|int] / [2|int]|int]'],
        ['read', '[int integerHalf|@int] = [[7|int] / [2|int]|int]', { name: 'value', was: 'value', value: '7' }],
        ['eval', '[int integerHalf|@int] = [3|int]', { was: '7 / 2', value: '3' }],
        ['write', 'integerHalf', '3', { integerHalf: 3 }],
        ['line', 3, 'std::cout << [half|double] << std::endl'],
        ['read', 'std::cout << [3.5|double] << std::endl', { name: 'half', was: 'half', value: '3.5' }],
        ['print', '3.5'],
        ['line', 4, 'std::cout << [integerHalf|int] << std::endl'],
        ['read', 'std::cout << [3|int] << std::endl', { name: 'integerHalf', was: 'integerHalf', value: '3' }],
        ['print', '3'],
      ],
    },
    {
      title: 'Truncation, then an implicit widening',
      note: 'Lab 3, example 5. The conversion to `uint8_t` changes the value; the conversion back, which nobody wrote, does not.',
      source: ['uint32_t a{ 256 };', 'uint8_t b{ static_cast<uint8_t>(a) };', 'uint32_t c{ b };', 'std::cout << c << std::endl;'],
      variables: [scalar('a', 'uint32_t', 64, 4, 0), scalar('b', 'uint8_t', 68, 1, 1), scalar('c', 'uint32_t', 72, 4, 2)],
      typeColors: TYPE_COLORS,
      steps: [
        ['line', 0, '[uint32_t a|@uint32_t] = [256|int]'],
        ['cast', '[uint32_t a|@uint32_t] = [static_cast<uint32_t>([256|int])|uint32_t]', { only: 'C', was: '256', value: 'static_cast<uint32_t>(256)', to: 'uint32_t' }],
        ['convert', '[uint32_t a|@uint32_t] = [256|uint32_t~int]', { only: 'C', was: 'static_cast<uint32_t>(256)', value: '256', from: 'int', to: 'uint32_t' }],
        ['convert', '[uint32_t a|@uint32_t] = [256|uint32_t~int]', { only: 'A', was: '256', value: '256', from: 'int', to: 'uint32_t' }],
        ['convert', '[uint32_t a|@uint32_t] = [256|uint32_t~int]', { only: 'B', was: '256', value: '256', from: 'int', to: 'uint32_t' }],
        ['write', 'a', '256', { a: 256 }],
        ['line', 1, '[uint8_t b|@uint8_t] = [static_cast<uint8_t>([a|uint32_t])|uint8_t]'],
        ['read', '[uint8_t b|@uint8_t] = [static_cast<uint8_t>([256|uint32_t])|uint8_t]', { name: 'a', was: 'a', value: '256' }],
        ['convert', '[uint8_t b|@uint8_t] = [0|uint8_t~uint32_t]', { was: 'static_cast<uint8_t>(256)', value: '0', from: 'uint32_t', to: 'uint8_t' }],
        ['write', 'b', '0', { b: 0 }],
        ['line', 2, '[uint32_t c|@uint32_t] = [b|uint8_t]'],
        ['read', '[uint32_t c|@uint32_t] = [0|uint8_t]', { name: 'b', was: 'b', value: '0' }],
        ['cast', '[uint32_t c|@uint32_t] = [static_cast<uint32_t>([0|uint8_t])|uint32_t]', { only: 'C', was: '0', value: 'static_cast<uint32_t>(0)', to: 'uint32_t' }],
        ['convert', '[uint32_t c|@uint32_t] = [0|uint32_t~uint8_t]', { only: 'C', was: 'static_cast<uint32_t>(0)', value: '0', from: 'uint8_t', to: 'uint32_t' }],
        ['convert', '[uint32_t c|@uint32_t] = [0|uint32_t~uint8_t]', { only: 'A', was: '0', value: '0', from: 'uint8_t', to: 'uint32_t' }],
        ['convert', '[uint32_t c|@uint32_t] = [0|uint32_t~uint8_t]', { only: 'B', was: '0', value: '0', from: 'uint8_t', to: 'uint32_t' }],
        ['write', 'c', '0', { c: 0 }],
        ['line', 3, 'std::cout << [c|uint32_t] << std::endl'],
        ['read', 'std::cout << [0|uint32_t] << std::endl', { name: 'c', was: 'c', value: '0' }],
        ['print', '0'],
      ],
    },
    {
      title: 'Pointer types, and one that does not fit',
      note: 'The issue\'s `A** p = value`. The last line does not compile: the trace stops on it and says why.',
      source: ['A a{ 1, 2 };', 'A* value{ &a };', 'A** pp{ &value };', 'A** p{ value };'],
      types: { A: 'struct A\n{\n    int f1;\n    int f2;\n};' },
      variables: [
        { name: 'a', kind: 'struct', type: 'A', address: 64, size: 8, color: 0,
          fields: [{ name: 'f1', offset: 0, size: 4, kind: 'int', color: 0 }, { name: 'f2', offset: 4, size: 4, kind: 'int', color: 1 }] },
        scalar('value', 'A*', 72, 8, 1, 'ptr'), scalar('pp', 'A**', 80, 8, 2, 'ptr'), scalar('p', 'A**', 88, 8, 3, 'ptr')],
      typeColors: TYPE_COLORS,
      steps: [
        ['line', 0, '[A a|@A] = [{ 1, 2 }|A]'],
        ['write', 'a', '{ 1, 2 }', { 'a.f1': 1, 'a.f2': 2 }],
        ['line', 1, '[A* value|@A*] = [&[a|A]|A*]'],
        ['addr', '[A* value|@A*] = [64|A*]', { name: 'a', was: '&a', value: '64' }],
        ['write', 'value', '64', { value: 64 }, 'a'],
        ['line', 2, '[A** pp|@A**] = [&[value|A*]|A**]'],
        ['addr', '[A** pp|@A**] = [72|A**]', { name: 'value', was: '&value', value: '72' }],
        ['write', 'pp', '72', { pp: 72 }, 'value'],
        ['line', 3, '[A** p|@A**] = [value|A*]'],
        ['clash', { name: 'p', value: 'value', leftType: 'A**', rightType: 'A*', at: 'a', as: 'A*',
          reading: '8589934593', peel: '*p : A*   ≠   *value : A', message: "error: cannot convert 'A*' to 'A**'" }],
      ],
    },
  ];

  window.TypePrototype = { scenarios, build };
})();
