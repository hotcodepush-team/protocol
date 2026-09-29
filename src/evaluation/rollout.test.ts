import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { resolveRolloutBucket } from './rollout.js';

interface BucketCase {
  bucket: number;
  deviceId: string;
  releaseId: string;
}

const CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/rollout-buckets.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: BucketCase[] }
).cases;

describe('resolveRolloutBucket', () => {
  test.each(
    CASES.map(
      entry => [entry.deviceId, entry.releaseId, entry.bucket] as const,
    ),
  )(
    'should put device %j and release %j into bucket %i',
    (deviceId, releaseId, bucket) => {
      expect(resolveRolloutBucket(deviceId, releaseId)).toBe(bucket);
    },
  );

  test('should stay within a hundred buckets', () => {
    for (let index = 0; index < 1000; index++) {
      const bucket = resolveRolloutBucket(`device-${index}`, 'release');
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });
});
