import type { PackKind } from '../results.js';
import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import type { Configuration } from '../wire/configuration.js';
import { resolveUpdatesBaseUrl } from '../wire/configuration.js';

/** What a download knows when it picks the pack to request. */
export interface PackDownload {
  appId: string;
  /**
   * The bundle the device runs, from the current release or the embedded bundle.
   * `null` for an embedded bundle the build step did not register.
   */
  baseBundleId: string | null;
  envelope: Pick<ManifestEnvelope, 'bundleId' | 'deltas' | 'pack'>;
  hosts: Pick<Configuration, 'updatesBaseUrl'>;
  /** How many manifest files the device has neither in its file store nor in its embedded bundle. */
  missingFileCount: number;
}

/**
 * A pack a download requests. `sizeBytes` is null when the envelope states no length.
 * `packBytesLimit` is the most bytes the pack may hold.
 */
export interface PackSource {
  kind: Exclude<PackKind, 'files'>;
  packBytesLimit: number;
  sizeBytes: number | null;
  url: string;
}

/**
 * Resolves the pack a download requests first, or `null` when no file is missing.
 * A device without a base takes the full pack. A device with a base takes a delta even for one missing file,
 * so the main bundle arrives as a patch. That is the delta the envelope lists for the base, else the streamed pack.
 */
export function resolvePackSource(download: PackDownload): PackSource | null {
  if (download.missingFileCount === 0) {
    return null;
  }
  const { baseBundleId, envelope } = download;
  if (baseBundleId === null) {
    return resolveFullPackSource(download);
  }
  const listedDelta = envelope.deltas.find(
    delta => delta.baseBundleId === baseBundleId,
  );
  if (listedDelta === undefined) {
    return resolveStreamedPackSource(download, baseBundleId);
  }
  return {
    kind: 'delta',
    packBytesLimit: listedDelta.sizeBytes,
    sizeBytes: listedDelta.sizeBytes,
    url: listedDelta.url,
  };
}

/**
 * Resolves the pack to request after `source` answered anything but 200 or 206.
 * Returns `null` when the download fails and waits for the next cycle, as for a full pack or a listed delta.
 * A streamed pack falls back to the full pack whatever the answer, since a device follows no redirect.
 */
export function resolveFallbackPackSource(
  download: PackDownload,
  source: PackSource,
): PackSource | null {
  switch (source.kind) {
    case 'delta':
    case 'full':
      return null;
    case 'streamed':
      return resolveFullPackSource(download);
  }
}

function resolveFullPackSource(download: PackDownload): PackSource {
  const { pack } = download.envelope;
  return {
    kind: 'full',
    packBytesLimit: pack.sizeBytes,
    sizeBytes: pack.sizeBytes,
    url: pack.url,
  };
}

// The updates host assembles this delta on request, so its length is unknown up front.
// It shares its entries with the full pack, so it is never larger.
function resolveStreamedPackSource(
  download: PackDownload,
  baseBundleId: string,
): PackSource {
  return {
    kind: 'streamed',
    packBytesLimit: download.envelope.pack.sizeBytes,
    sizeBytes: null,
    url: `${resolveUpdatesBaseUrl(download.hosts)}/v1/apps/${download.appId}/bundles/${download.envelope.bundleId}/deltas/${baseBundleId}`,
  };
}
