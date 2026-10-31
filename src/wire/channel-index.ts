import { z } from 'zod';

import { CONDITION_TYPES } from '../results.js';
import {
  HttpUrlSchema,
  IdentifierSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  PlatformSchema,
  Sha256HexSchema,
  SizeBytesSchema,
} from './primitives.js';

/** The format major of the channel index, equal to the `v1` in the index path. */
export const CHANNEL_INDEX_SCHEMA = 1;

// A writer refuses more than these limits, but a reader parses any count, so raising one stays additive.
export const DEVICE_CONDITION_HASHED_ID_COUNT_LIMIT = 500;
export const RELEASE_CONDITION_COUNT_LIMIT = 16;

export const AttributeConditionSchema = z.looseObject({
  key: NonEmptyStringSchema,
  type: z.literal('attribute'),
  valueSha256: Sha256HexSchema,
});

export const BinaryConditionSchema = z.looseObject({
  range: NonEmptyStringSchema,
  type: z.literal('binary'),
});

export const DeviceConditionSchema = z.looseObject({
  hashedIds: z.array(Sha256HexSchema),
  type: z.literal('device'),
});

export const FingerprintConditionSchema = z.looseObject({
  fingerprint: NonEmptyStringSchema,
  type: z.literal('fingerprint'),
});

export const OsConditionSchema = z.looseObject({
  range: NonEmptyStringSchema,
  type: z.literal('os'),
});

/** A condition type this implementation does not know. It parses, and it fails closed. */
export const UnknownConditionSchema = z.looseObject({
  type: z
    .string()
    .refine(type => !(CONDITION_TYPES as readonly string[]).includes(type)),
});

export const KnownConditionSchema = z.union([
  AttributeConditionSchema,
  BinaryConditionSchema,
  DeviceConditionSchema,
  FingerprintConditionSchema,
  OsConditionSchema,
]);
export type KnownCondition = z.infer<typeof KnownConditionSchema>;
export type UnknownCondition = z.infer<typeof UnknownConditionSchema>;

export const ConditionSchema = z.union([
  KnownConditionSchema,
  UnknownConditionSchema,
]);
export type Condition = KnownCondition | UnknownCondition;

export const IndexReleaseSchema = z.looseObject({
  bundleId: IdentifierSchema,
  bundleVersion: z.string(),
  conditions: z.array(ConditionSchema),
  createdAt: IsoTimestampSchema,
  id: IdentifierSchema,
  isMandatory: z.boolean(),
  manifestSha256: Sha256HexSchema,
  manifestUrl: HttpUrlSchema,
  notes: z.string().nullable(),
  number: z.int().positive(),
  rolloutPercent: z.int().min(0).max(100),
  sizeBytes: SizeBytesSchema,
});
export type IndexRelease = z.infer<typeof IndexReleaseSchema>;

/** The channel index for one app, channel and platform. */
export const ChannelIndexSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  cappedAt: IsoTimestampSchema.nullable(),
  channelId: NonEmptyStringSchema,
  pausedAt: IsoTimestampSchema.nullable(),
  platform: PlatformSchema,
  releases: z.array(IndexReleaseSchema),
  revokedReleaseIds: z.array(IdentifierSchema),
  schema: z.literal(CHANNEL_INDEX_SCHEMA),
  sequence: z.int().nonnegative(),
});
export type ChannelIndex = z.infer<typeof ChannelIndexSchema>;
