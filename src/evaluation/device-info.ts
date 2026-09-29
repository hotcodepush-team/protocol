/** What the device knows when it evaluates a channel index. */
export interface DeviceInfo {
  /** The sequence of the index the device has already evaluated; an older index is ignored. */
  appliedIndexSequence: number | null;
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
  /** The server time of the last acknowledged report, for the spending cap. */
  reportedAt: string | null;
  runtimeVersion: string | null;
}
