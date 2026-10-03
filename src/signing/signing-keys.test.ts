import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  generateSigningKeyPair,
  resolveSigningKeyFingerprint,
  SigningPublicKeySchema,
} from './signing-keys.js';

interface SignaturesFixture {
  keys: { fingerprint: string; name: string; publicKey: string }[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../fixtures/signatures.json', import.meta.url),
    'utf8',
  ),
) as SignaturesFixture;

describe('resolveSigningKeyFingerprint', () => {
  test.each(FIXTURE.keys)(
    'should resolve the fingerprint of $name',
    ({ fingerprint, publicKey }) => {
      expect(resolveSigningKeyFingerprint(publicKey)).toBe(fingerprint);
    },
  );

  test('should refuse a key that does not parse', () => {
    expect(() => resolveSigningKeyFingerprint('ed25519:')).toThrow(TypeError);
  });
});

describe('SigningPublicKeySchema', () => {
  test.each(FIXTURE.keys)('should accept $name', ({ publicKey }) => {
    expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(true);
  });

  test.each([
    [
      'when the scheme is outside the allow-list',
      `ecdsa-p256-sha256:${'A'.repeat(43)}=`,
    ],
    ['when the prefix is missing', `${'A'.repeat(43)}=`],
    ['when the base64 is not canonical', `ed25519:${'A'.repeat(42)}B=`],
    ['when the base64 lacks its padding', `ed25519:${'A'.repeat(43)}`],
    ['when an ed25519 key is not 32 bytes', `ed25519:${'A'.repeat(44)}`],
  ])('should refuse a key %s', (_condition, publicKey) => {
    expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(false);
  });
});

describe('generateSigningKeyPair', () => {
  test('should generate an ed25519 pair in the self-describing form by default', async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    expect(privateKey).toMatch(/^ed25519:/);
    expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(true);
  });

  test('should generate an rsa-v1_5-sha256 pair when asked for the scheme', async () => {
    const { privateKey, publicKey } =
      await generateSigningKeyPair('rsa-v1_5-sha256');
    expect(privateKey).toMatch(/^rsa-v1_5-sha256:/);
    expect(publicKey).toMatch(/^rsa-v1_5-sha256:/);
    expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(true);
  });
});
