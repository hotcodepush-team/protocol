import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { isVersionInRange, parseVersion } from './version-range.js';

interface RangeCase {
  range: string;
  satisfied: boolean | null;
  version: string;
}

const CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/version-ranges.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: RangeCase[] }
).cases;

describe('parseVersion', () => {
  test.each([
    ['2.4.1', [2, 4, 1]],
    ['17', [17]],
    [' 1.2 ', [1, 2]],
    ['2.4.1.57', [2, 4, 1, 57]],
  ])('should parse %s', (value, expected) => {
    expect(parseVersion(value)).toEqual(expected);
  });

  test.each(['', 'v1.2.3', '1.2.3-beta', '1..2', 'abc', '1.2.3+57'])(
    'should not parse %j',
    value => {
      expect(parseVersion(value)).toBeNull();
    },
  );
});

describe('isVersionInRange', () => {
  test.each(
    CASES.map(entry => [entry.version, entry.range, entry.satisfied] as const),
  )('should answer %s in %j with %s', (version, range, satisfied) => {
    const parsed = parseVersion(version);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }
    expect(isVersionInRange(parsed, range)).toBe(satisfied);
  });

  test.each([
    ['>= 1.2', '>=1.2'],
    ['> 1.2 < 2', '>1.2 <2'],
    ['<=\t2.4.1', '<=2.4.1'],
    ['=  1.2.3 || <  1', '=1.2.3 || <1'],
  ])('should read %j as %j', (range, joinedRange) => {
    for (const version of [
      [0, 9],
      [1, 2],
      [1, 2, 3, 4],
      [1, 3],
      [2, 4, 1],
    ]) {
      expect(isVersionInRange(version, joinedRange)).not.toBeNull();
      expect(isVersionInRange(version, range)).toBe(
        isVersionInRange(version, joinedRange),
      );
    }
  });

  test.each(['1.x.3', '1.*.3', '1.X.3', '1.x.x', 'x.1', '2.4.x.57'])(
    'should not parse %j when a component follows a wildcard',
    range => {
      expect(isVersionInRange([1, 2, 3], range)).toBeNull();
    },
  );

  test.each(['1.2x', '1.x2', 'xx'])(
    'should not parse %j when a component is neither a number nor a wildcard',
    range => {
      expect(isVersionInRange([1, 2, 3], range)).toBeNull();
    },
  );

  test.each(['>=', '1.2 >=', '> = 1.2', '>= >= 1.2'])(
    'should not parse %j when an operator is not followed by a version',
    range => {
      expect(isVersionInRange([1, 2, 3], range)).toBeNull();
    },
  );

  test('should not parse comparators when no whitespace separates them', () => {
    expect(isVersionInRange([1, 2, 3], '>=1.2<2')).toBeNull();
  });
});
