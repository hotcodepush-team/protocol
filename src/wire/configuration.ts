import { z } from 'zod';

import {
  DOWNLOAD_STRATEGIES,
  INSTALL_STRATEGIES,
  MANDATORY_INSTALL_STRATEGIES,
  READY_SIGNALS,
} from '../results.js';
import { EmbeddedBundleManifestSchema } from './bundle-manifest.js';
import {
  ChannelNameSchema,
  IsoTimestampSchema,
  NonEmptyStringSchema,
  RelativePathSchema,
} from './primitives.js';

/** Every duration in seconds, one unit, no suffix in the key. */
const SecondsSchema = z.number().nonnegative();

/** The SDK options every build carries, each with its default, so a file with the app id alone is complete. */
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
  publicKeys: z.array(NonEmptyStringSchema).default([]),
  readySignal: z.enum(READY_SIGNALS).default('render'),
  readyTimeout: z.number().min(1).default(10),
};

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
  channelId: NonEmptyStringSchema,
  dir: z.string().optional(),
  embeddedBundleId: NonEmptyStringSchema.nullable(),
  embeddedBundleManifest: EmbeddedBundleManifestSchema,
  filesBaseUrl: z.url().optional(),
  fingerprint: NonEmptyStringSchema.nullable(),
  updatesBaseUrl: z.url().optional(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;
