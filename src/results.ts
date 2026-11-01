// The catalog: every value list of the SDK results and the device events, as sdk-api.md defines them.
// Additive only: a value is never removed, renamed or retyped.

/** When a downloaded update is applied. */
export const APPLY_STRATEGIES = [
  'immediate',
  'manual',
  'next_resume',
  'next_start',
] as const;
export type ApplyStrategy = (typeof APPLY_STRATEGIES)[number];

export const APPLY_UPDATE_STATUSES = ['applied', 'nothing_to_apply'] as const;
export type ApplyUpdateStatus = (typeof APPLY_UPDATE_STATUSES)[number];

export const CHANNEL_SOURCES = ['config', 'runtime'] as const;
export type ChannelSource = (typeof CHANNEL_SOURCES)[number];

/**
 * Whether the SDK checks on its own: at start, on resume and at the interval.
 * `manual` leaves every cycle to the app's `sync()`.
 */
export const CHECK_STRATEGIES = ['auto', 'manual'] as const;
export type CheckStrategy = (typeof CHECK_STRATEGIES)[number];

export const CONDITION_TYPES = [
  'attribute',
  'binary',
  'device',
  'fingerprint',
  'os',
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const DEVICE_EVENT_TYPES = [
  'applied',
  'checked',
  'confirmed',
  'downloaded',
  'failed',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** When an update the check found is downloaded. `manual` stops the cycle after the check. */
export const DOWNLOAD_STRATEGIES = ['auto', 'manual', 'unmetered'] as const;
export type DownloadStrategy = (typeof DOWNLOAD_STRATEGIES)[number];

export const FAILED_REASONS = [
  'channel_unknown',
  'content_mismatched',
  'device_offline',
  'download_failed',
  'index_invalid',
  'manifest_invalid',
  'signature_invalid',
] as const;
export type FailedReason = (typeof FAILED_REASONS)[number];

/** When a mandatory update is applied. `next_start` is left out, since it would make the flag meaningless. */
export const MANDATORY_APPLY_STRATEGIES = ['immediate', 'manual'] as const;
export type MandatoryApplyStrategy =
  (typeof MANDATORY_APPLY_STRATEGIES)[number];

/** The pack that served a download, sent as `packKind` in the `downloaded` device event. `files` means no pack. */
export const PACK_KINDS = ['delta', 'files', 'full', 'streamed'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const PLATFORMS = ['android', 'ios'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** What ends the readiness gate: the first render, or an explicit `notifyReady()`. */
export const READY_SIGNALS = ['manual', 'render'] as const;
export type ReadySignal = (typeof READY_SIGNALS)[number];

export const ROLLBACK_REASONS = [
  'app_crashed',
  'app_requested',
  'readiness_timed_out',
] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];

export const SKIPPED_REASONS = [
  'build_debug',
  'bundle_failed_before',
  'channel_paused',
  'condition_unsupported',
  'connection_metered',
  'device_incompatible',
  'device_not_in_rollout',
  'device_not_targeted',
  'release_older_than_binary',
  'release_revoked',
  'spending_cap_reached',
] as const;
export type SkippedReason = (typeof SKIPPED_REASONS)[number];

export const SYNC_STATUSES = [
  'applied',
  'available',
  'downloaded',
  'failed',
  'skipped',
  'up_to_date',
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** What started a cycle: the SDK on its own, or the app's call. */
export const SYNC_TRIGGERS = ['interval', 'manual', 'resume', 'start'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

/** Every value list above by its camelCase name, as `catalog.json` carries it for readers outside TypeScript. */
export const CATALOG = {
  applyStrategies: APPLY_STRATEGIES,
  applyUpdateStatuses: APPLY_UPDATE_STATUSES,
  channelSources: CHANNEL_SOURCES,
  checkStrategies: CHECK_STRATEGIES,
  conditionTypes: CONDITION_TYPES,
  deviceEventTypes: DEVICE_EVENT_TYPES,
  downloadStrategies: DOWNLOAD_STRATEGIES,
  failedReasons: FAILED_REASONS,
  mandatoryApplyStrategies: MANDATORY_APPLY_STRATEGIES,
  packKinds: PACK_KINDS,
  platforms: PLATFORMS,
  readySignals: READY_SIGNALS,
  rollbackReasons: ROLLBACK_REASONS,
  skippedReasons: SKIPPED_REASONS,
  syncStatuses: SYNC_STATUSES,
  syncTriggers: SYNC_TRIGGERS,
} as const;

/** The release type of the SDK: five fields mapped from an index entry. */
export interface Release {
  bundleId: string;
  bundleVersion: string;
  id: string;
  isMandatory: boolean;
  number: number;
}

/** The moments a strategy applies a downloaded update. `manual` is not one, since it waits for `applyUpdate()`. */
export type ApplyMoment = Exclude<ApplyStrategy, 'manual'>;

/**
 * The outcome of one cycle. On `available`, the download is left to the app.
 * On `downloaded`, `applyStrategy` says when the update is applied. On `applied`, the reload follows the result.
 */
export type SyncResult =
  | { release: Release | null; status: 'up_to_date' }
  | {
      downloadSizeBytes: number | null;
      notes: string | null;
      release: Release;
      status: 'available';
    }
  | {
      applyStrategy: Exclude<ApplyStrategy, 'immediate'>;
      notes: string | null;
      release: Release;
      status: 'downloaded';
    }
  | { notes: string | null; release: Release; status: 'applied' }
  | {
      conditionType?: ConditionType;
      reason: SkippedReason;
      release: Release | null;
      status: 'skipped';
    }
  | {
      message: string;
      reason: FailedReason;
      release: Release | null;
      status: 'failed';
    };

/** The result of `sync()` with the download pinned to `manual`, so nothing is downloaded or applied. */
export type CheckForUpdateResult = Exclude<
  SyncResult,
  { status: 'applied' | 'downloaded' }
>;

/** The result of `sync()` with the download pinned to `auto`, so the cycle never stops at `available`. */
export type DownloadUpdateResult = Exclude<SyncResult, { status: 'available' }>;

export type ApplyUpdateResult =
  | { release: Release; status: 'applied' }
  | { release: Release | null; status: 'nothing_to_apply' };

export interface NotifyReadyResult {
  currentRelease: Release | null;
  isRolledBack: boolean;
  /** The release before this start, when it changed. */
  previousRelease: Release | null;
  rollbackReason?: RollbackReason;
}

/** A snapshot of the SDK state: everything the debug screen shows. */
export interface GetStateResult {
  currentRelease: Release | null;
  /** From the resource file; `null` in a build the build step did not register. */
  embeddedBundleId: string | null;
  failedBundleIds: string[];
  fallbackRelease: Release | null;
  index: { fetchedAt: string; sequence: number } | null;
  lastCheck: {
    checkedAt: string;
    result: SyncResult;
    trigger: SyncTrigger;
  } | null;
  nextRelease: Release | null;
  /** The server time of the first acknowledged report in the latest UTC month that has one, kept by `resolveKeptReportedAt`. */
  reportedAt: string | null;
}

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
  platform: Platform;
  sdkVersion: string;
}

export type SetAttributesOptions = Record<string, string | null>;

export interface RollbackUpdateOptions {
  /** The cause in the app, sent as `detail` in the `failed` event. Printable, at most 256 characters. */
  reason?: string;
}

/** Strategies for this call that override the configuration. */
export interface SyncOptions {
  applyStrategy?: ApplyStrategy;
  downloadStrategy?: DownloadStrategy;
  mandatoryApplyStrategy?: MandatoryApplyStrategy;
}

/** The apply strategies for this call. The download strategy is pinned to `auto`. */
export type DownloadUpdateOptions = Omit<SyncOptions, 'downloadStrategy'>;

export interface SetRestartAllowedOptions {
  isAllowed: boolean;
}
