import { describe, expect, test } from 'vitest';

import { hashAttribute, hashDeviceId } from './attributes.js';
import type { ReleaseCondition } from './release-conditions.js';
import {
  ReleaseConditionSchema,
  toWireCondition,
} from './release-conditions.js';

const DEVICE_ID = '7c1f2b0e-2a4b-4d7c-9b7e-3f1a2c4d5e6f';

describe('ReleaseConditionSchema', () => {
  test.each<ReleaseCondition>([
    { key: 'plan', type: 'attribute', value: 'beta' },
    { range: '>=2.0.0', type: 'binary' },
    { ids: [DEVICE_ID], type: 'device' },
    { fingerprint: 'fp1:abc', type: 'fingerprint' },
    { range: '>=17', type: 'os' },
  ])('should accept a raw $type condition', condition => {
    expect(ReleaseConditionSchema.safeParse(condition).success).toBe(true);
  });

  test.each([
    ['a bad key', { key: 'user id', type: 'attribute', value: 'beta' }],
    [
      'a value with a control character',
      { key: 'plan', type: 'attribute', value: 'be\u0000ta' },
    ],
    [
      'a value of 257 code points',
      { key: 'plan', type: 'attribute', value: 'ü'.repeat(257) },
    ],
    [
      'a hashed value',
      {
        key: 'plan',
        type: 'attribute',
        valueSha256: hashAttribute('plan', 'beta'),
      },
    ],
    ['an id that is no uuid', { ids: ['device-1'], type: 'device' }],
    [
      '501 ids',
      { ids: Array.from({ length: 501 }, () => DEVICE_ID), type: 'device' },
    ],
  ])('should refuse %s', (_name, condition) => {
    expect(ReleaseConditionSchema.safeParse(condition).success).toBe(false);
  });
});

describe('toWireCondition', () => {
  test('should hash an attribute value as the conditions-attribute fixture carries it', () => {
    expect(
      toWireCondition({ key: 'plan', type: 'attribute', value: 'beta' }),
    ).toStrictEqual({
      key: 'plan',
      type: 'attribute',
      valueSha256:
        'a0a6d2c8cf0615e4185237562c65f1022853674911e045ed3539c18171b1ac9c',
    });
  });

  test('should hash every device id', () => {
    expect(toWireCondition({ ids: [DEVICE_ID], type: 'device' })).toStrictEqual(
      { hashedIds: [hashDeviceId(DEVICE_ID)], type: 'device' },
    );
  });

  test('should pass a condition without a hash through', () => {
    const condition: ReleaseCondition = { range: '>=2.0.0', type: 'binary' };
    expect(toWireCondition(condition)).toStrictEqual(condition);
  });
});
