import { describe, expect, expectTypeOf, test } from 'vitest';

import type {
  HotCodePushApi,
  HotCodePushEventName,
  HotCodePushEvents,
  RolledBackEvent,
  UpdateFailedEvent,
} from './api.js';
import { HOT_CODE_PUSH_EVENT_NAMES } from './api.js';

type MethodName = {
  [Key in keyof HotCodePushApi]: HotCodePushApi[Key] extends (
    ...args: never[]
  ) => unknown
    ? Key
    : never;
}[keyof HotCodePushApi];

describe('HotCodePushApi', () => {
  test('should expose exactly the methods sdk-api.md names', () => {
    expectTypeOf<MethodName>().toEqualTypeOf<
      | 'addListener'
      | 'applyUpdate'
      | 'checkForUpdate'
      | 'clearUpdates'
      | 'downloadUpdate'
      | 'getChannel'
      | 'getDevice'
      | 'getState'
      | 'notifyReady'
      | 'removeAllListeners'
      | 'rollback'
      | 'setAttributes'
      | 'setChannel'
      | 'setRestartAllowed'
      | 'showDebugScreen'
      | 'sync'
    >();
  });

  test('should type a listener by its event name', () => {
    expectTypeOf<
      HotCodePushEvents['updateFailed']
    >().toEqualTypeOf<UpdateFailedEvent>();
    expectTypeOf<
      HotCodePushEvents['rolledBack']
    >().toEqualTypeOf<RolledBackEvent>();
  });
});

describe('HOT_CODE_PUSH_EVENT_NAMES', () => {
  test('should list the five events and nothing of a cycle', () => {
    expect([...HOT_CODE_PUSH_EVENT_NAMES]).toEqual([
      'downloadProgress',
      'rolledBack',
      'updateAvailable',
      'updateDownloaded',
      'updateFailed',
    ]);
    expectTypeOf<
      (typeof HOT_CODE_PUSH_EVENT_NAMES)[number]
    >().toEqualTypeOf<HotCodePushEventName>();
  });
});
