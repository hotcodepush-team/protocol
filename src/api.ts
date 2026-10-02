import type {
  ApplyResult,
  CheckResult,
  DownloadResult,
  FailedReason,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  InstallMoment,
  NotifyReadyResult,
  Release,
  RollbackOptions,
  RollbackReason,
  SetAttributesOptions,
  SetChannelOptions,
  SetRestartAllowedOptions,
  SyncOptions,
  SyncResult,
  SyncTrigger,
} from './results.js';

/**
 * The SDK's surface, defined once and implemented by every SDK — Capacitor,
 * React Native, Cordova and, through the React Native package, Expo — as
 * sdk-api.md's Methods and Events sections write it. A method takes at most
 * one options object and resolves a typed result or nothing; results answer
 * what the app called, events report what the SDK did on its own.
 */

/** A check found a release the device qualifies for. */
export interface UpdateAvailableEvent {
  downloadBytes: number | null;
  notes: string | null;
  release: Release;
  trigger: SyncTrigger;
}

/** The download completed and the update waits for its install. */
export interface UpdateDownloadedEvent {
  installAt: InstallMoment;
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
  downloadedBytes: number;
  progress: number;
  releaseId: string;
  totalBytes: number;
}

/** At the start that follows a rollback, once, before the readiness gate; `to` is `null` for the embedded bundle. */
export interface RolledBackEvent {
  from: Release;
  reason: RollbackReason;
  to: Release | null;
}

export interface HotCodePushEvents {
  downloadProgress: DownloadProgressEvent;
  rolledBack: RolledBackEvent;
  updateAvailable: UpdateAvailableEvent;
  updateDownloaded: UpdateDownloadedEvent;
  updateFailed: UpdateFailedEvent;
}

export type HotCodePushEventName = keyof HotCodePushEvents;

export const HOT_CODE_PUSH_EVENT_NAMES = [
  'downloadProgress',
  'rolledBack',
  'updateAvailable',
  'updateDownloaded',
  'updateFailed',
] as const satisfies readonly HotCodePushEventName[];

export interface HotCodePushListenerHandle {
  remove: () => Promise<void>;
}

export interface HotCodePushApi {
  /**
   * One full cycle: fetch the index, evaluate it locally, download and verify the
   * update the device is eligible for per `downloadStrategy`, apply it per the
   * install strategies, report. A second call while one runs joins the running one.
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
  /** The first stage: fetch and evaluate, download nothing. */
  checkForUpdate(): Promise<CheckResult>;
  /** The second stage: download and verify the update the last check found, whatever `downloadStrategy` says. */
  downloadUpdate(): Promise<DownloadResult>;
  /** The third stage: apply the downloaded update now and reload the app. */
  applyUpdate(): Promise<ApplyResult>;
  /** Ends the readiness gate when `readySignal` is `manual`; safe to call at any time on any setting. */
  notifyReady(): Promise<NotifyReadyResult>;
  /** Rolls the running release back now, marks its bundle as failed on this device, reports `REPORTED_BY_APP`, reloads. */
  rollback(options?: RollbackOptions): Promise<void>;
  /** Clears every downloaded update and the list of failed bundles, keeps the channel and the attributes, reloads. */
  clearUpdates(): Promise<void>;
  /** Restart gating: `allowed: false` holds the one restart the SDK would perform until `allowed: true`. */
  setRestartAllowed(options: SetRestartAllowedOptions): Promise<void>;
  /** The SDK's state, a snapshot. */
  getState(): Promise<GetStateResult>;
  /** The channel in effect with its source. */
  getChannel(): Promise<GetChannelResult>;
  /** Switches the device to a channel by name or by id; `null` clears the runtime choice. */
  setChannel(options: SetChannelOptions): Promise<void>;
  /** The facts of the device report. */
  getDevice(): Promise<GetDeviceResult>;
  /** Merges string attributes the app sets for `attribute` conditions; a `null` value removes a key. */
  setAttributes(options: SetAttributesOptions): Promise<void>;
  /** Opens the SDK's native debug screen. */
  showDebugScreen(): Promise<void>;
  addListener<EventName extends HotCodePushEventName>(
    eventName: EventName,
    listener: (event: HotCodePushEvents[EventName]) => void,
  ): Promise<HotCodePushListenerHandle>;
  removeAllListeners(): Promise<void>;
}
