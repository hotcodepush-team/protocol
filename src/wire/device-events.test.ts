import { describe, expect, test } from 'vitest';

import {
  DeviceEventsRequestSchema,
  DeviceEventsResponseSchema,
} from './device-events.js';

const REQUEST = {
  deviceId: 'd1',
  events: [
    {
      condition: 'binary',
      reason: 'INCOMPATIBLE',
      releaseId: 'r2',
      status: 'SKIPPED',
      type: 'checked',
    },
    {
      bundleId: 'b1',
      bytes: 4096,
      packKind: 'delta',
      releaseId: 'r1',
      type: 'downloaded',
    },
    { releaseId: 'r1', type: 'applied' },
    { releaseId: 'r1', type: 'confirmed' },
    { reason: 'READY_TIMEOUT', releaseId: 'r1', type: 'failed' },
    {
      detail: 'checkout crashed on launch',
      reason: 'REPORTED_BY_APP',
      releaseId: 'r1',
      type: 'failed',
    },
    { reason: 'INVALID_SIGNATURE', releaseId: 'r2', type: 'failed' },
    { fromReleaseId: 'r1', toReleaseId: null, type: 'rolledBack' },
  ],
  platform: 'android',
  report: {
    attributes: { plan: 'beta' },
    binaryBuild: '57',
    binaryVersion: '2.4.1',
    channelId: 'c1',
    channelSource: 'config',
    embeddedBundleId: 'b0',
    fingerprint: 'fp1:a41b',
    osVersion: '14',
    releaseId: 'r1',
  },
  sdkVersion: '0.3.1',
};

describe('DeviceEventsRequestSchema', () => {
  test('should parse a batch with every event type', () => {
    expect(DeviceEventsRequestSchema.parse(REQUEST)).toEqual(REQUEST);
  });

  test('should parse a batch without a report', () => {
    expect(
      DeviceEventsRequestSchema.parse({ ...REQUEST, report: null }).report,
    ).toBeNull();
  });

  test('should reject a release id outside the identifier charset', () => {
    const events = [{ releaseId: '../r1', type: 'applied' }];
    expect(
      DeviceEventsRequestSchema.safeParse({ ...REQUEST, events }).success,
    ).toBe(false);
  });

  test('should reject an event type it does not know', () => {
    const events = [{ releaseId: 'r1', type: 'installed' }];
    expect(
      DeviceEventsRequestSchema.safeParse({ ...REQUEST, events }).success,
    ).toBe(false);
  });

  test('should reject a failure detail above 256 characters or with a control character', () => {
    const long = [
      {
        detail: 'a'.repeat(257),
        reason: 'REPORTED_BY_APP',
        releaseId: 'r1',
        type: 'failed',
      },
    ];
    const control = [
      {
        detail: 'a\nb',
        reason: 'REPORTED_BY_APP',
        releaseId: 'r1',
        type: 'failed',
      },
    ];
    expect(
      DeviceEventsRequestSchema.safeParse({ ...REQUEST, events: long }).success,
    ).toBe(false);
    expect(
      DeviceEventsRequestSchema.safeParse({ ...REQUEST, events: control })
        .success,
    ).toBe(false);
  });

  test('should reject an attribute with a control character', () => {
    const report = { ...REQUEST.report, attributes: { plan: 'a\nb' } };
    expect(
      DeviceEventsRequestSchema.safeParse({ ...REQUEST, report }).success,
    ).toBe(false);
  });
});

describe('DeviceEventsResponseSchema', () => {
  test('should parse the acknowledgement', () => {
    const response = { reportedAt: '2026-09-29T10:00:00.000Z' };
    expect(DeviceEventsResponseSchema.parse(response)).toEqual(response);
  });
});
