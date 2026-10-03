import { z } from 'zod';

import { AttributesSchema, AttributeValueSchema } from '../attributes.js';
import {
  CONDITION_TYPES,
  ROLLBACK_REASONS,
  SKIPPED_REASONS,
} from '../results.js';
import {
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
  embeddedBundleId: NonEmptyStringSchema.nullable(),
  fingerprint: NonEmptyStringSchema.nullable(),
  osVersion: NonEmptyStringSchema,
  releaseId: NonEmptyStringSchema.nullable(),
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
    releaseId: NonEmptyStringSchema,
    status: z.enum(['AVAILABLE', 'SKIPPED']),
    type: z.literal('checked'),
  }),
  z.looseObject({
    bundleId: NonEmptyStringSchema,
    bytes: SizeBytesSchema,
    packKind: z.enum(PACK_KINDS),
    releaseId: NonEmptyStringSchema,
    type: z.literal('downloaded'),
  }),
  z.looseObject({
    releaseId: NonEmptyStringSchema,
    type: z.literal('applied'),
  }),
  z.looseObject({
    releaseId: NonEmptyStringSchema,
    type: z.literal('confirmed'),
  }),
  z.looseObject({
    /** The app's `rollback({ reason })` on `REPORTED_BY_APP`: printable, at most 256 characters. */
    detail: AttributeValueSchema.optional(),
    reason: z.enum([
      ...ROLLBACK_REASONS,
      'DOWNLOAD_FAILED',
      'INVALID_SIGNATURE',
      'VERIFICATION_FAILED',
    ]),
    releaseId: NonEmptyStringSchema,
    type: z.literal('failed'),
  }),
  z.looseObject({
    fromReleaseId: NonEmptyStringSchema,
    toReleaseId: NonEmptyStringSchema.nullable(),
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
