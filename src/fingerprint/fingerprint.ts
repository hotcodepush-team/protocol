// The `fp1` fingerprint hashes the native contract (decided 2026-09-16).
// `fp1` versions the whole recipe: inputs, canonicalization and hash.
// Fingerprints compare by equality only, so any change here is `fp2`, never an edit.
import { z } from 'zod';

import { stringifyCanonicalJson } from '../canonical-json.js';
import { computeSha256Hex } from '../hash/sha256.js';
import { ExtraFingerprintPathSchema } from '../wire/primitives.js';
import type {
  DeclaredDependency,
  LockedDependency,
  LockedPackage,
  LockedTree,
  LockfileName,
} from './lockfiles.js';
import {
  LOCKFILE_NAMES,
  readLockedTree,
  resolveDeclaredDependencies,
} from './lockfiles.js';
import { hasNativeMarkers } from './native-markers.js';
import type { ProjectReader } from './project-reader.js';
import {
  FingerprintError,
  parseProjectJson,
  readProjectText,
} from './project-reader.js';

export interface FingerprintProject {
  /**
   * The files or directories the app lists in `extraFingerprintPaths`, relative to the project directory.
   * A path may reach a sibling workspace through `..` but must stay inside the reader's root.
   */
  extraFingerprintPaths: readonly string[];
  /**
   * The project directory relative to the reader's root, which holds the lockfile.
   * In a monorepo this is the workspace path. Empty when both are the same directory.
   */
  projectPath: string;
  /** Reads from the directory that holds the lockfile, the monorepo root for a workspace. */
  reader: ProjectReader;
}

/** What the fingerprint hashes. `hotcodepush fingerprint` prints it and `fingerprint diff` compares it. */
export interface FingerprintContributors {
  /** The files under the extra paths, each with its hash. */
  extraFingerprintPaths: ExtraFingerprintFile[];
  packages: LockedPackage[];
}

export interface ExtraFingerprintFile {
  path: string;
  sha256: string;
}

interface InstalledPackage {
  directory: string;
  locked: LockedPackage;
}

interface PendingDependency {
  dependency: LockedDependency;
  dependentDirectory: string;
}

/**
 * The packages that always contribute, since their version is the native layer itself.
 * No marker detects React Native or the Cordova platforms.
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

/** Computes the fingerprint: `fp1:` and the SHA-256 of the canonical JSON of the contributors. */
export function computeFingerprint(
  contributors: FingerprintContributors,
): string {
  return `${FINGERPRINT_RECIPE}:${computeSha256Hex(stringifyCanonicalJson(contributors))}`;
}

/**
 * Reads what the fingerprint hashes: the native and runtime packages the lockfile installs, and the extra files.
 * Packages are walked from the project's package.json, so a sibling workspace never contributes.
 * Each installed copy is read where the lockfile installs it, never from a hoisted copy of another version.
 * Hidden files inside a declared directory are skipped.
 */
export async function readFingerprintContributors(
  project: FingerprintProject,
): Promise<FingerprintContributors> {
  const { projectPath, reader } = project;
  const lockfile = await readLockfile(reader);
  const installedPackages = await readInstalledPackages(
    reader,
    projectPath,
    await readLockedTree(
      lockfile.name,
      lockfile.text,
      {
        dependencies: await readProjectDependencies(reader, projectPath),
        path: projectPath,
      },
      reader,
    ),
  );
  const nativePackages: LockedPackage[] = [];
  for (const { directory, locked } of installedPackages) {
    if (await isNativePackage(reader, locked.name, directory)) {
      nativePackages.push(locked);
    }
  }
  return {
    extraFingerprintPaths: await readExtraFingerprintFiles(
      reader,
      projectPath,
      project.extraFingerprintPaths,
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
      `The project has no lockfile. Commit one of ${LOCKFILE_NAMES.join(', ')}.`,
    );
  }
  // Two lockfiles mean one is stale. Reading the stale one could match the wrong binary.
  if (others.length > 0) {
    throw new FingerprintError(
      `The project has ${lockfiles.map(found => found.name).join(' and ')}. Keep the one its package manager writes.`,
    );
  }
  return lockfile;
}

