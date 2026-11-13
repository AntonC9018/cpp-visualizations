#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/FrontendActions.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/VirtualFileSystem.h"
#include "llvm/Support/raw_ostream.h"

#include <memory>
#include <string>
#include <vector>

static const char *kVirtualStdHeader = R"cpp(
#ifndef COURSE_VIRTUAL_STD_H
#define COURSE_VIRTUAL_STD_H
namespace std {
  using size_t = decltype(sizeof(0));
  using ptrdiff_t = decltype(static_cast<char*>(nullptr) - static_cast<char*>(nullptr));
  using nullptr_t = decltype(nullptr);
  using int8_t = signed char;
  using uint8_t = unsigned char;
  using int16_t = short;
  using uint16_t = unsigned short;
  using int32_t = int;
  using uint32_t = unsigned int;
  using int64_t = long;
  using uint64_t = unsigned long;
  using intptr_t = long;
  using uintptr_t = unsigned long;
  struct ostream {
    ostream& operator<<(int);
    ostream& operator<<(unsigned int);
    ostream& operator<<(long);
    ostream& operator<<(unsigned long);
    ostream& operator<<(long long);
    ostream& operator<<(unsigned long long);
    ostream& operator<<(double);
    ostream& operator<<(char);
    ostream& operator<<(const char*);
    ostream& operator<<(const void*);
    ostream& operator<<(ostream& (*)(ostream&));
  };
  extern ostream cout;
  ostream& endl(ostream&);
}
using size_t = std::size_t;
using ptrdiff_t = std::ptrdiff_t;
using int8_t = std::int8_t;
using uint8_t = std::uint8_t;
using int16_t = std::int16_t;
using uint16_t = std::uint16_t;
using int32_t = std::int32_t;
using uint32_t = std::uint32_t;
using int64_t = std::int64_t;
using uint64_t = std::uint64_t;
using intptr_t = std::intptr_t;
using uintptr_t = std::uintptr_t;
#endif
)cpp";

int main(int argc, char **argv) {
  auto VFS = llvm::makeIntrusiveRefCnt<llvm::vfs::InMemoryFileSystem>();
  VFS->addFile("/virtual/include/iostream", 0,
               llvm::MemoryBuffer::getMemBuffer(kVirtualStdHeader));
  VFS->addFile("/virtual/include/cstdint", 0,
               llvm::MemoryBuffer::getMemBuffer(kVirtualStdHeader));
  VFS->addFile("/virtual/include/cstddef", 0,
               llvm::MemoryBuffer::getMemBuffer(kVirtualStdHeader));

  bool astDump = false;
  bool astDumpFilterMain = false;
  bool dumpRecordLayoutsComplete = false;
  std::string inputPath;

  for (int i = 1; i < argc; ++i) {
    llvm::StringRef arg(argv[i]);
    if (arg == "-Xclang" && i + 1 < argc) {
      llvm::StringRef xarg(argv[++i]);
      if (xarg == "-ast-dump=json") {
        astDump = true;
      } else if (xarg == "-ast-dump-filter=main") {
        astDumpFilterMain = true;
      } else if (xarg == "-fdump-record-layouts-complete") {
        dumpRecordLayoutsComplete = true;
      }
    } else if (arg == "-" || !arg.starts_with("-")) {
      inputPath = arg.str();
    }
  }

  if (inputPath.empty()) {
    llvm::errs() << "error: no input file\n";
    llvm::errs().flush();
    return 1;
  }

  auto BufOrErr = llvm::MemoryBuffer::getFileOrSTDIN(inputPath);
  if (!BufOrErr) {
    llvm::errs() << "error: could not read " << inputPath << "\n";
    llvm::errs().flush();
    return 1;
  }
  std::string sourceContent = (*BufOrErr)->getBuffer().str();
  VFS->addFile("/virtual/source.cpp", 0,
               llvm::MemoryBuffer::getMemBuffer(sourceContent));

  std::vector<const char *> cc1Args = {
      "-triple",
      "x86_64-unknown-linux-gnu",
      "-std=c++20",
      "-fsyntax-only",
      "-nostdsysteminc",
      "-nobuiltininc",
      "-isystem",
      "/virtual/include",
  };
  if (astDump) {
    cc1Args.push_back("-ast-dump=json");
  }
  if (astDumpFilterMain) {
    cc1Args.push_back("-ast-dump-filter=main");
  }
  if (dumpRecordLayoutsComplete) {
    cc1Args.push_back("-fdump-record-layouts-complete");
  }
  cc1Args.push_back("/virtual/source.cpp");

  auto DiagOpts = std::make_unique<clang::DiagnosticOptions>();
  DiagOpts->ShowColors = false;
  auto *DiagClient = new clang::TextDiagnosticPrinter(llvm::errs(), *DiagOpts);
  auto Diags = llvm::makeIntrusiveRefCnt<clang::DiagnosticsEngine>(
      llvm::makeIntrusiveRefCnt<clang::DiagnosticIDs>(), *DiagOpts, DiagClient);

  auto Invocation = std::make_shared<clang::CompilerInvocation>();
  if (!clang::CompilerInvocation::CreateFromArgs(*Invocation, cc1Args, *Diags)) {
    llvm::outs().flush();
    llvm::errs().flush();
    return 1;
  }

  clang::CompilerInstance Clang(Invocation);
  Clang.setDiagnostics(Diags.get());
  Clang.createFileManager(VFS);
  Clang.createSourceManager(Clang.getFileManager());

  std::unique_ptr<clang::FrontendAction> Act;
  if (astDump) {
    Act = std::make_unique<clang::ASTDumpAction>();
  } else {
    Act = std::make_unique<clang::SyntaxOnlyAction>();
  }

  bool ok = Clang.ExecuteAction(*Act);
  llvm::outs().flush();
  llvm::errs().flush();
  return ok ? 0 : 1;
}
