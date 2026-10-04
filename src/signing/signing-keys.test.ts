import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  generateSigningKeyPair,
  isAcceptedSigningPublicKey,
  resolveSigningKeyFingerprint,
  SIGNING_KEY_BITS_MINIMUM,
  SigningPublicKeySchema,
} from './signing-keys.js';

interface SignaturesFixture {
  keys: {
    bits: number;
    fingerprint: string;
    name: string;
    publicKey: string;
  }[];
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
    expect(() => resolveSigningKeyFingerprint('rsa-v1_5-sha256:')).toThrow(
      TypeError,
    );
  });
});

describe('SigningPublicKeySchema', () => {
  test.each(FIXTURE.keys)(
    'should accept the form of $name',
    ({ publicKey }) => {
      expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(true);
    },
  );

  test.each([
    [
      'when the scheme is ed25519, which left the allow-list',
      'ed25519:NYn5qxMGX39y0hB0UZzOG8KFtzCesZ+/dRZQBTFeCz4=',
    ],
    [
      'when the scheme is outside the allow-list',
      `ecdsa-p256-sha256:${'A'.repeat(43)}=`,
    ],
    ['when the prefix is missing', `${'A'.repeat(43)}=`],
    ['when the base64 is not canonical', `rsa-v1_5-sha256:${'A'.repeat(42)}B=`],
    ['when the base64 lacks its padding', `rsa-v1_5-sha256:${'A'.repeat(43)}`],
  ])('should refuse a key %s', (_condition, publicKey) => {
    expect(SigningPublicKeySchema.safeParse(publicKey).success).toBe(false);
  });
});

describe('isAcceptedSigningPublicKey', () => {
  test.each(FIXTURE.keys)(
    'should accept $name only at the minimum size or above',
    async ({ bits, publicKey }) => {
      expect(await isAcceptedSigningPublicKey(publicKey)).toBe(
        bits >= SIGNING_KEY_BITS_MINIMUM,
      );
    },
  );

  test('should refuse bytes Web Crypto does not import as an RSA key', async () => {
    expect(await isAcceptedSigningPublicKey('rsa-v1_5-sha256:AQID')).toBe(
      false,
    );
  });

  test('should refuse a key under another scheme', async () => {
    expect(
      await isAcceptedSigningPublicKey(
        'ed25519:NYn5qxMGX39y0hB0UZzOG8KFtzCesZ+/dRZQBTFeCz4=',
      ),
    ).toBe(false);
  });
});

describe('generateSigningKeyPair', () => {
  test('should generate an RSA pair of 4096 bits: the public key self-describing, the private key the base64 of its PKCS #8 DER', async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(privateKey), character => character.charCodeAt(0)),
      { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
      false,
      ['sign'],
    );
    expect((importedKey.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(
      4096,
    );
    expect(publicKey).toMatch(/^rsa-v1_5-sha256:/);
    expect(await isAcceptedSigningPublicKey(publicKey)).toBe(true);
  });
});
