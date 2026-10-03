import { describe, expect, test } from 'vitest';

import { encodeBase64 } from './base64.js';

describe('encodeBase64', () => {
  test.each([
    [[], ''],
    [[0xfb], '+w=='],
    [[0xfb, 0xff], '+/8='],
    [[0xfb, 0xff, 0xbf], '+/+/'],
  ])('should encode %j as %j', (bytes, base64) => {
    expect(encodeBase64(new Uint8Array(bytes))).toBe(base64);
  });
});
