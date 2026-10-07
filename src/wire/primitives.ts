import { z } from 'zod';

import { PLATFORMS } from '../results.js';

/** The one public size limit, in decimal bytes: a bundle, any one file, a pack and a delta pack are at most this, and so is what a device downloads for one release. */
export const BUNDLE_MAX_SIZE_BYTES = 512_000_000;

/** Bytes as base64 in its one canonical spelling: padded, no unused bits set. */
export const Base64Schema = z
  .string()
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)$/,
  );

/** A channel's name: `A–Z a–z 0–9 - _`, one to 64 characters, unique per app case-insensitively. */
export const ChannelNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** A bundle or release id: `A–Z a–z 0–9 _ -`, one to 64 characters, since a bundle id names a directory on the device. */
export const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** An ISO 8601 timestamp in UTC, `2026-09-29T10:00:00.000Z`. */
export const IsoTimestampSchema = z.iso.datetime();

export const NonEmptyStringSchema = z.string().min(1);

export const PlatformSchema = z.enum(PLATFORMS);

/** A path inside a bundle: `/`-separated, with no empty, `.` or `..` segment, no backslash and no NUL, so a file never lands outside its bundle. */
export const RelativePathSchema = z.string().refine(isRelativePath);

/** A SHA-256 as 64 lowercase hexadecimal characters. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** A self-describing signature value: the scheme, a colon, the base64 signature. */
export const SignatureValueSchema = z
  .string()
  .regex(/^[a-z0-9_-]+:[A-Za-z0-9+/]+=*$/);

export const SizeBytesSchema = z.int().nonnegative();

/** A signature as the index and the manifest envelope carry it. */
export const SignatureSchema = z.looseObject({
  keyId: NonEmptyStringSchema,
  value: SignatureValueSchema,
});
export type Signature = z.infer<typeof SignatureSchema>;

function isRelativePath(path: string): boolean {
  return (
    !path.includes('\\') &&
    !path.includes('\0') &&
    path
      .split('/')
      .every(segment => segment !== '' && segment !== '.' && segment !== '..')
  );
}
