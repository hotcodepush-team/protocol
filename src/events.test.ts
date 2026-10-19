import { describe, expectTypeOf, test } from 'vitest';

import type {
  HotCodePushEvents,
  UpdateFailedEvent,
  UpdateRolledBackEvent,
} from './events.js';
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
