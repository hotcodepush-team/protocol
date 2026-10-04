/**
 * Writes `fixtures/signatures.json` from the four test keys it already holds:
 * the keys stay, and every case is rebuilt and signed by the built package's
 * `signManifest`. RSASSA-PKCS1-v1_5 signs deterministically, so an unchanged
 * manifest yields the same file.
 *
 *     npm run build && node scripts/generate-signatures-fixture.ts
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import type * as Protocol from '../src/index.ts';

interface FixtureKey {
  bits: number;
  fingerprint: string;
  name: string;
  privateKey: string;
  publicKey: string;
}

interface SignedManifest {
  manifest: string;
  signature: Protocol.Signature | null;
}

const FIXTURE_URL = new URL('../fixtures/signatures.json', import.meta.url);
const PUBLIC_KEY_PREFIX = 'rsa-v1_5-sha256:';
const SIGNATURE_ALGORITHM = { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' };

// The built package, since Node runs this file but not the sources' `.js` imports.
const { signManifest, stringifyCanonicalJson } = (await import(
  new URL('../dist/index.js', import.meta.url).href
)) as typeof Protocol;

const KEYS = (
  JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as { keys: FixtureKey[] }
).keys;
const KEY_A = findKey('rsa-4096-a');
const KEY_B = findKey('rsa-4096-b');
const KEY_FLOOR = findKey('rsa-2048');
const KEY_SMALL = findKey('rsa-1024');

const MANIFEST = {
  appId: 'a1',
  bundleVersion: '1.0.1',
  files: [
    {
      path: 'assets/index-a1b2c3.js',
      sha256:
        'bed516453d68ad6b6c03290f64dd604b80a276f4abc75d7127be6507935d59d1',
      sizeBytes: 37,
    },
    {
      path: 'index.html',
      sha256:
        '8c8f3bf8856932916f7fbb68a6c7e47ecd0de8de67a7cc3083662235d2caa870',
      sizeBytes: 81,
    },
  ],
  fingerprint:
    'fp1:a0c0fb8fa5c59bbc0f00c9339d378525f68d0f8b942d4a787c4a18f76190a125',
  patches: [],
  platforms: ['android', 'ios'],
};

const signedByA = await signManifest(MANIFEST, KEY_A.privateKey);
const signedByB = await signManifest(MANIFEST, KEY_B.privateKey);
const signedByFloor = await signManifest(MANIFEST, KEY_FLOOR.privateKey);
const signedBySmall = await signWithoutChecks(KEY_SMALL, KEY_SMALL.fingerprint);
const signedByBUnderA = await signWithoutChecks(KEY_B, KEY_A.fingerprint);

const fixture = {
  description:
    "Signatures over the bundle manifest. One scheme is allowed, rsa-v1_5-sha256: RSASSA-PKCS1-v1_5 with SHA-256. A public key and a signature value are self-describing, `rsa-v1_5-sha256:<base64>`, the public key the base64 of its SPKI DER; a value under any other prefix, ed25519 included, names an unknown scheme and is refused. A private key is the base64 of its PKCS #8 DER. A key fingerprint is `sha256:` and the SHA-256 of the SPKI bytes in hex, and a signature's keyId is the fingerprint of the key it is verified with. A key under 2048 bits is refused wherever it is imported. A manifest signature covers the UTF-8 bytes of the envelope's manifest string, the canonical JSON of the bundle manifest, whose keyId is the fingerprint of the key that signs it and null when unsigned. Each case lists its keys three ways: publicKeys as hotcodepush.json lists them, and devicePublicKeys as a resource file carries them per platform — the base64 of the SPKI DER for android, of the PKCS #1 DER for ios, each beside its keyId. The keys are test keys.",
  keys: KEYS,
  manifests: [
    buildCase(
      'should accept a manifest signed by a listed key',
      signedByA,
      [KEY_A],
      true,
    ),
    buildCase(
      'should accept a manifest signed by a key of 2048 bits, the minimum',
      signedByFloor,
      [KEY_FLOOR],
      true,
    ),
    buildCase(
      'should select the key the keyId names among several',
      signedByA,
      [KEY_B, KEY_A, KEY_FLOOR],
      true,
    ),
    buildCase(
      'should refuse a manifest changed after signing',
      {
        ...signedByA,
        manifest: signedByA.manifest.replace(
          '"bundleVersion":"1.0.1"',
          '"bundleVersion":"1.0.2"',
        ),
      },
      [KEY_A],
      false,
    ),
    buildCase(
      'should refuse a signature changed after signing',
      {
        ...signedByA,
        signature: {
          ...signedByA.signature,
          value: flipFirstSignatureCharacter(signedByA.signature.value),
        },
      },
      [KEY_A],
      false,
    ),
    buildCase(
      'should refuse an unsigned manifest',
      {
        manifest: stringifyCanonicalJson({ ...MANIFEST, keyId: null }),
        signature: null,
      },
      [KEY_A],
      false,
    ),
    buildCase(
      'should refuse a signature by a key not in the list',
      signedByB,
      [KEY_A],
      false,
    ),
    buildCase(
      'should refuse a signature checked against the key its keyId names when another listed key made it',
      signedByBUnderA,
      [KEY_A, KEY_B],
      false,
    ),
    buildCase(
      'should refuse a scheme outside the allow-list, ed25519',
      {
        ...signedByA,
        signature: {
          keyId: KEY_A.fingerprint,
          value:
            'ed25519:1GP+qGsACCYnFnEQwrAary024EqZa6UNX9QiljIM6SAv5wmJ4ph/lIPfD0H7xN7QXxu+brdspejCCrQF1BLNBA==',
        },
      },
      [KEY_A],
      false,
    ),
    buildCase(
      'should refuse a signature by a key under 2048 bits',
      signedBySmall,
      [KEY_SMALL],
      false,
    ),
    buildCase(
      'should refuse every signature when no key is listed',
      signedByA,
      [],
      false,
    ),
  ],
};

writeFileSync(FIXTURE_URL, `${JSON.stringify(fixture, null, 2)}\n`);

function buildCase(
  name: string,
  { manifest, signature }: SignedManifest,
  keys: FixtureKey[],
  isValid: boolean,
) {
  return {
    name,
    envelope: { encryption: null, manifest, signature },
    publicKeys: keys.map(key => key.publicKey),
    devicePublicKeys: {
      android: keys.map(key => ({
        der: encodeSpkiDer(key),
        keyId: key.fingerprint,
      })),
      ios: keys.map(key => ({
        der: encodePkcs1Der(key),
        keyId: key.fingerprint,
      })),
    },
    isValid,
  };
}

function encodePkcs1Der(key: FixtureKey): string {
  return createPublicKey({
    format: 'der',
    key: Buffer.from(encodeSpkiDer(key), 'base64'),
    type: 'spki',
  })
    .export({ format: 'der', type: 'pkcs1' })
    .toString('base64');
}

function encodeSpkiDer(key: FixtureKey): string {
  return key.publicKey.slice(PUBLIC_KEY_PREFIX.length);
}

function findKey(name: string): FixtureKey {
  const key = KEYS.find(candidate => candidate.name === name);
  if (key === undefined) {
    throw new Error(`signatures.json holds no key named ${name}`);
  }
  return key;
}

function flipFirstSignatureCharacter(value: string): string {
  const signature = value.slice(PUBLIC_KEY_PREFIX.length);
  return `${PUBLIC_KEY_PREFIX}${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
}

/** A signature `signManifest` refuses to make: by a key under the minimum size, or under another key's id. */
async function signWithoutChecks(
  key: FixtureKey,
  keyId: string,
): Promise<SignedManifest> {
  const manifest = stringifyCanonicalJson({ ...MANIFEST, keyId });
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(key.privateKey, 'base64'),
    SIGNATURE_ALGORITHM,
    false,
    ['sign'],
  );
  const value = await crypto.subtle.sign(
    SIGNATURE_ALGORITHM.name,
    cryptoKey,
    new TextEncoder().encode(manifest),
  );
  return {
    manifest,
    signature: {
      keyId,
      value: `${PUBLIC_KEY_PREFIX}${Buffer.from(value).toString('base64')}`,
    },
  };
}
