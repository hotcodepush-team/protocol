/**
 * Canonical JSON: object keys sorted by their UTF-16 code units, no
 * whitespace, strings and numbers as JSON.stringify writes them, so the same
 * document yields the same bytes in TypeScript, Swift and Kotlin — the bytes a
 * manifest signature covers and a manifest hash names.
 */
export function stringifyCanonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonical JSON carries finite numbers only');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value)
        ? `[${value.map(entry => stringifyCanonicalJson(entry)).join(',')}]`
        : stringifyCanonicalObject(value as Record<string, unknown>);
    default:
      throw new TypeError(`canonical JSON cannot carry a ${typeof value}`);
  }
}

function stringifyCanonicalObject(object: Record<string, unknown>): string {
  const members = Object.keys(object)
    .sort()
    .filter(key => object[key] !== undefined)
    .map(
      key => `${JSON.stringify(key)}:${stringifyCanonicalJson(object[key])}`,
    );
  return `{${members.join(',')}}`;
}
