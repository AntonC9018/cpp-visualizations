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
  `settings.ts` lists the templates and flags a trace can be asked for, and `snippet.ts`
  traces a snippet with them: the one entry point of the command line and the browser.
- `src/node/` holds the native Clang adapter and CLI implementations
  (`toolchain.ts`, `records.ts`, `layout.ts`, `tracing.ts`, `generate.ts`,
  `discover.ts`, `fixtures.ts`, `demo.ts`).
- `src/player/` holds the modular TypeScript browser player (`constants.ts`, `svg.ts`,
  `model.ts`, `geometry.ts`, `scene.ts`, `player_view.ts`, `layout_view.ts`, `index.ts`), bundled
  by Vite into `player/player.js`.
- `src/browser/` holds the browser Clang WASM runtime and interactive playground (`wasi.ts`,
  `wasm_frontend.ts`, `cache.ts`, `worker.ts`, `client.ts`, `presets.ts`, `playground_url.ts`,
  `playground.ts`), bundled into
  `player/clang-worker.js` and `player/playground.js`.
- `wasm/` holds the trimmed Clang 21 WASM frontend (`clang-trace-frontend.cpp`, WASI compatibility
  shims, and `build.sh` producing the bundled `player/clang-trace-frontend.wasm`).
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
their original targets. Fields must be supported integers, `float`, `double`, pointers (including
`void*`), another struct of the snippet by value, or `std::array`. A nested struct is copied,
assigned and initialized as a whole
(`a.inner = { 5 };`), and its fields are reached by path (`a.inner.x`, `p->inner.x`,
`&a.inner.x`). Clang verifies the value of each initialized field after every statement. The player draws
struct frames, a nested struct as a frame inside its owner's, per-field colours and separate
arc endpoints for objects and fields.

Execution traces support `std::array<T, N>` with 1–32 elements per dimension and up to
64 scalar cells per array. Elements may be supported integers, `float`, `double`, pointers, structs, or arrays.
Arrays can be struct fields. The tracer handles aggregate initialization, copies, assignments,
indexed reads and writes, `.size()`, and `.data()` for obtaining a pointer to the first element.
References can bind to an array or an element. The player draws an indexed frame, walks through
nested accesses, and shows an element's address while a pointer targets it or the expression
takes its address. The array variable's starting address is always shown.

A reference (`int& c = a;`, `auto&`, `const int&`, to a variable, a field, a struct, a pointer or
what a pointer points to) is another name for storage, as the lessons put it. Binding it is one
step; wherever its name is used afterwards, the name first becomes what it stands for
(`c = 2` → `a = 2`). At `-O0` the compiler keeps a hidden pointer-sized slot per reference; the
program cannot name it, so memory is drawn without it, with the variables in their real order.
Clang checks each binding when it is made.

Output prints one integer, floating-point or pointer value followed only by whitespace (`' '`, `'\t'`, `'\n'`) or
`std::endl`. A statement of whitespace alone, such as `std::cout << std::endl;`, prints it as
spelled; flushing is not shown. A pointer prints its normalized address as 8 bytes of
hexadecimal (`64` → `0x0000000000000040`), one more step of the pane. Nothing runs the
program, so no real address exists: Clang's constant evaluation checks which object the
pointer designates. A null pointer prints `0`. A string
literal or another character is rejected.

Integers of every width are values: `int`, `short`, `long`, `long long`, their unsigned kinds
and the aliases over them (`uint8_t`, `int16_t`, `size_t`), each drawn at its own size.
`float` (4 bytes) and `double` (8 bytes) values and arithmetic (`+`, `-`, `*`, `/`), `void*`
pointers (with implicit conversions to `void*` and `static_cast` to or from `void*`), and
`sizeof` on supported types and expressions are also supported.
A conversion between numeric or pointer types is one step, whether it is written (`static_cast<uint8_t>(a)`, `static_cast<double>(seven)`)
or implied: an initializer or assignment of another type, and the promotion of an operand
before arithmetic (`a + a` on `uint8_t` adds two `int`s, `~a` flips the 32 bits of an `int`).
An integer conversion keeps its low bits, so `256` becomes `0` as `uint8_t` and `-2` becomes `65534` as
`uint16_t`. `static_cast` to the type the value already has only goes away.
Unsigned arithmetic wraps; signed overflow and non-finite floating-point division are undefined and rejected.
`char` and `bool` are not supported, a one-byte integer cannot be
printed (the stream prints a character), and neither can an integer beyond 2^53, which the player
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

