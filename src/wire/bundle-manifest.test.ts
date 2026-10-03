import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  BundleManifestSchema,
  EmbeddedBundleManifestSchema,
  ManifestEnvelopeSchema,
} from './bundle-manifest.js';

interface WireRulesFixture {
  acceptedEnvelopes: { envelope: unknown; name: string }[];
  acceptedManifests: { manifest: unknown; name: string }[];
  refusedEnvelopes: { envelope: unknown; name: string }[];
  refusedManifests: { manifest: unknown; name: string }[];
}

const WIRE_RULES = JSON.parse(
  readFileSync(
    new URL('../../fixtures/wire-rules.json', import.meta.url),
    'utf8',
  ),
) as WireRulesFixture;

const HASH = 'b'.repeat(64);

const MANIFEST = {
  appId: 'a1',
  bundleVersion: '1.4.2',
  files: [{ path: 'assets/index-B4x.js', sha256: HASH, sizeBytes: 812331 }],
  fingerprint: 'fp1:abc',
  keyId: null,
  patches: [
    {
      format: 'bsdiff',
      fromSha256: HASH,
      path: 'assets/index-B4x.js',
      toSha256: HASH,
    },
  ],
  platforms: ['android', 'ios'],
};

const ENVELOPE = {
  bundleId: 'b1',
  createdAt: '2026-09-29T10:00:00.000Z',
  deltas: [
    {
      baseBundleId: 'b0',
      sizeBytes: 1024,
      url: 'https://files.hotcodepush.com/apps/a1/bundles/b1/deltas/b0',
    },
  ],
  encryption: null,
  manifest: JSON.stringify(MANIFEST),
  pack: {
    sizeBytes: 4096,
    url: 'https://files.hotcodepush.com/apps/a1/bundles/b1/pack',
  },
  patches: [
    {
      ...MANIFEST.patches[0],
      sizeBytes: 512,
      url: `https://files.hotcodepush.com/apps/a1/patches/${HASH}/${HASH}`,
    },
  ],
  signature: null,
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
});

describe('the wire rules', () => {
  test.each(
    WIRE_RULES.acceptedManifests.map(accepted => [accepted.name, accepted]),
  )('%s', (_name, accepted) => {
    expect(BundleManifestSchema.safeParse(accepted.manifest).success).toBe(
      true,
    );
  });

  test.each(
    WIRE_RULES.refusedManifests.map(refused => [refused.name, refused]),
  )('%s', (_name, refused) => {
    expect(BundleManifestSchema.safeParse(refused.manifest).success).toBe(
      false,
    );
  });

  test.each(
    WIRE_RULES.acceptedEnvelopes.map(accepted => [accepted.name, accepted]),
  )('%s', (_name, accepted) => {
    expect(ManifestEnvelopeSchema.safeParse(accepted.envelope).success).toBe(
      true,
    );
  });

  test.each(
    WIRE_RULES.refusedEnvelopes.map(refused => [refused.name, refused]),
  )('%s', (_name, refused) => {
    expect(ManifestEnvelopeSchema.safeParse(refused.envelope).success).toBe(
      false,
    );
  });
});

describe('EmbeddedBundleManifestSchema', () => {
  test('should parse a manifest without patches', () => {
    const manifest = Object.fromEntries(
      Object.entries(MANIFEST).filter(([key]) => key !== 'patches'),
    );
    expect(EmbeddedBundleManifestSchema.parse(manifest)).toEqual(manifest);
  });
});

describe('ManifestEnvelopeSchema', () => {
  test('should parse an unsigned envelope', () => {
    expect(ManifestEnvelopeSchema.parse(ENVELOPE)).toEqual(ENVELOPE);
  });

  test('should parse a signed envelope with a self-describing value', () => {
    const envelope = {
      ...ENVELOPE,
      signature: { keyId: 'k1', value: 'rsa-v1_5-sha256:AQID' },
    };
    expect(ManifestEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  test('should reject a signature value without a scheme', () => {
    const envelope = { ...ENVELOPE, signature: { keyId: 'k1', value: 'AQID' } };
    expect(ManifestEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
