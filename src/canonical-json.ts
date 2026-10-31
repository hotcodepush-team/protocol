/**
 * Serializes a value as canonical JSON, the bytes a manifest signature and a manifest hash cover.
 * Keys are sorted by UTF-16 code units, with no whitespace. Strings and numbers follow JSON.stringify.
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
      if (Array.isArray(value)) {
        return `[${value.map(entry => stringifyCanonicalJson(entry)).join(',')}]`;
      }
      // A Date, Map or typed array would serialize as `{}` or index keys. Fail rather than sign wrong bytes.
      if (!isPlainObject(value)) {
        throw new TypeError('canonical JSON carries plain objects only');
      }
      return stringifyCanonicalObject(value as Record<string, unknown>);
    default:
      throw new TypeError(`canonical JSON cannot carry a ${typeof value}`);
  }
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
