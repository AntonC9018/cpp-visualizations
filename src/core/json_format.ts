// JSON serialization matching Python's `json.dumps(obj, sort_keys=True)`, with `indent` as in
// `JSON.stringify`. Unlike `JSON.stringify`, -0 stays `-0`: a float cell can hold it.

export function dumpsSorted(value: unknown, indent: number | null = null): string {
  const step = indent === null ? null : Math.min(10, Math.max(0, Math.trunc(indent) || 0));
  function format(val: unknown, level: number): string {
    if (Object.is(val, -0)) return '-0';
    if (val === null || typeof val !== 'object') return JSON.stringify(val);
    const array = Array.isArray(val);
    const record = val as Record<string, unknown>;
    const items = array
      ? Array.from(val, item => format(item ?? null, level + 1))
      : Object.keys(record)
          .sort()
          .filter(key => record[key] !== undefined)
          .map(key => `${JSON.stringify(key)}: ${format(record[key], level + 1)}`);
    const [open, close] = array ? '[]' : '{}';
    if (items.length === 0) return open + close;
    if (step === null || step === 0) return `${open}${items.join(', ')}${close}`;
    const pad = `\n${' '.repeat(step * (level + 1))}`;
    return `${open}${pad}${items.join(`,${pad}`)}\n${' '.repeat(step * level)}${close}`;
  }
  return format(value, 0);
}
