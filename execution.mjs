// Run a whitelisted statement list under GDB and observe main's frame after every statement.
//
// The program calls `__course_checkpoint(i, …)` after statement `i`; a GDB breakpoint there reads
// the requested variables from main's frame. Observations are raw (real addresses and stored
// bits); the tracer interprets and verifies them. Nothing here decides what is supported.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Unsupported, run, tool } from './toolchain.mjs';

export class Cell {
  constructor({
    address,
    size,
    pointer,
    value,
    object_address = null,
    object_size = null,
    reference = false,
  }) {
    this.address = address;
    this.size = size;
    this.pointer = pointer;
    this.value = value;
    this.object_address = object_address;
    this.object_size = object_size;
    this.reference = reference;
    Object.freeze(this);
  }
}

export const REFERENCE = 'reference';

export class Execution {
  constructor(checkpoints, stdout) {
    this.checkpoints = checkpoints;
    this.stdout = stdout;
    Object.freeze(this);
  }
}

const PROGRAM = `#include <iostream>
#include <cstdint>
using namespace std;
__attribute__((noinline)) void __course_checkpoint(int position, ...) {
 asm volatile("" : : : "memory");
}
int main() {
`;

const SCRIPT = `import gdb, json, shlex
expected, output, report = json.loads(EXPECTED), OUTPUT, REPORT
records, failures, exits = [], [], []
class Checkpoint(gdb.Breakpoint):
    def stop(self):
        try:
            current = gdb.newest_frame()
            position = int(current.read_var("position"))
            frame = current.older()
            row = {}
            for name, defined in expected[position]:
                owner, _, member = name.partition('.')
                value = frame.read_var(owner)
                if defined == "reference":
                    if value.type.code != gdb.TYPE_CODE_REF:
                        raise RuntimeError(name + " is not a reference")
                    row[name] = {"address": int(value.referenced_value().address), "size": 0,
                                 "pointer": False, "value": None, "reference": True}
                    continue
                object_address, object_size = int(value.address), int(value.type.sizeof)
                for part in member.split('.') if member else ():
                    value = value[part]
                kind = value.type.strip_typedefs().code
                if value.address is None or kind not in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_PTR):
                    raise RuntimeError("unsupported storage for " + name)
                row[name] = {"address": int(value.address), "size": int(value.type.sizeof),
                             "pointer": kind == gdb.TYPE_CODE_PTR,
                             "value": int(value) if defined else None}
                if member:
                    row[name].update(object_address=object_address, object_size=object_size)
            records.append({"position": position, "variables": row})
        except Exception as error:
            failures.append(str(error))
        return False
Checkpoint("__course_checkpoint", internal=True)
gdb.events.exited.connect(lambda event: exits.append(getattr(event, "exit_code", None)))
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("run > " + shlex.quote(output))
with open(report, "w") as handle:
    json.dump({"records": records, "failures": failures, "exits": exits}, handle)
`;

export function execute(statements, expected, directory) {
  const body = [];
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index];
    const scope = expected[index];
    body.push(statement);
    const args = [String(index), ...scope.map(([name]) => `&${name}`)];
    body.push(`__course_checkpoint(${args.join(', ')});`);
  }
  const path = join(directory, 'runtime.cpp');
  const binary = join(directory, 'runtime');
  writeFileSync(path, PROGRAM + body.join('\n') + '\n}\n');
  const compilation = run([
    tool('CLANGXX', 'clang++'),
    '-std=c++20',
    '-g',
    '-O0',
    '-fno-omit-frame-pointer',
    path,
    '-o',
    binary,
  ]);
  if (compilation.returncode) {
    throw new Unsupported('whitelisted runtime program did not compile');
  }
  const output = join(directory, 'stdout.txt');
  const report = join(directory, 'report.json');
  const script = join(directory, 'verify.py');
  writeFileSync(
    script,
    SCRIPT.replace('EXPECTED', JSON.stringify(JSON.stringify(expected)))
      .replace('OUTPUT', JSON.stringify(output))
      .replace('REPORT', JSON.stringify(report))
  );
  const result = run([
    tool('GDB', 'gdb'),
    '--batch',
    '-nx',
    '--quiet',
    '-ex',
    'set auto-load safe-path /nonexistent',
    '-x',
    script,
    binary,
  ]);
  if (result.returncode || !existsSync(report)) {
    throw new Unsupported('GDB could not collect the runtime trace');
  }
  const observed = JSON.parse(readFileSync(report, 'utf8'));
  const records = observed.records;
  if (
    observed.failures.length > 0 ||
    observed.exits.length !== 1 ||
    observed.exits[0] !== 0 ||
    records.length !== expected.length ||
    records.some((row, i) => row.position !== i)
  ) {
    const reason =
      observed.failures.join('; ') || 'missing checkpoints or abnormal program exit';
    throw new Unsupported('runtime verification failed: ' + reason);
  }
  const checkpoints = records.map(row =>
    Object.fromEntries(
      Object.entries(row.variables).map(([name, cell]) => [name, new Cell(cell)])
    )
  );
  return new Execution(checkpoints, readFileSync(output, 'utf8'));
}
