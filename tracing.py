"""Compiler-backed execution traces of flat integer, pointer and aggregate struct examples.

Clang supplies syntax, types and record layouts. A strict AST whitelist predicts each
statement's effects without executing arbitrary C++. GDB verifies every live scalar and
struct field after every statement, including unchanged memory. Only verified states become
unified-format reductions; addresses are normalized deterministically near 64.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import itertools
import json
from pathlib import Path
import re
import textwrap
import tempfile

from execution import REFERENCE, Execution, execute
from records import canonical_type, displayed, displayed_type, layouts, type_name, type_spelling
from toolchain import IllFormed, Unsupported, run, tool
from trace_format import (FORMAT, UNKNOWN, FormatError, scalar, struct, struct_field, field as trace_field,
                          reference as trace_reference,
                          addresses as storage_addresses, leaves, validate, whitespace_output)

__all__ = ["Pointer", "Unsupported", "trace"]

FIRST_ADDRESS = 64
POINTER_SIZE = 8
# JSON numbers are doubles in the player: larger magnitudes would not be drawn exactly.
MAX_EXACT = 2**53
MAX_STATEMENTS, MAX_VARIABLES = 20, 8
_QUOTED_OR_COMMENT = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/')


# Values -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Pointer:
    """A pointer value: the variable whose address it holds, or None for a null pointer."""
    target: str | None = None


Value = int | Pointer | dict[str, "Value | None"]


@dataclass(frozen=True)
class Integer:
    """A builtin integer type: its bytes and whether it is signed."""
    size: int
    signed: bool

    def wrap(self, value: int) -> int:
        """`value` converted to this type: its low bits, as every conversion keeps them."""
        bits = 8 * self.size
        value %= 1 << bits
        return value - (1 << bits) if self.signed and value >> (bits - 1) else value

    def holds(self, value: int) -> bool:
        return self.wrap(value) == value

    def result(self, value: int) -> int:
        """The result of arithmetic in this type: unsigned wraps, signed overflow is undefined."""
        if self.signed and not self.holds(value):
            raise Unsupported("signed integer overflow is outside the timeline category")
        return self.wrap(value)


# By Clang's canonical spelling, with the sizes of the pinned x86-64 toolchain; GDB checks the
# size of every cell. `char` and `bool` are not numbers in the lessons and stay out.
INTEGERS = {spelling: Integer(size, signed)
            for size, names in ((1, ("signed char", "unsigned char")), (2, ("short", "unsigned short")),
                                (4, ("int", "unsigned int")), (8, ("long", "unsigned long")),
                                (8, ("long long", "unsigned long long")))
            for spelling, signed in zip(names, (True, False))}
# Clang resolves an alias only where it is the whole type, not under a pointer (`uint8_t *`).
ALIASES = {"size_t": "unsigned long", "ptrdiff_t": "long", "intptr_t": "long", "uintptr_t": "unsigned long",
           **{f"{prefix}int{8 * size}_t": spelling for spelling, integer in INTEGERS.items()
              if "long long" not in spelling for prefix, size in [("" if integer.signed else "u", integer.size)]}}


def _integer_named(spelling: str, records=()) -> Integer | None:
    """The integer type a spelling names, unless the snippet has a struct of that name."""
    name = spelling.removeprefix("const ").removeprefix("std::")
    return None if name in records else INTEGERS.get(ALIASES.get(name, name))


def _integer_type(node: dict, records=()) -> Integer | None:
    """The integer type of an expression or declaration, behind any alias (`uint8_t`)."""
    return _integer_named(canonical_type(node), records)


def _depth(node: dict, records=()) -> int:
    """How many pointer levels lie over an integer or a supported struct."""
    qualified = type_spelling(node)
    match = re.fullmatch(r"(const )?([\w: ]+?)(?: (\*+))?", canonical_type(node))
    if match and _integer_named(match[2], records) and not (match[1] and match[3]):
        return len(match[3] or "")
    record_type = type_name(node)
    if record_type in records:
        return 0
    match = re.fullmatch(r"(\w+) (\*+)", qualified)
    if match and match[1] in records:
        return len(match[2])
    if "&" in qualified:
        raise Unsupported("references are not supported")
    if "[" in qualified:
        raise Unsupported("arrays are not supported")
    if "*" in qualified:
        raise Unsupported(f"only pointers to integers are supported, not {qualified}")
    raise Unsupported(f"only integer and pointer values are supported, not {qualified or 'this type'}")


# Source text ------------------------------------------------------------------------------

def _body(source: str) -> str:
    def comment(match):
        value = match.group()
        return "\n" * value.count("\n") + " " if value.startswith(("//", "/*")) else value
    source = _QUOTED_OR_COMMENT.sub(comment, source)
    for line in source.splitlines():
        if line.lstrip().startswith("#") and not re.fullmatch(r'\s*#\s*include\s*[<"][\w./]+[>"]\s*', line):
            raise Unsupported("only ordinary include directives are supported")
    source = re.sub(r'^\s*#\s*include[^\n]*', '', source, flags=re.MULTILINE).strip()
    source = re.sub(r'^using\s+namespace\s+std\s*;\s*', '', source)
    if re.search(r'\bmain\s*\(', source):
        match = re.fullmatch(r'([\s\S]*?)int\s+main\s*\(\s*(?:void\s*)?\)\s*\{([\s\S]*)\}\s*', source)
        if not match:
            raise Unsupported("only a standalone parameterless main or statement fragment is supported")
        # Struct definitions may precede main; anything else (a global, a function)
        # would change meaning once moved into main's body.
        if re.sub(r'\bstruct\s+\w+\s*\{[^{}]*\}\s*;', '', match.group(1)).strip():
            raise Unsupported("only struct definitions may precede main")
        source = (match.group(1) + match.group(2)).strip()
    if not source or len(source) > 10_000:
        raise Unsupported("empty or oversized snippet")
    # Keep offsets byte-equivalent to Clang and avoid unreviewed identifier/string encodings.
    if not source.isascii():
        raise Unsupported("non-ASCII source text is not supported")
    return source


_DEFINITION = re.compile(r'struct\s+\w+\s*[{;]')
_DEFINITION_TEXT = re.compile(r'^([ \t]*)(struct\s+(\w+)\s*\{[^{}]*\}\s*;)', re.MULTILINE)


def _definitions(body: str) -> dict[str, str]:
    """Each struct definition as the snippet writes it, without the indentation of main."""
    return {match.group(3): textwrap.dedent(match.group(1) + match.group(2))
            for match in _DEFINITION_TEXT.finditer(body)}


def _bounds(node: dict) -> tuple[int, int]:
    try:
        first, last = node["range"]["begin"], node["range"]["end"]
        return first["offset"], last["offset"] + last["tokLen"]
    except KeyError as exc:
        raise Unsupported("macro-expanded or implicit source ranges are not supported") from exc


def _compact(source: str) -> tuple[str, list[int]]:
    """Collapse whitespace outside literals and retain a source-offset map."""
    out, mapping, index = [], [0] * (len(source) + 1), 0
    pattern = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|\s+|.', re.DOTALL)
    for match in pattern.finditer(source):
        token = match.group()
        if token.isspace():
            replacement = " " if out and out[-1] != " " else ""
        else:
            replacement = token
        for offset in range(match.start(), match.end()):
            mapping[offset] = index + (min(offset - match.start(), len(replacement)) if not token.isspace() else 0)
        out.append(replacement)
        index += len(replacement)
        mapping[match.end()] = index
    return "".join(out).rstrip(), mapping


def _main_ast(program: str, directory: Path) -> dict:
    path = directory / "source.cpp"
    path.write_text(program)
    result = run([tool("CLANGXX", "clang++"), "-std=c++20", "-fsyntax-only", "-fno-color-diagnostics",
                  "-Xclang", "-ast-dump=json", "-Xclang", "-ast-dump-filter=main", str(path)])
    if result.returncode:
        diagnostic = next((line for line in result.stderr.splitlines() if "error:" in line), "error: ill-formed C++")
        place = re.match(r".*?:(\d+):(\d+): error:", diagnostic)
        lines = program.splitlines(keepends=True)
        offset = sum(map(len, lines[:int(place[1]) - 1])) + int(place[2]) - 1 if place else None
        # Drop the temporary path, which differs between runs.
        raise IllFormed(diagnostic[diagnostic.index("error:"):], offset)
    decoder, offset, selected = json.JSONDecoder(), 0, []
    try:
        while offset < len(result.stdout):
            while offset < len(result.stdout) and result.stdout[offset].isspace():
                offset += 1
            if offset == len(result.stdout):
                break
            node, offset = decoder.raw_decode(result.stdout, offset)
            if node.get("kind") == "FunctionDecl" and node.get("name") == "main":
                selected.append(node)
    except ValueError as exc:
        raise Unsupported("Clang returned invalid AST JSON") from exc
    if len(selected) != 1:
        raise Unsupported("expected one main function")
    compound = [node for node in selected[0].get("inner", []) if node.get("kind") == "CompoundStmt"]
    if len(compound) != 1:
        raise Unsupported("main has no supported body")
    if _bounds(compound[0])[1] != program.rfind("}") + 1:
        raise Unsupported("declarations outside main are unsupported")
    return compound[0]


# Evaluation -------------------------------------------------------------------------------

@dataclass(frozen=True)
class Reduction:
    """One rewrite of the pane: the text at `span` becomes a value, an address or a name.

    `read` replaces it with the value of `name`, `addr` with the address of `name`, `deref`
    with the name of the variable `name` (a pointer) points to, `alias` the reference `name`
    with what it is bound to (`spelling`), and `eval` with `value` (or
    `spelling`, when the value is not written as a number). `convert` replaces a value of the
    type `source` with the `value` it has in another type, even when it reads the same. A struct value that has a type on
    its own, a read or a typed literal, keeps it in front: `record` names it. `span` indexes the
    statement's original pane; inner reductions come first. `type` is the type of the result.
    """
    kind: str
    span: tuple[int, int]
    name: str | None = None
    value: Value | None = None
    spelling: str | None = None
    record: str | None = None
    type: str | None = None
    source: str | None = None


class _Evaluator:
    """Evaluates one expression against the state before its statement, recording reductions."""

    def __init__(self, state, locate, records, references=()):
        self.state, self.locate, self.reductions = state, locate, []
        self.records, self.references = records, references
        self.temporary = False

    def _reduce(self, kind: str, node: dict, **details) -> None:
        self.reductions.append(Reduction(kind, self.locate(node), type=displayed_type(node), **details))

    def _load(self, name: str) -> Value:
        value = _load(self.state, name)
        if value is None:
            raise Unsupported(f"reading uninitialized variable {name}")
        return value

    def variable(self, node: dict) -> str:
        """The local variable a DeclRefExpr names; a reference names what it is bound to."""
        declaration = node.get("referencedDecl", {})
        name = declaration.get("name")
        if node.get("kind") == "DeclRefExpr" and declaration.get("kind") == "VarDecl" and name in self.references:
            self._reduce("alias", node, name=name, spelling=self.references[name])
            return self.references[name]
        if node.get("kind") != "DeclRefExpr" or declaration.get("kind") != "VarDecl" or name not in self.state:
            raise Unsupported("expression references an undeclared or nonlocal variable")
        return name

    def lvalue(self, node: dict, outer: dict | None = None) -> str:
        """The variable `node` designates. Parentheses around a dereference reduce with it."""
        kind, children = node.get("kind"), node.get("inner", [])
        if kind == "ParenExpr" and len(children) == 1:
            return self.lvalue(children[0], outer or node)
        if kind == "DeclRefExpr":
            return self.variable(node)
        if kind == "MemberExpr" and len(children) == 1:
            if node.get("isArrow"):
                pointer, via = self.rvalue(children[0])
                if via is None:
                    raise Unsupported("arrow access requires a pointer variable")
                if pointer.target is None:
                    raise Unsupported(f"dereferencing the null pointer {via} is undefined")
                name = pointer.target + "." + node["name"]
                self._reduce("deref", outer or node, name=via, value=Pointer(name))
                return name
            return self.lvalue(children[0]) + "." + node["name"]
        if kind == "UnaryOperator" and node.get("opcode") == "*" and len(children) == 1:
            pointer, via = self.rvalue(children[0])
            if via is None:
                raise Unsupported("only dereferencing a pointer variable is supported, not a computed address")
            if pointer.target is None:
                raise Unsupported(f"dereferencing the null pointer {via} is undefined")
            self._reduce("deref", outer or node, name=via)
            return pointer.target
        raise Unsupported(f"unsupported assignable expression: {kind}")

    def rvalue(self, node: dict) -> tuple[Value, str | None]:
        """The value of `node`, and the variable it was read from, if it was read."""
        kind, children = node.get("kind"), node.get("inner", [])
        if kind == "MaterializeTemporaryExpr" and len(children) == 1:
            # A hidden stack slot. It lies below every local declared so far, so it only
            # opens a gap in the drawn memory if a declaration follows: see `_analyze`.
            self.temporary = True
            return self.rvalue(children[0])
        if kind == "ExprWithCleanups" and len(children) == 1:
            return self.rvalue(children[0])
        if kind == "ImplicitCastExpr" and len(children) == 1:
            cast = node.get("castKind")
            if cast == "LValueToRValue":
                _depth(node, self.records)
                name = self.lvalue(children[0])
                value = self._load(name)
                self._reduce("read", node, name=name, value=value)
                return value, name
            if cast == "NullToPointer" and _depth(node, self.records):
                literal = children[0]
                if literal.get("kind") == "CXXNullPtrLiteralExpr" or (
                        literal.get("kind") == "IntegerLiteral" and literal.get("value") == "0"):
                    self._reduce("eval", node, value=Pointer())
                    return Pointer(), None
            if cast == "NoOp":
                return self.rvalue(children[0])
            _reject_pointer_operator(children[0])
            if cast == "IntegralCast":
                return self._convert(node, children[0]), None
            raise Unsupported(f"implicit {cast} conversions are outside this category")
        if kind == "CXXStaticCastExpr" and len(children) == 1:
            # Clang spells the conversion as implicit casts inside the written one: one step.
            operand = children[0]
            while (operand.get("kind") == "ImplicitCastExpr" and operand.get("castKind") in {"IntegralCast", "NoOp"}
                   and len(operand.get("inner", [])) == 1):
                operand = operand["inner"][0]
            return self._convert(node, operand), None
        depth = _depth(node, self.records)
        record = self.records.get(type_name(node)) if not depth else None
        if record:
            if kind == "CXXFunctionalCastExpr" and len(children) == 1:
                value, _ = self.rvalue(children[0])
                # The list is the typed literal's own value: one step, with the type kept.
                if children[0].get("kind") == "InitListExpr" and self.reductions[-1].value is value:
                    self.reductions.pop()
                self._reduce("eval", node, value=value, record=record.name)
                return value, None
            if kind == "InitListExpr":
                value = {}
                for item, child in zip(record.fields, children):
                    if child.get("kind") == "ImplicitValueInitExpr":
                        value[item["name"]] = _filled(item, self.records, zero=True)
                    elif child.get("castKind") == "IntegralCast":
                        # The list is one typed value: a part of it has no label to change.
                        raise Unsupported("a conversion inside a struct's braces is not supported")
                    else:
                        value[item["name"]], _ = self.rvalue(child)
                        # A list inside a list is part of the one value: it takes no step alone.
                        if child.get("kind") == "InitListExpr" and self.reductions[-1].value is value[item["name"]]:
                            self.reductions.pop()
                self._reduce("eval", node, value=value)
                return value, None
            if kind == "CXXConstructExpr":
                if not children:
                    return _filled(record, self.records), None
                if len(children) == 1:
                    return self.rvalue(children[0])
            if kind in {"DeclRefExpr", "MemberExpr"} or (
                    kind == "UnaryOperator" and node.get("opcode") == "*"):
                name = self.lvalue(node)
                value = self._load(name)
                if any(item is None for item in _flatten({name: value}).values()):
                    raise Unsupported(f"reading uninitialized struct {name}")
                self._reduce("read", node, name=name, value=value, record=record.name)
                return value, name
        if kind == "IntegerLiteral":
            return int(node["value"]), None
        if kind == "InitListExpr" or kind == "CXXFunctionalCastExpr":
            return self._braces(node, depth), None
        if kind == "ParenExpr" and len(children) == 1:
            value, _ = self.rvalue(children[0])
        elif kind == "UnaryOperator" and node.get("opcode") == "&" and len(children) == 1:
            if children[0].get("kind") not in {"DeclRefExpr", "MemberExpr"}:
                raise Unsupported("only the address of a variable is supported")
            name = self.lvalue(children[0])
            self._reduce("addr", node, name=name)
            return Pointer(name), None
        elif kind == "UnaryOperator" and node.get("opcode") in {"+", "-"} and len(children) == 1 and not depth:
            operand = self._integer_operand(children[0])
            value = _integer_type(node).result(operand if node["opcode"] == "+" else -operand)
        elif kind == "BinaryOperator" and node.get("opcode") in {"+", "-", "*", "/", "%"} and len(children) == 2:
            _reject_pointer_operator(node)
            value = self._arithmetic(_integer_type(node), node["opcode"], self._integer_operand(children[0]),
                                     self._integer_operand(children[1]))
        else:
            raise Unsupported(f"unsupported expression: {kind} {node.get('opcode', '')}".rstrip())
        self._reduce("eval", node, value=value)
        return value, None

    def _integer_operand(self, node: dict) -> int:
        value, _ = self.rvalue(node)
        if not isinstance(value, int):
            raise Unsupported("pointer arithmetic and comparison are not supported")
        return value

    def _convert(self, node: dict, operand: dict) -> int:
        """`operand` converted to the integer type of `node`, a cast written or implied."""
        _depth(node, self.records)
        target = _integer_type(node)
        if target is None or _integer_type(operand) is None:
            raise Unsupported("only conversions between integer types are supported")
        value = target.wrap(self._integer_operand(operand))
        source = displayed_type(operand)
        if source == displayed_type(node):
            # `static_cast<int>` of an int changes nothing: the cast just goes away.
            self._reduce("eval", node, value=value)
        else:
            self._reduce("convert", node, value=value, source=source)
        return value

    def _braces(self, node: dict, depth: int) -> Value:
        """`{}`, `{x}` and `int{}`; empty braces value-initialize to 0 or a null pointer."""
        children = node.get("inner", [])
        if node["kind"] == "CXXFunctionalCastExpr":
            if len(children) != 1 or children[0].get("kind") != "InitListExpr" or children[0].get("inner"):
                raise Unsupported("only empty int{} functional initialization is supported")
            value = 0
        elif len(children) > 1:
            raise Unsupported("multiple initializer elements are unsupported")
        elif children:
            value, _ = self.rvalue(children[0])
        else:
            value = Pointer() if depth else 0
        self._reduce("eval", node, value=value)
        return value

    @staticmethod
    def _arithmetic(type_: Integer, operation: str, left: int, right: int) -> int:
        if operation in {"/", "%"}:
            quotient = right and (abs(left) // abs(right)) * (-1 if (left < 0) != (right < 0) else 1)
            if right == 0 or not type_.holds(quotient):
                raise Unsupported("undefined integer division")
            return quotient if operation == "/" else left - quotient * right
        return type_.result({"+": left + right, "-": left - right, "*": left * right}[operation])


def _strip_parentheses(node: dict) -> dict:
    while node.get("kind") == "ParenExpr" and len(node.get("inner", [])) == 1:
        node = node["inner"][0]
    return node


def _operand_is_pointer(node: dict) -> bool:
    return "*" in node.get("type", {}).get("qualType", "")


def _reject_pointer_operator(node: dict) -> None:
    """Pointer arithmetic and comparison need array or address-order semantics: not drawn."""
    if node.get("kind") == "BinaryOperator" and (
            _operand_is_pointer(node) or any(map(_operand_is_pointer, node.get("inner", [])))):
        raise Unsupported("pointer arithmetic and comparison are not supported")


# Statements -------------------------------------------------------------------------------

@dataclass
class Statement:
    """One statement of main: its text, what it evaluates, and its effect on memory or output.

    `source` is the statement's text and `span` its evaluated part, for the code highlight.
    `pane` is the statement in the lessons' notation (`int b{ a };` reads `int b = a`); the
    other spans index it: `expr` is the evaluated part, `result` the expression whose value is
    written or printed, and `destination` the name of the written variable once reduced.
    Output is `result` followed by `output_suffix`; `printed` is set when `result` is not a
    value but whitespace output such as `std::endl`, and holds what it prints.
    `typed` lists the pane's typed parts before any reduction, as (span, type): names and
    literals. `slot` is the span of the declaration (`int* p`), whose type is `type`.
    """
    source: str
    span: tuple[int, int] | None
    pane: str
    expr: tuple[int, int] | None = None
    result: tuple[int, int] | None = None
    value: Value | None = None
    reductions: list[Reduction] = field(default_factory=list)
    target: str | None = None
    destination: tuple[int, int] | None = None
    declared: str | None = None
    pointer: bool = False
    record: str | None = None
    output_suffix: str | None = None
    printed: str | None = None
    temporary: bool = False
    # A reference declaration: `declared` is the reference and `bound` what it names for good.
    bound: str | None = None
    typed: list[tuple[tuple[int, int], str]] = field(default_factory=list)
    slot: tuple[int, int] | None = None
    type: str | None = None
    # The bytes a declared scalar takes.
    size: int | None = None


def _filled(item, records, zero: bool = False):
    """A field's (or a whole record's) value when nothing was written: unknown, or zeroed."""
    record = item if hasattr(item, "fields") else records[item["type"]] if item["kind"] == "struct" else None
    if record:
        return {inner["name"]: _filled(inner, records, zero) for inner in record.fields}
    return None if not zero else Pointer() if item["kind"] == "ptr" else 0


def _typed(node: dict, locate, names) -> list[tuple[tuple[int, int], str]]:
    """The parts of an expression that have a type before anything is evaluated: local names
    (a field access by `.` whole) and literals. Compound expressions get theirs when reduced."""
    kind, children = node.get("kind"), node.get("inner", [])
    plain = node
    while plain.get("kind") == "MemberExpr" and not plain.get("isArrow") and len(plain.get("inner", [])) == 1:
        plain = plain["inner"][0]
    local = plain.get("kind") == "DeclRefExpr" and plain.get("referencedDecl", {}).get("name") in names
    if local or kind in {"IntegerLiteral", "CXXNullPtrLiteralExpr"}:
        return [(locate(node), displayed_type(node))]
    return [part for child in children for part in _typed(child, locate, names)]


def _pane_parts(source: str, span: tuple[int, int], empty_initializer: bool) -> tuple[str, str]:
    """The context around an evaluated span, with brace initialization read as assignment."""
    start, end = span
    prefix, suffix = source[:start], source[end:].rstrip().removesuffix(";").rstrip()
    # Empty value-initialization keeps its real `{}` and becomes an assignment of it.
    if empty_initializer:
        prefix = prefix.rstrip() + ' = '
    if prefix.rstrip().endswith('{') and suffix.lstrip().startswith('}'):
        prefix = prefix.rstrip()[:-1].rstrip()
        prefix += ' ' if prefix.endswith('=') else ' = '
        suffix = suffix.lstrip()[1:]
    return prefix, suffix


def _cout_operands(node: dict) -> list[dict]:
    while node.get("kind") in {"ImplicitCastExpr", "ExprWithCleanups"} and len(node.get("inner", [])) == 1:
        node = node["inner"][0]
    if node.get("kind") == "DeclRefExpr" and node.get("referencedDecl", {}).get("name") == "cout":
        return []
    if node.get("kind") != "CXXOperatorCallExpr" or len(node.get("inner", [])) != 3:
        raise Unsupported("only std::cout insertion calls are supported")
    callee, left, right = node["inner"]
    while callee.get("kind") == "ImplicitCastExpr" and callee.get("inner"):
        callee = callee["inner"][0]
    if callee.get("referencedDecl", {}).get("name") != "operator<<":
        raise Unsupported("only stream insertion calls are supported")
    return _cout_operands(left) + [right]


def _strip_casts(operand: dict) -> dict:
    while operand.get("kind") == "ImplicitCastExpr" and operand.get("inner"):
        operand = operand["inner"][0]
    return operand


def _whitespace(operand: dict) -> str | None:
    """What `std::endl` or a whitespace character prints, or None for any other operand."""
    operand = _strip_casts(operand)
    if operand.get("referencedDecl", {}).get("name") == "endl":
        return "\n"
    if operand.get("kind") == "CharacterLiteral" and int(operand["value"]) in {9, 10, 32}:
        return chr(int(operand["value"]))
    return None


def _output_suffix(operands: list[dict]) -> str:
    suffix = ""
    for operand in operands:
        printed = _whitespace(operand)
        if printed is None:
            raise Unsupported("one integer output followed only by whitespace or endl is supported")
        suffix += printed
    return suffix


def _statement(node: dict, program: str, state: dict[str, Value | None], records,
               references: dict[str, str]) -> Statement:
    """Analyze one statement against the state before it."""
    while node.get("kind") == "ExprWithCleanups" and len(node.get("inner", [])) == 1:
        node = node["inner"][0]
    start, end = _bounds(node)
    if end < len(program) and program[end] == ";":
        end += 1
    source, mapping = _compact(program[start:end])
    left = declared = output_suffix = printed = root = name_offset = None
    whole = pointer = empty_initializer = reference = False
    record = size = None
    if node["kind"] == "DeclStmt":
        children = node.get("inner", [])
        if len(children) == 1 and children[0].get("kind") == "CXXRecordDecl":
            return Statement(source, None, source.removesuffix(";"))
        if len(children) != 1 or children[0].get("kind") != "VarDecl":
            raise Unsupported("one scalar declaration per statement is required")
        variable = children[0]
        if any(child.get("kind", "").endswith("Attr") for child in variable.get("inner", [])):
            raise Unsupported("declaration attributes need a separate memory-layout visualization")
        spelling = type_spelling(variable)
        reference = spelling.endswith("&")
        if reference:
            if spelling.endswith("&&"):
                raise Unsupported("rvalue references are not supported")
            # A reference to anything a variable may hold.
            _depth({"type": {key: text[:-1].rstrip() for key, text in variable["type"].items()}}, records)
        else:
            pointer = _depth(variable, records) > 0
            integer = _integer_type(variable)
            size = POINTER_SIZE if pointer else integer and integer.size
        record = type_name(variable) if not pointer and type_name(variable) in records else None
        declared = variable["name"]
        if declared.startswith("__course_") or declared in state or declared in references:
            raise Unsupported("unique variable names are required")
        if variable.get("storageClass") or variable.get("constexpr"):
            raise Unsupported("static and constexpr storage are outside this category")
        name_offset = variable.get("loc", {}).get("offset")
        if name_offset is None:
            raise Unsupported("macro-expanded declarations are not supported")
        children = variable.get("inner", [])
        root = children[0] if children else None
        # Nonempty declaration braces are surrounding statement context, not the value.
        if not record and root and root.get("kind") == "InitListExpr" and len(root.get("inner", [])) == 1:
            root = root["inner"][0]
        # Binding a reference to const adds no step.
        while reference and root and root.get("castKind") == "NoOp" and len(root.get("inner", [])) == 1:
            root = root["inner"][0]
        if record and root and root.get('kind') == 'CXXConstructExpr' and not root.get('inner'):
            pane = source.removesuffix(';')
            return Statement(source, None, pane, value=_filled(records[record], records),
                             target=declared, declared=declared, record=record,
                             slot=(0, len(pane)), type=displayed_type(variable))
        if record and root and root.get('kind') == 'CXXConstructExpr' and len(root.get('inner', [])) == 1:
            root = root['inner'][0]
        empty_initializer = bool(root) and root.get("kind") == "InitListExpr" and not root.get("inner")
    elif (node["kind"] == "BinaryOperator" and node.get("opcode") == "=") or (
            node["kind"] == "CXXOperatorCallExpr" and len(node.get("inner", [])) == 3
            and type_name(node) in records):
        left, root = node["inner"][-2:]
        _depth(left, records)
        if left.get("kind") == "ParenExpr" and _strip_parentheses(left).get("kind") == "DeclRefExpr":
            raise Unsupported("a parenthesized variable as assignment target is not supported")
        # A plain variable on the left is context; a dereference is evaluated with the rest,
        # and so is a reference, which first becomes the variable it names.
        whole = (left.get("kind") != "DeclRefExpr"
                 or left.get("referencedDecl", {}).get("name") in references)
    elif node["kind"] == "CXXOperatorCallExpr":
        operands = _cout_operands(node)
        if not operands:
            raise Unsupported("empty output expression")
        root, output_suffix = operands[0], _output_suffix(operands[1:])
        printed = _whitespace(root)
        if _strip_casts(root).get("kind") == "StringLiteral":
            raise Unsupported("string literal output is not supported")
        # `operator<<(const void*)` prints an address: the conversion to it is not a step.
        if (root.get("kind") == "ImplicitCastExpr" and root.get("castKind") == "BitCast"
                and type_spelling(root) == "const void *" and len(root.get("inner", [])) == 1):
            root = root["inner"][0]
    else:
        raise Unsupported(f"unsupported statement: {node['kind']}")

    if root is None:
        pane = source.removesuffix(";").rstrip()
        return Statement(source, None, pane, target=declared, declared=declared, pointer=pointer,
                         slot=(0, len(pane)), type=displayed_type(variable), size=size)
    first, last = (start, _bounds(node)[1]) if whole else _bounds(root)
    span = (mapping[first - start], mapping[last - start])
    prefix, suffix = _pane_parts(source, span, empty_initializer)
    text = source[slice(*span)]

    def to_pane(offset: int) -> int:
        position = mapping[offset - start]
        # The context before the evaluated part keeps its offsets; only its tail is rewritten.
        return position if position < span[0] else position - span[0] + len(prefix)

    def locate(item: dict) -> tuple[int, int]:
        return tuple(map(to_pane, _bounds(item)))

    if printed is not None:
        # Output that is no value (`std::endl`, `'\n'`) prints as it is spelled.
        if whitespace_output(text) != printed:
            raise Unsupported("whitespace output is supported as std::endl, '\\n', '\\t' or ' '")
        return Statement(source, span, prefix + text + suffix, (len(prefix), len(prefix) + len(text)),
                         locate(root), output_suffix=output_suffix, printed=printed)
    evaluator = _Evaluator(state, locate, records, references)
    names = state.keys() | references.keys()
    typed = sorted((_typed(left, locate, names) if left is not None else []) + _typed(root, locate, names))
    if reference:
        bound = evaluator.lvalue(root)
        if evaluator.temporary:
            raise Unsupported("a reference bound to a temporary is not supported")
        return Statement(source, span, prefix + text + suffix, (len(prefix), len(prefix) + len(text)),
                         locate(root), reductions=evaluator.reductions, declared=declared, bound=bound,
                         destination=(to_pane(name_offset), to_pane(name_offset) + len(declared)), typed=typed)
    target, destination, designation = declared, None, []
    if left is not None:
        # A reference on the left becomes the name it stands for before the right side is read
        # (`c = b` reads `a = b`); reading and following pointers there comes after.
        target, destination = evaluator.lvalue(left), locate(left)
        renamed = len(list(itertools.takewhile(lambda reduction: reduction.kind == "alias", evaluator.reductions)))
        evaluator.reductions, designation = evaluator.reductions[:renamed], evaluator.reductions[renamed:]
    value, _ = evaluator.rvalue(root)
    evaluator.reductions += designation
    slot = None
    if declared:
        destination = (to_pane(name_offset), to_pane(name_offset) + len(declared))
        slot = (0, destination[1])
    elif left is None and isinstance(value, dict):
        raise Unsupported("only integer and pointer output is supported")
    elif left is None and getattr(_integer_type(root), "size", None) == 1:
        raise Unsupported("std::cout prints a one-byte integer as a character")
    return Statement(source, span, prefix + text + suffix, (len(prefix), len(prefix) + len(text)),
                     locate(root), value, evaluator.reductions, target, destination, declared, pointer, record,
                     output_suffix, temporary=evaluator.temporary, typed=typed, slot=slot,
                     type=displayed_type(variable) if declared else None, size=size)


def _load(state, name, missing=False):
    owner, *path = name.split('.')
    value = state.get(owner) if missing else state[owner]
    for member in path:
        value = value[member]
    return value


def _flatten(state):
    """Every leaf by dotted name; nested structs flatten all the way down."""
    cells = {}
    for name, value in state.items():
        if isinstance(value, dict):
            cells.update(_flatten({name + '.' + member: item for member, item in value.items()}))
        else:
            cells[name] = value
    return cells


def _stored_at(value, path: list[str], new):
    """`value` with the member at `path` replaced; no shared structure is modified."""
    if not path:
        return new
    return dict(value, **{path[0]: _stored_at(value[path[0]], path[1:], new)})


def _after(statement: Statement, state: dict[str, Value | None]) -> dict[str, Value | None]:
    after = dict(state)
    if statement.target is not None:
        owner, *path = statement.target.split('.')
        after[owner] = _stored_at(after.get(owner), path, statement.value)
    return after


_PREAMBLE = "#include <iostream>\n#include <cstdint>\nusing namespace std;\nint main() {\n"
# Clang's ways of saying that a value of one type cannot be stored where another is needed.
_MISMATCHES = tuple(map(re.compile, (
    r"cannot initialize a variable of type '(?P<to>[^']+)' with an? \w+ of type '(?P<from>[^']+)'",
    r"assigning to '(?P<to>[^']+)' from (?:incompatible type )?'(?P<from>[^']+)'",
    r"no viable conversion from '(?P<from>[^']+)' to '(?P<to>[^']+)'")))


@dataclass(frozen=True)
class Mismatch:
    """A last statement that does not compile because its value does not fit its slot.

    `source` is the statement and `span` its value, for the code highlight; `pane` is the
    statement in the lessons' notation, `slot` and `value` its two typed parts there.
    """
    source: str
    span: tuple[int, int]
    pane: str
    slot: tuple[int, int]
    value: tuple[int, int]
    needed: str
    given: str


def _mismatch(body: str, error: IllFormed) -> tuple[str, Mismatch]:
    """Split a body whose last statement is a type mismatch into what runs and the mismatch.

    Clang reports the value, or the declared name when the value follows `=`; everything before
    the value, up to the previous statement, is the slot.
    Any other error, or one that is not in the last statement, stays unsupported.
    """
    found = next(filter(None, (pattern.search(str(error)) for pattern in _MISMATCHES)), None)
    at = None if error.offset is None else error.offset - len(_PREAMBLE)
    if not found or at is None or not 0 <= at < len(body):
        raise error
    end = body.find(";", at)
    start = max(body.rfind(";", 0, at), body.rfind("}", 0, at)) + 1
    if end < 0 or not re.fullmatch(r"\s*(?:return\s+0\s*;\s*)?", body[end + 1:]) or not body[:start].strip():
        raise error
    start += len(body[start:at]) - len(body[start:at].lstrip())
    if not body[start:at].rstrip().endswith(("=", "{")):
        assigned = re.match(r"\w+\s*=\s*", body[at:end])
        if not assigned:
            raise error
        at += assigned.end()
    source, mapping = _compact(body[start:end + 1])
    braced = body[start:at].rstrip().endswith("{")
    value_end = body[at:end].rstrip().removesuffix("}").rstrip() if braced else body[at:end].rstrip()
    span = (mapping[at - start], mapping[at - start + len(value_end)])
    prefix, suffix = _pane_parts(source, span, False)
    slot = prefix.rstrip().removesuffix("=").rstrip()
    if suffix.strip() or not slot or '"' in source or "'" in source:
        raise error
    text = source[slice(*span)]
    return body[:start], Mismatch(source, span, prefix + text, (0, len(slot)), (len(prefix), len(prefix) + len(text)),
                                  displayed(found["to"]), displayed(found["from"]))


def _analyze(source: str, directory: Path) -> tuple[list[Statement], dict]:
    program = _PREAMBLE + source + "\n}\n"
    ast = _main_ast(program, directory)
    records = layouts(ast, directory)
    statements, state, references = [], {}, {}
    for node in ast.get("inner", []):
        if node.get("kind") == "ReturnStmt":
            children = node.get("inner", [])
            if (len(children) == 1 and children[0].get("kind") == "IntegerLiteral"
                    and children[0].get("value") == "0" and node is ast["inner"][-1]):
                continue
            raise Unsupported("only a final return 0 is supported")
        statement = _statement(node, program, state, records, references)
        if statement.declared and any(earlier.temporary for earlier in statements):
            # The temporary's hidden slot would sit between the named locals.
            raise Unsupported("a declaration after a materialized temporary needs a separate memory-layout visualization")
        statements.append(statement)
        if len(statements) > MAX_STATEMENTS:
            raise Unsupported("too many statements")
        state = _after(statement, state)
        if statement.bound:
            references[statement.declared] = statement.bound
        if len(state) > MAX_VARIABLES:
            raise Unsupported("too many variables")
    if not state:
        raise Unsupported("a variable timeline requires at least one variable")
    return statements, records


# Memory -----------------------------------------------------------------------------------

def _normalize(addresses: dict[str, int], sizes: dict[str, int]) -> dict[str, int]:
    """Shift real addresses so the lowest sits at 64, keeping every alignment."""
    alignment = max(sizes.values())
    lowest = min(addresses.values())
    base = lowest - lowest % alignment
    return {name: FIRST_ADDRESS + address - base for name, address in addresses.items()}


def _without_reference_slots(real: dict[str, int], variables: list[dict]) -> dict[str, int]:
    """Addresses with the hidden slots of references closed up.

    At -O0 every reference takes a pointer-sized stack slot among the locals. The program
    cannot name it, and the lessons call a reference another name, so memory is drawn
    without it: the variables keep their order and sit as they would with no reference.
    """
    packed = storage_addresses(variables)
    names = [variable["name"] for variable in variables]
    if sorted(names, key=real.get) != sorted(names, key=packed.get):
        raise Unsupported("runtime order of the variables disagrees with their declarations")
    return packed


def _observed(execution: Execution, predicted: list[dict], variables: list[dict],
              references: dict[str, str]):
    """Check every live leaf, including unchanged fields, against GDB after each statement.

    A struct and its first field can share an address. Keep the statically typed target and
    verify its address rather than trying to recover an ambiguous target from that number.
    """
    cells, addresses = leaves(variables), {}
    owners, offsets = {variable['name']: variable for variable in variables}, storage_addresses(variables)
    # A reference is observed as the address of what it names; the rest are storage.
    bindings = [{name: cell for name, cell in row.items() if cell.reference} for row in execution.checkpoints]
    checkpoints = [{name: cell for name, cell in row.items() if not cell.reference}
                   for row in execution.checkpoints]
    for row in checkpoints:
        for name, cell in row.items():
            if cell.size != cells[name]['size'] or cell.pointer != (cells[name]['kind'] == 'ptr'):
                raise Unsupported(f'runtime storage of {name} disagrees with Clang')
            if addresses.setdefault(name, cell.address) != cell.address:
                raise Unsupported('variable address changed during the trace')
            owner, _, member = name.partition('.')
            if member:
                offset = offsets[name] - offsets[owner]
                base = cell.object_address
                if (cell.object_size != owners[owner]['size'] or cell.address != base + offset
                        or addresses.setdefault(owner, base) != base):
                    raise Unsupported(f'runtime field offset of {name} disagrees with Clang')
    # A nested struct is no cell of its own: it sits at its offset in the observed object.
    for name, offset in offsets.items():
        owner = name.partition('.')[0]
        if owner in addresses:
            addresses.setdefault(name, addresses[owner] + offset - offsets[owner])
    for row in bindings:
        for name, cell in row.items():
            if cell.address != addresses.get(references.get(name)):
                raise Unsupported(f'runtime verification failed: the reference {name} disagrees')
    for row, expected in zip(checkpoints, predicted):
        expected = _flatten(expected)
        if row.keys() != expected.keys():
            raise Unsupported('runtime verification failed: incomplete frame')
        for name, value in expected.items():
            bits = addresses[value.target] if isinstance(value, Pointer) and value.target else (
                0 if isinstance(value, Pointer) else value)
            if row[name].value != bits:
                if isinstance(value, Pointer) and row[name].value and row[name].value not in addresses.values():
                    raise Unsupported(f'runtime value of {name} is not the address of a variable')
                raise Unsupported(f'runtime verification failed: {name} disagrees')
    return addresses, predicted


# Rendering --------------------------------------------------------------------------------

def _spaceless(text: str) -> str:
    return re.sub(r"\s+", "", text)


class _Pane:
    """The pane as reductions replace parts of its original text, innermost first."""

    def __init__(self, text: str, typed=(), slot=None):
        self.original, self.edits = text, []  # (start, end, text) in original coordinates
        # The typed parts, as (start, end, type) in original coordinates; `slot` is one of them.
        self.typed, self.slot = [(*span, type_) for span, type_ in typed], slot

    @property
    def types(self) -> list[dict]:
        """The typed parts of the current text, in order."""
        return [{"span": self.locate(start, end), "type": type_, **({"slot": True} if (start, end) == self.slot else {})}
                for start, end, type_ in sorted(self.typed)]

    def retype(self, start: int, end: int, type_: str | None) -> None:
        """The original `[start, end)` is now one value of `type_`: its parts are no longer.
        Inside a typed part (the `rs` of `rs.f`) nothing changes: the part keeps its type."""
        if any(begin <= start and end <= finish and (begin, finish) != (start, end) for begin, finish, _ in self.typed):
            return
        kept = type_ or next((old for begin, finish, old in self.typed if (begin, finish) == (start, end)), None)
        self.typed = [part for part in self.typed if not (start <= part[0] and part[1] <= end)]
        if kept:
            self.typed.append((start, end, kept))

    @property
    def text(self) -> str:
        parts, cursor = [], 0
        for start, end, new in self.edits:
            parts += [self.original[cursor:start], new]
            cursor = end
        return "".join(parts) + self.original[cursor:]

    def locate(self, start: int, end: int) -> list[int]:
        """Where the original `[start, end)` lies in the current text."""
        def shift(at):
            return at + sum(len(new) - (finish - begin) for begin, finish, new in self.edits if finish <= at)
        return [shift(start), shift(end)]

    def read(self, start: int, end: int) -> str:
        """The current text of the original `[start, end)`."""
        first, last = self.locate(start, end)
        return self.text[first:last]

    def replace(self, start: int, end: int, new: str, type_: str | None = None) -> list[int]:
        """Replace the original `[start, end)`; returns the span it covered in the old text.
        The new text has `type_`, or keeps the type the span had as a whole."""
        span = self.locate(start, end)
        self.retype(start, end, type_)
        self.edits = sorted([edit for edit in self.edits if not (start <= edit[0] and edit[1] <= end)]
                            + [(start, end, new)])
        return span


class _Renderer:
    """Turns analyzed statements and their (observed) states into unified trace steps."""

    def __init__(self, addresses: dict[str, int], cells=None, real: dict[str, int] | None = None,
                 references: bool = False, types: bool = False):
        self.addresses = addresses
        # Types are drawn only where an example asks for them: elsewhere they are noise.
        self.types = types
        # What each reference is bound to so far; steps carry it only in a trace with references.
        self.refs = {} if references else None
        self.order = sorted(cells or addresses, key=addresses.get)
        self.steps, self.stdout = [], ""
        # What the program really prints: the same, but with the run's own addresses.
        self.real, self.real_stdout = real or addresses, ""

    def printed(self, pointer: Pointer, addresses: dict[str, int]) -> str:
        """A pointer as `std::cout` prints it; the trace pads the normalized address to 8 bytes."""
        if pointer.target is None:
            return "0"
        address = addresses[pointer.target]
        return f"{address:#x}" if addresses is self.real and self.real is not self.addresses else f"0x{address:016x}"

    def show(self, value: Value) -> str:
        """A value as the pane writes it: a number, an address, or 0 for a null pointer."""
        if isinstance(value, dict):
            return "{" + ", ".join(self.show(item) for item in value.values()) + "}"
        return str(self.stored(value))

    def stored(self, value: Value) -> int:
        if isinstance(value, Pointer):
            return self.addresses[value.target] if value.target else 0
        if abs(value) > MAX_EXACT:
            raise Unsupported("integers beyond 2^53 are not drawn exactly")
        return value

    def add(self, line: int, pane: _Pane, expr, state: dict, op=None, hold: float = 1.0) -> None:
        state = _flatten(state)
        values = {name: None if name not in state else UNKNOWN if state[name] is None
                  else self.stored(state[name]) for name in self.order}
        targets = {name: value.target for name, value in state.items()
                   if isinstance(value, Pointer) and value.target}
        step = {"line": line, "pane": pane.text, "op": op, "stdout": self.stdout, "hold": hold,
                "values": values, "targets": targets}
        if expr:
            step["expr"] = pane.locate(*expr)
        if self.types and pane.types:
            step["types"] = pane.types
        if self.refs is not None:
            step["refs"] = dict(self.refs)
        self.steps.append(step)

    def statement(self, line: int, statement: Statement, before: dict, after: dict) -> None:
        typed = statement.typed + ([(statement.slot, statement.type)] if statement.slot else [])
        pane, expr = _Pane(statement.pane, typed, statement.slot), statement.expr
        writes = statement.target is not None and statement.result is not None
        self.add(line, pane, expr, before if writes else after)
        for reduction in statement.reductions:
            if reduction.kind == "read":
                text = (reduction.record or "") + self.show(_load(before, reduction.name))
                op = {"kind": "read", "name": reduction.name, "value": text}
            elif reduction.kind == "addr":
                text = str(self.addresses[reduction.name])
                op = {"kind": "addr", "name": reduction.name, "value": text}
            elif reduction.kind == "alias":
                text = reduction.spelling
                op = {"kind": "alias", "name": reduction.name, "target": text}
            elif reduction.kind == "deref":
                # The target is where the pointer's observed value points.
                text = (reduction.value or _load(before, reduction.name)).target
                op = {"kind": "deref", "target": text, "via": reduction.name}
            elif reduction.kind == "convert" and self.types:
                text = self.show(reduction.value)
                op = {"kind": "convert", "value": text, "from": reduction.source, "to": reduction.type}
            else:
                text = reduction.spelling or (reduction.record or "") + self.show(reduction.value)
                op = {"kind": "eval", "value": text}
                # A brace list of plain values is already its value, however it is spaced.
                if isinstance(reduction.value, dict) and _spaceless(pane.read(*reduction.span)) == _spaceless(text):
                    text = pane.read(*reduction.span)
            # A typed conversion is a step even when the digits stay: the type is what changes.
            # Untyped, it is an evaluation like any other, seen only when the text changes.
            if pane.read(*reduction.span) != text or op["kind"] == "convert":
                op["span"] = pane.replace(*reduction.span, text, reduction.type)
                self.add(line, pane, expr, before, op)
            else:
                # No step of its own, but the text now reads as one value of its type.
                pane.retype(*reduction.span, reduction.type)
                if self.types:
                    self.steps[-1]["types"] = pane.types
        if statement.result is None:
            return
        if statement.bound:
            self.refs[statement.declared] = statement.bound
            op = {"kind": "bind", "name": statement.declared, "target": statement.bound,
                  "span": pane.locate(*statement.result), "destination": pane.locate(*statement.destination)}
            self.add(line, pane, expr, after, op, 1.2)
            return
        # A literal spelled otherwise (`0x10`, `1'000`) settles on its decimal value.
        if isinstance(statement.value, int) and pane.read(*statement.result) != str(statement.value):
            op = {"kind": "eval", "value": str(statement.value),
                  "span": pane.replace(*statement.result, str(statement.value))}
            self.add(line, pane, expr, before, op)
        span, text = pane.locate(*statement.result), pane.read(*statement.result)
        real = text
        if statement.printed is not None:
            real = text = statement.printed
        elif statement.output_suffix is not None and isinstance(statement.value, Pointer):
            # The stream formats an address in hexadecimal: one more step of the pane.
            text, real = self.printed(statement.value, self.addresses), self.printed(statement.value, self.real)
            if pane.read(*statement.result) != text:
                op = {"kind": "eval", "value": text, "span": pane.replace(*statement.result, text)}
                self.add(line, pane, expr, before, op)
                span = pane.locate(*statement.result)
        if statement.output_suffix is not None:
            self.real_stdout += real + statement.output_suffix
            self.stdout += text + statement.output_suffix
            self.add(line, pane, expr, after, {"kind": "print", "value": text, "span": span}, 1.2)
            return
        name, old = statement.target, _load(before, statement.target, missing=True)
        op = {"kind": "write", "name": name, "value": text, "span": span,
              "destination": pane.locate(*statement.destination)}
        # Redirecting a pointer holds longer, so the moved arc registers.
        redirected = isinstance(old, Pointer) and old.target and old != _load(after, name)
        self.add(line, pane, expr, after, op, 1.6 if redirected else 1.2)

    def mismatch(self, line: int, mismatch: Mismatch, state: dict) -> None:
        """The statement as written, then its value's type against the type its slot needs."""
        pane = _Pane(mismatch.pane, [(mismatch.slot, mismatch.needed), (mismatch.value, mismatch.given)], mismatch.slot)
        self.add(line, pane, mismatch.value, state)
        op = {"kind": "clash", "span": list(mismatch.value), "destination": list(mismatch.slot),
              "from": mismatch.given, "to": mismatch.needed}
        self.add(line, pane, mismatch.value, state, op)


