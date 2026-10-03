/**
 * The documents the Expo Updates bridge serves, in the format of the Expo
 * Updates protocol v1 (https://docs.expo.dev/technical-specs/expo-updates-1/,
 * as modified 2026-08-12) and of the expo-updates client on its main branch
 * as of 2026-10-02, which requires a UUID id, a `fileExtension` on every
 * asset but the launch asset, and timestamps with milliseconds. The bytes the
 * CLI signs at upload and the bridge serves verbatim are the canonical JSON
 * of a document, `stringifyCanonicalJson`.
 */
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import mime from 'mime/lite';
import { z } from 'zod';

import { computeSha256 } from '../hash/sha256.js';
import type { Platform } from '../results.js';
import type { BundleManifest, ManifestFile } from './bundle-manifest.js';

const ExpoExportPlatformMetadataSchema = z.looseObject({
  assets: z.array(z.looseObject({ ext: z.string(), path: z.string() })),
  bundle: z.string(),
});

/** `metadata.json` as `expo export` writes it: per platform, the bundle's path and the assets' paths and extensions. */
export const ExpoExportMetadataSchema = z.looseObject({
  fileMetadata: z.looseObject({
    android: ExpoExportPlatformMetadataSchema.optional(),
    ios: ExpoExportPlatformMetadataSchema.optional(),
  }),
  version: z.literal(0),
});
export type ExpoExportMetadata = z.infer<typeof ExpoExportMetadataSchema>;

export interface ExpoManifestInput {
  /** The id the API gave the bundle. */
  bundleId: string;
  /** The manifest of the uploaded `expo export` directory. */
  bundleManifest: BundleManifest;
  /** When the API created the bundle. */
  createdAt: string;
  /** The app's public Expo config, which `Constants.expoConfig` reads from the manifest's `extra.expoClient`. */
  expoClientConfig: Record<string, unknown>;
  exportMetadata: ExpoExportMetadata;
  /** The files host, without a trailing slash. */
  filesBaseUrl: string;
  platform: Platform;
  runtimeVersion: string;
}

export interface ExpoAsset {
  contentType: string;
  fileExtension: string;
  /** The base64url SHA-256 of the file. */
  hash: string;
  /** What the app's code references the asset by: for an asset, the MD5 hex its export path names. */
  key: string;
  url: string;
}

export type ExpoLaunchAsset = Omit<ExpoAsset, 'fileExtension'>;

export interface ExpoManifest {
  assets: ExpoAsset[];
  createdAt: string;
  extra: { expoClient: Record<string, unknown> };
  id: string;
  launchAsset: ExpoLaunchAsset;
  metadata: Record<string, string>;
  runtimeVersion: string;
}

export interface ExpoNoUpdateAvailableDirective {
  type: 'noUpdateAvailable';
}

export interface ExpoRollBackToEmbeddedDirective {
  parameters: { commitTime: string };
  type: 'rollBackToEmbedded';
}

export type ExpoDirective =
  ExpoNoUpdateAvailableDirective | ExpoRollBackToEmbeddedDirective;

export class ExpoManifestError extends Error {
  override readonly name = 'ExpoManifestError';
}

const LAUNCH_ASSET_CONTENT_TYPE = 'application/javascript';
const UNKNOWN_CONTENT_TYPE = 'application/octet-stream';

/**
 * The manifest of one platform's update: the platform's bundle as the launch
 * asset and its assets, each fetched from the files host by hash. The id is
 * a UUIDv8 derived from the bundle id and the platform, so the same bundle is
 * the same update on every upload of its manifest.
 */
export function buildExpoManifest(input: ExpoManifestInput): ExpoManifest {
  const { bundleId, platform } = input;
  const platformMetadata = input.exportMetadata.fileMetadata[platform];
  if (platformMetadata === undefined) {
    throw new ExpoManifestError(
      `the export holds no ${platform} bundle; export it with --platform ${platform}`,
    );
  }
  const launchFile = findManifestFile(input, platformMetadata.bundle);
  return {
    assets: platformMetadata.assets.map(asset => {
      const file = findManifestFile(input, asset.path);
      return {
        contentType: mime.getType(asset.ext) ?? UNKNOWN_CONTENT_TYPE,
        fileExtension: `.${asset.ext}`,
        hash: resolveBase64UrlSha256(file.sha256),
        key: resolveFileName(asset.path),
        url: resolveFileUrl(input, file.sha256),
      };
    }),
    createdAt: new Date(input.createdAt).toISOString(),
    extra: { expoClient: input.expoClientConfig },
    id: resolveExpoUpdateId(bundleId, platform),
    launchAsset: {
      contentType: LAUNCH_ASSET_CONTENT_TYPE,
      hash: resolveBase64UrlSha256(launchFile.sha256),
      key: launchFile.sha256,
      url: resolveFileUrl(input, launchFile.sha256),
    },
    metadata: {},
    runtimeVersion: input.runtimeVersion,
  };
}

/** The directive that tells a client its running update is the newest. */
export function buildExpoNoUpdateAvailableDirective(): ExpoNoUpdateAvailableDirective {
  return { type: 'noUpdateAvailable' };
}

/** The directive that sends a client back to its embedded update when `commitTime`, the moment of the rollback, is newer than the update it runs. */
export function buildExpoRollBackToEmbeddedDirective(
  commitTime: string,
): ExpoRollBackToEmbeddedDirective {
  return {
    parameters: { commitTime: new Date(commitTime).toISOString() },
    type: 'rollBackToEmbedded',
  };
}

function findManifestFile(
  { bundleId, bundleManifest }: ExpoManifestInput,
  path: string,
): ManifestFile {
  const file = bundleManifest.files.find(candidate => candidate.path === path);
  if (file === undefined) {
    throw new ExpoManifestError(
      `metadata.json names ${path}, which bundle ${bundleId} does not hold`,
    );
  }
  return file;
}

function resolveBase64UrlSha256(sha256: string): string {
  let binary = '';
  for (const byte of hexToBytes(sha256)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function resolveExpoUpdateId(bundleId: string, platform: Platform): string {
  const bytes = computeSha256(`${bundleId}:${platform}`).slice(0, 16);
  // The version nibble 8 and the RFC 9562 variant bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function resolveFileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function resolveFileUrl(input: ExpoManifestInput, sha256: string): string {
  return `${input.filesBaseUrl}/apps/${input.bundleManifest.appId}/files/${sha256}`;
}
