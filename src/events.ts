import type {
  ApplyStrategy,
  FailedReason,
  Release,
  RollbackReason,
  SyncTrigger,
} from './results.js';

/**
 * The SDK's events, defined once here and emitted by every SDK, as
 * sdk-api.md's Events section writes them: results answer what the app
 * called, events report what the SDK did on its own. Each SDK declares its
 * own listener API around them.
 */

/** A check found a release the device qualifies for. */
export interface UpdateAvailableEvent {
  downloadSizeBytes: number | null;
  notes: string | null;
  release: Release;
  trigger: SyncTrigger;
}

/** The download completed; `applyStrategy` says when the update is applied, `manual` meaning the app's `applyUpdate()`. */
export interface UpdateDownloadedEvent {
  applyStrategy: Exclude<ApplyStrategy, 'immediate'>;
  release: Release;
  trigger: SyncTrigger;
}

/** A check or a download failed. */
export interface UpdateFailedEvent {
  message: string;
  reason: FailedReason;
  release: Release | null;
  trigger: SyncTrigger;
}

/** While a pack downloads; `progress` from `0` to `1`. */
export interface DownloadProgressEvent {
  downloadSizeBytes: number;
  progress: number;
  progressBytes: number;
  releaseId: string;
}

/** At the start that follows a rollback, once, before the readiness gate; `toRelease` is `null` for the embedded bundle. */
export interface UpdateRolledBackEvent {
  fromRelease: Release;
  reason: RollbackReason;
  toRelease: Release | null;
}

export interface HotCodePushEvents {
  downloadProgress: DownloadProgressEvent;
  updateAvailable: UpdateAvailableEvent;
  updateDownloaded: UpdateDownloadedEvent;
  updateFailed: UpdateFailedEvent;
  updateRolledBack: UpdateRolledBackEvent;
}

export type HotCodePushEventName = keyof HotCodePushEvents;
