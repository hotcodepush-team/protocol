/**
 * The `fp1` fingerprint, the hash of the native contract (decided
 * 2026-09-16): from the committed lockfile, the packages that ship native
 * code and the runtime packages, plus the custom native sources the app
 * declares; the canonical JSON of those contributors, its SHA-256, the `fp1:`
 * prefix. `fp1` versions the whole recipe — inputs, canonicalization and
 * hash — so a change to anything here is `fp2`, never an edit, since
 * fingerprints compare by equality only.
 */
import { stringifyCanonicalJson } from '../canonical-json.js';
import { computeSha256Hex } from '../hash/sha256.js';
import { RelativePathSchema } from '../wire/primitives.js';
import type { LockedPackage, LockfileName } from './lockfiles.js';
import { LOCKFILE_NAMES, resolveLockedPackages } from './lockfiles.js';
import { hasNativeMarkers } from './native-markers.js';
import type { ProjectReader } from './project-reader.js';
import { FingerprintError, readProjectText } from './project-reader.js';

export interface FingerprintProject {
  /** The custom native sources the app declares: files or directories, relative to the project root. */
  nativeSourcePaths: readonly string[];
  reader: ProjectReader;
}

/** What the fingerprint hashes, and what `hotcodepush fingerprint` prints and `fingerprint diff` compares. */
export interface FingerprintContributors {
  nativeSources: NativeSourceFile[];
  packages: LockedPackage[];
}

export interface NativeSourceFile {
  path: string;
  sha256: string;
}

/**
 * The packages whose version is the native layer itself, contributing
 * whatever their markers say: the Capacitor runtime, and React Native and the
 * Cordova platforms, which no marker detects.
 */
export const FINGERPRINT_RUNTIME_PACKAGES = [
  '@capacitor/android',
  '@capacitor/core',
  '@capacitor/ios',
  'cordova-android',
  'cordova-ios',
  'react-native',
] as const;

const FINGERPRINT_RECIPE = 'fp1';

/** `fp1:` and the SHA-256 of the contributors' canonical JSON. */
export function computeFingerprint(
  contributors: FingerprintContributors,
): string {
  return `${FINGERPRINT_RECIPE}:${computeSha256Hex(stringifyCanonicalJson(contributors))}`;
}

/**
 * The contributors of the project's fingerprint, read through the project
 * reader: the lockfile, the markers of every package it installs, found in
 * `node_modules` or, for pnpm's hidden hoisting, `node_modules/.pnpm/node_modules`,
 * and the declared native sources. Every package of a kept name contributes,
 * one entry per version and integrity, sorted by name, version and integrity;
 * native sources sorted by path, hidden files inside a declared directory
 * skipped.
 */
export async function readFingerprintContributors(
  project: FingerprintProject,
): Promise<FingerprintContributors> {
  const { reader } = project;
  const lockfile = await readLockfile(reader);
  if ((await reader.readDirectory('node_modules')) === null) {
    throw new FingerprintError(
      `${lockfile.name} is there but node_modules is not; install the dependencies first`,
    );
  }
  const lockedPackages = resolveUniquePackages(
    resolveLockedPackages(lockfile.name, lockfile.text),
  );
  const nativeNames = new Set<string>();
  for (const name of new Set(lockedPackages.map(locked => locked.name))) {
    if (await isNativePackage(reader, name)) {
      nativeNames.add(name);
    }
  }
  return {
    nativeSources: await resolveNativeSources(
      reader,
      project.nativeSourcePaths,
    ),
    packages: lockedPackages.filter(locked => nativeNames.has(locked.name)),
  };
}

async function readLockfile(
  reader: ProjectReader,
): Promise<{ name: LockfileName; text: string }> {
  const lockfiles: { name: LockfileName; text: string }[] = [];
  for (const name of LOCKFILE_NAMES) {
    const text = await readProjectText(reader, name);
    if (text !== null) {
      lockfiles.push({ name, text });
    }
  }
  const [lockfile, ...others] = lockfiles;
  if (lockfile === undefined) {
    throw new FingerprintError(
      `the project has no lockfile; commit one of ${LOCKFILE_NAMES.join(', ')}`,
    );
  }
  // Two lockfiles mean one is stale, and reading the stale one could match a binary it does not describe.
  if (others.length > 0) {
    throw new FingerprintError(
      `the project has ${lockfiles.map(found => found.name).join(' and ')}; keep the one its package manager writes`,
    );
  }
  return lockfile;
}

function resolveUniquePackages(packages: LockedPackage[]): LockedPackage[] {
  const packagesByKey = new Map(
    packages.map(locked => [
      JSON.stringify([locked.name, locked.version, locked.integrity]),
      locked,
    ]),
  );
  return [...packagesByKey.values()].sort(
    (first, second) =>
      compareCodeUnits(first.name, second.name) ||
      compareCodeUnits(first.version, second.version) ||
      compareCodeUnits(first.integrity ?? '', second.integrity ?? ''),
  );
}

async function isNativePackage(
  reader: ProjectReader,
  name: string,
): Promise<boolean> {
  if ((FINGERPRINT_RUNTIME_PACKAGES as readonly string[]).includes(name)) {
    return true;
  }
  for (const directory of [
    `node_modules/${name}`,
    `node_modules/.pnpm/node_modules/${name}`,
  ]) {
    if ((await reader.readDirectory(directory)) !== null) {
      return hasNativeMarkers(reader, directory);
    }
  }
  return false;
}

async function resolveNativeSources(
  reader: ProjectReader,
  paths: readonly string[],
): Promise<NativeSourceFile[]> {
  const filesByPath = new Map<string, NativeSourceFile>();
  for (const path of paths) {
    if (!RelativePathSchema.safeParse(path).success) {
      throw new FingerprintError(
        `the native source ${JSON.stringify(path)} is not a relative path without . or .. segments`,
      );
    }
    for (const file of await collectNativeSourceFiles(reader, path)) {
      filesByPath.set(file.path, file);
    }
  }
  return [...filesByPath.values()].sort((first, second) =>
    compareCodeUnits(first.path, second.path),
  );
}

async function collectNativeSourceFiles(
  reader: ProjectReader,
  path: string,
): Promise<NativeSourceFile[]> {
  const entries = await reader.readDirectory(path);
  if (entries !== null) {
    const files: NativeSourceFile[] = [];
    for (const entry of entries.filter(entry => !entry.name.startsWith('.'))) {
      files.push(
        ...(await collectNativeSourceFiles(reader, `${path}/${entry.name}`)),
      );
    }
    return files;
  }
  const bytes = await reader.readFile(path);
  if (bytes === null) {
    throw new FingerprintError(`the native source ${path} does not exist`);
  }
  return [{ path, sha256: computeSha256Hex(bytes) }];
}

/** Order by UTF-16 code units, the same on every machine and locale. */
function compareCodeUnits(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}
