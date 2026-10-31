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

// Every duration uses seconds, and its key ends in `Seconds`.
const SecondsSchema = z.number().nonnegative();

// Every option has a default, so a file with only the app id is complete.
// The public keys are added per file, in the encoding each reader needs.
const SDK_OPTIONS_SHAPE = {
  applyStrategy: z.enum(APPLY_STRATEGIES).default('next_start'),
  /** At least 60 seconds, since zero made the core check in a tight loop. Defaults to 900. */
  checkIntervalSeconds: SecondsSchema.min(60).default(900),
  checkStrategy: z.enum(CHECK_STRATEGIES).default('auto'),
  downloadStrategy: z.enum(DOWNLOAD_STRATEGIES).default('auto'),
  isEnabledInDebugBuilds: z.boolean().default(true),
  mandatoryApplyStrategy: z
    .enum(MANDATORY_APPLY_STRATEGIES)
    .default('immediate'),
  /** The minimum time in the background before a `next_resume` apply. */
  nextResumeMinimumBackgroundSeconds: SecondsSchema.default(300),
  readySignal: z.enum(READY_SIGNALS).default('render'),
  readyTimeoutSeconds: SecondsSchema.min(1).default(10),
};

/**
 * A public key as a device reads it: base64 DER in the encoding the native API imports, so the device parses no ASN.1.
 * That is PKCS #1 for `SecKeyCreateWithData` on iOS and SPKI for `X509EncodedKeySpec` on Android.
 * `keyId` is the fingerprint over the SPKI bytes, which a device cannot recompute from PKCS #1.
 */
export const DevicePublicKeySchema = z.looseObject({
  der: Base64Schema,
  keyId: NonEmptyStringSchema,
});
export type DevicePublicKey = z.infer<typeof DevicePublicKeySchema>;

/**
 * `hotcodepush.json` in the project root, written by `init` and read by every CLI command.
 * Only the CLI uses `extraFingerprintPaths`.
 */
export const ProjectConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  channel: ChannelNameSchema.default('production'),
  /**
   * Files or directories the fingerprint hashes beside the packages, relative to the project root.
   * `..` may reach a sibling workspace.
   */
  extraFingerprintPaths: z.array(ExtraFingerprintPathSchema).default([]),
  /** The keys the app binaries accept, as `rsa-v1_5-sha256:` and the base64 of the SPKI DER. */
  publicKeys: z.array(SigningPublicKeySchema).default([]),
});
export type ProjectConfiguration = z.infer<typeof ProjectConfigurationSchema>;

/**
 * The resource file the device reads: the project configuration plus what only a build step knows.
 * The embed step resolves the channel to its id and drops the CLI-only key. Hosts are set only outside production builds.
 */
export const ConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  builtAt: IsoTimestampSchema,
  /**
   * Null when the embed step ran offline or without a token and could not resolve the channel name.
   * Such a build answers `failed` with `channel_unknown`, and requests and reports nothing.
   */
  channelId: NonEmptyStringSchema.nullable(),
  embeddedBundleId: IdentifierSchema.nullable(),
  /**
   * Null in a build that bundled no JavaScript, such as a React Native or Expo debug build.
   * Its build step registers no binary, and the SDK answers `skipped` with `build_debug`.
   */
  embeddedBundleManifest: BundleManifestSchema.nullable(),
  filesBaseUrl: HttpUrlSchema.optional(),
  /**
   * The fingerprint of the native contract of the build, the same string the device reports and conditions name.
   * Null when the recipe could not read the project.
   */
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The project public keys, re-encoded by the embed step for the platform of this file. */
  publicKeys: z.array(DevicePublicKeySchema).default([]),
  updatesBaseUrl: HttpUrlSchema.optional(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;

// A production build carries no hosts in its resource file, so it uses these.
const FILES_BASE_URL_DEFAULT = 'https://files.hotcodepush.com';
const UPDATES_BASE_URL_DEFAULT = 'https://updates.hotcodepush.com';

/**
 * Whether a manifest, pack or delta URL lies under the files or updates host, the production hosts when none is set.
 * It must start with the base URL and a `/`, so another scheme, userinfo, look-alike host, port or path fails.
 * The device then fails with `manifest_invalid` before writing a byte.
 */
export function isUrlOnConfiguredHost(
  url: string,
  hosts: Pick<Configuration, 'filesBaseUrl' | 'updatesBaseUrl'>,
): boolean {
  return [resolveFilesBaseUrl(hosts), resolveUpdatesBaseUrl(hosts)].some(
    baseUrl => url.startsWith(`${baseUrl}/`),
  );
}

export function resolveFilesBaseUrl(
  hosts: Pick<Configuration, 'filesBaseUrl'>,
): string {
  return hosts.filesBaseUrl ?? FILES_BASE_URL_DEFAULT;
}

export function resolveUpdatesBaseUrl(
  hosts: Pick<Configuration, 'updatesBaseUrl'>,
): string {
  return hosts.updatesBaseUrl ?? UPDATES_BASE_URL_DEFAULT;
}
