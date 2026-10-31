import { z } from 'zod';

import type { Platform } from '../results.js';
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
 * The bundle manifest: what the CLI knows before the upload. With signing on, its canonical JSON is the signed bytes.
 * It has no majors and is additive only. The server facts ride unsigned in the envelope, since the file hashes already bind the signature to the bytes.
 * A reader keeps unknown platforms and fields, such as `patches` in a manifest stored before 2026-10-04.
 * The resource file holds the manifest of the embedded bundle in the same shape.
 */
export const BundleManifestSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  bundleVersion: z.string(),
  files: z.array(ManifestFileSchema),
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The fingerprint of the signing key, or `null` when unsigned. */
  keyId: NonEmptyStringSchema.nullable(),
  platforms: z.array(NonEmptyStringSchema),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

/**
 * Whether the manifest names the app of the device and lists its platform, signed or not.
 * If not, the device fails with `manifest_invalid` before writing a byte, so a tampered index or a wrong cache never installs it.
 */
export function isManifestForDevice(
  manifest: BundleManifest,
  device: { appId: string; platform: Platform },
): boolean {
  return (
    manifest.appId === device.appId &&
    manifest.platforms.includes(device.platform)
  );
}

export const EnvelopeDeltaSchema = z.looseObject({
  baseBundleId: IdentifierSchema,
  sizeBytes: SizeBytesSchema,
  url: HttpUrlSchema,
});
export type EnvelopeDelta = z.infer<typeof EnvelopeDeltaSchema>;

/**
 * The document at the manifest key, written by the server on `complete`.
 * It holds the signed manifest string, the signature and a reserved encryption slot.
 * The server facts sit unsigned beside them: bundle id, creation time, pack and deltas.
 * An envelope stored before 2026-10-04 still carries `patches`, which a reader ignores.
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
