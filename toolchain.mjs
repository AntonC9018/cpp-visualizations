// The pinned compiler and debugger, and the error every rejected snippet raises.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export class Unsupported extends Error {
  constructor(message) {
    super(message);
    this.name = 'Unsupported';
  }
}

export function run(command, { timeout = 30_000 } = {}) {
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

function which(executable) {
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

export function tool(env, executable) {
  const selected = process.env[env] || which(executable);
  if (!selected) {
    throw new Unsupported(`${executable} is required (set ${env})`);
  }
  return selected;
}
