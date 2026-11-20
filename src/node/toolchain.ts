// Launch the pinned native Clang and translate its output into trace data.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  STANDARD_FLAGS, Unsupported, illFormed, type AstNode, type CompilerFrontend, type Standard,
} from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import { type TokenizedSource, parseAstDump, readTokens } from '../core/source.ts';

export { Unsupported };

export interface CommandResult {
  returncode: number;
  stdout: string;
  stderr: string;
}

export function run(
  command: string[],
  { timeout = 30_000 }: { timeout?: number } = {}
): CommandResult {
  const [file, ...args] = command;
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Unsupported(`tool execution failed: ${result.error.message}`);
  }
  return {
    returncode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function which(executable: string): string | null {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue searching PATH
    }
  }
  return null;
}

export function tool(env: string, executable: string): string {
  const selected = process.env[env] || which(executable);
  if (!selected) {
    throw new Unsupported(`${executable} is required (set ${env})`);
  }
  return selected;
}

function withDirectory<T>(directory: string | undefined, fn: (dir: string) => T): T {
  if (directory !== undefined) {
    return fn(directory);
  }
  const temp = mkdtempSync(join(tmpdir(), 'clang-'));
  try {
    return fn(temp);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function createClangFrontend(directory?: string): CompilerFrontend {
  /** Run Clang on `program` with the shared language options; the path names it in diagnostics. */
  const clang = (program: string, args: string[], standard: Standard = 'c++20'): CommandResult & { path: string } =>
    withDirectory(directory, dir => {
      const path = join(dir, 'source.cpp');
      writeFileSync(path, program);
      const result = run([
        tool('CLANGXX', 'clang++'), ...STANDARD_FLAGS[standard], '-fsyntax-only', '-fno-color-diagnostics',
        ...args, path,
      ]);
      return { ...result, path };
    });
  // A program's tokens are read again for each check on the same snippet.
  const lexed = new Map<string, TokenizedSource>();

  return {
    tokens(program, { ignoreExpansions = false } = {}) {
      const key = `${ignoreExpansions}\0${program}`;
      let tokens = lexed.get(key);
      if (!tokens) {
        const result = clang(program, ['-H', '-Xclang', '-dump-tokens']);
        if (result.returncode !== 0) throw illFormed(result.stderr, program);
        tokens = readTokens(result.stderr, result.path, program, { ignoreExpansions });
        lexed.set(key, tokens);
      }
      return tokens;
    },

    astDump(program, filter, standard = 'c++20') {
      const result = clang(program, ['-Xclang', '-ast-dump=json', '-Xclang', '-ast-dump-filter=' + filter], standard);
      if (result.returncode !== 0) throw illFormed(result.stderr, program);
      return parseAstDump(result.stdout);
    },

    recordLayoutsDump(program: string): string {
      const result = clang(program, ['-Xclang', '-fdump-record-layouts-complete']);
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not compute record layouts');
      }
      return result.stdout;
    },

    typeSizes(types: string[]): Record<string, number> {
      const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };\n`).join('');
      const result = clang(probe, ['-Xclang', '-ast-dump=json']);
      if (result.returncode !== 0) {
        throw new Unsupported('Clang could not obtain field sizes');
      }
      return extractEnumConstantSizes(JSON.parse(result.stdout) as AstNode, types);
    },
  };
}
