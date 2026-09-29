/**
 * The range subset the three evaluators share, over dotted numeric versions:
 * comparators `>=`, `>`, `<=`, `<`, `=`, whitespace allowed after the operator,
 * a bare version as equality, partial versions and an `x` or `*` as the last
 * component as intervals, alternatives joined by `||`, comparators of one
 * alternative joined by whitespace. Anything else does not parse, and a
 * condition that does not parse is not satisfied.
 */

export type Version = readonly number[];

type Comparator = { operator: '<' | '<=' | '=' | '>' | '>='; version: Version };

/** One comparator and the whitespace after it, a wildcard only as the last component; sticky, so matching stops at the first character that is not one. */
const COMPARATOR_PATTERN =
  /(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*(?:\.[xX*])?|[xX*])(?:\s+|$)/gy;
const VERSION_PATTERN = /^\d+(\.\d+)*$/;

/** A version's numeric components; `null` when the string is not a dotted number. */
export function parseVersion(value: string): Version | null {
  const trimmed = value.trim();
  if (!VERSION_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.split('.').map(component => Number.parseInt(component, 10));
}

/**
 * Whether the version satisfies the range: `null` when the range does not parse.
 * A comparator compares only as many components as it names, so `2.4.1`
 * matches a device on `2.4.1` with any build, while `2.4.1.57` names the build.
 */
export function isVersionInRange(
  version: Version,
  range: string,
): boolean | null {
  const alternatives = range
    .split('||')
    .map(alternative => parseAlternative(alternative));
  if (alternatives.some(alternative => alternative === null)) {
    return null;
  }
  return alternatives.some(
    alternative =>
      alternative !== null &&
      alternative.every(comparator =>
        isComparatorSatisfied(version, comparator),
      ),
  );
}

function compareVersions(
  left: Version,
  right: Version,
  length: number,
): number {
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isComparatorSatisfied(
  version: Version,
  comparator: Comparator,
): boolean {
  const order = compareVersions(
    version,
    comparator.version,
    comparator.version.length,
  );
  switch (comparator.operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '=':
      return order === 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
  }
}

function parseAlternative(alternative: string): Comparator[] | null {
  const trimmed = alternative.trim();
  const matches = [...trimmed.matchAll(COMPARATOR_PATTERN)];
  const matchedLength = matches.reduce(
    (length, match) => length + match[0].length,
    0,
  );
  if (trimmed.length === 0 || matchedLength !== trimmed.length) {
    return null;
  }
  const comparators: Comparator[] = [];
  for (const match of matches) {
    const parsed = parseComparator(match);
    if (parsed === null) {
      return null;
    }
    comparators.push(...parsed);
  }
  return comparators;
}

function parseComparator(match: RegExpMatchArray): Comparator[] | null {
  const operator = match[1] as Comparator['operator'] | undefined;
  const components = (match[2] ?? '').split('.');
  const wildcardIndex = components.findIndex(component =>
    /^[xX*]$/.test(component),
  );
  if (wildcardIndex !== -1 && operator !== undefined) {
    return null;
  }
  if (
    wildcardIndex === -1 &&
    (operator !== undefined || components.length >= 3)
  ) {
    const version = components.map(component => Number.parseInt(component, 10));
    return [{ operator: operator ?? '=', version }];
  }
  return resolveIntervalComparators(
    components
      .slice(0, wildcardIndex === -1 ? components.length : wildcardIndex)
      .map(component => Number.parseInt(component, 10)),
  );
}

/** A partial or wildcard version as the interval it names: `1.2` and `1.2.x` are `>=1.2 <1.3`, `x` is everything. */
function resolveIntervalComparators(fixed: readonly number[]): Comparator[] {
  if (fixed.length === 0) {
    return [];
  }
  const lastIndex = fixed.length - 1;
  const upper = fixed.map((component, index) =>
    index === lastIndex ? component + 1 : component,
  );
  return [
    { operator: '>=', version: fixed },
    { operator: '<', version: upper },
  ];
}
