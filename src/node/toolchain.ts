// The pinned compiler and debugger, and the error every rejected snippet raises.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { Unsupported, type AstNode, type CompilerFrontend } from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import { extractMainAstFromStdout } from '../core/tracing.ts';

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
  return {
    mainAst(program: string): AstNode {
      return withDirectory(directory, dir => {
        const path = join(dir, 'source.cpp');
        writeFileSync(path, program);
        const result = run([
          tool('CLANGXX', 'clang++'),
          '-std=c++20',
          '-fsyntax-only',
          '-fno-color-diagnostics',
          '-Xclang',
          '-ast-dump=json',
          '-Xclang',
          '-ast-dump-filter=main',
          path,
        ]);
        if (result.returncode !== 0) {
          const line =
            result.stderr.split(/\r?\n/).find(l => l.includes('error:')) ||
            'error: ill-formed C++';
          throw new Unsupported(line.slice(line.indexOf('error:')));
        }
        return extractMainAstFromStdout(result.stdout, program);
      });
    },

    recordLayoutsDump(program: string): string {
      return withDirectory(directory, dir => {
        const path = join(dir, 'source.cpp');
        if (program) {
          writeFileSync(path, program);
        }
        const result = run([
          tool('CLANGXX', 'clang++'),
          '-std=c++20',
          '-fsyntax-only',
          '-Xclang',
          '-fdump-record-layouts-complete',
          path,
        ]);
        if (result.returncode !== 0) {
          throw new Unsupported('Clang could not compute record layouts');
        }
        return result.stdout;
      });
    },

    typeSizes(types: string[]): Record<string, number> {
      return withDirectory(directory, dir => {
        const path = join(dir, 'sizes.cpp');
        const probe = types.map((t, i) => `enum { __course_${i} = sizeof(${t}) };\n`).join('');
        writeFileSync(path, probe);
        const result = run([
          tool('CLANGXX', 'clang++'),
          '-std=c++20',
          '-fsyntax-only',
          '-Xclang',
          '-ast-dump=json',
          path,
        ]);
        if (result.returncode !== 0) {
          throw new Unsupported('Clang could not obtain field sizes');
        }
        return extractEnumConstantSizes(JSON.parse(result.stdout) as AstNode, types);
      });
    },
  };
}
