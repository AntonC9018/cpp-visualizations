// JSON serialization matching Python's `json.dumps(obj, sort_keys=True)`.

export function dumpsSorted(value: unknown, indent: number | null = null): string {
  function sortKeysDeep(val: unknown): unknown {
    if (Array.isArray(val)) {
      return val.map(sortKeysDeep);
    }
    if (typeof val === 'object' && val !== null) {
      const sorted: Record<string, unknown> = {};
      const record = val as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        sorted[key] = sortKeysDeep(record[key]);
      }
      return sorted;
    }
    return val;
  }

  function formatPrimitive(val: unknown): string {
    if (Object.is(val, -0)) return "-0.0";
    return JSON.stringify(val);
  }
  const ordered = sortKeysDeep(value);
  if (indent !== null) {
    function formatIndented(val: unknown, level: number): string {
      if (val === null || typeof val !== 'object') {
        return formatPrimitive(val);
      }
      const pad = " ".repeat(indent! * (level + 1));
      const closePad = " ".repeat(indent! * level);
      if (Array.isArray(val)) {
        if (val.length === 0) return "[]";
        return `[\n${val.map(item => pad + formatIndented(item, level + 1)).join(",\n")}\n${closePad}]`;
      }
      const record = val as Record<string, unknown>;
      const keys = Object.keys(record).filter(k => record[k] !== undefined);
      if (keys.length === 0) return "{}";
      const entries = keys.map(k => `${pad}${JSON.stringify(k)}: ${formatIndented(record[k], level + 1)}`);
      return `{\n${entries.join(",\n")}\n${closePad}}`;
    }
    return formatIndented(ordered, 0);
  }
  // Format with ', ' and ': ' separators like Python's default json.dumps(obj, sort_keys=True)
  function formatCompact(val: unknown): string {
    if (val === null || typeof val !== 'object') {
      return formatPrimitive(val);
    }
    if (Array.isArray(val)) {
      return `[${val.map(formatCompact).join(', ')}]`;
    }
    const record = val as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter(k => record[k] !== undefined)
      .map(k => `${JSON.stringify(k)}: ${formatCompact(record[k])}`);
    return `{${entries.join(', ')}}`;
  }
  return formatCompact(ordered);
}
