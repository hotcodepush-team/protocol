import { describe, expect, test } from 'vitest';

import {
  AttributesSchema,
  hashAttribute,
  hashDeviceId,
  isValidAttributeKey,
  isValidAttributeValue,
} from './attributes.js';
import { computeSha256Hex } from './hash/sha256.js';

describe('isValidAttributeKey', () => {
  test.each(['userId', 'plan', 'a.b-c_d', 'x'.repeat(64)])(
    'should accept %s',
    key => {
      expect(isValidAttributeKey(key)).toBe(true);
    },
  );

  test.each(['', 'user id', 'ü', 'a/b', 'x'.repeat(65)])(
    'should reject %j',
    key => {
      expect(isValidAttributeKey(key)).toBe(false);
    },
  );
});

describe('isValidAttributeValue', () => {
  test.each(['', '42', 'beta cohort', 'Ünïcode ✓', 'x'.repeat(256)])(
    'should accept %j',
    value => {
      expect(isValidAttributeValue(value)).toBe(true);
    },
  );

  test.each(['a\nb', 'a\tb', '\u0000', 'x'.repeat(257)])(
    'should reject %j',
    value => {
      expect(isValidAttributeValue(value)).toBe(false);
    },
  );
});

describe('AttributesSchema', () => {
  test('should reject a record with an invalid key', () => {
    expect(AttributesSchema.safeParse({ 'user id': '42' }).success).toBe(false);
  });
});

describe('hashAttribute', () => {
  test('should hash the key, a NUL and the value', () => {
    expect(hashAttribute('userId', '42')).toBe(
      computeSha256Hex('userId\u000042'),
    );
  });

  test('should tell a shifted separator apart', () => {
    expect(hashAttribute('ab', 'c')).not.toBe(hashAttribute('a', 'bc'));
  });
});

describe('hashDeviceId', () => {
  test('should hash the device id alone', () => {
    expect(hashDeviceId('7c1f2b0e-2a4b-4d7c-9b7e-3f1a2c4d5e6f')).toBe(
      computeSha256Hex('7c1f2b0e-2a4b-4d7c-9b7e-3f1a2c4d5e6f'),
    );
  });
});
