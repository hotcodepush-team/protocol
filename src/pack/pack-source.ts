import type { PackKind } from '../results.js';
import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import type { Configuration } from '../wire/configuration.js';
import { resolveUpdatesBaseUrl } from '../wire/configuration.js';

/** What a download knows when it picks the pack to request. */
export interface PackDownload {
  appId: string;
  /** The bundle the device runs: the current release's, or the embedded bundle's id; `null` for an embedded bundle the build step did not register. */
  baseBundleId: string | null;
  envelope: Pick<ManifestEnvelope, 'bundleId' | 'deltas' | 'pack'>;
  hosts: Pick<Configuration, 'updatesBaseUrl'>;
  /** The manifest's files the device holds neither in its file store nor in its embedded bundle. */
  missingFileCount: number;
}

/** A pack a download requests: where, how its bytes arrive, its length when the envelope states one and the most bytes it may hold. */
export interface PackSource {
  kind: Exclude<PackKind, 'files'>;
  packBytesLimit: number;
  sizeBytes: number | null;
  url: string;
}

/**
 * The pack a download requests first, `null` when no file is missing. A
 * device with a base takes a delta for one missing file as for ten, so
 * the one file a patch exists for, the main bundle, arrives as a patch. The
 * envelope's deltas are the deltas that exist: the one it lists for the
 * device's base, else the streamed pack the updates host assembles, never a
 * URL guessed on the files host. A device without a base takes the full pack.
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
 * The pack a download requests after `source` answered anything but a 200 or
 * a 206, `null` when the download fails and waits for the next cycle. Only the
 * streamed pack gives way: whatever the updates host answers, its redirect to
 * the full pack above twenty objects included, reads as the full pack, since a
 * device follows no redirect. A listed delta that does not answer fails like
 * the full pack, its 404 included.
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

/**
 * The delta the updates host assembles on request, of a length known only
 * as it arrives, never larger than the full pack whose entries it shares.
 */
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
