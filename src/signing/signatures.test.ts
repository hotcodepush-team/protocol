import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import { BundleManifestSchema } from '../wire/bundle-manifest.js';
import {
  resolvePublicKeyOfPrivateKey,
  signManifest,
  verifyManifestSignature,
} from './signatures.js';
import {
  generateSigningKeyPair,
  SIGNING_KEY_BITS_MINIMUM,
} from './signing-keys.js';

interface SignaturesFixture {
  keys: {
    bits: number;
    fingerprint: string;
    name: string;
    privateKey: string;
    publicKey: string;
  }[];
  manifests: {
    envelope: ManifestEnvelope;
    isValid: boolean;
    name: string;
    publicKeys: string[];
  }[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../fixtures/signatures.json', import.meta.url),
    'utf8',
  ),
) as SignaturesFixture;

const MANIFEST = {
  appId: 'a1',
  bundleVersion: '1.0.1',
  files: [],
  fingerprint: null,
  patches: [],
  platforms: ['ios'],
};

function resolvePrivateKeyOfName(keyName: string): string {
  const key = FIXTURE.keys.find(({ name }) => name === keyName);
  if (key === undefined) {
    throw new Error(`No fixture key is named ${keyName}.`);
  }
  return key.privateKey;
}

function resolvePrivateKeyOfKeyId(keyId: string): string {
  const key = FIXTURE.keys.find(({ fingerprint }) => fingerprint === keyId);
  if (key === undefined) {
    throw new Error(`No fixture key has the fingerprint ${keyId}.`);
  }
  return key.privateKey;
}

describe('verifyManifestSignature', () => {
  test.each(FIXTURE.manifests)(
    '$name',
    async ({ envelope, isValid, publicKeys }) => {
      expect(await verifyManifestSignature(envelope, publicKeys)).toBe(isValid);
    },
  );
});

describe('signManifest', () => {
  const validCases = FIXTURE.manifests.filter(({ isValid }) => isValid);

  test.each(validCases)(
    'should reproduce the manifest and the signature of the case: $name',
    async ({ envelope }) => {
      const signature = envelope.signature;
      if (signature === null) {
        throw new Error('A valid case is signed.');
      }
      const manifest = BundleManifestSchema.parse(
        JSON.parse(envelope.manifest),
      );
      expect(
        await signManifest(manifest, resolvePrivateKeyOfKeyId(signature.keyId)),
      ).toEqual({ manifest: envelope.manifest, signature });
    },
  );

  test('should name the signing key in the signed manifest', async () => {
    const { privateKey } = await generateSigningKeyPair();
    const { manifest, signature } = await signManifest(MANIFEST, privateKey);
    expect(BundleManifestSchema.parse(JSON.parse(manifest)).keyId).toBe(
      signature.keyId,
    );
  });

  test('should sign a manifest the verifier accepts with a generated key pair', async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const signed = await signManifest(MANIFEST, privateKey);
    expect(await verifyManifestSignature(signed, [publicKey])).toBe(true);
  });

  test('should refuse a private key that is not the base64 of a PKCS #8 key', async () => {
    await expect(
      signManifest(MANIFEST, 'rsa-v1_5-sha256:AQID'),
    ).rejects.toThrow(TypeError);
  });

  test('should refuse to sign with a key under the minimum size', async () => {
    await expect(
      signManifest(MANIFEST, resolvePrivateKeyOfName('rsa-1024')),
    ).rejects.toThrow(TypeError);
  });
});

describe('resolvePublicKeyOfPrivateKey', () => {
  test.each(
    FIXTURE.keys.filter(({ bits }) => bits >= SIGNING_KEY_BITS_MINIMUM),
  )(
    'should resolve the public half of $name',
    async ({ privateKey, publicKey }) => {
      expect(await resolvePublicKeyOfPrivateKey(privateKey)).toBe(publicKey);
    },
  );

  test('should refuse a private key that does not parse', async () => {
    await expect(resolvePublicKeyOfPrivateKey('not base64')).rejects.toThrow(
      TypeError,
    );
  });

  test('should refuse a private key under the minimum size', async () => {
    await expect(
      resolvePublicKeyOfPrivateKey(resolvePrivateKeyOfName('rsa-1024')),
    ).rejects.toThrow(TypeError);
  });
});
