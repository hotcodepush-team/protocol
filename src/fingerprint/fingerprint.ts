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
  LockedDependency,
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

/** A dependency the walk has yet to find, with the directory of the project or package depending on it. */
interface PendingDependency {
  dependency: LockedDependency;
  dependentDirectory: string;
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
 * workspace's packages never contribute; the markers of each installed copy,
 * read in the directory the lockfile installs it in, so a nested copy is
 * never read from a hoisted namesake of another version; and the declared
 * native sources. Every copy that ships native code or is a runtime package
 * contributes, one entry per name, version and integrity, sorted by name,
 * version and integrity; native sources sorted by path, hidden files inside
 * a declared directory skipped.
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
  const nativePackages: LockedPackage[] = [];
  for (const { directory, locked } of installedPackages) {
    if (await isNativePackage(reader, locked.name, directory)) {
      nativePackages.push(locked);
    }
  }
  return {
    nativeSources: await resolveNativeSources(
      reader,
      project.nativeSourcePaths,
    ),
    packages: resolveUniquePackages(nativePackages),
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
  const pendingDependencies: PendingDependency[] = tree.projectDependencies.map(
    dependency => ({ dependency, dependentDirectory: projectPath }),
  );
  for (
    let pending = pendingDependencies.shift();
    pending !== undefined;
    pending = pendingDependencies.shift()
  ) {
    const { dependency, dependentDirectory } = pending;
    if (installedPackages.has(dependency.key)) {
      continue;
    }
    const directory = await readInstallDirectory(
      reader,
      tree.resolveInstallDirectories(dependency, dependentDirectory),
    );
    if (directory === null) {
      if (dependency.isOptional) {
        continue;
      }
      const { name, version } = dependency.package;
      throw new FingerprintError(
        `the lockfile installs ${name} ${version} and node_modules does not hold it; install the dependencies first`,
      );
    }
    installedPackages.set(dependency.key, {
      directory,
      locked: dependency.package,
    });
    pendingDependencies.push(
      ...tree
        .resolveDependencies(dependency)
        .map(next => ({ dependency: next, dependentDirectory: directory })),
    );
  }
  return [...installedPackages.values()];
}

/** The first of the directories a package may be installed in that exists; null when none does. */
async function readInstallDirectory(
  reader: ProjectReader,
  directories: string[],
): Promise<string | null> {
  for (const directory of directories) {
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
