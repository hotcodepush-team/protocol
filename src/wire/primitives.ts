import { z } from 'zod';

import { PLATFORMS } from '../results.js';

/** A channel's name: `A–Z a–z 0–9 - _`, one to 64 characters, unique per app case-insensitively. */
export const ChannelNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** An ISO 8601 timestamp in UTC, `2026-09-29T10:00:00.000Z`. */
export const IsoTimestampSchema = z.iso.datetime();

export const NonEmptyStringSchema = z.string().min(1);

export const PlatformSchema = z.enum(PLATFORMS);

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
