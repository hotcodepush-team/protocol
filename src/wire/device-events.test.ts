import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  DeviceEventSchema,
  DeviceEventsRequestSchema,
  DeviceEventsResponseSchema,
} from './device-events.js';

interface DeviceEventsFixture {
  acceptedBatches: {
    batch: { events: unknown[] };
    name: string;
    skippedEventIndexes: number[];
  }[];
  refusedBatches: { batch: unknown; name: string }[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../fixtures/device-events.json', import.meta.url),
    'utf8',
  ),
) as DeviceEventsFixture;

/** The endpoint's reading: the batch whole, its events one by one, an unreadable one skipped. */
const DeviceBatchSchema = DeviceEventsRequestSchema.extend({
  events: z.array(z.unknown()),
});

describe('the events endpoint', () => {
  test.each(FIXTURE.acceptedBatches.map(accepted => [accepted.name, accepted]))(
    '%s',
    (_name, accepted) => {
      const { events } = accepted.batch;
      const skippedEventIndexes = events.flatMap((event, index) =>
        DeviceEventSchema.safeParse(event).success ? [] : [index],
      );
      const readableBatch = {
        ...accepted.batch,
        events: events.filter(
          (_event, index) => !skippedEventIndexes.includes(index),
        ),
      };
      expect(skippedEventIndexes).toEqual(accepted.skippedEventIndexes);
      expect(DeviceEventsRequestSchema.parse(readableBatch)).toEqual(
        readableBatch,
      );
    },
  );

  test.each(FIXTURE.refusedBatches.map(refused => [refused.name, refused]))(
    '%s',
    (_name, refused) => {
      expect(DeviceBatchSchema.safeParse(refused.batch).success).toBe(false);
    },
  );
});

describe('DeviceEventsResponseSchema', () => {
  test('should parse the acknowledgement', () => {
    const response = { reportedAt: '2026-09-29T10:00:00.000Z' };
    expect(DeviceEventsResponseSchema.parse(response)).toEqual(response);
  });
});
