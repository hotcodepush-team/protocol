import { describe, expectTypeOf, test } from 'vitest';

import type {
  ApplyMoment,
  ApplyStrategy,
  ApplyUpdateResult,
  CheckForUpdateResult,
  CheckStrategy,
  DownloadStrategy,
  DownloadUpdateOptions,
  DownloadUpdateResult,
  GetChannelResult,
  GetDeviceResult,
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
  });

  test('should keep manual out of the apply moments', () => {
    expectTypeOf<ApplyMoment>().toEqualTypeOf<
      'immediate' | 'next-resume' | 'next-start'
    >();
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

  test('should let a download call override the apply stage alone', () => {
    expectTypeOf<DownloadUpdateOptions>().toEqualTypeOf<{
      applyStrategy?: ApplyStrategy;
      mandatoryApplyStrategy?: MandatoryApplyStrategy;
    }>();
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
  test('should name the six sync statuses', () => {
    expectTypeOf<SyncResult['status']>().toEqualTypeOf<
      | 'APPLIED'
      | 'AVAILABLE'
      | 'DOWNLOADED'
      | 'FAILED'
      | 'SKIPPED'
      | 'UP_TO_DATE'
    >();
  });

  test('should let a sync resolve AVAILABLE with the download size when the download stayed manual', () => {
    expectTypeOf<Extract<SyncResult, { status: 'AVAILABLE' }>>().toEqualTypeOf<{
      downloadSizeBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'AVAILABLE';
    }>();
  });

  test("should let a sync resolve DOWNLOADED with the moment of an apply that is scheduled or the app's", () => {
    expectTypeOf<
      Extract<SyncResult, { status: 'DOWNLOADED' }>
    >().toEqualTypeOf<{
      applyAt: 'manual' | 'next-resume' | 'next-start';
      notes: string | null;
      release: Release;
      status: 'DOWNLOADED';
    }>();
  });

  test('should name the four check statuses, nothing downloaded or applied', () => {
    expectTypeOf<CheckForUpdateResult['status']>().toEqualTypeOf<
      'AVAILABLE' | 'FAILED' | 'SKIPPED' | 'UP_TO_DATE'
    >();
  });

  test('should name the five download statuses, never AVAILABLE', () => {
    expectTypeOf<DownloadUpdateResult['status']>().toEqualTypeOf<
      'APPLIED' | 'DOWNLOADED' | 'FAILED' | 'SKIPPED' | 'UP_TO_DATE'
    >();
  });

  test('should name the two apply statuses', () => {
    expectTypeOf<ApplyUpdateResult['status']>().toEqualTypeOf<
      'APPLIED' | 'NOTHING_TO_APPLY'
    >();
  });
});
