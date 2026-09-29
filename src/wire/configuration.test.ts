import { describe, expect, test } from 'vitest';

import {
  ConfigurationSchema,
  ProjectConfigurationSchema,
} from './configuration.js';

const PROJECT = { appId: 'a1', channelId: 'c1', dir: 'dist' };

describe('ProjectConfigurationSchema', () => {
  test('should apply the defaults to a file with the two ids', () => {
    expect(ProjectConfigurationSchema.parse(PROJECT)).toEqual({
      ...PROJECT,
      autoSync: true,
      enabledInDebugBuilds: true,
      installStrategy: 'next-start',
      minimumBackgroundDuration: 300,
      network: 'any',
      publicKeys: [],
      readySignal: 'render',
      readyTimeout: 10,
      syncInterval: 900,
    });
  });

  test('should keep the $schema line for the editor', () => {
    const parsed = ProjectConfigurationSchema.parse({
      ...PROJECT,
      $schema: 'https://hotcodepush.com/schema.json',
    });
    expect(parsed).toHaveProperty('$schema');
  });

  test('should reject a ready timeout below one second', () => {
    expect(
      ProjectConfigurationSchema.safeParse({ ...PROJECT, readyTimeout: 0 })
        .success,
    ).toBe(false);
  });
});

describe('ConfigurationSchema', () => {
  test('should require the build-time facts', () => {
    expect(ConfigurationSchema.safeParse(PROJECT).success).toBe(false);
  });

  test('should parse the resource file', () => {
    const configuration = {
      ...PROJECT,
      builtAt: '2026-09-29T10:00:00.000Z',
      embeddedBundleId: null,
      embeddedBundleManifest: {
        appId: 'a1',
        bundleId: 'b0',
        createdAt: '2026-09-29T09:00:00.000Z',
        deltas: [],
        files: [],
        pack: {
          sizeBytes: 0,
          url: 'https://files.hotcodepush.com/apps/a1/bundles/b0/pack',
        },
        patches: [],
        version: '1.4.1',
      },
      fingerprint: null,
    };
    expect(ConfigurationSchema.parse(configuration)).toMatchObject(
      configuration,
    );
  });
});
