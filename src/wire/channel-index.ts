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

/** The channel index's format major, equal to the `v1` in the index path. */
export const CHANNEL_INDEX_SCHEMA = 1;

/** The most hashed ids a `device` condition carries: a writer refuses more, a reader parses any count, so raising it stays additive. */
export const DEVICE_CONDITION_MAX_HASHED_IDS = 500;

/** The most conditions a release carries: a writer refuses more, a reader parses any count, so raising it stays additive. */
export const RELEASE_MAX_CONDITIONS = 16;

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
  hash: NonEmptyStringSchema,
  type: z.literal('fingerprint'),
});

export const OsConditionSchema = z.looseObject({
  range: NonEmptyStringSchema,
  type: z.literal('os'),
});

/** A condition type this implementation does not know: it parses, and it fails closed. */
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
  rollout: z.int().min(0).max(100),
  sizeBytes: SizeBytesSchema,
});
export type IndexRelease = z.infer<typeof IndexReleaseSchema>;

/** The channel's index for a platform, one object per app, channel and platform. */
export const ChannelIndexSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  cappedAt: IsoTimestampSchema.nullable(),
  channelId: NonEmptyStringSchema,
  isPaused: z.boolean(),
  platform: PlatformSchema,
  releases: z.array(IndexReleaseSchema),
  revokedReleaseIds: z.array(IdentifierSchema),
  schema: z.literal(CHANNEL_INDEX_SCHEMA),
  sequence: z.int().nonnegative(),
});
export type ChannelIndex = z.infer<typeof ChannelIndexSchema>;
