import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type {
  DeclaredDependency,
  LockedDependency,
  LockedProject,
  LockedTree,
} from '../lockfiles.js';
import {
  DependencyRangesSchema,
  NODE_MODULES_SEGMENT,
  parseLockfileText,
  resolveDeclaredDependencies,
  resolveNodeModulesPaths,
} from '../lockfiles.js';
import type { ProjectReader } from '../project-reader.js';
import { FingerprintError } from '../project-reader.js';

const PnpmImporterDependenciesSchema = z
  .record(z.string(), z.looseObject({ version: z.string() }))
  .optional();

const PnpmLockfileSchema = z.looseObject({
  importers: z
    .record(
      z.string(),
      z.looseObject({
        dependencies: PnpmImporterDependenciesSchema,
        devDependencies: PnpmImporterDependenciesSchema,
        optionalDependencies: PnpmImporterDependenciesSchema,
      }),
    )
    .default({}),
  lockfileVersion: z.literal('9.0'),
  packages: z
    .record(
      z.string(),
      z.looseObject({
        resolution: z
          .looseObject({
            integrity: z.string().optional(),
            tarball: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default({}),
  snapshots: z
    .record(
      z.string(),
      z
        .looseObject({
          dependencies: DependencyRangesSchema,
          optionalDependencies: DependencyRangesSchema,
        })
        .nullable(),
    )
    .default({}),
});

type PnpmLockfile = z.infer<typeof PnpmLockfileSchema>;

// Matches an alias version, which is the aliased package's key such as `real-name@1.2.3`, scoped or not.
// No other version starts with a name and an `@`.
const PNPM_ALIAS_VERSION_PATTERN = /^(?:@[^@/]+\/)?[^@:(/]+@/;
const PNPM_LINK_PREFIX = 'link:';
const PNPM_ROOT_IMPORTER = '.';
const PNPM_VIRTUAL_STORE_DIRECTORY = 'node_modules/.pnpm';
// Matches the hash pnpm puts at the end of a shortened store name.
// That is 26 base32 characters up to pnpm 9 and 32 hex characters from pnpm 10.
const PNPM_VIRTUAL_STORE_HASH_PATTERN = /^(?:[a-z2-7]{26}|[0-9a-f]{32})$/;

// pnpm installs each snapshot in a virtual store directory named after it.
// An alias contributes the aliased package's version and integrity under the declared name, as in every lockfile.
export function resolvePnpmLockedTree(
  text: string,
  {
    project,
    virtualStoreNames,
  }: { project: LockedProject; virtualStoreNames: ReadonlySet<string> },
): LockedTree {
  const lockfile = parsePnpmLockfile(text);
  const importedVersions = resolvePnpmImportedVersions(lockfile, project);
  return {
    projectDependencies: project.dependencies.flatMap(declared => {
      const version = importedVersions.get(declared.name);
      return version === undefined
        ? []
        : resolvePnpmDependency({ ...declared, range: version }, lockfile);
    }),
    resolveDependencies: dependency => {
      const snapshot = lockfile.snapshots[dependency.key];
      return [
        ...resolveDeclaredDependencies({
          isOptional: false,
          ranges: snapshot?.dependencies,
        }),
        ...resolveDeclaredDependencies({
          isOptional: true,
          ranges: snapshot?.optionalDependencies,
        }),
      ].flatMap(declared => resolvePnpmDependency(declared, lockfile));
    },
    resolveInstallDirectories: (dependency, dependentDirectory) =>
      resolvePnpmInstallDirectories(dependency, {
        dependentDirectory,
        virtualStoreNames,
      }),
  };
}

function parsePnpmLockfile(text: string): PnpmLockfile {
  const lockfile = PnpmLockfileSchema.safeParse(
    parseLockfileText(text, {
      lockfileName: 'pnpm-lock.yaml',
      parse: parseYaml,
    }),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'The file pnpm-lock.yaml is not a lockfile of version 9.0. Run "pnpm install" with pnpm 9 or later.',
    );
  }
  return lockfile.data;
}

function resolvePnpmImportedVersions(
  lockfile: PnpmLockfile,
  project: LockedProject,
): Map<string, string> {
  const importerPath = project.path === '' ? PNPM_ROOT_IMPORTER : project.path;
  const importer = lockfile.importers[importerPath];
  if (importer === undefined) {
    throw new FingerprintError(
      `The file pnpm-lock.yaml holds no importer "${importerPath}". Run "pnpm install".`,
    );
  }
  return new Map(
    [
      importer.dependencies,
      importer.devDependencies,
      importer.optionalDependencies,
    ].flatMap(dependencies =>
      Object.entries(dependencies ?? {}).map(([name, { version }]) => [
        name,
        version,
      ]),
    ),
  );
}

function resolvePnpmDependency(
  declared: DeclaredDependency,
  lockfile: PnpmLockfile,
): LockedDependency[] {
  const key = resolvePnpmSnapshotKey(declared);
  if (
    declared.range.startsWith(PNPM_LINK_PREFIX) ||
    !(key in lockfile.snapshots)
  ) {
    return [];
  }
  // A snapshot key adds the resolved peers in parentheses. A package key does not.
  const packageKey = key.split('(')[0] ?? key;
  const resolution = lockfile.packages[packageKey]?.resolution;
  return [
    {
      isOptional: declared.isOptional,
      key,
      package: {
        integrity: resolution?.integrity ?? resolution?.tarball ?? null,
        name: declared.name,
        version: packageKey.slice(
          resolvePnpmPackageName(packageKey).length + 1,
        ),
      },
    },
  ];
}

function resolvePnpmInstallDirectories(
  dependency: LockedDependency,
  {
    dependentDirectory,
    virtualStoreNames,
  }: { dependentDirectory: string; virtualStoreNames: ReadonlySet<string> },
): string[] {
  const virtualStoreName = resolvePnpmVirtualStoreName(
    dependency.key,
    virtualStoreNames,
  );
  return [
    ...(virtualStoreName === null
      ? []
      : [
          `${PNPM_VIRTUAL_STORE_DIRECTORY}/${virtualStoreName}/${NODE_MODULES_SEGMENT}${resolvePnpmPackageName(dependency.key)}`,
        ]),
    ...resolveNodeModulesPaths(dependentDirectory, {
      name: dependency.package.name,
    }),
  ];
}

// Empty when another package manager installed the project.
export async function readPnpmVirtualStoreNames(
  reader: ProjectReader,
): Promise<ReadonlySet<string>> {
  const entries = await reader.readDirectory(PNPM_VIRTUAL_STORE_DIRECTORY);
  return new Set(
    (entries ?? []).filter(entry => entry.isDirectory).map(entry => entry.name),
  );
}

function resolvePnpmSnapshotKey(declared: DeclaredDependency): string {
  return PNPM_ALIAS_VERSION_PATTERN.test(declared.range)
    ? declared.range
    : `${declared.name}@${declared.range}`;
}

function resolvePnpmPackageName(snapshotKey: string): string {
  return snapshotKey.slice(0, snapshotKey.indexOf('@', 1));
}

// pnpm replaces characters a file name cannot hold with `+` and the peer parentheses with `_`.
// It shortens a long or capitalized name to a prefix, `_` and a hash that depends on version and platform, so match by prefix.
function resolvePnpmVirtualStoreName(
  snapshotKey: string,
  virtualStoreNames: ReadonlySet<string>,
): string | null {
  const escapedKey = snapshotKey.replace(/[\\/:*?"<>|#]/g, '+');
  const name = escapedKey.includes('(')
    ? escapedKey.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_')
    : escapedKey;
  if (virtualStoreNames.has(name)) {
    return name;
  }
  const shortenedNames = [...virtualStoreNames].filter(storeName =>
    isShortenedVirtualStoreName(storeName, { name }),
  );
  return shortenedNames.length === 1 ? (shortenedNames[0] ?? null) : null;
}

function isShortenedVirtualStoreName(
  storeName: string,
  { name }: { name: string },
): boolean {
  const separatorIndex = storeName.lastIndexOf('_');
  return (
    separatorIndex > 0 &&
    PNPM_VIRTUAL_STORE_HASH_PATTERN.test(storeName.slice(separatorIndex + 1)) &&
    name.startsWith(storeName.slice(0, separatorIndex))
  );
}
