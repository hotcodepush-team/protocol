import { describe, expectTypeOf, test } from 'vitest';

import type { GetDeviceResult, Platform } from './results.js';

describe('GetDeviceResult', () => {
  test('should allow a null fingerprint', () => {
    expectTypeOf<GetDeviceResult['fingerprint']>().toEqualTypeOf<
      string | null
    >();
  });

  test('should report the web platform', () => {
    expectTypeOf<GetDeviceResult['platform']>().toEqualTypeOf<
      'android' | 'ios' | 'web'
    >();
  });
});

describe('Platform', () => {
  test('should keep the web platform out of the index and the events', () => {
    expectTypeOf<Platform>().toEqualTypeOf<'android' | 'ios'>();
  });
});
