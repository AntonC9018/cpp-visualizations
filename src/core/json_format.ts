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

  const ordered = sortKeysDeep(value);
  if (indent !== null) {
    return JSON.stringify(ordered, null, indent);
  }
  // Format with ', ' and ': ' separators like Python's default json.dumps(obj, sort_keys=True)
  function formatCompact(val: unknown): string {
    if (val === null || typeof val !== 'object') {
      return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
      return `[${val.map(formatCompact).join(', ')}]`;
    }
    const record = val as Record<string, unknown>;
    const entries = Object.keys(record).map(
      k => `${JSON.stringify(k)}: ${formatCompact(record[k])}`
    );
    return `{${entries.join(', ')}}`;
  }
  return formatCompact(ordered);
}
