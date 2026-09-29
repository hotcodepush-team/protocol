import { z } from 'zod';

import {
  IsoTimestampSchema,
  NonEmptyStringSchema,
  Sha256HexSchema,
  SignatureSchema,
  SizeBytesSchema,
} from './primitives.js';

export const ManifestFileSchema = z.looseObject({
  path: NonEmptyStringSchema,
  sha256: Sha256HexSchema,
  sizeBytes: SizeBytesSchema,
});
export type ManifestFile = z.infer<typeof ManifestFileSchema>;

export const ManifestDeltaSchema = z.looseObject({
  baseBundleId: NonEmptyStringSchema,
  sizeBytes: SizeBytesSchema,
  url: z.url(),
});
export type ManifestDelta = z.infer<typeof ManifestDeltaSchema>;

export const ManifestPatchSchema = z.looseObject({
  format: NonEmptyStringSchema,
  fromSha256: Sha256HexSchema,
  path: NonEmptyStringSchema,
  sizeBytes: SizeBytesSchema,
  toSha256: Sha256HexSchema,
  url: z.url(),
});
export type ManifestPatch = z.infer<typeof ManifestPatchSchema>;

/** The bundle manifest: content only, additive with no majors, signed by the CLI when signing is on. */
export const BundleManifestSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  bundleId: NonEmptyStringSchema,
  createdAt: IsoTimestampSchema,
  deltas: z.array(ManifestDeltaSchema),
  files: z.array(ManifestFileSchema),
  pack: z.looseObject({ sizeBytes: SizeBytesSchema, url: z.url() }),
  patches: z.array(ManifestPatchSchema),
  version: z.string(),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/**
 * The embedded bundle's manifest in the resource file: a bundle the embed step did not register
 * carries only its files, so an absent `pack` reads as `null` and absent `deltas` and `patches` as empty.
 */
export const EmbeddedBundleManifestSchema = BundleManifestSchema.extend({
  deltas: BundleManifestSchema.shape.deltas.default([]),
  pack: BundleManifestSchema.shape.pack.nullable().default(null),
  patches: BundleManifestSchema.shape.patches.default([]),
});
export type EmbeddedBundleManifest = z.infer<
  typeof EmbeddedBundleManifestSchema
>;

/** The envelope at the manifest's key: the manifest as the signed string, the signature, the reserved encryption slot. */
export const ManifestEnvelopeSchema = z.looseObject({
  encryption: z.null(),
  manifest: NonEmptyStringSchema,
  signature: SignatureSchema.nullable(),
});
export type ManifestEnvelope = z.infer<typeof ManifestEnvelopeSchema>;
