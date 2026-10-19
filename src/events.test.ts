import { describe, expect, expectTypeOf, test } from 'vitest';

import type {
  HotCodePushEventName,
  HotCodePushEvents,
  UpdateFailedEvent,
  UpdateRolledBackEvent,
} from './events.js';
import { HOT_CODE_PUSH_EVENT_NAMES } from './events.js';
import type { ApplyStrategy } from './results.js';

describe('HotCodePushEvents', () => {
  test('should map an event name to its payload', () => {
    expectTypeOf<
      HotCodePushEvents['updateFailed']
    >().toEqualTypeOf<UpdateFailedEvent>();
    expectTypeOf<
      HotCodePushEvents['updateRolledBack']
    >().toEqualTypeOf<UpdateRolledBackEvent>();
  });

  test('should say when a downloaded update is applied, manual included', () => {
    expectTypeOf<
      HotCodePushEvents['updateDownloaded']['applyStrategy']
    >().toEqualTypeOf<Exclude<ApplyStrategy, 'immediate'>>();
  });
});

describe('HOT_CODE_PUSH_EVENT_NAMES', () => {
  test('should list the five events and nothing of a cycle', () => {
    expect([...HOT_CODE_PUSH_EVENT_NAMES]).toEqual([
      'downloadProgress',
      'updateAvailable',
      'updateDownloaded',
      'updateFailed',
      'updateRolledBack',
    ]);
    expectTypeOf<
      (typeof HOT_CODE_PUSH_EVENT_NAMES)[number]
    >().toEqualTypeOf<HotCodePushEventName>();
  });
});
