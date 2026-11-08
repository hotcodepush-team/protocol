import type {
  ApplyUpdateResult,
  CheckForUpdateResult,
  DownloadUpdateOptions,
  DownloadUpdateResult,
  GetChannelResult,
  GetDeviceResult,
  GetStateResult,
  NotifyReadyResult,
  RollbackUpdateOptions,
  SetAttributesOptions,
  SetChannelOptions,
  SetRestartAllowedOptions,
  SyncOptions,
  SyncResult,
} from './results.js';

/**
 * The methods every HotCodePush SDK offers, the same on each framework.
 * Each bridge extends it with its own `addListener`, since the listener handle is the framework's.
 */
export interface HotCodePushMethods {
  /**
   * Applies the downloaded update now and reloads the app.
   *
   * The apply strategy does not matter here.
   */
  applyUpdate(): Promise<ApplyUpdateResult>;
  /**
   * Checks for an update without downloading it.
   *
   * It runs `sync()` with `downloadStrategy` set to `manual`.
   */
  checkForUpdate(): Promise<CheckForUpdateResult>;
  /**
   * Clears all downloaded updates and the list of failed bundles, then reloads the app.
   *
   * The channel and the attributes stay.
   */
  clearUpdates(): Promise<void>;
  /**
   * Downloads and verifies the available update.
   *
   * It runs `sync()` with `downloadStrategy` set to `auto`.
   * It checks the index again with a conditional GET and applies the update as the apply strategies say.
   */
  downloadUpdate(
    options?: DownloadUpdateOptions,
  ): Promise<DownloadUpdateResult>;
  /** Returns the channel in effect and where it comes from. */
  getChannel(): Promise<GetChannelResult>;
  /** Returns the device facts that the device report carries. */
  getDevice(): Promise<GetDeviceResult>;
  /** Returns a snapshot of the SDK state. */
  getState(): Promise<GetStateResult>;
  /**
   * Ends the readiness gate when `readySignal` is `manual`.
   *
   * It is safe to call at any time and with any `readySignal`.
   */
  notifyReady(): Promise<NotifyReadyResult>;
  /** Removes every listener that `addListener` added. */
  removeAllListeners(): Promise<void>;
  /**
   * Rolls back the running release now and reloads the app.
   *
   * The bundle is marked as failed on this device, and the rollback is reported with the reason `app_requested`.
   */
  rollbackUpdate(options?: RollbackUpdateOptions): Promise<void>;
  /**
   * Merges the given attributes into the ones that `attribute` conditions match.
   *
   * A `null` value removes the key.
   */
  setAttributes(options: SetAttributesOptions): Promise<void>;
  /**
   * Switches the device to a channel by name or by ID.
   *
   * `null` clears the channel set at runtime and returns to the configured one.
   */
  setChannel(options: SetChannelOptions): Promise<void>;
  /**
   * Allows or holds the restarts the SDK performs on its own.
   *
   * With `isAllowed: false`, the SDK holds its restart after an `immediate` apply, a `next_resume` apply or a mandatory release.
   * The held restart runs when `isAllowed: true` is set.
   * Restarts the app asks for with `applyUpdate()`, `rollbackUpdate()` or `clearUpdates()` are never held.
   * The setting is not persisted: every app start begins with restarts allowed.
   */
  setRestartAllowed(options: SetRestartAllowedOptions): Promise<void>;
  /** Opens the native debug screen of the SDK. */
  showDebugScreen(): Promise<void>;
  /**
   * Runs one update cycle under the configured strategies.
   *
   * The cycle fetches the index, evaluates it locally, downloads and verifies, applies and reports.
   * It stops at any step whose strategy is `manual` and leaves that step to the app.
   * The SDK runs the same cycle on its own at start, at resume and on the interval.
   * A call made while a cycle runs joins that cycle.
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
}
