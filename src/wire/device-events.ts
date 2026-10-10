import { z } from 'zod';

import { AttributesSchema, AttributeValueSchema } from '../attributes.js';
import {
  CONDITION_TYPES,
  ROLLBACK_REASONS,
  SKIPPED_REASONS,
} from '../results.js';
import {
  BUNDLE_MAX_SIZE_BYTES,
  IdentifierSchema,
  IsoTimestampSchema,
  PlatformSchema,
  PrintableStringSchema,
  SizeBytesSchema,
} from './primitives.js';

export const ChannelSourceSchema = z.enum(['config', 'runtime']);

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
    bytes: SizeBytesSchema.max(BUNDLE_MAX_SIZE_BYTES),
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
    /** The app's `rollbackUpdate({ reason })` on `APP_REQUESTED`, under the attribute-value rule. */
    detail: AttributeValueSchema.optional(),
    reason: z.enum([
      ...ROLLBACK_REASONS,
      'CONTENT_MISMATCHED',
      'DOWNLOAD_FAILED',
      'MANIFEST_INVALID',
      'SIGNATURE_INVALID',
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

/** The outbox's cap and so the largest batch a device sends; the events endpoint refuses a larger one. */
export const MAX_EVENTS_PER_BATCH = 200;

/** One batch to `POST /v1/apps/{appId}/events`. */
export const DeviceEventsRequestSchema = z.looseObject({
  deviceId: PrintableStringSchema,
  events: z.array(DeviceEventSchema).max(MAX_EVENTS_PER_BATCH),
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
