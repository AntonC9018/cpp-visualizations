// Launch the pinned native Clang and translate its output into trace data.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import {
  STANDARD_FLAGS, Unsupported, illFormed, type AstNode, type CompilerFrontend, type Macros, type Standard,
} from '../core/errors.ts';
import { extractEnumConstantSizes } from '../core/records.ts';
import {
  type TokenizedSource, definedMacros, includesOnlyStandardHeaders, memo, parseAstDump, readTokens, stripTokenDump,
} from '../core/source.ts';

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

const HEADER_SEARCH_ENV = ['CPATH', 'CPLUS_INCLUDE_PATH', 'C_INCLUDE_PATH', 'OBJC_INCLUDE_PATH'] as const;
const HEADER_ENV = [...HEADER_SEARCH_ENV, 'SDKROOT', 'SYSROOT'] as const;

function headerEnv(): string {
  return HEADER_ENV.map(name => process.env[name] ?? '').join('\0');
}

function customHeaderDirs(): string[] {
  const dirs: string[] = [];
  for (const name of HEADER_SEARCH_ENV) {
    for (const entry of (process.env[name] ?? '').split(delimiter)) {
      if (entry) dirs.push(entry);
    }
  }
  return dirs;
}

function pathStamp(paths: string[]): string | null {
  try {
    return paths
      .map(path => {
        const stat = statSync(path, { bigint: true });
        return `${path}\0${stat.ino}:${stat.size}:${stat.mtimeNs}`;
      })
      .join('\n');
  } catch {
    return null;
  }
}

/** The pinned compiler's standard headers define the same macros for every frontend. */
const standardMacros = memo<Macros>(16);

export function createClangFrontend(directory?: string): CompilerFrontend {
  /**
   * Run Clang on `program` with the shared language options, checking its syntax unless `args`
   * name another action. The path names the program in diagnostics.
   */
  const clang = (program: string, args: string[], standard: Standard = 'c++20'): CommandResult & { path: string } =>
    withDirectory(directory, dir => {
      const path = join(dir, 'source.cpp');
      writeFileSync(path, program);
      const action = args.includes('-E') ? [] : ['-fsyntax-only'];
      const result = run([
        tool('CLANGXX', 'clang++'), ...STANDARD_FLAGS[standard], ...action, '-fno-color-diagnostics',
        ...args, path,
      ]);
      return { ...result, path };
    });
  // A program's tokens are read again for each check on the same snippet; invalidate if any
  // included header or header search environment changes between calls.
  interface CachedTokens {
    tokens: TokenizedSource;
    env: string;
    paths: string[];
    stamp: string | null;
  }
  const lexed = new Map<string, CachedTokens>();

  return {
    tokens(program, { ignoreExpansions = false } = {}) {
      const key = `${ignoreExpansions}\0${program}`;
      const env = headerEnv();
      const cached = lexed.get(key);
      if (
        cached &&
        cached.env === env &&
        (cached.paths.length === 0 || (cached.stamp !== null && pathStamp(cached.paths) === cached.stamp))
      ) {
        return cached.tokens;
      }
      const result = clang(program, ['-H', '-Xclang', '-dump-tokens']);
      if (result.returncode !== 0) {
        throw illFormed(stripTokenDump(result.stderr), program, { locatedOnly: true });
      }
      const tokens = readTokens(result.stderr, result.path, program, { ignoreExpansions });
      const included = [...result.stderr.matchAll(/^\.+ ([^\r\n]+)$/gm)].map(m => m[1]);
      const paths = [...new Set([...included, ...(included.length ? customHeaderDirs() : [])])];
      const stamp = paths.length ? pathStamp(paths) : '';
      lexed.set(key, { tokens, env, paths, stamp });
      return tokens;
    },

    macros(program) {
      const read = (): Macros => {
        const result = clang(program, ['-E', '-dM']);
        if (result.returncode !== 0) throw illFormed(result.stderr, program);
        return definedMacros(result.stdout);
      };
      // The snippet's own headers or custom search paths may change between traces.
      return includesOnlyStandardHeaders(program) && customHeaderDirs().length === 0
        ? standardMacros(`${tool('CLANGXX', 'clang++')}\0${headerEnv()}\0${program}`, read)
        : read();
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
