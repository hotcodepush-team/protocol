import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  ConfigurationSchema,
  isUrlOnConfiguredHost,
  ProjectConfigurationSchema,
} from './configuration.js';

interface ConfiguredHostCase {
  filesBaseUrl: string | null;
  isOnConfiguredHost: boolean;
  name: string;
  updatesBaseUrl: string | null;
  url: string;
}

interface ResourceFileCase {
  embeddedBundleManifest: unknown;
  name: string;
  resourceFile: unknown;
}

const CONFIGURED_HOST_CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/configured-hosts.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: ConfiguredHostCase[] }
).cases;

const PROJECT = { appId: 'a1', channel: 'staging', dir: 'dist' };

const RESOURCE_FILE_CASES = (
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/resource-files.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: ResourceFileCase[] }
).cases;

describe('ProjectConfigurationSchema', () => {
  test('should apply the defaults to a file with the app id and a channel', () => {
    expect(ProjectConfigurationSchema.parse(PROJECT)).toEqual({
      ...PROJECT,
      autoCheck: true,
      checkInterval: 900,
      downloadStrategy: 'auto',
      enabledInDebugBuilds: true,
      installOnResumeAfter: 300,
      installStrategy: 'next-start',
      mandatoryInstallStrategy: 'immediate',
      nativeSources: [],
      publicKeys: [],
      readySignal: 'render',
      readyTimeout: 10,
    });
  });

  test('should follow production when the file names no channel', () => {
    expect(ProjectConfigurationSchema.parse({ appId: 'a1' }).channel).toBe(
      'production',
    );
  });

  test('should reject a channel name outside the charset or above 64 characters', () => {
    expect(
      ProjectConfigurationSchema.safeParse({
        appId: 'a1',
        channel: 'prod uction',
      }).success,
    ).toBe(false);
    expect(
      ProjectConfigurationSchema.safeParse({
        appId: 'a1',
        channel: 'a'.repeat(65),
      }).success,
    ).toBe(false);
  });

  test('should reject a mandatory install strategy of next-start', () => {
    expect(
      ProjectConfigurationSchema.safeParse({
        ...PROJECT,
        mandatoryInstallStrategy: 'next-start',
      }).success,
    ).toBe(false);
  });

  test('should keep the $schema line for the editor', () => {
    const parsed = ProjectConfigurationSchema.parse({
      ...PROJECT,
      $schema: 'https://hotcodepush.com/schema.json',
    });
    expect(parsed).toHaveProperty('$schema');
  });

  test('should read the native sources the CLI hashes', () => {
    const nativeSources = ['ios/App/App/Plugins', 'android/app/src/main/java'];
    expect(
      ProjectConfigurationSchema.parse({ ...PROJECT, nativeSources })
        .nativeSources,
    ).toEqual(nativeSources);
  });

  test('should reject a native source that is not a clean relative path', () => {
    expect(
      ProjectConfigurationSchema.safeParse({
        ...PROJECT,
        nativeSources: ['../shared/Plugins'],
      }).success,
    ).toBe(false);
  });

  test.each(['ed25519:AAAA', 'ecdsa-p256-sha256:AAAA'])(
    'should reject the public key %s, outside the one signing scheme',
    publicKey => {
      expect(
        ProjectConfigurationSchema.safeParse({
          ...PROJECT,
          publicKeys: [publicKey],
        }).success,
      ).toBe(false);
    },
  );

  test('should list a public key in its self-describing form', () => {
    expect(
      ProjectConfigurationSchema.parse({
        ...PROJECT,
        publicKeys: ['rsa-v1_5-sha256:AQID'],
      }).publicKeys,
    ).toEqual(['rsa-v1_5-sha256:AQID']);
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

  test.each(['channelId', 'embeddedBundleManifest'])(
    'should require the %s key, its value or null',
    requiredKey => {
      const [registered] = RESOURCE_FILE_CASES;
      const resourceFile = registered?.resourceFile as Record<string, unknown>;
      const withoutRequiredKey = Object.fromEntries(
        Object.entries(resourceFile).filter(([key]) => key !== requiredKey),
      );
      expect(ConfigurationSchema.safeParse(withoutRequiredKey).success).toBe(
        false,
      );
    },
  );

  test('should read a null channel id from a build that could not resolve its channel', () => {
    const withoutChannel = RESOURCE_FILE_CASES.find(({ name }) =>
      name.includes('without a channel'),
    );
    const parsed = ConfigurationSchema.parse(withoutChannel?.resourceFile);
    expect(parsed.channelId).toBeNull();
    expect(parsed.embeddedBundleId).toBeNull();
  });

  test('should reject an empty channel id', () => {
    const [registered] = RESOURCE_FILE_CASES;
    const resourceFile = registered?.resourceFile as Record<string, unknown>;
    expect(
      ConfigurationSchema.safeParse({ ...resourceFile, channelId: '' }).success,
    ).toBe(false);
  });

  test.each(['iOS', 'Android'])(
    'should read the public keys of an %s build as the embed step encoded them, each beside its key id',
    platform => {
      const withKeys = RESOURCE_FILE_CASES.find(({ name }) =>
        name.includes(`public keys of an ${platform} build`),
      );
      const resourceFile = withKeys?.resourceFile as { publicKeys: unknown[] };
      expect(resourceFile.publicKeys).toHaveLength(2);
      expect(ConfigurationSchema.parse(resourceFile).publicKeys).toEqual(
        resourceFile.publicKeys,
      );
    },
  );

  test('should read no public key from a build of a project that lists none', () => {
    const [registered] = RESOURCE_FILE_CASES;
    expect(
      ConfigurationSchema.parse(registered?.resourceFile).publicKeys,
    ).toEqual([]);
  });

  test.each([
    ['the self-describing form the project file lists', 'rsa-v1_5-sha256:AQID'],
    ['a key without its key id', { der: 'AQID' }],
    ['a key whose bytes are not canonical base64', { der: 'AQI', keyId: 'k1' }],
  ])('should reject %s among the public keys', (_condition, publicKey) => {
    const [registered] = RESOURCE_FILE_CASES;
    const resourceFile = registered?.resourceFile as Record<string, unknown>;
    expect(
      ConfigurationSchema.safeParse({
        ...resourceFile,
        publicKeys: [publicKey],
      }).success,
    ).toBe(false);
  });

  test('should type the hosts a staging or local build carries', () => {
    const staging = RESOURCE_FILE_CASES.find(({ name }) =>
      name.includes('hosts'),
    );
    const parsed = ConfigurationSchema.parse(staging?.resourceFile);
    expect(parsed.filesBaseUrl).toBe('https://files.staging.hotcodepush.com');
    expect(parsed.updatesBaseUrl).toBe(
      'https://updates.staging.hotcodepush.com',
    );
  });

  test('should ignore the native sources, which only the CLI reads', () => {
    const [registered] = RESOURCE_FILE_CASES;
    const resourceFile = registered?.resourceFile as Record<string, unknown>;
    expect(
      ConfigurationSchema.safeParse({
        ...resourceFile,
        nativeSources: ['../shared/Plugins'],
      }).success,
    ).toBe(true);
  });

  test('should reject an embedded bundle id outside the identifier charset', () => {
    const [registered] = RESOURCE_FILE_CASES;
    const resourceFile = registered?.resourceFile as Record<string, unknown>;
    expect(
      ConfigurationSchema.safeParse({
        ...resourceFile,
        embeddedBundleId: '../b0',
      }).success,
    ).toBe(false);
  });

  test('should reject a host that is not a URL', () => {
    const [registered] = RESOURCE_FILE_CASES;
    const resourceFile = registered?.resourceFile as Record<string, unknown>;
    expect(
      ConfigurationSchema.safeParse({ ...resourceFile, filesBaseUrl: 'files' })
        .success,
    ).toBe(false);
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

describe('isUrlOnConfiguredHost', () => {
  test.each(CONFIGURED_HOST_CASES.map(hostCase => [hostCase.name, hostCase]))(
    '%s',
    (_name, { filesBaseUrl, isOnConfiguredHost, updatesBaseUrl, url }) => {
      expect(
        isUrlOnConfiguredHost(url, {
          filesBaseUrl: filesBaseUrl ?? undefined,
          updatesBaseUrl: updatesBaseUrl ?? undefined,
        }),
      ).toBe(isOnConfiguredHost);
    },
  );
});
