#!/usr/bin/env bash
set -euo pipefail

# Reproducible build script for clang-trace-frontend.wasm (LLVM/Clang 21.1.8 -> wasm32-unknown-wasi).
# Produces a trimmed single-purpose C++20 AST/layout frontend matching x86_64-unknown-linux-gnu ABI.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

BUILD_DIR="${BUILD_DIR:-$SCRIPT_DIR/build}"
OUT_WASM="${OUT_WASM:-$ROOT_DIR/player/clang-trace-frontend.wasm}"
COMPAT_INC="$SCRIPT_DIR/wasi-compat-include"

find_nix_store() {
  local pattern="$1"
  local match
  match="$(ls -d /nix/store/*"$pattern"* 2>/dev/null | grep -v '\.drv$' | head -n 1 || true)"
  printf '%s' "$match"
}

LLVM_SRC="${LLVM_SRC:-$(find_nix_store 'llvm-src-21.1.8')}"
[[ -d "$LLVM_SRC/llvm" ]] && LLVM_SRC="$LLVM_SRC/llvm"
CLANG_SRC="${CLANG_SRC:-$(find_nix_store 'clang-src-21.1.8')}"
[[ -d "$CLANG_SRC/clang" ]] && CLANG_SRC="$CLANG_SRC/clang"

WASI_CLANG_PKG="${WASI_CLANG_PKG:-$(find_nix_store 'wasm32-unknown-wasi-clang-wrapper-21.1.8')}"
WASI_BINUTILS_PKG="${WASI_BINUTILS_PKG:-$(find_nix_store 'wasm32-unknown-wasi-llvm-binutils-wrapper-21.1.8')}"
LLD_PKG="${LLD_PKG:-$(find_nix_store 'lld-21.1.8')}"
LIBCXX_PKG="${LIBCXX_PKG:-$(find_nix_store 'libcxx-static-wasm32-unknown-wasi-21.1.8' | grep -v '-dev$' || find_nix_store 'libcxx-static-wasm32-unknown-wasi-21.1.8')}"
WASILIBC_PKG="${WASILIBC_PKG:-$(find_nix_store 'wasilibc-static-wasm32-unknown-wasi-27' | grep -vE '-(dev|share)$' || true)}"
TBLGEN_PKG="${TBLGEN_PKG:-$(find_nix_store 'llvm-tblgen-21.1.8')}"
BINARYEN_PKG="${BINARYEN_PKG:-$(find_nix_store 'binaryen-')}"

WASI_CC="${WASI_CC:-${WASI_CLANG_PKG:+$WASI_CLANG_PKG/bin/wasm32-unknown-wasi-clang}}"
WASI_CXX="${WASI_CXX:-${WASI_CLANG_PKG:+$WASI_CLANG_PKG/bin/wasm32-unknown-wasi-clang++}}"
WASI_AR="${WASI_AR:-${WASI_BINUTILS_PKG:+$WASI_BINUTILS_PKG/bin/wasm32-unknown-wasi-ar}}"
WASI_RANLIB="${WASI_RANLIB:-${WASI_BINUTILS_PKG:+$WASI_BINUTILS_PKG/bin/wasm32-unknown-wasi-ranlib}}"
WASI_STRIP="${WASI_STRIP:-${WASI_BINUTILS_PKG:+$WASI_BINUTILS_PKG/bin/wasm32-unknown-wasi-strip}}"
LLVM_TBLGEN="${LLVM_TBLGEN:-${TBLGEN_PKG:+$TBLGEN_PKG/bin/llvm-tblgen}}"
CLANG_TBLGEN="${CLANG_TBLGEN:-${TBLGEN_PKG:+$TBLGEN_PKG/bin/clang-tblgen}}"
LIBCXX_LIB="${LIBCXX_LIB:-${LIBCXX_PKG:+$LIBCXX_PKG/lib}}"
WASILIBC_LIB="${WASILIBC_LIB:-${WASILIBC_PKG:+$WASILIBC_PKG/lib}}"
WASM_OPT="${WASM_OPT:-${BINARYEN_PKG:+$BINARYEN_PKG/bin/wasm-opt}}"

for required_path in \
  "$LLVM_SRC/CMakeLists.txt" \
  "$CLANG_SRC/CMakeLists.txt" \
  "$WASI_CC" \
  "$WASI_CXX" \
  "$WASI_AR" \
  "$WASI_RANLIB" \
  "$LLVM_TBLGEN" \
  "$CLANG_TBLGEN"; do
  if [[ -z "$required_path" || ! -e "$required_path" ]]; then
    echo "error: missing required build dependency: $required_path" >&2
    exit 1
  fi
done

if [[ -n "$WASI_BINUTILS_PKG" ]]; then
  export PATH="$WASI_BINUTILS_PKG/bin:$PATH"
fi
if [[ -n "$LLD_PKG" ]]; then
  export PATH="$LLD_PKG/bin:$PATH"
fi

