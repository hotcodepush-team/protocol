/** What the device knows when it evaluates a channel index. */
export interface DeviceInfo {
  attributes: Record<string, string>;
  binaryBuild: string;
  binaryVersion: string;
  /** The floor from the resource file. A release created before it is never applied. */
  builtAt: string;
  /** The running release, or `null` for the embedded bundle. */
  currentRelease: { id: string; number: number } | null;
  deviceId: string;
  failedBundleIds: readonly string[];
  fingerprint: string | null;
  osVersion: string;
  /**
   * The server time of the first acknowledged report in the latest UTC month that has one, for the spending cap.
   * Kept by `resolveKeptReportedAt`.
   */
  reportedAt: string | null;
}
