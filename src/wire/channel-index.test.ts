import { describe, expect, test } from 'vitest';

import {
  CHANNEL_INDEX_SCHEMA,
  ChannelIndexSchema,
  ConditionSchema,
} from './channel-index.js';

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