async function readProjectDependencies(
  reader: ProjectReader,
  projectPath: string,
): Promise<DeclaredDependency[]> {
  const path = resolveProjectFilePath(projectPath, 'package.json');
  const text = await readProjectText(reader, path);
  if (text === null) {
    throw new FingerprintError(`The project has no ${path}.`);
  }
  const manifest = ProjectManifestSchema.safeParse(parseProjectJson(text));
  if (!manifest.success) {
    throw new FingerprintError(`The file ${path} does not parse.`);
  }
  const { dependencies, devDependencies, optionalDependencies } = manifest.data;
  return [
    ...resolveDeclaredDependencies(dependencies, false),
    ...resolveDeclaredDependencies(devDependencies, false),
    ...resolveDeclaredDependencies(optionalDependencies, true),
  ];
}

// A missing package is refused, since hashing it as native-free could match the wrong binary.
// A missing optional package is skipped with its dependencies, since an unsupported platform never installs it.
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
        `The lockfile installs ${name} ${version} but node_modules does not hold it. Install the dependencies first.`,
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

async function readExtraFingerprintFiles(
  reader: ProjectReader,
  projectPath: string,
  declaredPaths: readonly string[],
): Promise<ExtraFingerprintFile[]> {
  const filesByPath = new Map<string, ExtraFingerprintFile>();
  for (const declaredPath of declaredPaths) {
    const realPath = await readExtraFingerprintRealPath(
      reader,
      projectPath,
      declaredPath,
    );
    for (const file of await collectExtraFingerprintFiles(reader, realPath)) {
      filesByPath.set(file.path, file);
    }
  }
  return [...filesByPath.values()].sort((first, second) =>
    compareCodeUnits(first.path, second.path),
  );
}

// The path must stay inside the lockfile directory both before and after resolving symbolic links.
// So a sibling workspace can be named, but nothing outside the repository.
async function readExtraFingerprintRealPath(
  reader: ProjectReader,
  projectPath: string,
  declaredPath: string,
): Promise<string> {
  if (!ExtraFingerprintPathSchema.safeParse(declaredPath).success) {
    throw new FingerprintError(
      `The extra fingerprint path ${JSON.stringify(declaredPath)} is not a relative path without empty or "." segments.`,
    );
  }
  const resolvedPath = resolveParentSegments(
    resolveProjectFilePath(projectPath, declaredPath),
  );
  const realPath = isInsideRoot(resolvedPath)
    ? await reader.readRealPath(resolvedPath)
    : resolvedPath;
  if (realPath === null) {
    throw new FingerprintError(
      `The extra fingerprint path ${declaredPath} does not exist.`,
    );
  }
  if (!isInsideRoot(realPath)) {
    throw new FingerprintError(
      `The extra fingerprint path ${declaredPath} is not inside the lockfile's directory.`,
    );
  }
  return realPath;
}

async function collectExtraFingerprintFiles(
  reader: ProjectReader,
  path: string,
): Promise<ExtraFingerprintFile[]> {
  const entries = await reader.readDirectory(path);
  if (entries !== null) {
    const files: ExtraFingerprintFile[] = [];
    for (const entry of entries.filter(entry => !entry.name.startsWith('.'))) {
      files.push(
        ...(await collectExtraFingerprintFiles(
          reader,
          `${path}/${entry.name}`,
        )),
      );
    }
    return files;
  }
  const bytes = await reader.readFile(path);
  if (bytes === null) {
    throw new FingerprintError(
      `The extra fingerprint path ${path} does not exist.`,
    );
  }
  return [{ path, sha256: computeSha256Hex(bytes) }];
}

function resolveProjectFilePath(projectPath: string, path: string): string {
  return projectPath === '' ? path : `${projectPath}/${path}`;
}

// A path that climbs above the root keeps its leading `..` segments.
function resolveParentSegments(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

// The root itself does not count as inside.
function isInsideRoot(path: string): boolean {
  return path !== '' && path !== '..' && !path.startsWith('../');
}

// Unlike localeCompare, this order is the same on every machine and locale.
function compareCodeUnits(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
}