`--bits` (the tag's `bits` attribute) is for examples about how integers are stored: it implies
`--types` and draws every integer as its bytes and bits. Memory shows each value above its
bytes in hex, and the player gets a Little-endian / Big-endian switch for their order. Under
the pane a row of bits follows each value and conversion: narrowing strikes out the dropped
bytes, and widening a signed value carries its sign bit into the new bytes while widening an
unsigned one fills zeros. Only integer variables are taken; floats, pointers, structs, arrays and
references are rejected.

A brace list of plain values (`A a { 1, 2 };`) is stored as spelled, with no step that only
respaces it, and so is a typed one (`A{ 1, 2 }`); a designated list evaluates to its values.
A struct value with a type of its own keeps it in the pane: a typed literal, and a struct that
is read (`b = a` becomes `b = A{1, 2}`).

Pointer arithmetic/comparison, C arrays, rvalue references, references bound to temporaries,
casts other than `static_cast`,
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

Clang's token stream and AST provide the structure of the snippet. Constant evaluation provides
numeric reductions and verifies each initialized scalar, struct field and pointer target after
each statement. The player uses illustrative addresses and Clang's sizes and field offsets.
Writes that leave a value unchanged, such as in the failed swap, still appear in the timeline.

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
The view lists the fields, then draws the struct's bytes as one tape with each field's name
above its bytes. Padding appears in the list as `padding ×N` rows and on the tape as hatched
bytes. Alignment is shown only when it inserted padding: `alignof = max(field sizes)`, slot
edges on the tape and offsets at each slot; otherwise the offsets mark where fields start.
Hover, click or keyboard focus links a field's row, name and bytes; `struct` and `sizeof`
highlight the whole object, `alignof` the widest fields. Theme changes preserve focus.

Constant evaluation supports casting from `void*` back to the pointee's original type.
Casting it to a different pointee type is outside the trace category.

## Toolchain and tests

The flake pins the tools. A host repository that traces in CI keeps a flake of its own
with the same shells so that its lock decides when its traces are stale.
`nix develop .#visualizations` provides Clang with C++ standard headers and Node.
CI uses the same shell.
The default shell (`nix develop`) adds Chromium for headless screenshots of the demo.
Both shells set `CLANGXX` to the pinned compiler.

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
against the Clang 21 WASM frontend at `player/clang-trace-frontend.wasm`. The worker downloads
the checked-in module and stores it in the browser Cache API
(`clang-trace-frontend-v<WASM_VERSION>`), deleting the caches of earlier versions.

Rebuild the module with LLVM 21.1.8 sources, host TableGen tools and WASI clang. When using a
pristine LLVM source tarball, apply the WASI executable-path patch in the source tree first.

```sh
patch -d /path/to/llvm-project-21.1.8.src -p1 < wasm/llvm-wasi.patch
JOBS=4 ./wasm/build.sh
```

`wasm/build.sh` accepts paths to the sources and tools through its environment variables.
Bump `WASM_VERSION` in `src/browser/cache.ts` with every rebuilt binary.

The playground and `generate.mjs trace` share the tracer and use Clang's AST and constant
evaluator. The playground runs its compiler in WASM with virtual headers for `<iostream>`,
`<cstdint>`, `<cstddef>` and `<array>`. Template and flag settings are kept in the URL as
`?template=expression-timeline&types=1`.

Override the compiler binary URL via `?wasm=https://.../clang-trace-frontend.wasm`,
`data-wasm-url` on `#playground-root`, or `window.CoursePlaygroundConfig.wasmUrl`.

## Adding a template or flag

A trace is asked for with a template and flags, listed once in `src/core/settings.ts`. A lesson
tag spells them as attributes (`<visualization template="layout">`, `<visualization types>`),
which maintenance passes through as `--template layout` and `--types` without knowing them;
`generate.mjs`, `discover.mjs`, the worker and the playground read the same list.

To add a flag, list it in `FLAGS` with the templates that take it and its playground label,
then read it in the tracer: `TraceOptions` takes every listed flag, so `traceWithFrontend`
receives it as an option. The command-line option, the tag attribute, the playground's toggle
and its URL parameter follow. A new template also needs its function in `snippet.ts`, which the
compiler asks for. `tests/settings.test.ts` checks that every template and flag reaches each
entry point and has a playground preset, so the WASM parity test traces it.

## Interactivity in Markdown

GitHub removes JavaScript from rendered repository markup ([GitHub markup]), so the player runs
only on the course website.

[GitHub markup]: https://github.com/github/markup#github-markup
