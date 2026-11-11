"""Integer conversions: a value changes its type in one step, whether or not its digits change."""
import copy
import os
from pathlib import Path
import shutil
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tracing  # noqa: E402
from tracing import INTEGERS, Unsupported  # noqa: E402
from trace_format import FormatError, validate  # noqa: E402

CLANG = os.environ.get('CLANGXX') or shutil.which('clang++')
GDB = os.environ.get('GDB') or shutil.which('gdb')


def conversions(trace, line=None):
    """Each conversion as (pane before, pane after, from, to)."""
    steps = trace['steps']
    return [(before['pane'], step['pane'], step['op']['from'], step['op']['to'])
            for before, step in zip(steps, steps[1:])
            if step['op'] and step['op']['kind'] == 'convert' and line in (None, step['line'])]


def typed(step):
    return [step['pane'][slice(*part['span'])] + ':' + part['type'] for part in step.get('types', [])]


class IntegerTests(unittest.TestCase):
    def test_a_conversion_keeps_the_low_bits(self):
        cases = [('unsigned char', 256, 0), ('unsigned char', -1, 255), ('signed char', -200, 56),
                 ('signed char', 255, -1), ('short', 65534, -2), ('unsigned int', -1, 4294967295),
                 ('int', 2**31, -2**31), ('long', -3, -3), ('unsigned long', -1, 2**64 - 1)]
        for spelling, value, expected in cases:
            with self.subTest(spelling=spelling, value=value):
                self.assertEqual(INTEGERS[spelling].wrap(value), expected)

    def test_unsigned_arithmetic_wraps_and_signed_overflow_is_undefined(self):
        self.assertEqual(INTEGERS['unsigned int'].result(-1), 4294967295)
        self.assertEqual(INTEGERS['short'].result(-32768), -32768)
        with self.assertRaisesRegex(Unsupported, 'signed integer overflow'):
            INTEGERS['long'].result(2**63)


@unittest.skipUnless(CLANG, 'Clang is required for AST integration tests')
class ConversionTests(unittest.TestCase):
    def trace(self, source):
        return tracing.trace(source, runtime=False, types=True)

    def test_an_explicit_cast_is_one_step(self):
        trace = self.trace('uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) };')
        self.assertEqual(conversions(trace, 1), [
            ('uint8_t b = static_cast<uint8_t>(256)', 'uint8_t b = 0', 'uint32_t', 'uint8_t')])
        self.assertEqual(trace['steps'][-1]['values'], {'a': 256, 'b': 0})
        self.assertEqual({v['name']: v['size'] for v in trace['variables']}, {'a': 4, 'b': 1})

    def test_the_same_digits_still_change_their_type(self):
        trace = self.trace('uint8_t b{ 0 }; uint32_t c{ b };')
        self.assertEqual(conversions(trace), [('uint8_t b = 0', 'uint8_t b = 0', 'int', 'uint8_t'),
                                              ('uint32_t c = 0', 'uint32_t c = 0', 'uint8_t', 'uint32_t')])
        read, converted = [step for step in trace['steps'] if step['line'] == 1][1:3]
        self.assertEqual((typed(read)[1], typed(converted)[1]), ('0:uint8_t', '0:uint32_t'))

    def test_an_implicit_conversion_in_an_assignment(self):
        trace = self.trace('int16_t s{ -2 }; uint16_t u{ 0 }; u = s;')
        self.assertEqual(conversions(trace, 2), [('u = -2', 'u = 65534', 'int16_t', 'uint16_t')])
        self.assertEqual({v['name']: v['size'] for v in trace['variables']}, {'s': 2, 'u': 2})

    def test_a_sign_change_of_one_width(self):
        self.assertEqual(conversions(self.trace('int8_t a{ -3 }; uint8_t b{ static_cast<uint8_t>(a) };'), 1),
                         [('uint8_t b = static_cast<uint8_t>(-3)', 'uint8_t b = 253', 'int8_t', 'uint8_t')])
        self.assertEqual(conversions(self.trace('uint8_t a{ 127 }; int8_t b{ static_cast<int8_t>(a) };'), 1),
                         [('int8_t b = static_cast<int8_t>(127)', 'int8_t b = 127', 'uint8_t', 'int8_t')])

    def test_a_negative_number_widens_with_its_sign(self):
        trace = self.trace('int8_t a{ -3 }; int b{ static_cast<int>(a) }; long c = b;')
        self.assertEqual(conversions(trace)[1:], [('int b = static_cast<int>(-3)', 'int b = -3', 'int8_t', 'int'),
                                                  ('long c = -3', 'long c = -3', 'int', 'long')])

    def test_narrowing_wraps(self):
        trace = self.trace('int c{ -200 }; int8_t d{ static_cast<int8_t>(c) }; std::cout << static_cast<int>(d);')
        self.assertEqual(conversions(trace), [
            ('int8_t d = static_cast<int8_t>(-200)', 'int8_t d = 56', 'int', 'int8_t'),
            ('std::cout << static_cast<int>(56)', 'std::cout << 56', 'int8_t', 'int')])
        self.assertEqual(trace['steps'][-1]['stdout'], '56')

    def test_operands_are_promoted_before_arithmetic(self):
        trace = self.trace('uint8_t a{ 200 }; int b = a + a; unsigned x = 0; x = x - 1;')
        self.assertEqual(conversions(trace, 1), [('int b = 200 + a', 'int b = 200 + a', 'uint8_t', 'int'),
                                                 ('int b = 200 + 200', 'int b = 200 + 200', 'uint8_t', 'int')])
        self.assertEqual(conversions(trace, 3), [('x = 0 - 1', 'x = 0 - 1', 'int', 'unsigned int')])
        self.assertEqual(trace['steps'][-1]['values'], {'a': 200, 'b': 400, 'x': 4294967295})

    def test_a_cast_to_the_same_type_only_goes_away(self):
        trace = self.trace('int a{ 5 }; int b{ static_cast<int>(a) };')
        self.assertEqual(conversions(trace), [])
        self.assertEqual([step['pane'] for step in trace['steps'] if step['line'] == 1][-1], 'int b = 5')

    def test_a_pointer_to_a_narrow_integer_writes_through(self):
        trace = self.trace('uint8_t a{ 1 }; uint8_t* p = &a; *p = 300 - 45;')
        self.assertEqual(conversions(trace, 2), [('*p = 255', '*p = 255', 'int', 'uint8_t')])
        self.assertEqual(trace['steps'][-1]['values']['a'], 255)

    def test_what_is_not_an_integer_conversion_is_rejected(self):
        cases = {
            'int value{ 7 }; double half{ static_cast<double>(value) / 2 };': 'not double',
            'bool b{ true }; int a = b;': 'not bool',
            'char c{ 5 }; int a = c;': 'not char',
            'uint8_t a{ 65 }; std::cout << a;': 'prints a one-byte integer as a character',
            'int a{ 5 }; short s{ a };': 'cannot be narrowed',
            'int a{ 2147483647 }; long b = a + 1;': 'signed integer overflow',
            'unsigned long a = 18446744073709551615ul;': 'beyond 2\\^53',
            'struct A { int f; }; uint8_t u{ 3 }; A a{ u };': "inside a struct's braces",
        }
        for source, reason in cases.items():
            with self.subTest(source=source), self.assertRaisesRegex(Unsupported, reason):
                self.trace(source)

    def test_a_conversion_must_match_the_typed_pane(self):
        trace = self.trace('uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) };')
        index = next(i for i, step in enumerate(trace['steps'])
                     if step['line'] == 1 and (step['op'] or {}).get('kind') == 'convert')
        for edit in (lambda op: op.update({'from': 'int'}), lambda op: op.update(to='uint32_t'),
                     lambda op: op.update(value='1'), lambda op: op.pop('from')):
            broken = copy.deepcopy(trace)
            edit(broken['steps'][index]['op'])
            with self.assertRaises(FormatError):
                validate(broken)


