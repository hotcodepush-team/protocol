import type {
  ApplyStrategy,
  FailedReason,
  Release,
  RollbackReason,
  SyncTrigger,
} from './results.js';

// The events every SDK emits, as defined in sdk-api.md. Each SDK wraps them in its own listener API.
// Results answer what the app called. Events report what the SDK did on its own.

/** A check found a release the device qualifies for. */
export interface UpdateAvailableEvent {
  downloadSizeBytes: number | null;
  notes: string | null;
  release: Release;
  trigger: SyncTrigger;
}

/**
 * The download completed. `applyStrategy` says when the update is applied.
 * With `manual`, the app applies it by calling `applyUpdate()`.
 */
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

/** Sent while a pack downloads. `progress` runs from `0` to `1`. */
export interface DownloadProgressEvent {
  downloadSizeBytes: number;
  progress: number;
  progressBytes: number;
  releaseId: string;
}

/**
 * Sent once at the start after a rollback, before the readiness gate.
 * `toRelease` is `null` for the embedded bundle.
 */
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
