// Run with `npm run build && node scripts/generate-signatures-fixture.ts`.
// It keeps the test keys in the fixture and re-signs every case. RSASSA-PKCS1-v1_5 is deterministic, so the output is stable.
import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import type * as Protocol from '../src/index.ts';

interface FixtureKey {
  bits: number;
  keyId: string;
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

// Node can run this file but not the `.js` imports inside src/, so it loads the build.
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
    'fp1:80dcb8300bb3c1c8acf608d8f85ce8fb0d0303d2e7160854b296a1142aec492d',
  platforms: ['android', 'ios'],
};

const signedByA = await signManifest(MANIFEST, KEY_A.privateKey);
const signedByB = await signManifest(MANIFEST, KEY_B.privateKey);
const signedByFloor = await signManifest(MANIFEST, KEY_FLOOR.privateKey);
const signedBySmall = await signWithoutChecks(KEY_SMALL, KEY_SMALL.keyId);
const signedByBUnderA = await signWithoutChecks(KEY_B, KEY_A.keyId);

const fixture = {
  description:
    "Signatures over the bundle manifest. One scheme is allowed, rsa-v1_5-sha256: RSASSA-PKCS1-v1_5 with SHA-256. A public key and a signature value are self-describing, `rsa-v1_5-sha256:<base64>`, the public key the base64 of its SPKI DER; a value under any other prefix, ed25519 included, names an unknown scheme and is refused. A private key is the base64 of its PKCS #8 DER. A key's keyId is the key id: `sha256:` and the hex SHA-256 of the SPKI bytes, and a signature's keyId is the key id of the key it is verified with. A key under 2048 bits is refused wherever it is imported. A manifest signature covers the UTF-8 bytes of the envelope's manifest string, the canonical JSON of the bundle manifest, whose keyId is the key id of the key that signs it and null when unsigned. Each case lists its keys three ways: publicKeys as hotcodepush.json lists them, and devicePublicKeys as a resource file carries them per platform — the base64 of the SPKI DER for android, of the PKCS #1 DER for ios, each beside its keyId. The keys are test keys.",
  keys: KEYS,
  manifests: [
    buildCase('should accept a manifest signed by a listed key', {
      isValid: true,
      keys: [KEY_A],
      signedManifest: signedByA,
    }),
    buildCase(
      'should accept a manifest signed by a key of 2048 bits, the minimum',
      {
        isValid: true,
        keys: [KEY_FLOOR],
        signedManifest: signedByFloor,
      },
    ),
    buildCase('should select the key the keyId names among several', {
      isValid: true,
      keys: [KEY_B, KEY_A, KEY_FLOOR],
      signedManifest: signedByA,
    }),
    buildCase('should refuse a manifest changed after signing', {
      isValid: false,
      keys: [KEY_A],
      signedManifest: {
        ...signedByA,
        manifest: signedByA.manifest.replace(
          '"bundleVersion":"1.0.1"',
          '"bundleVersion":"1.0.2"',
        ),
      },
    }),
    buildCase('should refuse a signature changed after signing', {
      isValid: false,
      keys: [KEY_A],
      signedManifest: {
        ...signedByA,
        signature: {
          ...signedByA.signature,
          value: flipFirstSignatureCharacter(signedByA.signature.value),
        },
      },
    }),
    buildCase('should refuse an unsigned manifest', {
      isValid: false,
      keys: [KEY_A],
      signedManifest: {
        manifest: stringifyCanonicalJson({ ...MANIFEST, keyId: null }),
        signature: null,
      },
    }),
    buildCase('should refuse a signature by a key not in the list', {
      isValid: false,
      keys: [KEY_A],
      signedManifest: signedByB,
    }),
    buildCase(
      'should refuse a signature checked against the key its keyId names when another listed key made it',
      {
        isValid: false,
        keys: [KEY_A, KEY_B],
        signedManifest: signedByBUnderA,
      },
    ),
    buildCase('should refuse a scheme outside the allow-list, ed25519', {
      isValid: false,
      keys: [KEY_A],
      signedManifest: {
        ...signedByA,
        signature: {
          keyId: KEY_A.keyId,
          value:
            'ed25519:1GP+qGsACCYnFnEQwrAary024EqZa6UNX9QiljIM6SAv5wmJ4ph/lIPfD0H7xN7QXxu+brdspejCCrQF1BLNBA==',
        },
      },
    }),
    buildCase('should refuse a signature by a key under 2048 bits', {
      isValid: false,
      keys: [KEY_SMALL],
      signedManifest: signedBySmall,
    }),
    buildCase('should refuse every signature when no key is listed', {
      isValid: false,
      keys: [],
      signedManifest: signedByA,
    }),
  ],
};

writeFileSync(FIXTURE_URL, `${JSON.stringify(fixture, null, 2)}\n`);

function buildCase(
  name: string,
  {
    isValid,
    keys,
    signedManifest: { manifest, signature },
  }: { isValid: boolean; keys: FixtureKey[]; signedManifest: SignedManifest },
) {
  return {
    name,
    envelope: { encryption: null, manifest, signature },
    publicKeys: keys.map(key => key.publicKey),
    devicePublicKeys: {
      android: keys.map(key => ({
        der: encodeSpkiDer(key),
        keyId: key.keyId,
      })),
      ios: keys.map(key => ({
        der: encodePkcs1Der(key),
        keyId: key.keyId,
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

// Makes the signatures that signManifest refuses: a key below the minimum size, or a foreign key id.
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