def trace(source: str, *, runtime: bool = True, types: bool = False) -> dict:
    """Trace a snippet into a validated unified-format trace, rejecting unsupported constructs.

    With `runtime=False` (probing) nothing is executed: values are the predicted ones and the
    layout is Clang's usual -O0 layout. With `types`, the pane and memory carry types, a
    conversion is a step of its own, and a last statement whose types do not fit is shown.
    """
    body, mismatch = _body(source), None
    with tempfile.TemporaryDirectory(prefix="course-expression-") as temporary:
        directory = Path(temporary)
        try:
            statements, records = _analyze(body, directory)
        except IllFormed as error:
            if not types:
                raise
            # A last statement whose types do not fit is shown, not run: the rest is traced.
            body, mismatch = _mismatch(body, error)
            statements, records = _analyze(body, directory)
        predicted, state = [], {}
        for statement in statements:
            state = _after(statement, state)
            predicted.append(state)
        declarations = [statement for statement in statements if statement.declared]
        variables, references, top, field_colors = [], {}, -8, {}
        for color, declaration in enumerate(declarations):
            name = declaration.declared
            if declaration.bound:
                references[name] = trace_reference(name, color)
                continue
            record = records.get(declaration.record)
            size = record.size if record else declaration.size
            alignment = record.alignment if record else size
            top = (top - size) // alignment * alignment
            if record:
                def fields_of(record):
                    fields = []
                    for item in record.fields:
                        shade = field_colors.setdefault(item['name'], len(field_colors))
                        if item['kind'] == 'struct':
                            fields.append(struct_field(item['name'], item['type'], item['offset'], item['size'],
                                                       fields_of(records[item['type']]), shade))
                        else:
                            fields.append(trace_field(**item, color=shade))
                    return fields
                variables.append(struct(name, record.name, top, size, fields_of(record), color))
            else:
                variables.append(scalar(name, top, size, 'ptr' if declaration.pointer else 'int', color,
                                        declaration.type if types else None))
        if runtime:
            scopes, bound = [], {}
            for statement, row in zip(statements, predicted):
                if statement.bound:
                    bound[statement.declared] = statement.bound
                scopes.append([(name, value is not None) for name, value in _flatten(row).items()]
                              + [(name, REFERENCE) for name in bound])
            execution = execute([statement.source for statement in statements], scopes, directory)
            addresses, states = _observed(execution, predicted, variables, bound)
        else:
            addresses, states = storage_addresses(variables), predicted
        real = addresses
        if references:
            addresses = _without_reference_slots(addresses, variables)
        # Shift by ABI alignment, never by a struct's total size (which need not be a power of 2).
        alignment = max([record.alignment for record in records.values()] +
                        [d.size for d in declarations if not d.record and not d.bound] + [4])
        addresses = _normalize(addresses, {"ABI": alignment})
        for variable in variables:
            variable['address'] = addresses[variable['name']]
        variables.sort(key=lambda variable: variable['address'])
    # Struct definitions are compiled and run but are not steps: the player shows them on
    # hover over the type, as written in the lesson.
    shown = [(statement, after) for statement, after in zip(statements, states)
             if not _DEFINITION.match(statement.source)]
    if not shown:
        raise Unsupported("a snippet of only struct definitions has nothing to step through")
    renderer, previous = _Renderer(addresses, leaves(variables), real, bool(references), types), {}
    for line, (statement, after) in enumerate(shown):
        renderer.statement(line, statement, previous, after)
        previous = after
    if runtime and renderer.real_stdout != execution.stdout:
        raise Unsupported("runtime output disagrees with the expression trace")
    shown = [statement for statement, _ in shown]
    if mismatch:
        renderer.mismatch(len(shown), mismatch, previous)
        shown.append(mismatch)
    renderer.steps[-1]["hold"] = 3
    result = {"format": FORMAT, "source": [statement.source for statement in shown],
              "spans": [list(statement.span) if statement.span else None for statement in shown],
              "variables": variables, "steps": renderer.steps}
    types = _definitions(body)
    if types:
        result["types"] = types
    if references:
        result["references"] = list(references.values())
    try:
        validate(result)
    except FormatError as exc:
        # A tracer defect must still fail closed, never publish a malformed trace.
        raise Unsupported(f"the tracer produced an invalid trace: {exc}") from exc
    return result
