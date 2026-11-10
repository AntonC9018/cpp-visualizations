"""References: a second name for storage, bound once and drawn without storage of its own."""
import copy
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate
import tracing
from tracing import Unsupported
from trace_format import FormatError, validate

CLANG = os.environ.get('CLANGXX') or shutil.which('clang++')
GDB = os.environ.get('GDB') or shutil.which('gdb')

SOURCE = '''struct A { int f; };
int a = 5; int b{1}; int& c = a; auto& d{ c }; c = b; int* p = &c; int& e = *p;
A s{1}; A& rs = s; int& rf = rs.f; rf = 4; int*& rp = p; *rp = 3; const int& k = a;
b = k + c; std::cout << d;'''


def panes(result, line):
    return [(step['pane'], (step['op'] or {}).get('kind')) for step in result['steps'] if step['line'] == line]


@unittest.skipUnless(CLANG and GDB, "Clang and Python-enabled GDB are required")
class ReferenceTraceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = tracing.trace(SOURCE)

    def test_a_reference_has_no_storage_and_is_bound_once(self):
        result = self.result
        generate.applicable(result, SOURCE)
        self.assertEqual([item['name'] for item in result['references']], ['c', 'd', 'e', 'rs', 'rf', 'rp', 'k'])
        # The hidden slots are closed up: only alignment padding lies between the variables.
        self.assertEqual([(v['name'], v['address']) for v in result['variables']],
                         [('s', 68), ('p', 72), ('b', 80), ('a', 84)])
        last = result['steps'][-1]
        self.assertEqual(last['refs'], {'c': 'a', 'd': 'a', 'e': 'a', 'rs': 's', 'rf': 's.f', 'rp': 'p', 'k': 'a'})
        self.assertEqual(last['stdout'], '3')
        self.assertNotIn('c', last['values'])

    def test_binding_resolves_the_initializer_to_storage(self):
        self.assertEqual(panes(self.result, 2), [('int& c = a', None), ('int& c = a', 'bind')])
        # A reference to a reference binds to what the first one names.
        self.assertEqual(panes(self.result, 3),
                         [('auto& d = c', None), ('auto& d = a', 'alias'), ('auto& d = a', 'bind')])
        self.assertEqual(panes(self.result, 6), [('int& e = *p', None), ('int& e = *84', 'read'),
                                                 ('int& e = a', 'deref'), ('int& e = a', 'bind')])
        self.assertEqual(panes(self.result, 9)[1:], [('int& rf = s.f', 'alias'), ('int& rf = s.f', 'bind')])

    def test_a_used_reference_becomes_the_name_it_stands_for(self):
        self.assertEqual(panes(self.result, 4),
                         [('c = b', None), ('c = 1', 'read'), ('a = 1', 'alias'), ('a = 1', 'write')])
        self.assertEqual(panes(self.result, 5)[1:3], [('int* p = &a', 'alias'), ('int* p = 84', 'addr')])
        self.assertEqual(panes(self.result, 10), [('rf = 4', None), ('s.f = 4', 'alias'), ('s.f = 4', 'write')])
        self.assertEqual(panes(self.result, 12)[1:], [('*p = 3', 'alias'), ('*84 = 3', 'read'),
                                                      ('a = 3', 'deref'), ('a = 3', 'write')])

    def test_unsupported_references_never_execute(self):
        cases = {
            'int&& r = 1; int a = r;': 'rvalue references',
            'const int& r = 5; int a = r;': 'unsupported assignable expression',
            'int a = 1; int& r = a; int r2 = 2; int& a2 = r2; int& r = r2;': 'error',
        }
        for source, reason in cases.items():
            with self.subTest(source=source), patch.object(tracing, 'execute') as execute:
                with self.assertRaisesRegex(Unsupported, reason):
                    tracing.trace(source)
                execute.assert_not_called()

    def test_a_reference_observed_elsewhere_is_fatal(self):
        original = tracing.execute

        def moved(*args):
            execution = original(*args)
            for row in execution.checkpoints:
                for name, cell in row.items():
                    if cell.reference:
                        row[name] = copy.replace(cell, address=cell.address + 4)
            return execution
        with patch.object(tracing, 'execute', moved), self.assertRaisesRegex(Unsupported, 'the reference c disagrees'):
            tracing.trace('int a = 1; int& c = a; c = 2;')


class ReferenceFormatTests(unittest.TestCase):
    def setUp(self):
        step = {'line': 0, 'pane': 'int a = 1', 'values': {'a': None}, 'targets': {}, 'stdout': '', 'hold': 1,
                'op': None, 'refs': {}}
        self.trace = {'format': 1, 'source': ['int a = 1;', 'int& c = a;', 'c = 2;'],
                      'variables': [{'name': 'a', 'address': 64, 'size': 4, 'kind': 'int', 'color': 0}],
                      'references': [{'name': 'c', 'color': 1}],
                      'steps': [
                          step,
                          dict(step, values={'a': 1}, op={'kind': 'write', 'name': 'a', 'value': '1',
                                                          'span': [8, 9], 'destination': [4, 5]}),
                          dict(step, line=1, pane='int& c = a', values={'a': 1}),
                          dict(step, line=1, pane='int& c = a', values={'a': 1}, refs={'c': 'a'},
                               op={'kind': 'bind', 'name': 'c', 'target': 'a', 'span': [9, 10], 'destination': [5, 6]}),
                          dict(step, line=2, pane='c = 2', values={'a': 1}, refs={'c': 'a'}),
                          dict(step, line=2, pane='a = 2', values={'a': 1}, refs={'c': 'a'},
                               op={'kind': 'alias', 'name': 'c', 'target': 'a', 'span': [0, 1]}),
                          dict(step, line=2, pane='a = 2', values={'a': 2}, refs={'c': 'a'},
                               op={'kind': 'write', 'name': 'a', 'value': '2', 'span': [4, 5], 'destination': [0, 1]}),
                      ]}

    def rejects(self, message, change):
        broken = copy.deepcopy(self.trace)
        change(broken)
        with self.assertRaisesRegex(FormatError, message):
            validate(broken)

    def test_accepts_bind_and_alias(self):
        validate(self.trace)

    def test_rejects_inconsistent_references(self):
        self.rejects('only a bind changes', lambda t: t['steps'][2].update(refs={'c': 'a'}))
        self.rejects('only a bind changes', lambda t: t['steps'][5].update(refs={}))
        self.rejects('unknown reference', lambda t: t['steps'][3]['op'].update(name='a'))
        self.rejects('unknown variable', lambda t: t['steps'][3]['op'].update(target='b'))
        self.rejects("does not cover 'c'", lambda t: t['steps'][3]['op'].update(destination=[0, 3]))
        self.rejects('does not cover the name', lambda t: t['steps'][5]['op'].update(span=[2, 3]))
        self.rejects('duplicate name', lambda t: t['references'].append({'name': 'a', 'color': 2}))


if __name__ == '__main__':
    unittest.main()
