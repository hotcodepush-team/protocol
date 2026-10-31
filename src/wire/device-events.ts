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
  UuidSchema,
} from './primitives.js';

export const ChannelSourceSchema = z.enum(CHANNEL_SOURCES);

/** The facts a device has. It sends them when they differ from the acknowledged ones or a new month began. */
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
    conditionType: z.enum(CONDITION_TYPES).optional(),
    reason: z.enum(SKIPPED_REASONS).optional(),
    releaseId: IdentifierSchema,
    status: z.enum(CHECKED_EVENT_STATUSES),
    type: z.literal('checked' satisfies DeviceEventType),
  }),
  z.looseObject({
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
    /** The reason the app passed to `rollbackUpdate({ reason })`, on `app_requested`. Same rule as an attribute value. */
    detail: AttributeValueSchema.optional(),
    reason: z.enum(FAILED_EVENT_REASONS),
    releaseId: IdentifierSchema,
    type: z.literal('failed' satisfies DeviceEventType),
  }),
]);
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

/** The outbox cap, so also the largest batch a device sends. The events endpoint refuses a larger one. */
export const BATCH_EVENT_COUNT_LIMIT = 200;

/** One batch to `POST /v1/apps/{appId}/events`. */
export const DeviceEventsRequestSchema = z.looseObject({
  deviceId: UuidSchema,
  events: z.array(DeviceEventSchema).max(BATCH_EVENT_COUNT_LIMIT),
  platform: PlatformSchema,
  report: DeviceReportSchema.nullable(),
  sdkVersion: PrintableStringSchema,
});
export type DeviceEventsRequest = z.infer<typeof DeviceEventsRequestSchema>;

/** The `202` response: the server time the device keeps as `reportedAt` through `resolveKeptReportedAt`. */
export const DeviceEventsResponseSchema = z.looseObject({
  reportedAt: IsoTimestampSchema,
});
export type DeviceEventsResponse = z.infer<typeof DeviceEventsResponseSchema>;

/** A `202` as the device reads it. `hasReport` says whether the acknowledged batch carried the device report. */
export interface DeviceEventsAcknowledgement {
  hasReport: boolean;
  reportedAt: string;
}

/**
 * Resolves the `reportedAt` a device keeps after a `202`: the stamp of the first acknowledged report in a UTC month.
 * Only a report in a later month replaces it, never a batch of events alone.
 * So the device compares `cappedAt` with the same stamp the server counted it by.
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

// Counts months since year zero, so the order holds across the turn of a year.
function resolveUtcMonthNumber(timestamp: string): number {
  const date = new Date(timestamp);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}
