import { z } from 'zod';

import {
  DOWNLOAD_STRATEGIES,
  INSTALL_STRATEGIES,
  MANDATORY_INSTALL_STRATEGIES,
  READY_SIGNALS,
} from '../results.js';
import { SigningPublicKeySchema } from '../signing/signing-keys.js';
import { BundleManifestSchema } from './bundle-manifest.js';
import {
  Base64Schema,
  ChannelNameSchema,
  IdentifierSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  RelativePathSchema,
} from './primitives.js';

/** Every duration in seconds, one unit, no suffix in the key. */
const SecondsSchema = z.number().nonnegative();

/** The SDK options every build carries, each with its default, so a file with the app id alone is complete; the public keys join per file, in the form each is read in. */
const SDK_OPTIONS_SHAPE = {
  autoCheck: z.boolean().default(true),
  checkInterval: SecondsSchema.default(900),
  downloadStrategy: z.enum(DOWNLOAD_STRATEGIES).default('auto'),
  enabledInDebugBuilds: z.boolean().default(true),
  installOnResumeAfter: SecondsSchema.default(300),
  installStrategy: z.enum(INSTALL_STRATEGIES).default('next-start'),
  mandatoryInstallStrategy: z
    .enum(MANDATORY_INSTALL_STRATEGIES)
    .default('immediate'),
  readySignal: z.enum(READY_SIGNALS).default('render'),
  readyTimeout: z.number().min(1).default(10),
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
 * CLI alone, `dir` and `nativeSources`.
 */
export const ProjectConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  channel: ChannelNameSchema.default('production'),
  dir: z.string().optional(),
  /** The custom native sources the fingerprint hashes: files or directories, relative to the project root. */
  nativeSources: z.array(RelativePathSchema).default([]),
  /** The keys the app's binaries accept, self-describing, `rsa-v1_5-sha256:` and the base64 of the SPKI DER. */
  publicKeys: z.array(SigningPublicKeySchema).default([]),
});
export type ProjectConfiguration = z.infer<typeof ProjectConfigurationSchema>;

/**
 * The resource file the device reads: the project's configuration with the
 * channel resolved to its id by the embed step, plus what only a build step
 * can know. The hosts are present outside production builds alone.
 */
export const ConfigurationSchema = z.looseObject({
  ...SDK_OPTIONS_SHAPE,
  appId: NonEmptyStringSchema,
  builtAt: IsoTimestampSchema,
  /**
   * Null in a build whose embed step ran without a token or offline and could
   * not resolve the channel's name: such a build answers `FAILED` with
   * `UNKNOWN_CHANNEL`, requests nothing and reports nothing.
   */
  channelId: NonEmptyStringSchema.nullable(),
  dir: z.string().optional(),
  embeddedBundleId: IdentifierSchema.nullable(),
  /**
   * Null in a build that bundled no JavaScript, a React Native or Expo debug
   * build: its build step registers no binary and asks the API nothing, and
   * the SDK answers `SKIPPED` with `DEBUG_BUILD`.
   */
  embeddedBundleManifest: BundleManifestSchema.nullable(),
  filesBaseUrl: z.url().optional(),
  fingerprint: NonEmptyStringSchema.nullable(),
  /** The project's public keys as the embed step re-encoded them for the platform the file is written for. */
  publicKeys: z.array(DevicePublicKeySchema).default([]),
  updatesBaseUrl: z.url().optional(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;
