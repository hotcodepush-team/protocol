/**
 * The catalog, every value list of the SDK's results and the device events,
 * defined once here and implemented by every SDK, as sdk-api.md's Types,
 * Statuses and reasons sections write it.
 * Every value is lowercase snake_case. Additive only: a value is added, never
 * removed, renamed or retyped.
 */

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

/** Whether the SDK checks on its own, at start, on resume and at the interval; `manual` leaves every cycle to the app's `sync()`. */
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
  'rolled_back',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** When an update the check found is downloaded; `manual` stops the cycle after the check. */
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

/** When a mandatory update is applied; `next_start` is excluded, since it would make the flag mean nothing. */
export const MANDATORY_APPLY_STRATEGIES = ['immediate', 'manual'] as const;
export type MandatoryApplyStrategy =
  (typeof MANDATORY_APPLY_STRATEGIES)[number];

/** The `downloaded` device event's `packKind`: the pack that served the download, or `files` when no pack was requested. */
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

/** Every value array above by its camelCase name, as `catalog.json` carries it for readers outside TypeScript; `npm run catalog` writes the file. */
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

/** The SDK's own release type: five fields mapped from an index entry. */
export interface Release {
  bundleId: string;
  bundleVersion: string;
  id: string;
  isMandatory: boolean;
  number: number;
}

/** The moments a strategy applies a downloaded update at; `manual` is none, it waits for the app's `applyUpdate()`. */
export type ApplyMoment = Exclude<ApplyStrategy, 'manual'>;

/**
 * The outcome of one cycle: `available` when the download is the app's,
 * `downloaded` when the apply is scheduled or the app's, `applyStrategy` saying
 * which, and `applied` when it happened now, the reload following the result.
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
      condition?: ConditionType;
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

/** `sync()` with the download pinned to `manual`: nothing is downloaded or applied. */
export type CheckForUpdateResult = Exclude<
  SyncResult,
  { status: 'applied' | 'downloaded' }
>;

/** `sync()` with the download pinned to `auto`: the cycle never stops at `available`. */
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

/** The SDK's state, a snapshot: everything the debug screen shows. */
export interface GetStateResult {
  currentRelease: Release | null;
  /** From the resource file; `null` in a build the embed step did not register. */
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
  /** The server time of the month's first acknowledged report, kept by `resolveKeptReportedAt`. */
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
  /** The app-side cause, carried as the `failed` event's `detail`: printable, at most 256 characters. */
  reason?: string;
}

/** Each stage's strategy for this call, overriding the configuration. */
export interface SyncOptions {
  applyStrategy?: ApplyStrategy;
  downloadStrategy?: DownloadStrategy;
  mandatoryApplyStrategy?: MandatoryApplyStrategy;
}

/** The apply strategies for this call; the download strategy is pinned to `auto`. */
export type DownloadUpdateOptions = Omit<SyncOptions, 'downloadStrategy'>;

export interface SetRestartAllowedOptions {
  isAllowed: boolean;
}
