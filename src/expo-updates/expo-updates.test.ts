import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { PLATFORMS } from '../results.js';
import type { BundleManifest } from '../wire/bundle-manifest.js';
import type {
  ExpoExportMetadata,
  ExpoManifest,
  ExpoManifestInput,
  ExpoRollBackToEmbeddedDirective,
} from './expo-updates.js';
import {
  buildExpoManifest,
  buildExpoNoUpdateAvailableDirective,
  buildExpoRollBackToEmbeddedDirective,
  ExpoExportMetadataSchema,
  ExpoManifestError,
} from './expo-updates.js';

interface ExpoUpdatesFixture {
  directives: {
    noUpdateAvailable: unknown;
    rollBackToEmbedded: {
      commitTime: string;
      directive: ExpoRollBackToEmbeddedDirective;
    };
  };
  input: Omit<ExpoManifestInput, 'platform'>;
  manifests: Record<(typeof PLATFORMS)[number], ExpoManifest>;
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../fixtures/expo-updates.json', import.meta.url),
    'utf8',
  ),
) as ExpoUpdatesFixture;

function bundleManifestWithout(path: string): BundleManifest {
  const { bundleManifest } = FIXTURE.input;
  return {
    ...bundleManifest,
    files: bundleManifest.files.filter(file => file.path !== path),
  };
}

describe('buildExpoManifest', () => {
  test.each(PLATFORMS)('should build the pinned %s manifest', platform => {
    expect(buildExpoManifest({ ...FIXTURE.input, platform })).toEqual(
      FIXTURE.manifests[platform],
    );
  });

  test('should refuse a platform the export holds no bundle for', () => {
    const exportMetadata: ExpoExportMetadata = {
      ...FIXTURE.input.exportMetadata,
      fileMetadata: { ios: FIXTURE.input.exportMetadata.fileMetadata.ios },
    };
    expect(() =>
      buildExpoManifest({
        ...FIXTURE.input,
        exportMetadata,
        platform: 'android',
      }),
    ).toThrow(ExpoManifestError);
  });

  test('should refuse an asset the bundle does not hold', () => {
    const [asset] = FIXTURE.input.exportMetadata.fileMetadata.ios?.assets ?? [];
    expect(() =>
      buildExpoManifest({
        ...FIXTURE.input,
        bundleManifest: bundleManifestWithout(asset?.path ?? ''),
        platform: 'ios',
      }),
    ).toThrow(ExpoManifestError);
  });

  test('should refuse a launch asset the bundle does not hold', () => {
    const bundlePath =
      FIXTURE.input.exportMetadata.fileMetadata.ios?.bundle ?? '';
    expect(() =>
      buildExpoManifest({
        ...FIXTURE.input,
        bundleManifest: bundleManifestWithout(bundlePath),
        platform: 'ios',
      }),
    ).toThrow(ExpoManifestError);
  });

  test('should give each platform its own update id', () => {
    const [android, ios] = PLATFORMS.map(
      platform => buildExpoManifest({ ...FIXTURE.input, platform }).id,
    );
    expect(android).not.toBe(ios);
  });
});

describe('ExpoExportMetadataSchema', () => {
  test('should parse the metadata.json of an export', () => {
    expect(
      ExpoExportMetadataSchema.parse(FIXTURE.input.exportMetadata),
    ).toEqual(FIXTURE.input.exportMetadata);
  });

  test('should refuse a metadata version it was not written against', () => {
    expect(
      ExpoExportMetadataSchema.safeParse({
        ...FIXTURE.input.exportMetadata,
        version: 1,
      }).success,
    ).toBe(false);
  });
});

describe('buildExpoNoUpdateAvailableDirective', () => {
  test('should build the pinned directive', () => {
    expect(buildExpoNoUpdateAvailableDirective()).toEqual(
      FIXTURE.directives.noUpdateAvailable,
    );
  });
});

describe('buildExpoRollBackToEmbeddedDirective', () => {
  test('should build the pinned directive with the commit time in milliseconds', () => {
    const { commitTime, directive } = FIXTURE.directives.rollBackToEmbedded;
    expect(buildExpoRollBackToEmbeddedDirective(commitTime)).toEqual(directive);
  });
});
