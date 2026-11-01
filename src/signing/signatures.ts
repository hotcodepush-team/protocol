import { stringifyCanonicalJson } from '../canonical-json.js';
import type {
  BundleManifest,
  ManifestEnvelope,
} from '../wire/bundle-manifest.js';
import type { Signature } from '../wire/primitives.js';
import {
  exportSigningPublicKey,
  formatSelfDescribingBytes,
  importSigningPrivateKey,
  importSigningPublicKey,
  parseSelfDescribingBytes,
  resolveSigningKeyId,
} from './signing-keys.js';

/** The manifest the CLI built, without `keyId`. Signing sets `keyId` to the key id of the signing key. */
export type ManifestToSign = Pick<
  BundleManifest,
  'appId' | 'bundleVersion' | 'files' | 'fingerprint' | 'platforms'
>;

/** The signed half of the envelope, which the CLI sends with the bundle. */
export interface SignedManifest {
  /** The canonical JSON of the bundle manifest: the bytes the signature covers. */
  manifest: string;
  signature: Signature;
}

interface SigningKey {
  cryptoKey: CryptoKey;
  // The key id of the public key.
  keyId: string;
}

const SIGNATURE_ALGORITHM = 'RSASSA-PKCS1-v1_5';

/**
 * Signs the bundle manifest.
 * It sets `keyId` to the key id of the signing key and signs the canonical JSON of the result.
 */
export async function signManifest(
  manifest: ManifestToSign,
  privateKey: string,
): Promise<SignedManifest> {
  const signingKey = await resolveSigningKey(privateKey);
  const signedManifest = stringifyCanonicalJson({
    ...manifest,
    keyId: signingKey.keyId,
  });
  return {
    manifest: signedManifest,
    signature: await signMessage(signedManifest, signingKey),
  };
}

/**
 * Whether the signature covers the `manifest` bytes under the key in `publicKeys` that `keyId` names.
 * False for an unsigned envelope, an unknown scheme or a key below the minimum size.
 */
export async function verifyManifestSignature(
  envelope: Pick<ManifestEnvelope, 'manifest' | 'signature'>,
  publicKeys: readonly string[],
): Promise<boolean> {
  if (envelope.signature === null) {
    return false;
  }
  return verifyMessage(envelope.manifest, {
    publicKeys,
    signature: envelope.signature,
  });
}

/**
 * Resolves the self-describing public key of a private key.
 * It tells a signer which key the config must list, and so which `keyId` it signs under.
 */
export async function resolvePublicKeyOfPrivateKey(
  privateKey: string,
): Promise<string> {
  return resolvePublicKeyOfCryptoKey(await importSigningPrivateKey(privateKey));
}

async function resolveSigningKey(privateKey: string): Promise<SigningKey> {
  const cryptoKey = await importSigningPrivateKey(privateKey);
  return {
    cryptoKey,
    keyId: resolveSigningKeyId(await resolvePublicKeyOfCryptoKey(cryptoKey)),
  };
}

async function signMessage(
  message: string,
  signingKey: SigningKey,
): Promise<Signature> {
  return {
    keyId: signingKey.keyId,
    value: formatSelfDescribingBytes(
      await crypto.subtle.sign(
        SIGNATURE_ALGORITHM,
        signingKey.cryptoKey,
        new TextEncoder().encode(message),
      ),
    ),
  };
}

async function verifyMessage(
  message: string,
  {
    publicKeys,
    signature,
  }: { publicKeys: readonly string[]; signature: Signature },
): Promise<boolean> {
  const parsedValue = parseSelfDescribingBytes(signature.value);
  const publicKey = publicKeys.find(
    candidate =>
      parseSelfDescribingBytes(candidate) !== null &&
      resolveSigningKeyId(candidate) === signature.keyId,
  );
  if (parsedValue === null || publicKey === undefined) {
    return false;
  }
  try {
    return await crypto.subtle.verify(
      SIGNATURE_ALGORITHM,
      await importSigningPublicKey(publicKey),
      parsedValue.bytes,
      new TextEncoder().encode(message),
    );
  } catch {
    // A key Web Crypto cannot import, or one below the minimum size, verifies nothing.
    return false;
  }
}

// The JWK of a private key carries its public half.
async function resolvePublicKeyOfCryptoKey(
  privateKey: CryptoKey,
): Promise<string> {
  const { e, kty, n } = await crypto.subtle.exportKey('jwk', privateKey);
  return exportSigningPublicKey(
    await crypto.subtle.importKey(
      'jwk',
      { e, kty, n },
      privateKey.algorithm as RsaHashedKeyAlgorithm,
      true,
      ['verify'],
    ),
  );
}