@unittest.skipUnless(CLANG, 'Clang is required for AST integration tests')
class UntypedConversionTests(unittest.TestCase):
    """Without types a conversion is an evaluation: a step only when the text changes."""

    def test_only_a_changed_value_is_a_step(self):
        trace = tracing.trace('uint32_t a{ 256 }; uint8_t b{ static_cast<uint8_t>(a) }; uint32_t c{ b };',
                              runtime=False)
        self.assertEqual([(step['pane'], (step['op'] or {}).get('kind')) for step in trace['steps'] if step['line']], [
            ('uint8_t b = static_cast<uint8_t>(a)', None), ('uint8_t b = static_cast<uint8_t>(256)', 'read'),
            ('uint8_t b = 0', 'eval'), ('uint8_t b = 0', 'write'),
            ('uint32_t c = b', None), ('uint32_t c = 0', 'read'), ('uint32_t c = 0', 'write')])
        self.assertFalse(any('types' in step for step in trace['steps']))
        self.assertFalse(any('type' in variable for variable in trace['variables']))

    def test_a_mismatch_is_not_shown(self):
        with self.assertRaisesRegex(Unsupported, 'cannot initialize'):
            tracing.trace('int a = 5; int* p = a;', runtime=False)


@unittest.skipUnless(CLANG and GDB, 'Clang and GDB are required for runtime verification')
class RuntimeConversionTests(unittest.TestCase):
    def test_gdb_agrees_on_every_width_and_sign(self):
        trace = tracing.trace('int8_t a{ -3 }; uint16_t b = a; int c{ -200 }; '
                              'int8_t d{ static_cast<int8_t>(c) }; uint64_t e = b; long f = d - 60; '
                              'std::cout << b << std::endl; std::cout << f;')
        self.assertEqual(trace['steps'][-1]['values'], {'a': -3, 'b': 65533, 'c': -200, 'd': 56, 'e': 65533, 'f': -4})
        self.assertEqual(trace['steps'][-1]['stdout'], '65533\n-4')
        self.assertEqual({v['name']: v['size'] for v in trace['variables']},
                         {'a': 1, 'b': 2, 'c': 4, 'd': 1, 'e': 8, 'f': 8})


if __name__ == '__main__':
    unittest.main()
