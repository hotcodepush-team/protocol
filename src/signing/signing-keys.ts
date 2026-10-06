import { z } from 'zod';

import { encodeBase64 } from '../base64.js';
import { computeSha256Hex } from '../hash/sha256.js';

/**
 * The pinned allow-list, one scheme: RSASSA-PKCS1-v1_5 with SHA-256, which
 * both platforms' own APIs verify. A value's prefix selects within the list
 * and never extends it, so the algorithm is never the signer's choice; a value
 * under any other prefix names an unknown scheme.
 */
export const SIGNING_SCHEMES = ['rsa-v1_5-sha256'] as const;
export type SigningScheme = (typeof SIGNING_SCHEMES)[number];

/** A key under this size is refused wherever a key is imported. */
export const SIGNING_KEY_BITS_MINIMUM = 2048;

/**
 * A key pair: the public key self-describing, `rsa-v1_5-sha256:` and the
 * base64 of its SPKI DER, as `hotcodepush.json` lists it; the private key the
 * base64 of its PKCS #8 DER, one line, the secret a CI holds.
 */
export interface SigningKeyPair {
  privateKey: string;
  publicKey: string;
}

export interface SelfDescribingBytes {
  bytes: Uint8Array<ArrayBuffer>;
  scheme: SigningScheme;
}

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/;

const GENERATED_SIGNING_KEY_BITS = 4096;

const SIGNING_ALGORITHM: RsaHashedImportParams = {
  hash: 'SHA-256',
  name: 'RSASSA-PKCS1-v1_5',
};

const SIGNING_SCHEME: SigningScheme = 'rsa-v1_5-sha256';

/**
 * A public key in the form the verifier selects by: the scheme of the
 * allow-list and canonical base64. The schema reads no key bytes; whether Web
 * Crypto takes the key, and at what size, is `isAcceptedSigningPublicKey`.
 */
export const SigningPublicKeySchema = z
  .string()
  .refine(
    publicKey => parseSelfDescribingBytes(publicKey) !== null,
    'must be `rsa-v1_5-sha256:<base64>`',
  );

/** The pair Web Crypto generates: RSA of 4096 bits. */
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

/**
 * Whether the public key is one a signature may be verified with: Web Crypto
 * imports it as an RSA key of at least the minimum size.
 */
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
 * The key's fingerprint, `sha256:` and the SHA-256 of its SPKI bytes in hex: a
 * signature's `keyId`, which selects the key it is verified with.
 */
export function resolveSigningKeyFingerprint(publicKey: string): string {
  const parsedKey = parseSelfDescribingBytes(publicKey);
  if (parsedKey === null) {
    throw new TypeError('The public key is not a self-describing signing key.');
  }
  return `sha256:${computeSha256Hex(parsedKey.bytes)}`;
}

/** The public key as `<scheme>:<base64 of its SPKI DER>`. */
export async function exportSigningPublicKey(
  publicKey: CryptoKey,
): Promise<string> {
  return formatSelfDescribingBytes(
    await crypto.subtle.exportKey('spki', publicKey),
  );
}

/** The private key of a signer, from the base64 of its PKCS #8 DER. */
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

/** The public key of a verifier, from its self-describing form. */
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

/**
 * Splits `<scheme>:<base64>`; null for a scheme outside the allow-list or
 * base64 that is not canonical, so one value has exactly one spelling.
 */
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

/** The size comes from the key Web Crypto imported, never from its bytes. */
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
  if (!CANONICAL_BASE64_PATTERN.test(base64)) {
    return null;
  }
  const bytes = Uint8Array.from(atob(base64), character =>
    character.charCodeAt(0),
  );
  // Unused bits in the last character decode the same bytes as zero bits would.
  return encodeBase64(bytes) === base64 ? bytes : null;
}

function isSigningScheme(scheme: string): scheme is SigningScheme {
  return (SIGNING_SCHEMES as readonly string[]).includes(scheme);
}
