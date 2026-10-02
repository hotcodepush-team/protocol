import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  CHANNEL_INDEX_SCHEMA,
  ChannelIndexSchema,
  ConditionSchema,
  DEVICE_CONDITION_MAX_HASHED_IDS,
  RELEASE_MAX_CONDITIONS,
} from './channel-index.js';

interface BoundsFixture {
  deviceConditionMaxHashedIds: number;
  releaseMaxConditions: number;
}

interface WireRulesFixture {
  acceptedIndexes: { index: unknown; name: string }[];
  refusedIndexes: { index: unknown; name: string }[];
}

const BOUNDS = JSON.parse(
  readFileSync(new URL('../../fixtures/bounds.json', import.meta.url), 'utf8'),
) as BoundsFixture;

const WIRE_RULES = JSON.parse(
  readFileSync(
    new URL('../../fixtures/wire-rules.json', import.meta.url),
    'utf8',
  ),
) as WireRulesFixture;

const HASH = 'a'.repeat(64);

const RELEASE = {
  bundleId: 'b1',
  bundleVersion: '1.4.2',
  conditions: [{ range: '>=2.3.0', type: 'binary' }],
  createdAt: '2026-09-29T10:00:00.000Z',
  id: 'r1',
  isMandatory: false,
  manifestSha256: HASH,
  manifestUrl: 'https://files.hotcodepush.com/apps/a1/bundles/b1/manifest.json',
  notes: null,
  number: 42,
  rollout: 100,
  sizeBytes: 10485760,
};

const INDEX = {
  appId: 'a1',
  cappedAt: null,
  channelId: 'c1',
  isPaused: false,
  platform: 'ios',
  releases: [RELEASE],
  revokedReleaseIds: [],
  rollBackToEmbedded: null,
  schema: 1,
  sequence: 17,
};

describe('ChannelIndexSchema', () => {
  test('should parse the channel index', () => {
    expect(ChannelIndexSchema.parse(INDEX)).toEqual(INDEX);
  });

  test('should keep a field it does not know', () => {
    const parsed = ChannelIndexSchema.parse({ ...INDEX, later: true });
    expect(parsed).toHaveProperty('later', true);
  });

  test('should reject another schema major', () => {
    expect(ChannelIndexSchema.safeParse({ ...INDEX, schema: 2 }).success).toBe(
      false,
    );
  });

  test('should match the constant to the v1 in the path', () => {
    expect(CHANNEL_INDEX_SCHEMA).toBe(1);
  });

  test('should parse the directive with its signature', () => {
    const parsed = ChannelIndexSchema.parse({
      ...INDEX,
      rollBackToEmbedded: {
        aboveNumber: 41,
        signature: { keyId: 'k1', value: 'ed25519:AAAA' },
      },
    });
    expect(parsed.rollBackToEmbedded?.aboveNumber).toBe(41);
  });
});

describe('the wire rules', () => {
  test.each(
    WIRE_RULES.acceptedIndexes.map(accepted => [accepted.name, accepted]),
  )('%s', (_name, accepted) => {
    expect(ChannelIndexSchema.safeParse(accepted.index).success).toBe(true);
  });

  test.each(WIRE_RULES.refusedIndexes.map(refused => [refused.name, refused]))(
    '%s',
    (_name, refused) => {
      expect(ChannelIndexSchema.safeParse(refused.index).success).toBe(false);
    },
  );
});

describe('bounds', () => {
  test('should match the constants to the bounds fixture', () => {
    expect(DEVICE_CONDITION_MAX_HASHED_IDS).toBe(
      BOUNDS.deviceConditionMaxHashedIds,
    );
    expect(RELEASE_MAX_CONDITIONS).toBe(BOUNDS.releaseMaxConditions);
  });
});

describe('ConditionSchema', () => {
  test.each([
    { range: '>=2.3.0 <3.0.0', type: 'binary' },
    { type: 'runtime', version: '3' },
    { hash: 'fp1:abc', type: 'fingerprint' },
    { range: '>=17', type: 'os' },
    { hashedIds: [HASH], type: 'device' },
    { key: 'userId', type: 'attribute', valueSha256: HASH },
  ])('should parse the known condition %j', condition => {
    expect(ConditionSchema.parse(condition)).toEqual(condition);
  });

  test('should parse an unknown condition type as it is', () => {
    const condition = { region: 'eu', type: 'geo' };
    expect(ConditionSchema.parse(condition)).toEqual(condition);
  });

  test('should reject a known condition type with a wrong shape', () => {
    expect(ConditionSchema.safeParse({ type: 'binary' }).success).toBe(false);
  });
});
