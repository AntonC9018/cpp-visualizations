"""Types in the pane: every name, literal and value carries its type, a declaration its slot."""
import copy
import os
from pathlib import Path
import shutil
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tracing  # noqa: E402
from trace_format import FormatError, validate  # noqa: E402

CLANG = os.environ.get('CLANGXX') or shutil.which('clang++')


def typed(step):
    """A step's typed parts as text: `int* p` is the slot `int* p:int*!`."""
    return [step['pane'][slice(*part['span'])] + ':' + part['type'] + ('!' if part.get('slot') else '')
            for part in step.get('types', [])]


def lines(trace, line):
    return [typed(step) for step in trace['steps'] if step['line'] == line]


@unittest.skipUnless(CLANG, 'Clang is required for AST integration tests')
class TypedPaneTests(unittest.TestCase):
    def trace(self, source):
        return tracing.trace(source, runtime=False)

    def test_names_literals_and_values_carry_their_types(self):
        trace = self.trace('int a = 5; int b = a + 6; std::cout << b;')
        self.assertEqual(lines(trace, 1), [['int b:int!', 'a:int', '6:int'], ['int b:int!', '5:int', '6:int'],
                                           ['int b:int!', '11:int'], ['int b:int!', '11:int']])
        self.assertEqual(lines(trace, 2), [['b:int'], ['11:int'], ['11:int']])

    def test_an_address_and_a_dereference_change_the_type(self):
        trace = self.trace('int a = 5; int* p = &a; *p = 6;')
        self.assertEqual(lines(trace, 1)[:2], [['int* p:int*!', 'a:int'], ['int* p:int*!', '76:int*']])
        self.assertEqual(lines(trace, 2)[:3], [['p:int*', '6:int'], ['76:int*', '6:int'], ['a:int', '6:int']])

    def test_a_declaration_slot_shows_the_deduced_type(self):
        trace = self.trace('int a = 5; auto p = &a; int b;')
        self.assertEqual(lines(trace, 1)[0][0], 'auto p:int*!')
        self.assertEqual(lines(trace, 2), [['int b:int!']])
        self.assertEqual({v['name']: v['type'] for v in trace['variables']}, {'a': 'int', 'p': 'int*', 'b': 'int'})

    def test_a_struct_value_and_a_field_are_one_typed_part(self):
        trace = self.trace('struct A { int f; int g; }; A a{ 1, 2 }; A b = a; A* p = &a; p->g = a.f;')
        self.assertEqual(lines(trace, 0)[0], ['A a:A!', '{ 1, 2 }:A'])
        self.assertEqual(lines(trace, 1)[1], ['A b:A!', 'A{1, 2}:A'])
        self.assertEqual(lines(trace, 3)[:4], [['p:A*', 'a.f:int'], ['p:A*', '1:int'], ['80:A*', '1:int'],
                                               ['a.g:int', '1:int']])

    def test_a_reference_keeps_the_type_of_what_it_names(self):
        trace = self.trace('struct A { int f; }; A s{ 1 }; A& r = s; r.f = 2;')
        self.assertEqual(lines(trace, 1)[0], ['s:A'])
        self.assertEqual(lines(trace, 2)[:2], [['r.f:int', '2:int'], ['s.f:int', '2:int']])

    def test_null_pointers(self):
        trace = self.trace('int* p{}; p = nullptr;')
        self.assertEqual(lines(trace, 0)[:2], [['int* p:int*!'], ['int* p:int*!', '0:int*']])
        self.assertEqual(lines(trace, 1)[:2], [['p:int*', 'nullptr:nullptr_t'], ['p:int*', '0:int*']])


@unittest.skipUnless(CLANG, 'Clang is required for AST integration tests')
class MismatchTests(unittest.TestCase):
    """A last statement whose value does not fit its slot is shown as a clash, not run."""

    def clash(self, source):
        trace = tracing.trace(source, runtime=False)
        written, clash = trace['steps'][-2:]
        self.assertIsNone(written['op'])
        self.assertEqual(written['pane'], clash['pane'])
        self.assertEqual(clash['line'], len(trace['source']) - 1)
        return trace, clash

    def test_a_declaration_with_the_wrong_pointer_depth(self):
        trace, clash = self.clash('struct A { int f; }; A a{ 1 }; A* value{ &a }; A** p{ value };')
        self.assertEqual(typed(clash), ['A** p:A**!', 'value:A*'])
        self.assertEqual((clash['op']['from'], clash['op']['to']), ('A*', 'A**'))
        self.assertEqual(trace['source'][-1], 'A** p{ value };')
        self.assertEqual({variable['name'] for variable in trace['variables']}, {'a', 'value'})
        self.assertEqual(clash['values'], trace['steps'][-3]['values'])

    def test_an_initializer_after_the_equals_sign(self):
        _, clash = self.clash('int a = 5; int* p = a; return 0;')
        self.assertEqual(typed(clash), ['int* p:int*!', 'a:int'])

    def test_an_assignment(self):
        _, clash = self.clash('int a = 5; int* p = &a; *p = &a;')
        self.assertEqual(typed(clash), ['*p:int!', '&a:int*'])

    def test_unrelated_structs(self):
        _, clash = self.clash('struct A { int f; }; struct B { int f; }; A a{ 1 }; B b = a;')
        self.assertEqual(typed(clash), ['B b:B!', 'a:A'])

    def test_only_the_last_statement_may_fail(self):
        for source in ('int a = 5; int* p = a; int b = 6;', 'int a = 5; int* p = b;', 'int* p = 5;'):
            with self.assertRaises(tracing.Unsupported):
                tracing.trace(source, runtime=False)

    def test_a_clash_must_match_the_typed_pane(self):
        trace, _ = self.clash('int a = 5; int* p = a;')
        for edit in (lambda op: op.update(to='int'), lambda op: op.update(span=[0, 1]),
                     lambda op: op.update({'from': 'int*'}), lambda op: op.update(destination=[0, 3])):
            broken = copy.deepcopy(trace)
            edit(broken['steps'][-1]['op'])
            with self.assertRaises(FormatError):
                validate(broken)
        broken = copy.deepcopy(trace)
        broken['steps'].append(copy.deepcopy(broken['steps'][-2]))
        with self.assertRaises(FormatError):
            validate(broken)


@unittest.skipUnless(CLANG, 'Clang is required for AST integration tests')
class TypeValidationTests(unittest.TestCase):
    def setUp(self):
        self.trace = tracing.trace('int a = 5; int b = a;', runtime=False)

    def broken(self, edit):
        trace = copy.deepcopy(self.trace)
        edit(trace)
        with self.assertRaises(FormatError):
            validate(trace)

    def test_rejects_malformed_typed_parts(self):
        self.broken(lambda t: t['steps'][0]['types'].reverse())
        self.broken(lambda t: t['steps'][0]['types'][0].update(span=[0, 99]))
        self.broken(lambda t: t['steps'][0]['types'][0].update(type=''))
        self.broken(lambda t: t['steps'][0]['types'][1].update(slot=True))
        self.broken(lambda t: t['steps'][0].update(types=[]))
        self.broken(lambda t: t['variables'][0].update(type=4))

    def test_types_are_optional(self):
        for step in self.trace['steps']:
            del step['types']
        for variable in self.trace['variables']:
            del variable['type']
        validate(self.trace)


if __name__ == '__main__':
    unittest.main()
