import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { FingerprintContributors } from './fingerprint.js';
import {
  computeFingerprint,
  readFingerprintContributors,
} from './fingerprint.js';
import type { ProjectReader } from './project-reader.js';
import { FingerprintError } from './project-reader.js';

interface FingerprintProjectFixture {
  files: Record<string, string>;
  name: string;
  extraFingerprintPaths: string[];
  projectPath: string;
}

interface FingerprintFixture {
  cases: (FingerprintProjectFixture & {
    contributors: FingerprintContributors;
    fingerprint: string;
  })[];
  refusedProjects: FingerprintProjectFixture[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../fixtures/fingerprints.json', import.meta.url),
    'utf8',
  ),
) as FingerprintFixture;

/** A workspace `apps/scanner` with no dependencies, its extra fingerprint paths added per test. */
const LINKED_PROJECT_FILES: Record<string, string> = {
  'apps/scanner/package.json': JSON.stringify({ name: 'scanner' }),
  'package-lock.json': JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'apps/scanner': { name: 'scanner' } },
  }),
  'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
};

/** A project held in memory: the files by path, the directories implied by them, no symbolic links. */
function createMemoryReader(files: Record<string, string>): ProjectReader {
  return {
    readDirectory(path) {
      const prefix = `${path}/`;
      const entries = new Map<string, boolean>();
      for (const filePath of Object.keys(files)) {
        if (filePath.startsWith(prefix)) {
          const [name = '', ...rest] = filePath.slice(prefix.length).split('/');
          entries.set(name, (entries.get(name) ?? false) || rest.length > 0);
        }
      }
      return Promise.resolve(
        entries.size === 0
          ? null
          : [...entries].map(([name, isDirectory]) => ({ isDirectory, name })),
      );
    },
    readFile(path) {
      const text = files[path];
      return Promise.resolve(
        text === undefined ? null : new TextEncoder().encode(text),
      );
    },
    readRealPath(path) {
      const isPresent = Object.keys(files).some(
        filePath => filePath === path || filePath.startsWith(`${path}/`),
      );
      return Promise.resolve(isPresent ? path : null);
    },
  };
}

/** The memory project with one symbolic link: the path `link` resolving to `target`. */
function createLinkedReader(
  files: Record<string, string>,
  link: string,
  target: string,
): ProjectReader {
  const reader = createMemoryReader(files);
  return {
    ...reader,
    readRealPath: path =>
      path === link ? Promise.resolve(target) : reader.readRealPath(path),
  };
}

function projectOf(fixture: FingerprintProjectFixture) {
  return {
    extraFingerprintPaths: fixture.extraFingerprintPaths,
    projectPath: fixture.projectPath,
    reader: createMemoryReader(fixture.files),
  };
}

describe('readFingerprintContributors', () => {
  test.each(FIXTURE.cases.map(fixtureCase => [fixtureCase.name, fixtureCase]))(
    '%s',
    async (_name, fixtureCase) => {
      const contributors = await readFingerprintContributors(
        projectOf(fixtureCase),
      );
      expect(contributors).toEqual(fixtureCase.contributors);
      expect(computeFingerprint(contributors)).toBe(fixtureCase.fingerprint);
    },
  );

  test.each(FIXTURE.refusedProjects.map(refused => [refused.name, refused]))(
    '%s',
    async (_name, refused) => {
      await expect(
        readFingerprintContributors(projectOf(refused)),
      ).rejects.toThrow(FingerprintError);
    },
  );

  test('should name the locked package that is not installed', async () => {
    const reader = createMemoryReader({
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/@capacitor/core': { version: '7.4.3' } },
      }),
      'package.json': JSON.stringify({
        dependencies: { '@capacitor/core': '^7.4.3' },
      }),
    });
    await expect(
      readFingerprintContributors({
        extraFingerprintPaths: [],
        projectPath: '',
        reader,
      }),
    ).rejects.toThrow('@capacitor/core 7.4.3');
  });

  test('should hash an extra fingerprint path under the path its symbolic link resolves to', async () => {
    const reader = createLinkedReader(
      {
        ...LINKED_PROJECT_FILES,
        'packages/scanner-native/ios/Bridge.swift': '',
      },
      'apps/scanner/native',
      'packages/scanner-native/ios',
    );
    const contributors = await readFingerprintContributors({
      extraFingerprintPaths: ['native'],
      projectPath: 'apps/scanner',
      reader,
    });
    expect(contributors.extraFingerprintPaths.map(file => file.path)).toEqual([
      'packages/scanner-native/ios/Bridge.swift',
    ]);
  });

  test("should refuse an extra fingerprint path when its symbolic link leads out of the lockfile's directory", async () => {
    const reader = createLinkedReader(
      LINKED_PROJECT_FILES,
      'apps/scanner/native',
      '../outside/ios',
    );
    await expect(
      readFingerprintContributors({
        extraFingerprintPaths: ['native'],
        projectPath: 'apps/scanner',
        reader,
      }),
    ).rejects.toThrow(
      "the extra fingerprint path native is not inside the lockfile's directory",
    );
  });
});

describe('computeFingerprint', () => {
  test('should yield one fingerprint for one dependency set in npm, pnpm and yarn classic', () => {
    const fingerprints = new Set(
      FIXTURE.cases
        .filter(fixtureCase => fixtureCase.name.includes('same'))
        .map(fixtureCase => fixtureCase.fingerprint),
    );
    expect(fingerprints).toEqual(new Set([FIXTURE.cases[0]?.fingerprint]));
  });

  test('should prefix the recipe version to the SHA-256 hex', () => {
    expect(
      computeFingerprint({ extraFingerprintPaths: [], packages: [] }),
    ).toMatch(/^fp1:[0-9a-f]{64}$/);
  });
});
