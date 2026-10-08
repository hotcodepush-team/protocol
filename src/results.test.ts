import { describe, expectTypeOf, test } from 'vitest';

import type {
  ApplyResult,
  ApplyStrategy,
  CheckStrategy,
  DownloadResult,
  DownloadStrategy,
  GetChannelResult,
  GetDeviceResult,
  InstallMoment,
  MandatoryApplyStrategy,
  Platform,
  ReadySignal,
  Release,
  SyncOptions,
  SyncResult,
  SyncTrigger,
} from './results.js';

describe('GetChannelResult', () => {
  test('should allow a null id while no id is known', () => {
    expectTypeOf<GetChannelResult['id']>().toEqualTypeOf<string | null>();
  });
});

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

describe('the strategies', () => {
  test('should name the two check strategies', () => {
    expectTypeOf<CheckStrategy>().toEqualTypeOf<'auto' | 'manual'>();
  });

  test('should name the four apply strategies with next-resume', () => {
    expectTypeOf<ApplyStrategy>().toEqualTypeOf<
      'immediate' | 'manual' | 'next-resume' | 'next-start'
    >();
    expectTypeOf<InstallMoment>().toEqualTypeOf<ApplyStrategy>();
  });

  test('should keep next-start out of the mandatory apply strategies', () => {
    expectTypeOf<MandatoryApplyStrategy>().toEqualTypeOf<
      'immediate' | 'manual'
    >();
  });

  test('should let a sync call override each stage', () => {
    expectTypeOf<SyncOptions>().toEqualTypeOf<{
      applyStrategy?: ApplyStrategy;
      downloadStrategy?: DownloadStrategy;
      mandatoryApplyStrategy?: MandatoryApplyStrategy;
    }>();
    expectTypeOf<DownloadStrategy>().toEqualTypeOf<
      'auto' | 'manual' | 'unmetered'
    >();
  });

  test('should end the readiness gate on render or a manual call', () => {
    expectTypeOf<ReadySignal>().toEqualTypeOf<'manual' | 'render'>();
  });

  test('should name the manual trigger, never call', () => {
    expectTypeOf<SyncTrigger>().toEqualTypeOf<
      'interval' | 'manual' | 'resume' | 'start'
    >();
  });
});

describe('the stage results', () => {
  test('should let a sync resolve AVAILABLE when the download stayed manual', () => {
    expectTypeOf<Extract<SyncResult, { status: 'AVAILABLE' }>>().toEqualTypeOf<{
      downloadBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'AVAILABLE';
    }>();
    expectTypeOf<SyncResult['status']>().toEqualTypeOf<
      'AVAILABLE' | 'FAILED' | 'SKIPPED' | 'UPDATED' | 'UP_TO_DATE'
    >();
  });

  test('should name the four download statuses', () => {
    expectTypeOf<DownloadResult['status']>().toEqualTypeOf<
      'DOWNLOADED' | 'FAILED' | 'SKIPPED' | 'UP_TO_DATE'
    >();
  });

  test('should name the two apply statuses', () => {
    expectTypeOf<ApplyResult['status']>().toEqualTypeOf<
      'APPLIED' | 'NOTHING_TO_APPLY'
    >();
  });
});
