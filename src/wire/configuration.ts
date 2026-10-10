import { z } from 'zod';

import {
  APPLY_STRATEGIES,
  CHECK_STRATEGIES,
  DOWNLOAD_STRATEGIES,
  MANDATORY_APPLY_STRATEGIES,
  READY_SIGNALS,
} from '../results.js';
import { SigningPublicKeySchema } from '../signing/signing-keys.js';
import { BundleManifestSchema } from './bundle-manifest.js';
import {
  Base64Schema,
  ChannelNameSchema,
  ExtraFingerprintPathSchema,
  HttpUrlSchema,
  IdentifierSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
} from './primitives.js';

/** Every duration in seconds, one unit, which the key names with its `Seconds` suffix. */
const SecondsSchema = z.number().nonnegative();

/** The SDK options every build carries, each with its default, so a file with the app id alone is complete; the public keys join per file, in the form each is read in. */
const SDK_OPTIONS_SHAPE = {
  /** The least time in the background before a `next-resume` apply. */
  applyOnResumeAfterSeconds: SecondsSchema.default(300),
  applyStrategy: z.enum(APPLY_STRATEGIES).default('next-start'),
  /** At least 60 seconds, the floor, since a zero made the core check in a tight loop; 900 when the project sets none. */
  checkIntervalSeconds: SecondsSchema.min(60).default(900),
  checkStrategy: z.enum(CHECK_STRATEGIES).default('auto'),
  downloadStrategy: z.enum(DOWNLOAD_STRATEGIES).default('auto'),
  enabledInDebugBuilds: z.boolean().default(true),
  mandatoryApplyStrategy: z
    .enum(MANDATORY_APPLY_STRATEGIES)
    .default('immediate'),
  readySignal: z.enum(READY_SIGNALS).default('render'),
  readyTimeoutSeconds: SecondsSchema.min(1).default(10),
};

/**
 * A public key as a device reads it, in the encoding its platform's own API
 * imports with no ASN.1 handled on the device: the base64 of the key's DER —
 * PKCS #1 for iOS's `SecKeyCreateWithData`, SPKI for Android's
 * `X509EncodedKeySpec` — beside its key id, the fingerprint over the SPKI
 * bytes, which a device cannot recompute from PKCS #1.
 */
export const DevicePublicKeySchema = z.looseObject({
  der: Base64Schema,
  keyId: NonEmptyStringSchema,
});
export type DevicePublicKey = z.infer<typeof DevicePublicKeySchema>;

/**
 * `hotcodepush.json` in the project root, written by `init` and read by every
 * CLI command: the app id, the channel by name, the SDK options and, for the
 * CLI alone, `extraFingerprintPaths`.
 */
export const ProjectConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  channel: ChannelNameSchema.default('production'),
  /** The extra paths the fingerprint hashes beside the packages: files or directories, relative to the project root, a sibling workspace's through `..`. */
  extraFingerprintPaths: z.array(ExtraFingerprintPathSchema).default([]),
  /** The keys the app's binaries accept, self-describing, `rsa-v1_5-sha256:` and the base64 of the SPKI DER. */
  publicKeys: z.array(SigningPublicKeySchema).default([]),
});
export type ProjectConfiguration = z.infer<typeof ProjectConfigurationSchema>;

/**
 * The resource file the device reads: the project's configuration with the
 * channel resolved to its id by the embed step and the CLI's own key left
 * behind, plus what only a build step can know. The hosts are present outside
 * production builds alone.
 */
export const ConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  builtAt: IsoTimestampSchema,
  /**
   * Null in a build whose embed step ran without a token or offline and could
   * not resolve the channel's name: such a build answers `FAILED` with
   * `CHANNEL_UNKNOWN`, requests nothing and reports nothing.
   */
  channelId: NonEmptyStringSchema.nullable(),
  embeddedBundleId: IdentifierSchema.nullable(),
  /**
   * Null in a build that bundled no JavaScript, a React Native or Expo debug
   * build: its build step registers no binary and asks the API nothing, and
   * the SDK answers `SKIPPED` with `BUILD_DEBUG`.
   */
  embeddedBundleManifest: BundleManifestSchema.nullable(),
  filesBaseUrl: HttpUrlSchema.optional(),
  /**
   * The fingerprint of the native contract the build was made from, `fp1:`
   * and the hash: the same string the device reports and a release's
   * conditions name; null when the recipe could not read the project.
   */
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The project's public keys as the embed step re-encoded them for the platform the file is written for. */
  publicKeys: z.array(DevicePublicKeySchema).default([]),
  updatesBaseUrl: HttpUrlSchema.optional(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;

/** The hosts a production build fetches from, which carries neither in its resource file. */
const FILES_BASE_URL_DEFAULT = 'https://files.hotcodepush.com';
const UPDATES_BASE_URL_DEFAULT = 'https://updates.hotcodepush.com';

/**
 * Whether a manifest, pack or delta URL lies under the configured files or
 * updates host, the production hosts when the build names none: it starts
 * with the base URL and a `/`, so another scheme, userinfo, a look-alike
 * host, another port or another path is off the host, `MANIFEST_INVALID`
 * before a byte is written.
 */
export function isUrlOnConfiguredHost(
  url: string,
  hosts: Pick<Configuration, 'filesBaseUrl' | 'updatesBaseUrl'>,
): boolean {
  return [resolveFilesBaseUrl(hosts), resolveUpdatesBaseUrl(hosts)].some(
    baseUrl => url.startsWith(`${baseUrl}/`),
  );
}

/** The files host the build names, the production one when it names none. */
export function resolveFilesBaseUrl(
  hosts: Pick<Configuration, 'filesBaseUrl'>,
): string {
  return hosts.filesBaseUrl ?? FILES_BASE_URL_DEFAULT;
}

/** The updates host the build names, the production one when it names none. */
export function resolveUpdatesBaseUrl(
  hosts: Pick<Configuration, 'updatesBaseUrl'>,
): string {
  return hosts.updatesBaseUrl ?? UPDATES_BASE_URL_DEFAULT;
}
