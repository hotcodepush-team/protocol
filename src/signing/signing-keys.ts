import { z } from 'zod';

import { encodeBase64 } from '../base64.js';
import { computeSha256Hex } from '../hash/sha256.js';

/**
 * The pinned allow-list: a self-describing prefix selects a scheme within it
 * and never extends it, so the algorithm is never the signer's choice.
 */
export const SIGNING_SCHEMES = ['ed25519', 'rsa-v1_5-sha256'] as const;
export type SigningScheme = (typeof SIGNING_SCHEMES)[number];

/**
 * A key pair in the self-describing form `<scheme>:<base64>`: the public key
 * raw for `ed25519` and SPKI DER for `rsa-v1_5-sha256`, the private key PKCS #8
 * DER for both.
 */
export interface SigningKeyPair {
  privateKey: string;
  publicKey: string;
}

export interface SelfDescribingBytes {
  bytes: Uint8Array<ArrayBuffer>;
  scheme: SigningScheme;
}

const ED25519_PUBLIC_KEY_LENGTH = 32;
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/;

/** A public key the verifier can select: a scheme of the allow-list and well-formed key bytes. */
export const SigningPublicKeySchema = z
  .string()
  .refine(
    publicKey => parseSigningPublicKey(publicKey) !== null,
    'must be `ed25519:<base64>` or `rsa-v1_5-sha256:<base64>`',
  );

const SCHEME_GENERATION: Record<
  SigningScheme,
  {
    algorithm: AlgorithmIdentifier | RsaHashedKeyGenParams;
    publicKeyFormat: 'raw' | 'spki';
  }
> = {
  'ed25519': { algorithm: { name: 'Ed25519' }, publicKeyFormat: 'raw' },
  'rsa-v1_5-sha256': {
    algorithm: {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    publicKeyFormat: 'spki',
  },
};

/**
 * The pair Web Crypto generates for a scheme of the allow-list: `ed25519`,
 * the platform's default, or `rsa-v1_5-sha256`, the pair an Expo-bridge app
 * carries beside it, 2048 bits as Expo's own certificates are.
 */
export async function generateSigningKeyPair(
  scheme: SigningScheme = 'ed25519',
): Promise<SigningKeyPair> {
  const generation = SCHEME_GENERATION[scheme];
  const keyPair = (await crypto.subtle.generateKey(generation.algorithm, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const privateKeyBytes = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey,
  );
  const publicKeyBytes = await crypto.subtle.exportKey(
    generation.publicKeyFormat,
    keyPair.publicKey,
  );
  return {
    privateKey: formatSelfDescribingBytes(scheme, privateKeyBytes),
    publicKey: formatSelfDescribingBytes(scheme, publicKeyBytes),
  };
}

/**
 * The key's fingerprint, `sha256:` and the SHA-256 of its key bytes in hex: a
 * signature's `keyId`, which selects the key it is verified with.
 */
export function resolveSigningKeyFingerprint(publicKey: string): string {
  const parsedKey = parseSigningPublicKey(publicKey);
  if (parsedKey === null) {
    throw new TypeError('The public key is not a self-describing signing key.');
  }
  return `sha256:${computeSha256Hex(parsedKey.bytes)}`;
}

export function parseSigningPublicKey(
  publicKey: string,
): SelfDescribingBytes | null {
  const parsedKey = parseSelfDescribingBytes(publicKey);
  if (
    parsedKey?.scheme === 'ed25519' &&
    parsedKey.bytes.length !== ED25519_PUBLIC_KEY_LENGTH
  ) {
    return null;
  }
  return parsedKey;
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
  const base64 = value.slice(separatorIndex + 1);
  if (
    separatorIndex === -1 ||
    !isSigningScheme(scheme) ||
    !CANONICAL_BASE64_PATTERN.test(base64)
  ) {
    return null;
  }
  const bytes = Uint8Array.from(atob(base64), character =>
    character.charCodeAt(0),
  );
  // Unused bits in the last character decode the same bytes as zero bits would.
  return encodeBase64(bytes) === base64 ? { bytes, scheme } : null;
}

export function formatSelfDescribingBytes(
  scheme: SigningScheme,
  bytes: ArrayBuffer | Uint8Array,
): string {
  return `${scheme}:${encodeBase64(new Uint8Array(bytes))}`;
}

function isSigningScheme(scheme: string): scheme is SigningScheme {
  return (SIGNING_SCHEMES as readonly string[]).includes(scheme);
}
