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
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** When an update the check found is downloaded; `manual` stops the cycle after the check. */
export const DOWNLOAD_STRATEGIES = ['auto', 'manual', 'unmetered'] as const;
export type DownloadStrategy = (typeof DOWNLOAD_STRATEGIES)[number];

export const FAILED_REASONS = [
  'CHANNEL_UNKNOWN',
  'CONTENT_MISMATCHED',
  'DEVICE_OFFLINE',
  'DOWNLOAD_FAILED',
  'INDEX_INVALID',
  'MANIFEST_INVALID',
  'SIGNATURE_INVALID',
] as const;
export type FailedReason = (typeof FAILED_REASONS)[number];

/** When a downloaded update is applied. */
export const INSTALL_STRATEGIES = [
  'immediate',
  'manual',
  'next-resume',
  'next-start',
] as const;
export type InstallStrategy = (typeof INSTALL_STRATEGIES)[number];

/** When a mandatory update is applied; `next-start` is excluded, since it would make the flag mean nothing. */
export const MANDATORY_INSTALL_STRATEGIES = ['immediate', 'manual'] as const;
export type MandatoryInstallStrategy =
  (typeof MANDATORY_INSTALL_STRATEGIES)[number];

export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** What ends the readiness gate: the first render, or an explicit `notifyReady()`. */
export const READY_SIGNALS = ['manual', 'render'] as const;
export type ReadySignal = (typeof READY_SIGNALS)[number];

export const ROLLBACK_REASONS = [
  'APP_CRASHED',
  'APP_REQUESTED',
  'READINESS_TIMED_OUT',
] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];

export const SKIPPED_REASONS = [
  'BUILD_DEBUG',
  'BUNDLE_FAILED_BEFORE',
  'CHANNEL_PAUSED',
  'CONDITION_UNSUPPORTED',
  'CONNECTION_METERED',
  'DEVICE_INCOMPATIBLE',
  'DEVICE_NOT_IN_ROLLOUT',
  'DEVICE_NOT_TARGETED',
  'RELEASE_OLDER_THAN_BINARY',
  'RELEASE_REVOKED',
  'SPENDING_CAP_REACHED',
] as const;
export type SkippedReason = (typeof SKIPPED_REASONS)[number];

/** What started a cycle: the SDK on its own, or the app's call. */
export const SYNC_TRIGGERS = ['interval', 'manual', 'resume', 'start'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** The SDK's own release type: five fields mapped from an index entry. */
export interface Release {
  bundleId: string;
  bundleVersion: string;
  id: string;
  isMandatory: boolean;
  number: number;
}

/** When a downloaded update runs, in the strategies' vocabulary. */
export type InstallMoment = InstallStrategy;

export type SyncResult =
  | { release: Release | null; status: 'UP_TO_DATE' }
  | {
      downloadBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'AVAILABLE';
    }
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

export type DownloadResult =
  | { notes: string | null; release: Release; status: 'DOWNLOADED' }
  | { release: Release | null; status: 'UP_TO_DATE' }
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

export type ApplyResult =
  | { release: Release; status: 'APPLIED' }
  | { release: Release | null; status: 'NOTHING_TO_APPLY' };

export interface NotifyReadyResult {
  currentRelease: Release | null;
  isRolledBack: boolean;
  /** The release before this start, when it changed. */
  previousRelease: Release | null;
  rollbackReason?: RollbackReason;
}

/** The SDK's state, a snapshot: everything the debug screen shows. */
export interface GetStateResult {
  currentRelease: Release | null;
  /** From the resource file; `null` in a build the embed step did not register. */
  embeddedBundleId: string | null;
  failedBundleIds: string[];
  fallbackRelease: Release | null;
  index: { fetchedAt: string; sequence: number } | null;
  lastCheck: {
    at: string;
    result: CheckResult | SyncResult;
    trigger: SyncTrigger;
  } | null;
  /** `reportedAt`, the server time of the last acknowledged report. */
  lastReportAt: string | null;
  nextRelease: Release | null;
}

export type ChannelSource = 'config' | 'runtime';

export interface GetChannelResult {
  /** `null` while no id is known: a build without a channel, or a runtime name no sync has resolved yet. */
  id: string | null;
  name: string | null;
  source: ChannelSource;
}

export type SetChannelOptions = { id: string } | { name: string } | null;

export interface GetDeviceResult {
  attributes: Record<string, string>;
  binaryBuild: string;
  binaryVersion: string;
  channel: GetChannelResult;
  /** `fp1:<sha256>` from the resource file, `null` in a build that carries none. */
  fingerprint: string | null;
  id: string;
  osVersion: string;
  /** `web` from the SDK's web no-op; the index and the events serve `ios` and `android` only. */
  platform: Platform | 'web';
  sdkVersion: string;
}

export type SetAttributesOptions = Record<string, string | null>;

export interface RollbackUpdateOptions {
  /** The app-side cause, carried as the `failed` event's `detail`: printable, at most 256 characters. */
  reason?: string;
}

/** Each stage's strategy for this call, overriding the configuration. */
export interface SyncOptions {
  downloadStrategy?: DownloadStrategy;
  installStrategy?: InstallStrategy;
  mandatoryInstallStrategy?: MandatoryInstallStrategy;
}

export interface SetRestartAllowedOptions {
  allowed: boolean;
}
