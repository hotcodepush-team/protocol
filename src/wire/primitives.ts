import { z } from 'zod';

import { PLATFORMS } from '../results.js';

/**
 * The one public size limit, in decimal bytes.
 * It caps a bundle, any one file, a pack, a delta and the download for one release.
 */
export const BUNDLE_BYTES_LIMIT = 512_000_000;

/** Base64 in its one canonical spelling: padded, with no unused bits set. */
export const Base64Schema = z
  .string()
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)$/,
  );

/** A channel name: 1 to 64 of `A–Z a–z 0–9 - _`, unique per app ignoring case. */
export const ChannelNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * A path in `extraFingerprintPaths`, `/`-separated and relative to the project directory.
 * It has no empty or `.` segment, backslash or NUL. `..` may reach a sibling workspace,
 * but the fingerprint refuses a path that leaves the lockfile directory.
 */
export const ExtraFingerprintPathSchema = z
  .string()
  .refine(isClimbingRelativePath);

/**
 * An absolute `http` or `https` URL, so it always names a host. Schemes like `javascript:` or `file:` are refused.
 * `http` is only for the local stack, which the configured-host rule enforces on the device.
 */
export const HttpUrlSchema = z.url({ protocol: z.regexes.httpProtocol });

/** A bundle or release id: 1 to 64 of `A–Z a–z 0–9 _ -`, since a bundle id names a directory on the device. */
export const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** An ISO 8601 timestamp in UTC, `2026-09-29T10:00:00.000Z`. */
export const IsoTimestampSchema = z.iso.datetime();

export const NonEmptyStringSchema = z.string().min(1);

export const PlatformSchema = z.enum(PLATFORMS);

/** Text a device reports, which the server stores as sent: non-empty, with no control character such as NUL. */
export const PrintableStringSchema =
  NonEmptyStringSchema.regex(/^[^\p{Cc}]*$/u);

/**
 * A path inside a bundle: `/`-separated, with no empty, `.` or `..` segment, backslash or NUL.
 * So a file never lands outside its bundle.
 */
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

function isClimbingRelativePath(path: string): boolean {
  return (
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every(segment => segment !== '' && segment !== '.')
  );
}

function isRelativePath(path: string): boolean {
  return isClimbingRelativePath(path) && !path.split('/').includes('..');
}
