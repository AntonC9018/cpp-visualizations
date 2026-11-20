// Transport Clang constant values through integer enum entries in the JSON AST.
// Floating results are carried as IEEE bits, including signed zero.
import { type AstNode, type CompilerFrontend, IllFormed, Unsupported } from './errors.ts';

export function numberSpelling(value: number, type: string): string {
  if (type === 'float' || type === 'double') {
    if (Object.is(value, -0)) return '-0.0';
    const text = String(value);
    return /[.e]/.test(text) ? text : text + '.0';
  }
  return BigInt(value).toString() + (type.startsWith('unsigned ') ? 'ULL' : 'LL');
}

export function numberOperand(value: number, type: string): string {
  return `static_cast<${type}>(${numberSpelling(value, type)})`;
}

function constant(node: AstNode): string | undefined {
  if (node.kind === 'ConstantExpr' && node.value !== undefined) return node.value;
  for (const child of node.inner ?? []) {
    const found = constant(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function enumValue(nodes: AstNode[], name: string): bigint {
  for (const node of nodes) {
    if (node.kind !== 'EnumDecl' || node.name !== name) continue;
    const declaration = node.inner?.find(child => child.kind === 'EnumConstantDecl');
    const value = declaration && constant(declaration);
    if (value !== undefined && /^-?\d+$/.test(value)) return BigInt(value);
  }
  throw new Unsupported('Clang did not return the requested constant value');
}

export function drawnInteger(value: bigint): number {
  // JSON numbers are doubles in the player.
  const number = Number(value);
  if (!Number.isSafeInteger(number) && value !== 2n ** 53n && value !== -(2n ** 53n)) {
    throw new Unsupported('integers beyond 2^53 are not drawn exactly');
  }
  return number;
}

export class ClangNumbers {
  private readonly values = new Map<string, number>();

  private readonly frontend: CompilerFrontend;

  constructor(frontend: CompilerFrontend) {
    this.frontend = frontend;
  }

  evaluate(expression: string, type: string, diagnostic?: string): number {
    const key = type + ':' + expression;
    const previous = this.values.get(key);
    if (previous !== undefined) return previous;
    const bitsType = type === 'float' ? 'unsigned int' : type === 'double' ? 'unsigned long long' : null;
    const initializer = bitsType
      ? `__builtin_bit_cast(${bitsType}, static_cast<${type}>(${expression}))`
      : `static_cast<${type}>(${expression})`;
    const program = `enum __course_number : ${bitsType ?? type} { __course_value = ${initializer} };\n`;
    let raw: bigint;
    try {
      raw = enumValue(this.frontend.astDump(program, '__course_number'), '__course_number');
    } catch (error) {
      if (error instanceof IllFormed && diagnostic) throw new Unsupported(diagnostic + ' (' + error.message + ')');
      throw error;
    }
    let number: number;
    if (type === 'float') {
      const buffer = new DataView(new ArrayBuffer(4));
      buffer.setUint32(0, Number(raw));
      number = buffer.getFloat32(0);
    } else if (type === 'double') {
      const buffer = new DataView(new ArrayBuffer(8));
      buffer.setBigUint64(0, raw);
      number = buffer.getFloat64(0);
    } else {
      number = drawnInteger(raw);
    }
    if (!Number.isFinite(number)) throw new Unsupported(diagnostic ?? 'non-finite floating-point value');
    this.values.set(key, number);
    return number;
  }
}

export interface ReplayStep {
  source: string;
  /** A definition before main, which the preamble already holds. */
  global: boolean;
  output: boolean;
  checks: string[];
}

const CHECKS = `
template<class T, class U> constexpr bool __course_equal(T actual, U expected) {
  if constexpr (__is_same(T, float))
    return __builtin_bit_cast(unsigned, actual) ==
           __builtin_bit_cast(unsigned, static_cast<float>(expected));
  else if constexpr (__is_same(T, double))
    return __builtin_bit_cast(unsigned long long, actual) ==
           __builtin_bit_cast(unsigned long long, static_cast<double>(expected));
  else
    return actual == static_cast<T>(expected);
}
template<class T, class U> constexpr bool __course_points_to(T* actual, U* expected) {
  return static_cast<const U*>(static_cast<const void*>(actual)) == expected;
}
`;

/** Check the actual C++ objects after each statement. Output is a player operation. */
export function verifyReplay(
  frontend: CompilerFrontend,
  preamble: string,
  steps: ReplayStep[]
): void {
  const chunks = [preamble, CHECKS, 'constexpr int __course_replay() {\n'];
  // These statements came from the C++20 token stream. Selecting them before replay
  // keeps feature-test macros and conditional directives from choosing another branch.
  for (const [index, step] of steps.entries()) {
    if (step.global) continue;
    if (!step.output) chunks.push(step.source, '\n');
    if (step.checks.length) {
      chunks.push(`if (!(${step.checks.join(' && ')})) return ${index + 1};\n`);
    }
  }
  chunks.push(
    'return 0;\n}\n',
    'enum __course_checkpoint : int { __course_result = __course_replay() };\n',
  );
  // C++26 permits a cast back from void* during constant evaluation when the pointee
  // has the right type. The original AST has already been checked in C++20 mode.
  let result: bigint;
  try {
    result = enumValue(frontend.astDump(chunks.join(''), '__course_checkpoint', 'c++2c'), '__course_checkpoint');
  } catch (error) {
    if (error instanceof IllFormed) throw new Unsupported('Clang could not evaluate the trace: ' + error.message);
    throw error;
  }
  if (result !== 0n) throw new Unsupported(`compiler verification failed after statement ${result}`);
}
