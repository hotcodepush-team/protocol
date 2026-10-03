import { stringifyCanonicalJson } from '../canonical-json.js';
import type {
  BundleManifest,
  ManifestEnvelope,
} from '../wire/bundle-manifest.js';
import type { Signature } from '../wire/primitives.js';
import {
  formatSelfDescribingBytes,
  parseSelfDescribingBytes,
  parseSigningPublicKey,
  resolveSigningKeyFingerprint,
} from './signing-keys.js';
import type { SelfDescribingBytes, SigningScheme } from './signing-keys.js';

/** The manifest the CLI built: every field but `keyId`, which signing sets to the signing key's fingerprint. */
export type ManifestToSign = Pick<
  BundleManifest,
  'appId' | 'bundleVersion' | 'files' | 'fingerprint' | 'patches' | 'platforms'
>;

/** The envelope's signed half, what the CLI sends with the bundle. */
export interface SignedManifest {
  /** The canonical JSON of the bundle manifest, the signed bytes. */
  manifest: string;
  signature: Signature;
}

interface SigningPrivateKey {
  cryptoKey: CryptoKey;
  /** The fingerprint of the key's public half. */
  keyId: string;
  scheme: SigningScheme;
}

interface SchemeAlgorithms {
  imported: AlgorithmIdentifier | RsaHashedImportParams;
  publicKeyFormat: 'raw' | 'spki';
  signed: AlgorithmIdentifier;
}

const SCHEME_ALGORITHMS: Record<SigningScheme, SchemeAlgorithms> = {
  'ed25519': {
    imported: { name: 'Ed25519' },
    publicKeyFormat: 'raw',
    signed: { name: 'Ed25519' },
  },
  'rsa-v1_5-sha256': {
    imported: { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    publicKeyFormat: 'spki',
    signed: { name: 'RSASSA-PKCS1-v1_5' },
  },
};

/**
 * Signs the bundle manifest: `keyId` set to the signing key's fingerprint, the
 * canonical JSON of the result, the signature over those bytes.
 */
export async function signManifest(
  manifest: ManifestToSign,
  privateKey: string,
): Promise<SignedManifest> {
  const signingKey = await importSigningPrivateKey(privateKey);
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
 * Signs a document's bytes as they are, under the key's fingerprint as
 * `keyId`: for a document that names no key in itself, the Expo-format
 * manifest the bridge serves verbatim.
 */
export async function signDocument(
  document: string,
  privateKey: string,
): Promise<Signature> {
  return signMessage(document, await importSigningPrivateKey(privateKey));
}

/**
 * Whether the envelope's signature covers its `manifest` bytes under the key
 * its `keyId` names among `publicKeys`; an unsigned envelope verifies against
 * no key.
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

async function importSigningPrivateKey(
  privateKey: string,
): Promise<SigningPrivateKey> {
  const parsedKey = parseSelfDescribingBytes(privateKey);
  if (parsedKey === null) {
    throw new TypeError(
      'The private key is not a self-describing signing key.',
    );
  }
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    parsedKey.bytes,
    SCHEME_ALGORITHMS[parsedKey.scheme].imported,
    true,
    ['sign'],
  );
  const publicKey = await resolvePublicKeyOfCryptoKey(
    cryptoKey,
    parsedKey.scheme,
  );
  return {
    cryptoKey,
    keyId: resolveSigningKeyFingerprint(publicKey),
    scheme: parsedKey.scheme,
  };
}

async function signMessage(
  message: string,
  signingKey: SigningPrivateKey,
): Promise<Signature> {
  const signatureBytes = await crypto.subtle.sign(
    SCHEME_ALGORITHMS[signingKey.scheme].signed,
    signingKey.cryptoKey,
    new TextEncoder().encode(message),
  );
  return {
    keyId: signingKey.keyId,
    value: formatSelfDescribingBytes(signingKey.scheme, signatureBytes),
  };
}

async function verifyMessage(
  message: string,
  signature: Signature,
  publicKeys: readonly string[],
): Promise<boolean> {
  const parsedValue = parseSelfDescribingBytes(signature.value);
  const parsedKey = resolvePublicKeyOfKeyId(publicKeys, signature.keyId);
  if (
    parsedValue === null ||
    parsedKey === null ||
    parsedKey.scheme !== parsedValue.scheme
  ) {
    return false;
  }
  const algorithms = SCHEME_ALGORITHMS[parsedKey.scheme];
  try {
    const cryptoKey = await crypto.subtle.importKey(
      algorithms.publicKeyFormat,
      parsedKey.bytes,
      algorithms.imported,
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      algorithms.signed,
      cryptoKey,
      parsedValue.bytes,
      new TextEncoder().encode(message),
    );
  } catch {
    // Key bytes Web Crypto cannot import verify nothing.
    return false;
  }
}

function resolvePublicKeyOfKeyId(
  publicKeys: readonly string[],
  keyId: string,
): SelfDescribingBytes | null {
  const publicKey = publicKeys.find(
    candidate =>
      parseSigningPublicKey(candidate) !== null &&
      resolveSigningKeyFingerprint(candidate) === keyId,
  );
  return publicKey === undefined ? null : parseSigningPublicKey(publicKey);
}

/**
 * The public half of a self-describing private key, in the same form: what a
 * signer holds names the `keyId` it signs under and the key a config lists.
 */
export async function resolvePublicKeyOfPrivateKey(
  privateKey: string,
): Promise<string> {
  const signingKey = await importSigningPrivateKey(privateKey);
  return resolvePublicKeyOfCryptoKey(signingKey.cryptoKey, signingKey.scheme);
}

/** The public half through the private key's JWK, which carries it. */
async function resolvePublicKeyOfCryptoKey(
  privateKey: CryptoKey,
  scheme: SigningScheme,
): Promise<string> {
  const algorithms = SCHEME_ALGORITHMS[scheme];
  const { crv, e, kty, n, x } = await crypto.subtle.exportKey(
    'jwk',
    privateKey,
  );
  const publicCryptoKey = await crypto.subtle.importKey(
    'jwk',
    { crv, e, kty, n, x },
    algorithms.imported,
    true,
    ['verify'],
  );
  const publicKeyBytes = await crypto.subtle.exportKey(
    algorithms.publicKeyFormat,
    publicCryptoKey,
  );
  return formatSelfDescribingBytes(scheme, publicKeyBytes);
}
