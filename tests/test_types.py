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
