import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { FailedReason } from '../results.js';
import { ManifestEnvelopeSchema } from '../wire/bundle-manifest.js';
import { isUrlOnConfiguredHost } from '../wire/configuration.js';
import type { DeviceEvent } from '../wire/device-events.js';
import type { PackDownload, PackSource } from './pack-source.js';
import { resolveDeltaRouteUrl, resolvePackSources } from './pack-source.js';

interface PackAnswer {
  missingFileCount: number | null;
  readOutcome: 'device_failed' | 'pack_read' | 'pack_refused' | null;
  status: number | null;
}

type DownloadedEvent = Pick<
  Extract<DeviceEvent, { type: 'downloaded' }>,
  'downloadSizeBytes' | 'packKind'
>;

type DownloadFailedReason = Extract<
  FailedReason,
  'content_mismatched' | 'download_failed'
>;

interface DownloadOutcome {
  deltaRouteUrl: string | null;
  downloadedEvent: DownloadedEvent | null;
  failedReason: DownloadFailedReason | null;
  requests: PackSource[];
}

interface PackSourceCase extends DownloadOutcome {
  answers: PackAnswer[];
  appId: string;
  baseBundleId: string | null;
  deltaRouteAnswer: { status: number | null } | null;
  envelope: unknown;
  filesBaseUrl: string | null;
  missingFileCount: number;
  name: string;
  updatesBaseUrl: string | null;
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

function resolveDownloadOutcome(
  download: PackDownload,
  { answers }: { answers: readonly PackAnswer[] },
): DownloadOutcome {
  const requests: PackSource[] = [];
  let downloadedEvent: DownloadedEvent | null = null;
  let failedReason: DownloadFailedReason | null = null;
  for (const source of resolvePackSources(download)) {
    const answer = answers[requests.length];
    if (answer === undefined) {
      throw new Error(
        'The case answers fewer requests than the download makes',
      );
    }
    requests.push(source);
    failedReason = resolvePackFailedReason(answer);
    if (failedReason === null) {
      downloadedEvent = {
        downloadSizeBytes: source.sizeBytes,
        packKind: source.kind,
      };
      break;
    }
    if (answer.readOutcome === 'device_failed') {
      break;
    }
  }
  if (answers.length > requests.length) {
    throw new Error('The case answers more requests than the download makes');
  }
  const deltaRouteUrl = resolveDeltaRouteUrl(download);
  return { deltaRouteUrl, downloadedEvent, failedReason, requests };
}

function resolvePackFailedReason({
  missingFileCount,
  readOutcome,
  status,
}: PackAnswer): DownloadFailedReason | null {
  if (
    status === null ||
    !SERVED_STATUSES.includes(status) ||
    readOutcome === 'device_failed'
  ) {
    return 'download_failed';
  }
  if (readOutcome === 'pack_read' && missingFileCount === 0) {
    return null;
  }
  return 'content_mismatched';
}

describe('a download', () => {
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
      const outcome = resolveDownloadOutcome(download, {
        answers: packCase.answers,
      });
      expect(outcome).toEqual({
        deltaRouteUrl: packCase.deltaRouteUrl,
        downloadedEvent: packCase.downloadedEvent,
        failedReason: packCase.failedReason,
        requests: packCase.requests,
      });
      expect(packCase.deltaRouteAnswer !== null).toBe(
        outcome.deltaRouteUrl !== null,
      );
      const askedUrls = outcome.requests.map(request => request.url);
      if (outcome.deltaRouteUrl !== null) {
        askedUrls.push(outcome.deltaRouteUrl);
      }
      for (const url of askedUrls) {
        expect(isUrlOnConfiguredHost(url, hosts)).toBe(true);
      }
    },
  );
});
