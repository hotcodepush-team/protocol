import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { stringifyCanonicalJson } from '../canonical-json.js';
import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import type { RollBackToEmbeddedDirective } from '../wire/channel-index.js';
import {
  signManifest,
  signRollBackToEmbedded,
  verifyManifestSignature,
  verifyRollBackToEmbeddedSignature,
} from './signatures.js';
import { generateSigningKeyPair } from './signing-keys.js';

interface SignaturesFixture {
  directives: {
    appId: string;
    channelId: string;
    directive: RollBackToEmbeddedDirective;
    isValid: boolean;
    name: string;
    publicKeys: string[];
    signedBytes: string;
  }[];
  keys: { fingerprint: string; name: string; privateKey: string }[];
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

function selectPrivateKey(keyId: string): string {
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

describe('verifyRollBackToEmbeddedSignature', () => {
  test.each(FIXTURE.directives)(
    '$name',
    async ({ appId, channelId, directive, isValid, publicKeys }) => {
      expect(
        await verifyRollBackToEmbeddedSignature(
          directive,
          { appId, channelId },
          publicKeys,
        ),
      ).toBe(isValid);
    },
  );

  test.each(FIXTURE.directives)(
    'should build the signed bytes of the case: $name',
    ({ appId, channelId, directive, signedBytes }) => {
      expect(
        stringifyCanonicalJson({
          aboveNumber: directive.aboveNumber,
          appId,
          channelId,
        }),
      ).toBe(signedBytes);
    },
  );
});

describe('signManifest', () => {
  const validCases = FIXTURE.manifests.filter(({ isValid }) => isValid);

  test.each(validCases)(
    'should reproduce the signature of the case: $name',
    async ({ envelope }) => {
      const signature = envelope.signature;
      if (signature === null) {
        throw new Error('A valid case is signed.');
      }
      expect(
        await signManifest(
          envelope.manifest,
          selectPrivateKey(signature.keyId),
        ),
      ).toEqual(signature);
    },
  );

  test('should sign a manifest the verifier accepts with a generated key pair', async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const manifest = stringifyCanonicalJson({ bundleId: 'b1' });
    const signature = await signManifest(manifest, privateKey);
    expect(
      await verifyManifestSignature({ manifest, signature }, [publicKey]),
    ).toBe(true);
  });

  test('should refuse a private key that is not self-describing', async () => {
    await expect(
      signManifest('{}', 'MC4CAQAwBQYDK2VwBCIEIA=='),
    ).rejects.toThrow(TypeError);
  });
});

describe('signRollBackToEmbedded', () => {
  test('should reproduce the signature of the signed directive', async () => {
    const [signedCase] = FIXTURE.directives.filter(({ isValid }) => isValid);
    const signature = signedCase?.directive.signature;
    if (
      signedCase === undefined ||
      signature === undefined ||
      signature === null
    ) {
      throw new Error('The fixture holds a signed directive.');
    }
    expect(
      await signRollBackToEmbedded(
        signedCase.directive,
        { appId: signedCase.appId, channelId: signedCase.channelId },
        selectPrivateKey(signature.keyId),
      ),
    ).toEqual(signature);
  });
});
