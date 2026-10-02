import { stringifyCanonicalJson } from '../canonical-json.js';
import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import type { RollBackToEmbeddedDirective } from '../wire/channel-index.js';
import type { Signature } from '../wire/primitives.js';
import {
  formatSelfDescribingBytes,
  parseSelfDescribingBytes,
  parseSigningPublicKey,
  resolveSigningKeyFingerprint,
} from './signing-keys.js';
import type { SelfDescribingBytes, SigningScheme } from './signing-keys.js';

/** The app and channel a `rollBackToEmbedded` directive is signed for, so it cannot be replayed elsewhere. */
export interface RollBackToEmbeddedChannel {
  appId: string;
  channelId: string;
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

/** Signs the envelope's `manifest` string, the canonical JSON of the bundle manifest, byte for byte. */
export function signManifest(
  manifest: string,
  privateKey: string,
): Promise<Signature> {
  return signMessage(manifest, privateKey);
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

/** Signs the canonical JSON of `{ aboveNumber, appId, channelId }`. */
export function signRollBackToEmbedded(
  directive: Pick<RollBackToEmbeddedDirective, 'aboveNumber'>,
  channel: RollBackToEmbeddedChannel,
  privateKey: string,
): Promise<Signature> {
  return signMessage(
    buildRollBackToEmbeddedMessage(directive, channel),
    privateKey,
  );
}

/**
 * Whether the directive's signature covers its `aboveNumber` for this app and
 * channel, the ones the device is configured with, never the index's own.
 */
export async function verifyRollBackToEmbeddedSignature(
  directive: RollBackToEmbeddedDirective,
  channel: RollBackToEmbeddedChannel,
  publicKeys: readonly string[],
): Promise<boolean> {
  if (directive.signature === null) {
    return false;
  }
  return verifyMessage(
    buildRollBackToEmbeddedMessage(directive, channel),
    directive.signature,
    publicKeys,
  );
}

function buildRollBackToEmbeddedMessage(
  { aboveNumber }: Pick<RollBackToEmbeddedDirective, 'aboveNumber'>,
  { appId, channelId }: RollBackToEmbeddedChannel,
): string {
  return stringifyCanonicalJson({ aboveNumber, appId, channelId });
}

async function signMessage(
  message: string,
  privateKey: string,
): Promise<Signature> {
  const parsedKey = parseSelfDescribingBytes(privateKey);
  if (parsedKey === null) {
    throw new TypeError(
      'The private key is not a self-describing signing key.',
    );
  }
  const algorithms = SCHEME_ALGORITHMS[parsedKey.scheme];
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    parsedKey.bytes,
    algorithms.imported,
    true,
    ['sign'],
  );
  const signatureBytes = await crypto.subtle.sign(
    algorithms.signed,
    cryptoKey,
    new TextEncoder().encode(message),
  );
  const publicKey = await resolvePublicKeyOfPrivateKey(
    cryptoKey,
    parsedKey.scheme,
  );
  return {
    keyId: resolveSigningKeyFingerprint(publicKey),
    value: formatSelfDescribingBytes(parsedKey.scheme, signatureBytes),
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

/** The public half through the private key's JWK, which carries it. */
async function resolvePublicKeyOfPrivateKey(
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
