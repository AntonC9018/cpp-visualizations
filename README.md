# Execution visualizations for C++

Show how C++ examples execute: code on the left, memory above an expression-evaluation
pane on the right, values moving between them. A compiler-backed tracer produces the traces;
a dependency-free browser player steps through them.

The templates were built for the [course] (epic [#50], integration design in [#55] and [#56])
and are meant to be mounted as a git submodule at `visualizations/`:

```sh
git submodule add https://github.com/AntonC9018/cpp-visualizations visualizations
```

The commands below are written from this repository's root;
from a host repository, prefix the paths with `visualizations/`.

- `src/core/` holds the isomorphic TypeScript tracer and trace format (`errors.ts`,
  `json_format.ts`, `trace_format.ts`, `records.ts`, `layout.ts`, `tracing.ts`), decoupled from
  Node APIs so the same AST and layout logic can run in Node or a browser Web Worker.
- `src/node/` holds the Node toolchain, GDB runtime verification, and CLI implementations
  (`toolchain.ts`, `execution.ts`, `records.ts`, `layout.ts`, `tracing.ts`, `generate.ts`,
  `discover.ts`, `fixtures.ts`, `demo.ts`).
- `src/player/` holds the modular TypeScript browser player (`constants.ts`, `svg.ts`,
  `model.ts`, `geometry.ts`, `scene.ts`, `player_view.ts`, `layout_view.ts`, `index.ts`), bundled
  by Vite into `player/player.js`.
- `src/browser/` holds the browser Clang WASM runtime and interactive playground (`wasi.ts`,
  `wasm_frontend.ts`, `cache.ts`, `worker.ts`, `client.ts`, `playground.ts`), bundled into
  `player/clang-worker.js` and `player/playground.js`.
- `wasm/` holds the trimmed Clang 21 WASM frontend (`clang-trace-frontend.cpp`, WASI compatibility
  shims, and `build.sh` producing the git-ignored `player/clang-trace-frontend.wasm`).
- `discover.mjs` lists the lesson examples the tracer supports and tags the ones chosen by hand.
- `generate.mjs` is the command line maintenance uses: `trace`, `probe` and `revision`.
- `player/` holds the bundled site engine (`player.js`, `player.css`), the browser playground
  (`playground.html`, `playground.css`, `playground.js`, `clang-worker.js`), the manual pointer
  and struct fixtures, and a local demo. [`player/README.md`](player/README.md) documents the
  engine and the format.

[course]: https://github.com/AntonC9018/uniCourse_dataStructuresAndAlgorithms
[course maintenance]: https://github.com/AntonC9018/course_maintenance
[#50]: https://github.com/AntonC9018/uniCourse_dataStructuresAndAlgorithms/issues/50
[#55]: https://github.com/AntonC9018/uniCourse_dataStructuresAndAlgorithms/issues/55
[#56]: https://github.com/AntonC9018/uniCourse_dataStructuresAndAlgorithms/issues/56
[#62]: https://github.com/AntonC9018/uniCourse_dataStructuresAndAlgorithms/issues/62

## Tracing lesson examples

`discover.mjs` inventories all outside-answer C++ fences under the configured lab roots. Clang
checks syntax and types; an AST whitelist accepts flat integer, pointer and aggregate struct
examples.
Address-of, dereference chains, pointer reads/copies, shared targets and reassignment through
pointers are supported, including pointers to pointers. Null pointers are stored and reduced
to `0`. The pane follows lesson notation: `**pp` → `**72` → `*p` → `*64` → `a`.

Structs support aggregate and designated initialization, uninitialized field storage, whole-object
copies, `.` and `->`, field addresses and pointer fields. Copies are shallow: pointer fields keep
their original targets. Fields must be `int`, pointers to `int`, another struct of the snippet by
value, or pointers to one. A nested struct is copied, assigned and initialized as a whole
(`a.inner = { 5 };`), and its fields are reached by path (`a.inner.x`, `p->inner.x`,
`&a.inner.x`). Every live field is checked under GDB after every statement. The player draws
struct frames, a nested struct as a frame inside its owner's, per-field colours and separate
arc endpoints for objects and fields.

A reference (`int& c = a;`, `auto&`, `const int&`, to a variable, a field, a struct, a pointer or
what a pointer points to) is another name for storage, as the lessons put it. Binding it is one
step; wherever its name is used afterwards, the name first becomes what it stands for
(`c = 2` → `a = 2`). At `-O0` the compiler keeps a hidden pointer-sized slot per reference; the
program cannot name it, so memory is drawn without it, with the variables in their real order.
GDB checks every binding after every statement.

Output prints one integer or pointer value followed only by whitespace (`' '`, `'\t'`, `'\n'`) or
`std::endl`. A statement of whitespace alone, such as `std::cout << std::endl;`, prints it as
spelled; flushing is not shown. A pointer prints its normalized address as 8 bytes of
hexadecimal (`64` → `0x0000000000000040`), one more step of the pane; the run's real,
randomized address is checked but never published. A null pointer prints `0`. A string
literal or another character is rejected.

Integers of every width are values: `int`, `short`, `long`, `long long`, their unsigned kinds
and the aliases over them (`uint8_t`, `int16_t`, `size_t`), each drawn at its own size.
A conversion between two of them is one step, whether it is written (`static_cast<uint8_t>(a)`)
or implied: an initializer or assignment of another type, and the promotion of an operand
before arithmetic (`a + a` on `uint8_t` adds two `int`s, `~a` flips the 32 bits of an `int`).
The value keeps its low bits, so `256` becomes `0` as `uint8_t` and `-2` becomes `65534` as
`uint16_t`. `static_cast` to the type the value already has only goes away.
Unsigned arithmetic wraps; signed overflow is undefined and rejected.
`char`, `bool` and floating-point types are not supported, a one-byte integer cannot be
printed (the stream prints a character), and neither can a value beyond 2^53, which the player
could not draw exactly.

Types are shown only where an example asks for them, with `--types` (the tag's `types`
attribute): in an example that is not about types they are noise. Then every name, literal
and value in the pane carries its type, a declaration is the slot its value must fit, and
memory shows each variable's type. A conversion is a step of its own even when the digits
stay (`0` as `uint8_t` → `0` as `uint32_t`): the value's type label changes. When the last
statement does not compile because the types differ (`A** p{ value };`, `copy = p;` with a
struct `copy`), everything before it is traced and the statement is shown as a final step
that does not run: the value's type against the slot's.
Without `--types` a conversion is an evaluation like any other, a step only when the value
changes, and a statement that does not compile is rejected.

A brace list of plain values (`A a { 1, 2 };`) is stored as spelled, with no step that only
respaces it, and so is a typed one (`A{ 1, 2 }`); a designated list evaluates to its values.
A struct value with a type of its own keeps it in the pane: a typed literal, and a struct that
is read (`b = a` becomes `b = A{1, 2}`).

Pointer arithmetic/comparison, arrays, rvalue references, references bound to temporaries,
casts other than `static_cast` between integers, a conversion inside a struct's braces,
heap allocation,
other field types, methods, inheritance, bitfields, default member initializers, empty structs,
qualified pointers, control flow, ill-formed snippets and undefined reads or
arithmetic are skipped with explicit reasons. Computed-address dereferences (`*(&a)`) and
address-of dereferences (`&*p`) are also outside this subset. A plain literal-initialized
cell gets no visualization; empty initialization, value copies, arithmetic, assignments and
output do.

```sh
node discover.mjs --report /tmp/visualization-inventory.json
node discover.mjs --tag en/labs/cpp/05_struct.md:670 ru/labs/cpp/05_struct.md:674
node discover.mjs --types --tag en/labs/cpp/03_numeric_conversions.md:93
```

Without `--tag` discovery writes nothing: it lists the candidates. Traceable is not the same as
worth tracing, so a person or a model reading the lesson picks the examples where watching
memory change is the point, and leaves out those that teach something the trace does not show
(type deduction, a compile error, naming). `--tag` then adds a minimal tag for each pick, in a
collapsed, localized execution-trace block. With `--types` the examples are traced with types,
so a last statement whose types do not fit is a candidate as well, and the tags ask for types:
use it for examples that are about types, such as a conversion or a type-checking puzzle.
Course maintenance traces every tag in CI inside the pinned toolchain and stores the results by content, so only
changed examples are traced again; a tag that cannot be traced fails the build.

Generation uses Clang AST types and operation ranges to build expression reductions. GDB
verifies every post-statement value, output, storage size and frame location. Pointer targets
retain their typed object or field identity; GDB verifies their numeric addresses. Addresses
are normalized relative to observed stack offsets, aligned near 64, so no ASLR addresses are
published. Cells are ordered by address, so declaration order may differ from the source.
Unchanged-value writes, such as the failed swap, remain visible writes.

```sh
node generate.mjs probe --source /tmp/snippet.cpp
node generate.mjs trace --source /tmp/snippet.cpp
node generate.mjs trace --source /tmp/snippet.cpp --types
```

`trace` prints the unified format as deterministic JSON (sorted keys). `revision` hashes the
tracer modules (including record layouts) and the flake that pins the tools:
the host repository's when it has one, otherwise this repository's. Maintenance keys stored traces
by this revision, so a toolchain or format change re-traces every example.

## Static struct layouts

Place `<!-- <visualization template="layout"> -->` and `<!-- </visualization> -->` inside
an answer block. Maintenance uses the nearest preceding top-level C++ fence, just as for
execution traces. Plain tags retain the step-through player.

Both `probe --template layout` and `trace --template layout` use Clang without executing the
snippet. Plain aggregate fields may be `uint8_t`, `int8_t`, `int`, `size_t`, `uint64_t`
(including `std::` spellings), or pointers. Unsupported field types are rejected explicitly.
The slot grid shows byte offsets, padding, field sizes, struct size and alignment. Hover,
click or keyboard focus links field rows with their bytes; the definition and size rows
highlight the whole object. Theme changes preserve focus.

## Toolchain and tests

The flake pins the tools. A host repository that traces in CI keeps a flake of its own
with the same shells, so that its lock decides when its traces are stale. `nix develop .#visualizations` provides Clang with C++
standard headers, Python-enabled GDB and Node, which is all tracing needs; CI uses the same shell.
The default shell (`nix develop`) adds Chromium for headless screenshots of the demo.
`CLANGXX` and `GDB` select the tools; both shells set them.

```sh
nix develop .#visualizations --command npm run test:tracer
```

The player's browser tests, TypeScript typecheck, and Vite bundle build run in the default shell:

```sh
nix develop --command npm ci
nix develop --command npm run typecheck
nix develop --command npm run build
nix develop --command npm run test:player
nix develop --command npm run test:wasm
nix develop --command npm run dev
```

## Browser Clang WASM playground

`player/playground.html` runs the isomorphic tracer (`src/core/`) inside a dedicated Web Worker
against a trimmed Clang 21 WASM build (`player/clang-trace-frontend.wasm`, ~17 MB raw / ~4.2 MB
brotli). The worker downloads the module once, stores it in the browser Cache API
(`clang-trace-frontend-v1`), and reuses cached bytes across reloads without re-fetching.

`*.wasm` binaries are git-ignored; rebuild `player/clang-trace-frontend.wasm` from LLVM 21.1.8
sources with:

```sh
./wasm/build.sh
```

The playground runs the same tracer as `generate.mjs trace`, only without GDB; the compiler
under it is Clang built to WASM instead of the native one, and both give the same AST.
The **Types** toggle (`?types=1`) traces as `--types` and a tag's `types` attribute do, so a
last statement whose types do not fit is shown rather than reported as an error.

Override the compiler binary URL via `?wasm=https://.../clang-trace-frontend.wasm`,
`data-wasm-url` on `#playground-root`, or `window.CoursePlaygroundConfig.wasmUrl`.

## Interactivity in Markdown

GitHub removes JavaScript from rendered repository markup ([GitHub markup]), so the player runs
only on the course website.

[GitHub markup]: https://github.com/github/markup#github-markup
