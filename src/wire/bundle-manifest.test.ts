import { describe, expect, test } from 'vitest';

import {
  BundleManifestSchema,
  EmbeddedBundleManifestSchema,
  ManifestEnvelopeSchema,
} from './bundle-manifest.js';

const HASH = 'b'.repeat(64);

const MANIFEST = {
  appId: 'a1',
  bundleId: 'b1',
  createdAt: '2026-09-29T10:00:00.000Z',
  deltas: [
    {
      baseBundleId: 'b0',
      sizeBytes: 1024,
      url: 'https://files.hotcodepush.com/apps/a1/bundles/b1/deltas/b0',
    },
  ],
  files: [{ path: 'assets/index-B4x.js', sha256: HASH, sizeBytes: 812331 }],
  pack: {
    sizeBytes: 4096,
    url: 'https://files.hotcodepush.com/apps/a1/bundles/b1/pack',
  },
  patches: [
    {
      format: 'bsdiff',
      fromSha256: HASH,
      path: 'assets/index-B4x.js',
      sizeBytes: 512,
      toSha256: HASH,
      url: `https://files.hotcodepush.com/apps/a1/patches/${HASH}/${HASH}`,
    },
  ],
  version: '1.4.2',
};

describe('BundleManifestSchema', () => {
  test('should parse the bundle manifest', () => {
    expect(BundleManifestSchema.parse(MANIFEST)).toEqual(MANIFEST);
  });

  test('should reject a file hash that is not sha256 hex', () => {
    const files = [{ ...MANIFEST.files[0], sha256: 'nope' }];
    expect(BundleManifestSchema.safeParse({ ...MANIFEST, files }).success).toBe(
      false,
    );
  });

  test('should reject a null pack', () => {
    expect(
      BundleManifestSchema.safeParse({ ...MANIFEST, pack: null }).success,
    ).toBe(false);
  });
});

describe('EmbeddedBundleManifestSchema', () => {
  test('should parse a manifest with a null pack', () => {
    const manifest = { ...MANIFEST, pack: null };
    expect(EmbeddedBundleManifestSchema.parse(manifest)).toEqual(manifest);
  });
});

describe('ManifestEnvelopeSchema', () => {
  test('should parse an unsigned envelope', () => {
    const envelope = {
      encryption: null,
      manifest: JSON.stringify(MANIFEST),
      signature: null,
    };
    expect(ManifestEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  test('should parse a signed envelope with a self-describing value', () => {
    const envelope = {
      encryption: null,
      manifest: '{}',
      signature: { keyId: 'k1', value: 'rsa-v1_5-sha256:AQID' },
    };
    expect(ManifestEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  test('should reject a signature value without a scheme', () => {
    const envelope = {
      encryption: null,
      manifest: '{}',
      signature: { keyId: 'k1', value: 'AQID' },
    };
    expect(ManifestEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
