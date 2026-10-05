import { z } from 'zod';

import { AttributesSchema, AttributeValueSchema } from '../attributes.js';
import {
  CONDITION_TYPES,
  ROLLBACK_REASONS,
  SKIPPED_REASONS,
} from '../results.js';
import {
  IdentifierSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  PlatformSchema,
  SizeBytesSchema,
} from './primitives.js';

export const ChannelSourceSchema = z.enum(['config', 'runtime']);

/** The facts a device has, sent when they differ from the acknowledged ones or the month began. */
export const DeviceReportSchema = z.looseObject({
  attributes: AttributesSchema,
  binaryBuild: NonEmptyStringSchema,
  binaryVersion: NonEmptyStringSchema,
  channelId: NonEmptyStringSchema,
  channelSource: ChannelSourceSchema,
  embeddedBundleId: IdentifierSchema.nullable(),
  fingerprint: NonEmptyStringSchema.nullable(),
  osVersion: NonEmptyStringSchema,
  releaseId: IdentifierSchema.nullable(),
  /** The runtime version the binary declares, for the `runtime` strategy; an SDK that does not send it reports none. */
  runtimeVersion: NonEmptyStringSchema.nullable().default(null),
});
export type DeviceReport = z.infer<typeof DeviceReportSchema>;

export const PACK_KINDS = ['delta', 'files', 'full', 'streamed'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const DeviceEventSchema = z.discriminatedUnion('type', [
  z.looseObject({
    condition: z.enum(CONDITION_TYPES).optional(),
    reason: z.enum(SKIPPED_REASONS).optional(),
    releaseId: IdentifierSchema,
    status: z.enum(['AVAILABLE', 'SKIPPED']),
    type: z.literal('checked'),
  }),
  z.looseObject({
    bundleId: IdentifierSchema,
    bytes: SizeBytesSchema,
    packKind: z.enum(PACK_KINDS),
    releaseId: IdentifierSchema,
    type: z.literal('downloaded'),
  }),
  z.looseObject({
    releaseId: IdentifierSchema,
    type: z.literal('applied'),
  }),
  z.looseObject({
    releaseId: IdentifierSchema,
    type: z.literal('confirmed'),
  }),
  z.looseObject({
    /** The app's `rollbackUpdate({ reason })` on `REPORTED_BY_APP`: printable, at most 256 characters. */
    detail: AttributeValueSchema.optional(),
    reason: z.enum([
      ...ROLLBACK_REASONS,
      'DOWNLOAD_FAILED',
      'INVALID_SIGNATURE',
      'VERIFICATION_FAILED',
    ]),
    releaseId: IdentifierSchema,
    type: z.literal('failed'),
  }),
  z.looseObject({
    fromReleaseId: IdentifierSchema,
    toReleaseId: IdentifierSchema.nullable(),
    type: z.literal('rolledBack'),
  }),
]);
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

/** One batch to `POST /v1/apps/{appId}/events`. */
export const DeviceEventsRequestSchema = z.looseObject({
  deviceId: NonEmptyStringSchema,
  events: z.array(DeviceEventSchema),
  platform: PlatformSchema,
  report: DeviceReportSchema.nullable(),
  sdkVersion: NonEmptyStringSchema,
});
export type DeviceEventsRequest = z.infer<typeof DeviceEventsRequestSchema>;

/** The `202`: the server time the device stores as `reportedAt`. */
export const DeviceEventsResponseSchema = z.looseObject({
  reportedAt: IsoTimestampSchema,
});
export type DeviceEventsResponse = z.infer<typeof DeviceEventsResponseSchema>;
