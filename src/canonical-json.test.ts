import { describe, expect, test } from 'vitest';

import { stringifyCanonicalJson } from './canonical-json.js';

describe('stringifyCanonicalJson', () => {
  test('should sort keys and drop whitespace', () => {
    expect(stringifyCanonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[1,2]},"b":1}',
    );
  });

  test('should sort keys by code unit, not by locale', () => {
    expect(stringifyCanonicalJson({ b: 1, B: 2, a: 3, _: 4 })).toBe(
      '{"B":2,"_":4,"a":3,"b":1}',
    );
  });

  test('should omit undefined members and keep null', () => {
    expect(stringifyCanonicalJson({ a: undefined, b: null })).toBe(
      '{"b":null}',
    );
  });

  test('should escape strings as JSON does', () => {
    expect(stringifyCanonicalJson('a"b\\c\n\u0001ü')).toBe(
      '"a\\"b\\\\c\\n\\u0001ü"',
    );
  });

  test('should write integers and decimals as JSON does', () => {
    expect(stringifyCanonicalJson([0, -1, 1.5, 1e21])).toBe('[0,-1,1.5,1e+21]');
  });

  test('should refuse a non-finite number', () => {
    expect(() => stringifyCanonicalJson(Number.NaN)).toThrow(TypeError);
  });

  test('should refuse a function', () => {
    expect(() => stringifyCanonicalJson(() => 1)).toThrow(TypeError);
  });

  test('should parse back to an equal document', () => {
    const document = {
      files: [{ path: 'a', sha256: 'b', sizeBytes: 3 }],
      version: '1.0',
    };
    expect(JSON.parse(stringifyCanonicalJson(document))).toEqual(document);
  });
});
