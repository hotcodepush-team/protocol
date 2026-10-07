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
  nativeSourcePaths: string[];
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

/** A project held in memory: the files by path, the directories implied by them. */
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
  };
}

function projectOf(fixture: FingerprintProjectFixture) {
  return {
    nativeSourcePaths: fixture.nativeSourcePaths,
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
    expect(computeFingerprint({ nativeSources: [], packages: [] })).toMatch(
      /^fp1:[0-9a-f]{64}$/,
    );
  });
});
