/**
 * The SDK's result catalog, defined once here and implemented by every SDK,
 * as sdk-api.md's Types, Statuses and reasons sections write it.
 * Additive only: a value is added, never removed, renamed or retyped.
 */

export const CONDITION_TYPES = [
  'attribute',
  'binary',
  'device',
  'fingerprint',
  'os',
  'runtime',
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const FAILED_REASONS = [
  'DOWNLOAD_FAILED',
  'INVALID_INDEX',
  'INVALID_SIGNATURE',
  'OFFLINE',
  'UNKNOWN_CHANNEL',
  'VERIFICATION_FAILED',
] as const;
export type FailedReason = (typeof FAILED_REASONS)[number];

export const INSTALL_STRATEGIES = [
  'immediate',
  'manual',
  'next-start',
  'on-resume',
] as const;
export type InstallStrategy = (typeof INSTALL_STRATEGIES)[number];

export const NETWORK_POLICIES = ['any', 'unmetered'] as const;
export type NetworkPolicy = (typeof NETWORK_POLICIES)[number];

export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const READY_SIGNALS = ['call', 'render'] as const;
export type ReadySignal = (typeof READY_SIGNALS)[number];

export const ROLLBACK_REASONS = [
  'CRASHED',
  'READY_TIMEOUT',
  'REPORTED_BY_APP',
] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];

export const SKIPPED_REASONS = [
  'CHANNEL_PAUSED',
  'DEBUG_BUILD',
  'FAILED_BEFORE',
  'INCOMPATIBLE',
  'METERED_CONNECTION',
  'NOT_IN_ROLLOUT',
  'NOT_TARGETED',
  'OLDER_THAN_BINARY',
  'RELEASE_REVOKED',
  'SPENDING_CAP_REACHED',
  'UNSUPPORTED_CONDITION',
] as const;
export type SkippedReason = (typeof SKIPPED_REASONS)[number];

export const SYNC_TRIGGERS = ['call', 'interval', 'resume', 'start'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** The SDK's own release type: five fields mapped from an index entry. */
export interface Release {
  bundleId: string;
  bundleVersion: string;
  id: string;
  isMandatory: boolean;
  number: number;
}

export type InstallMoment = 'manual' | 'next-start' | 'now' | 'on-resume';

export type SyncResult =
  | { release: Release | null; status: 'UP_TO_DATE' }
  | {
      installAt: InstallMoment;
      notes: string | null;
      release: Release;
      status: 'UPDATED';
    }
  | {
      condition?: ConditionType;
      reason: SkippedReason;
      release: Release | null;
      status: 'SKIPPED';
    }
  | {
      message: string;
      reason: FailedReason;
      release: Release | null;
      status: 'FAILED';
    };

export type CheckResult =
  | { release: Release | null; status: 'UP_TO_DATE' }
  | {
      downloadBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'AVAILABLE';
    }
  | {
      condition?: ConditionType;
      reason: SkippedReason;
      release: Release | null;
      status: 'SKIPPED';
    }
  | {
      message: string;
      reason: FailedReason;
      release: Release | null;
      status: 'FAILED';
    };

export interface ReadyResult {
  currentRelease: Release | null;
  isRolledBack: boolean;
  previousRelease: Release | null;
  rollbackReason?: RollbackReason;
}

export interface GetStatusResult {
  currentRelease: Release | null;
  embeddedBundleId: string | null;
  failedBundleIds: string[];
  fallbackRelease: Release | null;
  index: { fetchedAt: string; sequence: number } | null;
  lastCheck: {
    at: string;
    result: CheckResult | SyncResult;
    trigger: SyncTrigger;
  } | null;
  lastReportAt: string | null;
  nextRelease: Release | null;
}

export type ChannelSource = 'config' | 'runtime';

export interface GetChannelResult {
  id: string;
  name: string | null;
  source: ChannelSource;
}

export type SetChannelOptions = { id: string } | { name: string } | null;

export interface GetDeviceResult {
  attributes: Record<string, string>;
  binaryBuild: string;
  binaryVersion: string;
  channel: GetChannelResult;
  fingerprint: string;
  id: string;
  osVersion: string;
  platform: Platform;
  sdkVersion: string;
}

export type SetAttributesOptions = Record<string, string | null>;

export interface RollbackOptions {
  reason?: string;
}

export interface SyncOptions {
  installStrategy?: InstallStrategy;
  network?: NetworkPolicy;
}

export interface SetRestartAllowedOptions {
  allowed: boolean;
}
