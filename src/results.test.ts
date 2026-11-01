import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { CATALOG } from './results.js';

const CATALOG_URL = new URL('../catalog.json', import.meta.url);
const LOWERCASE_SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

describe('CATALOG', () => {
  test('should equal the committed catalog.json', () => {
    expect(
      JSON.parse(readFileSync(CATALOG_URL, 'utf8')),
      'catalog.json is stale: run npm run catalog',
    ).toEqual(CATALOG);
  });

  test.each(Object.entries(CATALOG))(
    'should spell every %s value in lowercase snake_case',
    (_name, values) => {
      for (const value of values) {
        expect(value).toMatch(LOWERCASE_SNAKE_CASE_PATTERN);
      }
    },
  );
});
