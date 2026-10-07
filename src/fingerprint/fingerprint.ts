/**
 * The `fp1` fingerprint, the hash of the native contract (decided
 * 2026-09-16): from the committed lockfile, the packages that ship native
 * code and the runtime packages, plus the custom native sources the app
 * declares; the canonical JSON of those contributors, its SHA-256, the `fp1:`
 * prefix. `fp1` versions the whole recipe — inputs, canonicalization and
 * hash — so a change to anything here is `fp2`, never an edit, since
 * fingerprints compare by equality only.
 */
import { z } from 'zod';

import { stringifyCanonicalJson } from '../canonical-json.js';
import { computeSha256Hex } from '../hash/sha256.js';
import { RelativePathSchema } from '../wire/primitives.js';
import type {
  DeclaredDependency,
  LockedPackage,
  LockedTree,
  LockfileName,
} from './lockfiles.js';
import {
  LOCKFILE_NAMES,
  resolveDeclaredDependencies,
  resolveLockedTree,
} from './lockfiles.js';
import { hasNativeMarkers } from './native-markers.js';
import type { ProjectReader } from './project-reader.js';
import {
  FingerprintError,
  parseProjectJson,
  readProjectText,
} from './project-reader.js';

export interface FingerprintProject {
  /** The custom native sources the app declares: files or directories, relative to the reader's root. */
  nativeSourcePaths: readonly string[];
  /** The project's directory relative to the reader's root, the lockfile's directory: a workspace's path in a monorepo, empty when they are one. */
  projectPath: string;
  /** The project from the directory holding its lockfile, a monorepo's root where the workspace installs. */
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

/** A locked package as the walk found it installed, in the directory its markers are read from. */
interface InstalledPackage {
  directory: string;
  locked: LockedPackage;
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

const ProjectManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});

/** `fp1:` and the SHA-256 of the contributors' canonical JSON. */
export function computeFingerprint(
  contributors: FingerprintContributors,
): string {
  return `${FINGERPRINT_RECIPE}:${computeSha256Hex(stringifyCanonicalJson(contributors))}`;
}

/**
 * The contributors of the project's fingerprint, read through the project
 * reader: the packages the lockfile installs for the project, walked from
 * its own package.json through the lockfile's dependency tree, so a sibling
 * workspace's packages never contribute; the markers of each, found in the
 * project's `node_modules`, the root's or, for pnpm's hidden hoisting,
 * `node_modules/.pnpm/node_modules`; and the declared native sources. Every
 * package of a kept name contributes, one entry per version and integrity,
 * sorted by name, version and integrity; native sources sorted by path,
 * hidden files inside a declared directory skipped.
 */
export async function readFingerprintContributors(
  project: FingerprintProject,
): Promise<FingerprintContributors> {
  const { projectPath, reader } = project;
  const lockfile = await readLockfile(reader);
  const installedPackages = await readInstalledPackages(
    reader,
    projectPath,
    resolveLockedTree(lockfile.name, lockfile.text, {
      dependencies: await readProjectDependencies(reader, projectPath),
      path: projectPath,
    }),
  );
  const directoriesByName = new Map(
    installedPackages.map(installed => [
      installed.locked.name,
      installed.directory,
    ]),
  );
  const nativeNames = new Set<string>();
  for (const [name, directory] of directoriesByName) {
    if (await isNativePackage(reader, name, directory)) {
      nativeNames.add(name);
    }
  }
  const lockedPackages = resolveUniquePackages(
    installedPackages.map(installed => installed.locked),
  );
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

/** Every dependency of every kind the project's package.json declares, the walk's start. */
async function readProjectDependencies(
  reader: ProjectReader,
  projectPath: string,
): Promise<DeclaredDependency[]> {
  const path = resolveProjectFilePath(projectPath, 'package.json');
  const text = await readProjectText(reader, path);
  if (text === null) {
    throw new FingerprintError(`the project has no ${path}`);
  }
  const manifest = ProjectManifestSchema.safeParse(parseProjectJson(text));
  if (!manifest.success) {
    throw new FingerprintError(`${path} does not parse`);
  }
  const { dependencies, devDependencies, optionalDependencies } = manifest.data;
  return [
    ...resolveDeclaredDependencies(dependencies, false),
    ...resolveDeclaredDependencies(devDependencies, false),
    ...resolveDeclaredDependencies(optionalDependencies, true),
  ];
}

/**
 * Each installed copy the walk reaches from the project, once, whatever the
 * path it was reached by. A locked package that is not installed is
 * refused: its markers cannot be read, and hashing it as native-free would
 * match binaries it does not describe. An optional one is skipped with its
 * own dependencies, since a platform it does not support never installs it.
 */
async function readInstalledPackages(
  reader: ProjectReader,
  projectPath: string,
  tree: LockedTree,
): Promise<InstalledPackage[]> {
  const installedPackages = new Map<string, InstalledPackage>();
  const pendingDependencies = [...tree.projectDependencies];
  for (
    let dependency = pendingDependencies.shift();
    dependency !== undefined;
    dependency = pendingDependencies.shift()
  ) {
    if (installedPackages.has(dependency.key)) {
      continue;
    }
    const { name, version } = dependency.package;
    const directory = await readInstallDirectory(reader, projectPath, name);
    if (directory === null) {
      if (dependency.isOptional) {
        continue;
      }
      throw new FingerprintError(
        `the lockfile installs ${name} ${version} and node_modules does not hold it; install the dependencies first`,
      );
    }
    installedPackages.set(dependency.key, {
      directory,
      locked: dependency.package,
    });
    pendingDependencies.push(...tree.resolveDependencies(dependency));
  }
  return [...installedPackages.values()];
}

/** The directory a package is installed in: the project's `node_modules`, the root's, or pnpm's hidden hoisting; null when none holds it. */
async function readInstallDirectory(
  reader: ProjectReader,
  projectPath: string,
  name: string,
): Promise<string | null> {
  for (const directory of new Set([
    resolveProjectFilePath(projectPath, `node_modules/${name}`),
    `node_modules/${name}`,
    `node_modules/.pnpm/node_modules/${name}`,
  ])) {
    if ((await reader.readDirectory(directory)) !== null) {
      return directory;
    }
  }
  return null;
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
  directory: string,
): Promise<boolean> {
  return (
    (FINGERPRINT_RUNTIME_PACKAGES as readonly string[]).includes(name) ||
    hasNativeMarkers(reader, directory)
  );
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

/** A path inside the project as the reader takes it, relative to the lockfile's directory. */
function resolveProjectFilePath(projectPath: string, path: string): string {
  return projectPath === '' ? path : `${projectPath}/${path}`;
}

/** Order by UTF-16 code units, the same on every machine and locale. */
function compareCodeUnits(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}