if [[ ! -f "$BUILD_DIR/build.ninja" ]]; then
  mkdir -p "$BUILD_DIR"
  cmake -G Ninja -S "$LLVM_SRC" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_SYSTEM_NAME=WASI \
    -DCMAKE_C_COMPILER="$WASI_CC" \
    -DCMAKE_CXX_COMPILER="$WASI_CXX" \
    -DCMAKE_AR="$WASI_AR" \
    -DCMAKE_RANLIB="$WASI_RANLIB" \
    -DCMAKE_C_FLAGS="-I$COMPAT_INC -Oz -ffunction-sections -fdata-sections" \
    -DCMAKE_CXX_FLAGS="-I$COMPAT_INC -Oz -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti -DCLANG_BUILD_STATIC" \
    -DUNIX=1 \
    -DLLVM_HOST_TRIPLE=wasm32-unknown-wasi \
    -DLLVM_TARGETS_TO_BUILD="" \
    -DLLVM_EXTERNAL_PROJECTS=clang \
    -DLLVM_EXTERNAL_CLANG_SOURCE_DIR="$CLANG_SRC" \
    -DLLVM_TABLEGEN="$LLVM_TBLGEN" \
    -DCLANG_TABLEGEN="$CLANG_TBLGEN" \
    -DLLVM_ENABLE_THREADS=OFF \
    -DLLVM_ENABLE_EH=OFF \
    -DLLVM_ENABLE_RTTI=OFF \
    -DLLVM_ENABLE_PIC=OFF \
    -DLLVM_ENABLE_TERMINFO=OFF \
    -DLLVM_ENABLE_ZLIB=OFF \
    -DLLVM_ENABLE_ZSTD=OFF \
    -DLLVM_ENABLE_LIBXML2=OFF \
    -DLLVM_ENABLE_PLUGINS=OFF \
    -DLLVM_BUILD_TOOLS=OFF \
    -DLLVM_INCLUDE_TESTS=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF \
    -DCLANG_ENABLE_ARCMT=OFF \
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF

  # Ensure WASI emulated mmap declarations are picked up consistently across LLVM Support.
  sed -i 's|/\* #undef HAVE_SYS_MMAN_H \*/|#define HAVE_SYS_MMAN_H 1|' \
    "$BUILD_DIR/include/llvm/Config/config.h"
  sed -i 's/-DCLANG_EXPORTS/-DCLANG_BUILD_STATIC/g' "$BUILD_DIR/build.ninja"
fi

ninja -C "$BUILD_DIR" \
  clangFrontend clangDriver clangParse clangSema clangAST clangLex clangBasic \
  clangEdit clangAnalysis clangASTMatchers clangSerialization clangSupport clangAPINotes \
  LLVMFrontendHLSL LLVMFrontendOpenMP LLVMFrontendOffloading \
  LLVMCore LLVMMC LLVMMCParser LLVMBitReader LLVMProfileData LLVMScalarOpts \
  LLVMDemangle LLVMSupport LLVMTargetParser LLVMBitstreamReader LLVMOption \
  LLVMBinaryFormat LLVMRemarks LLVMFrontendDirective

"$WASI_CXX" -std=c++17 -Oz -DNDEBUG -fno-exceptions -fno-rtti -ffunction-sections -fdata-sections \
  -DCLANG_BUILD_STATIC -DLLVM_BUILD_STATIC \
  -I"$BUILD_DIR/tools/clang/include" \
  -I"$CLANG_SRC/include" \
  -I"$BUILD_DIR/include" \
  -I"$LLVM_SRC/include" \
  -I"$COMPAT_INC" \
  -c "$SCRIPT_DIR/clang-trace-frontend.cpp" \
  -o "$BUILD_DIR/clang-trace-frontend.o"

"$WASI_CC" -Oz -c "$SCRIPT_DIR/wasi_stubs.c" -o "$BUILD_DIR/wasi_stubs.o"

RAW_WASM="$BUILD_DIR/clang-trace-frontend.raw.wasm"
LIB_ARGS=()
[[ -n "$LIBCXX_LIB" ]] && LIB_ARGS+=(-L"$LIBCXX_LIB")
LIB_ARGS+=(-lc++ -lc++abi)
[[ -n "$WASILIBC_LIB" ]] && LIB_ARGS+=(-L"$WASILIBC_LIB")
LIB_ARGS+=(-lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-getpid -ldl)

"$WASI_CXX" -Oz -fno-exceptions -fno-rtti \
  -Wl,--gc-sections \
  -Wl,-z,stack-size=8388608 \
  "$BUILD_DIR/clang-trace-frontend.o" \
  "$BUILD_DIR/wasi_stubs.o" \
  "$BUILD_DIR"/lib/libclang*.a \
  "$BUILD_DIR"/lib/libLLVM*.a \
  "${LIB_ARGS[@]}" \
  -o "$RAW_WASM"

mkdir -p "$(dirname -- "$OUT_WASM")"
if [[ -n "$WASI_STRIP" && -x "$WASI_STRIP" ]]; then
  "$WASI_STRIP" "$RAW_WASM"
fi

if [[ -n "$WASM_OPT" && -x "$WASM_OPT" ]]; then
  "$WASM_OPT" -Oz --strip-debug \
    --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int \
    "$RAW_WASM" -o "$OUT_WASM"
else
  cp "$RAW_WASM" "$OUT_WASM"
fi

ls -lh "$OUT_WASM"
