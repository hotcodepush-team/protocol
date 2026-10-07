import { z } from 'zod';

import {
  HttpUrlSchema,
  IdentifierSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  RelativePathSchema,
  Sha256HexSchema,
  SignatureSchema,
  SizeBytesSchema,
} from './primitives.js';

export const ManifestFileSchema = z.looseObject({
  path: RelativePathSchema,
  sha256: Sha256HexSchema,
  sizeBytes: SizeBytesSchema,
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

/**
 * The bundle manifest: what the CLI knows before the upload, the bytes it
 * signs as canonical JSON when signing is on. Additive with no majors; the
 * file hashes bind the signature to the bytes, so the server's facts ride the
 * envelope beside it, unsigned. A reader keeps a platform it does not know,
 * and a field it does not know, such as the `patches` a manifest stored
 * before 2026-10-04 still carries. The embedded bundle's manifest in the
 * resource file is a bundle manifest too.
 */
export const BundleManifestSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  bundleVersion: z.string(),
  files: z.array(ManifestFileSchema),
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The fingerprint of the key that signed the manifest, `null` when unsigned. */
  keyId: NonEmptyStringSchema.nullable(),
  platforms: z.array(NonEmptyStringSchema),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

export const EnvelopeDeltaSchema = z.looseObject({
  baseBundleId: IdentifierSchema,
  sizeBytes: SizeBytesSchema,
  url: HttpUrlSchema,
});
export type EnvelopeDelta = z.infer<typeof EnvelopeDeltaSchema>;

/**
 * The document at the manifest's key, written by the server's `complete`:
 * the manifest as the signed string, the signature, the reserved encryption
 * slot and, unsigned beside them, the server's facts — the bundle's id and
 * creation time, and the pack and the deltas as stored. An envelope stored
 * before 2026-10-04 still carries `patches`, which a reader ignores.
 */
export const ManifestEnvelopeSchema = z.looseObject({
  bundleId: IdentifierSchema,
  createdAt: IsoTimestampSchema,
  deltas: z.array(EnvelopeDeltaSchema),
  encryption: z.null(),
  manifest: NonEmptyStringSchema,
  pack: z.looseObject({ sizeBytes: SizeBytesSchema, url: HttpUrlSchema }),
  signature: SignatureSchema.nullable(),
});
export type ManifestEnvelope = z.infer<typeof ManifestEnvelopeSchema>;
