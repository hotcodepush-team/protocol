import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { ManifestEnvelopeSchema } from '../wire/bundle-manifest.js';
import { isUrlOnConfiguredHost } from '../wire/configuration.js';
import type { PackKind } from '../wire/device-events.js';
import type { PackDownload, PackSource } from './pack-source.js';
import { resolveFallbackPackSource, resolvePackSource } from './pack-source.js';

interface PackSourceCase {
  appId: string;
  baseBundleId: string | null;
  envelope: unknown;
  filesBaseUrl: string | null;
  missingFileCount: number;
  name: string;
  packKind: PackKind | null;
  requests: PackSource[];
  statuses: number[];
  updatesBaseUrl: string | null;
}

interface DownloadOutcome {
  packKind: PackKind | null;
  requests: PackSource[];
}

const PACK_SOURCE_CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/pack-sources.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: PackSourceCase[] }
).cases;

const SERVED_STATUSES = [200, 206];

/** The requests a download makes against the answers in order, and the kind of the pack that served it. */
function resolveDownloadOutcome(
  download: PackDownload,
  statuses: readonly number[],
): DownloadOutcome {
  const requests: PackSource[] = [];
  let source = resolvePackSource(download);
  if (source === null) {
    return { packKind: 'files', requests };
  }
  for (const status of statuses) {
    requests.push(source);
    if (SERVED_STATUSES.includes(status)) {
      return { packKind: source.kind, requests };
    }
    source = resolveFallbackPackSource(download, source, status);
    if (source === null) {
      return { packKind: null, requests };
    }
  }
  throw new Error('The case answers fewer requests than the download makes');
}

describe('resolvePackSource', () => {
  test.each(PACK_SOURCE_CASES.map(packCase => [packCase.name, packCase]))(
    '%s',
    (_name, packCase) => {
      const hosts = {
        filesBaseUrl: packCase.filesBaseUrl ?? undefined,
        updatesBaseUrl: packCase.updatesBaseUrl ?? undefined,
      };
      const download: PackDownload = {
        appId: packCase.appId,
        baseBundleId: packCase.baseBundleId,
        envelope: ManifestEnvelopeSchema.parse(packCase.envelope),
        hosts,
        missingFileCount: packCase.missingFileCount,
      };
      const outcome = resolveDownloadOutcome(download, packCase.statuses);
      expect(outcome).toEqual({
        packKind: packCase.packKind,
        requests: packCase.requests,
      });
      for (const request of outcome.requests) {
        expect(isUrlOnConfiguredHost(request.url, hosts)).toBe(true);
      }
    },
  );
});
