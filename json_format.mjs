// JSON serialization matching Python's `json.dumps(obj, sort_keys=True)`.
export function dumpsSorted(value, indent = null) {
  function sortKeysDeep(val) {
    if (Array.isArray(val)) {
      return val.map(sortKeysDeep);
    }
    if (typeof val === 'object' && val !== null) {
      const sorted = {};
      for (const key of Object.keys(val).sort()) {
        sorted[key] = sortKeysDeep(val[key]);
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
  function formatCompact(val) {
    if (val === null || typeof val !== 'object') {
      return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
      return `[${val.map(formatCompact).join(', ')}]`;
    }
    const entries = Object.keys(val).map(
      k => `${JSON.stringify(k)}: ${formatCompact(val[k])}`
    );
    return `{${entries.join(', ')}}`;
  }
  return formatCompact(ordered);
}
