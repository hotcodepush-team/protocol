import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { stringifyCanonicalJson } from '../canonical-json.js';
import { PLATFORMS } from '../results.js';
import { verifyManifestSignature } from '../signing/signatures.js';
import { generateSigningKeyPair } from '../signing/signing-keys.js';
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
  EXPO_UPDATE_METADATA_KEY,
  ExpoExportMetadataSchema,
  ExpoManifestEnvelopeSchema,
  ExpoManifestError,
  ExpoManifestSchema,
  resolveExpoUpdateId,
  signExpoManifest,
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

  test.each(PLATFORMS)(
    'should name the %s update in the metadata the filters match',
    platform => {
      const manifest = buildExpoManifest({ ...FIXTURE.input, platform });
      expect(manifest.metadata).toEqual({
        [EXPO_UPDATE_METADATA_KEY]: manifest.id,
      });
    },
  );
});

describe('resolveExpoUpdateId', () => {
  test.each(PLATFORMS)(
    'should resolve the pinned id of the %s update from the bundle alone',
    platform => {
      expect(resolveExpoUpdateId(FIXTURE.input.bundleId, platform)).toBe(
        FIXTURE.manifests[platform].id,
      );
    },
  );
});

describe('ExpoManifestSchema', () => {
  test.each(PLATFORMS)('should parse the pinned %s manifest', platform => {
    expect(ExpoManifestSchema.parse(FIXTURE.manifests[platform])).toEqual(
      FIXTURE.manifests[platform],
    );
  });

  test('should keep a field it does not know', () => {
    const manifest = { ...FIXTURE.manifests.ios, later: true };
    expect(ExpoManifestSchema.parse(manifest)).toEqual(manifest);
  });

  test('should refuse a manifest whose id is no UUID', () => {
    expect(
      ExpoManifestSchema.safeParse({ ...FIXTURE.manifests.ios, id: 'bundle-7' })
        .success,
    ).toBe(false);
  });

  test('should refuse a manifest without a runtime version', () => {
    expect(
      ExpoManifestSchema.safeParse({
        ...FIXTURE.manifests.ios,
        runtimeVersion: '',
      }).success,
    ).toBe(false);
  });
});

describe('signExpoManifest', () => {
  test('should sign the canonical JSON of the manifest with the key Expo clients verify', async () => {
    const { privateKey, publicKey } =
      await generateSigningKeyPair('rsa-v1_5-sha256');

    const envelope = await signExpoManifest(FIXTURE.manifests.ios, privateKey);

    expect(envelope.manifest).toBe(
      stringifyCanonicalJson(FIXTURE.manifests.ios),
    );
    expect(envelope.signature?.value).toMatch(/^rsa-v1_5-sha256:/);
    expect(await verifyManifestSignature(envelope, [publicKey])).toBe(true);
  });

  test('should leave the envelope unsigned when the app holds no key', async () => {
    expect(await signExpoManifest(FIXTURE.manifests.ios, null)).toEqual({
      manifest: stringifyCanonicalJson(FIXTURE.manifests.ios),
      signature: null,
    });
  });
});

describe('ExpoManifestEnvelopeSchema', () => {
  test('should parse an unsigned envelope', () => {
    const envelope = { manifest: '{}', signature: null };
    expect(ExpoManifestEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  test('should parse a signed envelope', () => {
    const envelope = {
      manifest: '{}',
      signature: { keyId: 'sha256:abc', value: 'rsa-v1_5-sha256:AAAA' },
    };
    expect(ExpoManifestEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  test('should refuse an envelope without the signature field', () => {
    expect(
      ExpoManifestEnvelopeSchema.safeParse({ manifest: '{}' }).success,
    ).toBe(false);
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
