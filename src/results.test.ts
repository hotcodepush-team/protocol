import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, test } from 'vitest';

import type {
  ApplyMoment,
  ApplyStrategy,
  ApplyUpdateResult,
  ApplyUpdateStatus,
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
  SyncStatus,
  SyncTrigger,
} from './results.js';
import { CATALOG } from './results.js';

const CATALOG_URL = new URL('../catalog.json', import.meta.url);
const LOWERCASE_SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

describe('CATALOG', () => {
  test('should equal the committed catalog.json', () => {
    expect(
      JSON.parse(readFileSync(CATALOG_URL, 'utf8')),
      'catalog.json is stale: run npm run catalog',
    ).toEqual(CATALOG);
  });

  test.each(Object.entries(CATALOG))(
    'should spell every %s value in lowercase snake_case',
    (_name, values) => {
      for (const value of values) {
        expect(value).toMatch(LOWERCASE_SNAKE_CASE_PATTERN);
      }
    },
  );
});

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
});

describe('Platform', () => {
  test('should name the two platforms', () => {
    expectTypeOf<Platform>().toEqualTypeOf<'android' | 'ios'>();
  });
});

describe('the strategies', () => {
  test('should name the two check strategies', () => {
    expectTypeOf<CheckStrategy>().toEqualTypeOf<'auto' | 'manual'>();
  });

  test('should name the four apply strategies with next_resume', () => {
    expectTypeOf<ApplyStrategy>().toEqualTypeOf<
      'immediate' | 'manual' | 'next_resume' | 'next_start'
    >();
  });

  test('should keep manual out of the apply moments', () => {
    expectTypeOf<ApplyMoment>().toEqualTypeOf<
      'immediate' | 'next_resume' | 'next_start'
    >();
  });

  test('should keep next_start out of the mandatory apply strategies', () => {
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
  test('should name the six sync statuses, in the union as in the catalog', () => {
    expectTypeOf<SyncStatus>().toEqualTypeOf<
      | 'applied'
      | 'available'
      | 'downloaded'
      | 'failed'
      | 'skipped'
      | 'up_to_date'
    >();
    expectTypeOf<SyncResult['status']>().toEqualTypeOf<SyncStatus>();
  });

  test('should let a sync resolve available with the download size when the download stayed manual', () => {
    expectTypeOf<Extract<SyncResult, { status: 'available' }>>().toEqualTypeOf<{
      downloadSizeBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'available';
    }>();
  });

  test("should let a sync resolve downloaded with the moment of an apply that is scheduled or the app's", () => {
    expectTypeOf<
      Extract<SyncResult, { status: 'downloaded' }>
    >().toEqualTypeOf<{
      applyStrategy: 'manual' | 'next_resume' | 'next_start';
      notes: string | null;
      release: Release;
      status: 'downloaded';
    }>();
  });

  test('should name the four check statuses, nothing downloaded or applied', () => {
    expectTypeOf<CheckForUpdateResult['status']>().toEqualTypeOf<
      'available' | 'failed' | 'skipped' | 'up_to_date'
    >();
  });

  test('should name the five download statuses, never available', () => {
    expectTypeOf<DownloadUpdateResult['status']>().toEqualTypeOf<
      'applied' | 'downloaded' | 'failed' | 'skipped' | 'up_to_date'
    >();
  });

  test('should name the two apply statuses, in the union as in the catalog', () => {
    expectTypeOf<ApplyUpdateStatus>().toEqualTypeOf<
      'applied' | 'nothing_to_apply'
    >();
    expectTypeOf<
      ApplyUpdateResult['status']
    >().toEqualTypeOf<ApplyUpdateStatus>();
  });
});
