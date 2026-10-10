/** What the device knows when it evaluates a channel index. */
export interface DeviceInfo {
  attributes: Record<string, string>;
  binaryBuild: string;
  binaryVersion: string;
  /** The floor from the resource file: no release created before it is applied. */
  builtAt: string;
  /** The running release, or `null` for the embedded bundle. */
  currentRelease: { id: string; number: number } | null;
  deviceId: string;
  failedBundleIds: readonly string[];
  fingerprint: string | null;
  osVersion: string;
  /** The server time of the month's first acknowledged report, kept by `resolveKeptReportedAt`, for the spending cap. */
  reportedAt: string | null;
}
