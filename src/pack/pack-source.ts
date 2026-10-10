import type { ManifestEnvelope } from '../wire/bundle-manifest.js';
import type { Configuration } from '../wire/configuration.js';
import {
  resolveFilesBaseUrl,
  resolveUpdatesBaseUrl,
} from '../wire/configuration.js';
import type { PackKind } from '../wire/device-events.js';

/** What a download knows when it picks the pack to request. */
export interface PackDownload {
  appId: string;
  /** The bundle the device runs: the current release's, or the embedded bundle's id; `null` for an embedded bundle the build step did not register. */
  baseBundleId: string | null;
  envelope: Pick<ManifestEnvelope, 'bundleId' | 'deltas' | 'pack'>;
  hosts: Pick<Configuration, 'filesBaseUrl' | 'updatesBaseUrl'>;
  /** The manifest's files the device holds neither in its file store nor in its embedded bundle. */
  missingFileCount: number;
}

/** A pack a download requests: where, how its bytes arrive, its length when the envelope states one and the most bytes it may hold. */
export interface PackSource {
  kind: Exclude<PackKind, 'files'>;
  maximumBytes: number;
  sizeBytes: number | null;
  url: string;
}

const NOT_FOUND_STATUS = 404;

/**
 * The pack a download requests first, `null` when no file is missing. A
 * device with a base takes a delta pack for one missing file as for ten, so
 * the one file a patch exists for, the main bundle, arrives as a patch: the
 * delta the envelope lists for its base, else the delta pack at the URL
 * derived on the files host, never larger than the full pack whose entries it
 * shares. A device without a base takes the full pack.
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
  if (listedDelta !== undefined) {
    return {
      kind: 'delta',
      maximumBytes: listedDelta.sizeBytes,
      sizeBytes: listedDelta.sizeBytes,
      url: listedDelta.url,
    };
  }
  return {
    kind: 'delta',
    maximumBytes: envelope.pack.sizeBytes,
    sizeBytes: null,
    url: `${resolveFilesBaseUrl(download.hosts)}/${resolveDeltaPackPath(download, baseBundleId)}`,
  };
}

/**
 * The pack a download requests after `source` answered `status` instead of a
 * 200 or a 206, `null` when the download fails and waits for the next cycle.
 * A delta pack answering 404 is not built, and the updates host assembles it;
 * whatever else the updates host answers, its redirect to the full pack above
 * twenty objects included, reads as the full pack, since a device follows no
 * redirect.
 */
export function resolveFallbackPackSource(
  download: PackDownload,
  source: PackSource,
  status: number,
): PackSource | null {
  switch (source.kind) {
    case 'delta':
      if (status !== NOT_FOUND_STATUS || download.baseBundleId === null) {
        return null;
      }
      return resolveStreamedPackSource(download, download.baseBundleId);
    case 'full':
      return null;
    case 'streamed':
      return resolveFullPackSource(download);
  }
}

/** The delta pack's path below a host, the bucket's key and the updates route alike. */
function resolveDeltaPackPath(
  download: PackDownload,
  baseBundleId: string,
): string {
  return `apps/${download.appId}/bundles/${download.envelope.bundleId}/deltas/${baseBundleId}`;
}

function resolveFullPackSource(download: PackDownload): PackSource {
  const { pack } = download.envelope;
  return {
    kind: 'full',
    maximumBytes: pack.sizeBytes,
    sizeBytes: pack.sizeBytes,
    url: pack.url,
  };
}

/** The delta pack the updates host assembles on request, of a length known only as it arrives. */
function resolveStreamedPackSource(
  download: PackDownload,
  baseBundleId: string,
): PackSource {
  return {
    kind: 'streamed',
    maximumBytes: download.envelope.pack.sizeBytes,
    sizeBytes: null,
    url: `${resolveUpdatesBaseUrl(download.hosts)}/v1/${resolveDeltaPackPath(download, baseBundleId)}`,
  };
}
