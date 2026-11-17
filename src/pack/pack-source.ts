import type { PackKind } from '../results.js';
import type {
  EnvelopeDelta,
  ManifestEnvelope,
} from '../wire/bundle-manifest.js';
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

/** A pack a download requests, at the URL and length the envelope states. */
export interface PackSource {
  kind: Extract<PackKind, 'delta' | 'full'>;
  sizeBytes: number;
  url: string;
}

/**
 * Resolves the packs a download tries in order: none when no file is missing, the full pack, or a delta and then the full pack.
 * A device with a base tries the delta the envelope lists for that base first, even for one missing file,
 * so the main bundle can arrive as a patch.
 * The first pack that arrives, is read without a refusal and leaves no file missing serves the download.
 * Any problem with a delta leads to the next pack. A failure of the device itself, a write that fails on its storage
 * or memory that runs out while a file inflates, starts no fallback and is `download_failed`.
 */
export function resolvePackSources(download: PackDownload): PackSource[] {
  if (download.missingFileCount === 0) {
    return [];
  }
  const fullPackSource = resolveFullPackSource(download);
  const listedDelta = resolveListedDelta(download);
  if (listedDelta === undefined) {
    return [fullPackSource];
  }
  const deltaSource: PackSource = {
    kind: 'delta',
    sizeBytes: listedDelta.sizeBytes,
    url: listedDelta.url,
  };
  return [deltaSource, fullPackSource];
}

/**
 * Resolves the URL of the delta route, the `GET` on the updates host a download sends when the envelope lists no delta for the device's base.
 * `null` when no file is missing, the device has no base or the envelope lists its delta.
 * The device sends it once and never retries it, requests the full pack without waiting for its answer,
 * and reads nothing of that answer. No answer and no failure of the request changes the download.
 */
export function resolveDeltaRouteUrl(download: PackDownload): string | null {
  const { appId, baseBundleId, envelope, hosts, missingFileCount } = download;
  if (
    missingFileCount === 0 ||
    baseBundleId === null ||
    resolveListedDelta(download) !== undefined
  ) {
    return null;
  }
  return `${resolveUpdatesBaseUrl(hosts)}/v1/apps/${appId}/bundles/${envelope.bundleId}/deltas/${baseBundleId}`;
}

function resolveListedDelta({
  baseBundleId,
  envelope,
}: PackDownload): EnvelopeDelta | undefined {
  return envelope.deltas.find(delta => delta.baseBundleId === baseBundleId);
}

function resolveFullPackSource(download: PackDownload): PackSource {
  const { pack } = download.envelope;
  return { kind: 'full', sizeBytes: pack.sizeBytes, url: pack.url };
}
