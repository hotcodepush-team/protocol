import { z } from 'zod';

import { AttributesSchema, AttributeValueSchema } from '../attributes.js';
import type {
  DeviceEventType,
  FailedReason,
  RollbackReason,
  SyncStatus,
} from '../results.js';
import {
  CHANNEL_SOURCES,
  CONDITION_TYPES,
  PACK_KINDS,
  ROLLBACK_REASONS,
  SKIPPED_REASONS,
} from '../results.js';
import {
  BUNDLE_BYTES_LIMIT,
  IdentifierSchema,
  IsoTimestampSchema,
  PlatformSchema,
  PrintableStringSchema,
  SizeBytesSchema,
} from './primitives.js';

export const ChannelSourceSchema = z.enum(CHANNEL_SOURCES);

/** The facts a device has, sent when they differ from the acknowledged ones or the month began. */
export const DeviceReportSchema = z.looseObject({
  attributes: AttributesSchema,
  binaryBuild: PrintableStringSchema,
  binaryVersion: PrintableStringSchema,
  channelId: PrintableStringSchema,
  channelSource: ChannelSourceSchema,
  embeddedBundleId: IdentifierSchema.nullable(),
  fingerprint: PrintableStringSchema.nullable(),
  osVersion: PrintableStringSchema,
  releaseId: IdentifierSchema.nullable(),
});
export type DeviceReport = z.infer<typeof DeviceReportSchema>;

const CHECKED_EVENT_STATUSES = [
  'available',
  'skipped',
] as const satisfies readonly SyncStatus[];

const FAILED_EVENT_REASONS = [
  ...ROLLBACK_REASONS,
  'content_mismatched',
  'download_failed',
  'manifest_invalid',
  'signature_invalid',
] as const satisfies readonly (FailedReason | RollbackReason)[];

export const DeviceEventSchema = z.discriminatedUnion('type', [
  z.looseObject({
    condition: z.enum(CONDITION_TYPES).optional(),
    reason: z.enum(SKIPPED_REASONS).optional(),
    releaseId: IdentifierSchema,
    status: z.enum(CHECKED_EVENT_STATUSES),
    type: z.literal('checked' satisfies DeviceEventType),
  }),
  z.looseObject({
    bundleId: IdentifierSchema,
    downloadSizeBytes: SizeBytesSchema.max(BUNDLE_BYTES_LIMIT),
    packKind: z.enum(PACK_KINDS),
    releaseId: IdentifierSchema,
    type: z.literal('downloaded' satisfies DeviceEventType),
  }),
  z.looseObject({
    releaseId: IdentifierSchema,
    type: z.literal('applied' satisfies DeviceEventType),
  }),
  z.looseObject({
    releaseId: IdentifierSchema,
    type: z.literal('confirmed' satisfies DeviceEventType),
  }),
  z.looseObject({
    /** The app's `rollbackUpdate({ reason })` on `app_requested`, under the attribute-value rule. */
    detail: AttributeValueSchema.optional(),
    reason: z.enum(FAILED_EVENT_REASONS),
    releaseId: IdentifierSchema,
    type: z.literal('failed' satisfies DeviceEventType),
  }),
  z.looseObject({
    fromReleaseId: IdentifierSchema,
    toReleaseId: IdentifierSchema.nullable(),
    type: z.literal('rolled_back' satisfies DeviceEventType),
  }),
]);
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

/** The outbox's cap and so the largest batch a device sends; the events endpoint refuses a larger one. */
export const BATCH_EVENT_COUNT_LIMIT = 200;

/** One batch to `POST /v1/apps/{appId}/events`. */
export const DeviceEventsRequestSchema = z.looseObject({
  deviceId: PrintableStringSchema,
  events: z.array(DeviceEventSchema).max(BATCH_EVENT_COUNT_LIMIT),
  platform: PlatformSchema,
  report: DeviceReportSchema.nullable(),
  sdkVersion: PrintableStringSchema,
});
export type DeviceEventsRequest = z.infer<typeof DeviceEventsRequestSchema>;

/** The `202`: the server time the device keeps as `reportedAt` by `resolveKeptReportedAt`. */
export const DeviceEventsResponseSchema = z.looseObject({
  reportedAt: IsoTimestampSchema,
});
export type DeviceEventsResponse = z.infer<typeof DeviceEventsResponseSchema>;

/** A `202` as the device reads it: the server time, and whether the acknowledged batch carried the device report. */
export interface DeviceEventsAcknowledgement {
  hasReport: boolean;
  reportedAt: string;
}

/**
 * The `reportedAt` a device keeps after a `202`: the stamp of the first
 * acknowledged batch of a UTC month that carried the device report, the month
 * read from the stamp itself. A later acknowledgement replaces it only when it
 * falls in a later UTC month, and a batch of events alone never moves it, so
 * the device compares with `cappedAt` the stamp the consumer counted it by.
 */
export function resolveKeptReportedAt(
  reportedAt: string | null,
  acknowledgement: DeviceEventsAcknowledgement,
): string | null {
  if (!acknowledgement.hasReport) {
    return reportedAt;
  }
  if (
    reportedAt === null ||
    resolveUtcMonthNumber(acknowledgement.reportedAt) >
      resolveUtcMonthNumber(reportedAt)
  ) {
    return acknowledgement.reportedAt;
  }
  return reportedAt;
}

/** The months since year zero, so a later month compares greater across a year's turn. */
function resolveUtcMonthNumber(timestamp: string): number {
  const date = new Date(timestamp);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}
