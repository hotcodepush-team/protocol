import { z } from 'zod';

import { encodeBase64 } from '../base64.js';
import { computeSha256Hex } from '../hash/sha256.js';
import { Base64Schema } from '../wire/primitives.js';

/**
 * The pinned allow-list: RSASSA-PKCS1-v1_5 with SHA-256, which the native APIs of both platforms verify.
 * The prefix of a value selects from this list and never extends it, so the signer never picks the algorithm.
 */
export const SIGNING_SCHEMES = ['rsa-v1_5-sha256'] as const;
export type SigningScheme = (typeof SIGNING_SCHEMES)[number];

/** A key under this size is refused wherever a key is imported. */
export const SIGNING_KEY_BITS_MINIMUM = 2048;

/**
 * A key pair. `publicKey` is `rsa-v1_5-sha256:` and the base64 of the SPKI DER, as `hotcodepush.json` lists it.
 * `privateKey` is the base64 of the PKCS #8 DER on one line: the secret a CI holds.
 */
export interface SigningKeyPair {
  privateKey: string;
  publicKey: string;
}

export interface SelfDescribingBytes {
  bytes: Uint8Array<ArrayBuffer>;
  scheme: SigningScheme;
}

const GENERATED_SIGNING_KEY_BITS = 4096;

const SIGNING_ALGORITHM: RsaHashedImportParams = {
  hash: 'SHA-256',
  name: 'RSASSA-PKCS1-v1_5',
};

const SIGNING_SCHEME: SigningScheme = 'rsa-v1_5-sha256';

/**
 * A public key in self-describing form: an allow-listed scheme and canonical base64.
 * It does not read the key bytes. `isAcceptedSigningPublicKey` checks that Web Crypto imports the key.
 */
export const SigningPublicKeySchema = z
  .string()
  .refine(
    publicKey => parseSelfDescribingBytes(publicKey) !== null,
    'must be `rsa-v1_5-sha256:<base64>`',
  );

/** Generates a 4096-bit RSA key pair with Web Crypto. */
export async function generateSigningKeyPair(): Promise<SigningKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      ...SIGNING_ALGORITHM,
      modulusLength: GENERATED_SIGNING_KEY_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  return {
    privateKey: encodeBase64(
      new Uint8Array(
        await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      ),
    ),
    publicKey: await exportSigningPublicKey(keyPair.publicKey),
  };
}

/** Whether Web Crypto imports the public key as an RSA key of at least the minimum size. */
export async function isAcceptedSigningPublicKey(
  publicKey: string,
): Promise<boolean> {
  try {
    await importSigningPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the key fingerprint: `sha256:` and the hex SHA-256 of the SPKI bytes.
 * It is the `keyId` of a signature and selects the key that verifies it.
 */
export function resolveSigningKeyFingerprint(publicKey: string): string {
  const parsedKey = parseSelfDescribingBytes(publicKey);
  if (parsedKey === null) {
    throw new TypeError('The public key is not a self-describing signing key.');
  }
  return `sha256:${computeSha256Hex(parsedKey.bytes)}`;
}

export async function exportSigningPublicKey(
  publicKey: CryptoKey,
): Promise<string> {
  return formatSelfDescribingBytes(
    await crypto.subtle.exportKey('spki', publicKey),
  );
}

export async function importSigningPrivateKey(
  privateKey: string,
): Promise<CryptoKey> {
  const privateKeyBytes = decodeCanonicalBase64(privateKey);
  if (privateKeyBytes === null) {
    throw new TypeError('The private key is not the base64 of a PKCS #8 key.');
  }
  return assertSigningKeySize(
    await crypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      SIGNING_ALGORITHM,
      true,
      ['sign'],
    ),
  );
}

export async function importSigningPublicKey(
  publicKey: string,
): Promise<CryptoKey> {
  const parsedKey = parseSelfDescribingBytes(publicKey);
  if (parsedKey === null) {
    throw new TypeError('The public key is not a self-describing signing key.');
  }
  return assertSigningKeySize(
    await crypto.subtle.importKey(
      'spki',
      parsedKey.bytes,
      SIGNING_ALGORITHM,
      true,
      ['verify'],
    ),
  );
}

// Refuses base64 that is not canonical, so each value has exactly one spelling.
export function parseSelfDescribingBytes(
  value: string,
): SelfDescribingBytes | null {
  const separatorIndex = value.indexOf(':');
  const scheme = value.slice(0, separatorIndex);
  const bytes = decodeCanonicalBase64(value.slice(separatorIndex + 1));
  return separatorIndex === -1 || !isSigningScheme(scheme) || bytes === null
    ? null
    : { bytes, scheme };
}

export function formatSelfDescribingBytes(
  bytes: ArrayBuffer | Uint8Array,
): string {
  return `${SIGNING_SCHEME}:${encodeBase64(new Uint8Array(bytes))}`;
}

// Reads the size from the key Web Crypto imported, never from the raw bytes.
function assertSigningKeySize(key: CryptoKey): CryptoKey {
  const { modulusLength } = key.algorithm as RsaHashedKeyAlgorithm;
  if (modulusLength < SIGNING_KEY_BITS_MINIMUM) {
    throw new TypeError(
      `The signing key has ${modulusLength} bits, under the ${SIGNING_KEY_BITS_MINIMUM} a key needs.`,
    );
  }
  return key;
}

function decodeCanonicalBase64(base64: string): Uint8Array<ArrayBuffer> | null {
  if (!Base64Schema.safeParse(base64).success) {
    return null;
  }
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function isSigningScheme(scheme: string): scheme is SigningScheme {
  return (SIGNING_SCHEMES as readonly string[]).includes(scheme);
}
