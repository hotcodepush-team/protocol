import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  ConfigurationSchema,
  ProjectConfigurationSchema,
} from './configuration.js';

interface ResourceFileCase {
  embeddedBundleManifest: unknown;
  name: string;
  resourceFile: unknown;
}

const PROJECT = { appId: 'a1', channelId: 'c1', dir: 'dist' };

const RESOURCE_FILE_CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/resource-files.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: ResourceFileCase[] }
).cases;

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

  test.each(RESOURCE_FILE_CASES)(
    '$name',
    ({ embeddedBundleManifest, resourceFile }) => {
      expect(
        ConfigurationSchema.parse(resourceFile).embeddedBundleManifest,
      ).toEqual(embeddedBundleManifest);
    },
  );
});
