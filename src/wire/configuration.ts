import { z } from 'zod';

import {
  INSTALL_STRATEGIES,
  NETWORK_POLICIES,
  READY_SIGNALS,
} from '../results.js';
import { EmbeddedBundleManifestSchema } from './bundle-manifest.js';
import { IsoTimestampSchema, NonEmptyStringSchema } from './primitives.js';

/**
 * `hotcodepush.json` in the project root, written by `init` and read by every
 * CLI command; the SDK options carry their defaults, so a file with only the
 * two ids is complete.
 */
export const ProjectConfigurationSchema = z.looseObject({
  appId: NonEmptyStringSchema,
  autoSync: z.boolean().default(true),
  channelId: NonEmptyStringSchema,
  dir: z.string().optional(),
  enabledInDebugBuilds: z.boolean().default(true),
  installStrategy: z.enum(INSTALL_STRATEGIES).default('next-start'),
  minimumBackgroundDuration: z.number().nonnegative().default(300),
  network: z.enum(NETWORK_POLICIES).default('any'),
  publicKeys: z.array(NonEmptyStringSchema).default([]),
  readySignal: z.enum(READY_SIGNALS).default('render'),
  readyTimeout: z.number().min(1).default(10),
  syncInterval: z.number().nonnegative().default(900),
});
export type ProjectConfiguration = z.infer<typeof ProjectConfigurationSchema>;

/** The resource file the device reads: the project's configuration plus what only a build step can know. */
export const ConfigurationSchema = ProjectConfigurationSchema.extend({
  builtAt: IsoTimestampSchema,
  embeddedBundleId: NonEmptyStringSchema.nullable(),
  embeddedBundleManifest: EmbeddedBundleManifestSchema,
  fingerprint: NonEmptyStringSchema.nullable(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;
