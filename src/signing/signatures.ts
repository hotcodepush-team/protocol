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
  resolveSigningKeyFingerprint,
} from './signing-keys.js';

/** The manifest the CLI built: every field but `keyId`, which signing sets to the signing key's fingerprint. */
export type ManifestToSign = Pick<
  BundleManifest,
  'appId' | 'bundleVersion' | 'files' | 'fingerprint' | 'platforms'
>;

/** The envelope's signed half, what the CLI sends with the bundle. */
export interface SignedManifest {
  /** The canonical JSON of the bundle manifest, the signed bytes. */
  manifest: string;
  signature: Signature;
}

interface SigningKey {
  cryptoKey: CryptoKey;
  /** The fingerprint of the key's public half. */
  keyId: string;
}

const SIGNATURE_ALGORITHM = 'RSASSA-PKCS1-v1_5';

/**
 * Signs the bundle manifest: `keyId` set to the signing key's fingerprint, the
 * canonical JSON of the result, the signature over those bytes.
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
 * Whether the envelope's signature covers its `manifest` bytes under the key
 * its `keyId` names among `publicKeys`; an unsigned envelope verifies against
 * no key, and so does a signature under an unknown scheme or by a key below
 * the minimum size.
 */
export async function verifyManifestSignature(
  envelope: Pick<ManifestEnvelope, 'manifest' | 'signature'>,
  publicKeys: readonly string[],
): Promise<boolean> {
  if (envelope.signature === null) {
    return false;
  }
  return verifyMessage(envelope.manifest, envelope.signature, publicKeys);
}

/**
 * The public half of a private key, self-describing: what a signer holds
 * names the `keyId` it signs under and the key a config lists.
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
    keyId: resolveSigningKeyFingerprint(
      await resolvePublicKeyOfCryptoKey(cryptoKey),
    ),
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
  signature: Signature,
  publicKeys: readonly string[],
): Promise<boolean> {
  const parsedValue = parseSelfDescribingBytes(signature.value);
  const publicKey = publicKeys.find(
    candidate =>
      parseSelfDescribingBytes(candidate) !== null &&
      resolveSigningKeyFingerprint(candidate) === signature.keyId,
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

/** The public half through the private key's JWK, which carries it. */
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
