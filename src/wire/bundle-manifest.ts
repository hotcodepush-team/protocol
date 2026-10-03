import { z } from 'zod';

import {
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

/** A patch the bundle offers: the file at `path` from the bytes of `fromSha256` to those of `toSha256`; an unknown format means the full file. */
export const ManifestPatchSchema = z.looseObject({
  format: NonEmptyStringSchema,
  fromSha256: Sha256HexSchema,
  path: RelativePathSchema,
  toSha256: Sha256HexSchema,
});
export type ManifestPatch = z.infer<typeof ManifestPatchSchema>;

/**
 * The bundle manifest: what the CLI knows before the upload, the bytes it
 * signs as canonical JSON when signing is on. Additive with no majors; the
 * file hashes bind the signature to the bytes, so the server's facts ride the
 * envelope beside it, unsigned. A reader keeps a platform it does not know.
 */
export const BundleManifestSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  bundleVersion: z.string(),
  files: z.array(ManifestFileSchema),
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The fingerprint of the key that signed the manifest, `null` when unsigned. */
  keyId: NonEmptyStringSchema.nullable(),
  patches: z.array(ManifestPatchSchema),
  platforms: z.array(NonEmptyStringSchema),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/** The embedded bundle's manifest in the resource file: the bundle manifest without patches, since nothing is ever patched to the embedded bundle. */
export const EmbeddedBundleManifestSchema = BundleManifestSchema.omit({
  patches: true,
});
export type EmbeddedBundleManifest = z.infer<
  typeof EmbeddedBundleManifestSchema
>;

export const EnvelopeDeltaSchema = z.looseObject({
  baseBundleId: IdentifierSchema,
  sizeBytes: SizeBytesSchema,
  url: z.url(),
});
export type EnvelopeDelta = z.infer<typeof EnvelopeDeltaSchema>;

export const EnvelopePatchSchema = ManifestPatchSchema.extend({
  sizeBytes: SizeBytesSchema,
  url: z.url(),
});
export type EnvelopePatch = z.infer<typeof EnvelopePatchSchema>;

/**
 * The document at the manifest's key, written by the server's `complete`:
 * the manifest as the signed string, the signature, the reserved encryption
 * slot and, unsigned beside them, the server's facts — the bundle's id and
 * creation time, and the pack, the deltas and the patches as stored.
 */
export const ManifestEnvelopeSchema = z.looseObject({
  bundleId: IdentifierSchema,
  createdAt: IsoTimestampSchema,
  deltas: z.array(EnvelopeDeltaSchema),
  encryption: z.null(),
  manifest: NonEmptyStringSchema,
  pack: z.looseObject({ sizeBytes: SizeBytesSchema, url: z.url() }),
  patches: z.array(EnvelopePatchSchema),
  signature: SignatureSchema.nullable(),
});
export type ManifestEnvelope = z.infer<typeof ManifestEnvelopeSchema>;
