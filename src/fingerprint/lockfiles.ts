import { parseSyml } from '@yarnpkg/parsers';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { ProjectReader } from './project-reader.js';
import { FingerprintError } from './project-reader.js';

export const LOCKFILE_NAMES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

/**
 * A package the lockfile installs, under the name it is installed by.
 * `integrity` is the lockfile hash, else the resolved URL, else null.
 * So a rebuild under the same version, from git, a tarball or pkg.pr.new, still differs.
 */
export interface LockedPackage {
  integrity: string | null;
  name: string;
  version: string;
}

// `key` is the lockfile's own key for the installed copy.
export interface LockedDependency {
  isOptional: boolean;
  key: string;
  package: LockedPackage;
}

// Workspace packages and links are the app's own code, and bundled packages ride inside their parent.
// So the tree holds neither, and no dependency the lockfile does not install.
export interface LockedTree {
  projectDependencies: LockedDependency[];
  resolveDependencies(dependency: LockedDependency): LockedDependency[];
  // The first existing path wins: the one the lockfile implies, then each `node_modules` Node would search.
  resolveInstallDirectories(
    dependency: LockedDependency,
    dependentDirectory: string,
  ): string[];
}

// `path` is relative to the lockfile directory, empty when both are the same.
export interface LockedProject {
  dependencies: DeclaredDependency[];
  path: string;
}

// `range` is a package.json range or the version a lockfile pinned.
export interface DeclaredDependency {
  isOptional: boolean;
  name: string;
  range: string;
}

const DependencyRangesSchema = z.record(z.string(), z.string()).optional();

const NpmLockfileSchema = z.looseObject({
  lockfileVersion: z.int().min(2),
  packages: z.record(
    z.string(),
    z.looseObject({
      dependencies: DependencyRangesSchema,
      inBundle: z.boolean().optional(),
      integrity: z.string().optional(),
      link: z.boolean().optional(),
      optionalDependencies: DependencyRangesSchema,
      peerDependencies: DependencyRangesSchema,
      resolved: z.string().optional(),
      version: z.string().optional(),
    }),
  ),
});

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

// Yarn classic records `integrity` and `resolved`, berry records `checksum` and `resolution`.
const YarnLockfileEntrySchema = z.looseObject({
  checksum: z.string().optional(),
  dependencies: DependencyRangesSchema,
  // Berry marks optional dependencies here. parseSyml reads every scalar as a string.
  dependenciesMeta: z
    .record(z.string(), z.looseObject({ optional: z.string().optional() }))
    .optional(),
  integrity: z.string().optional(),
  linkType: z.string().optional(),
  optionalDependencies: DependencyRangesSchema,
  resolution: z.string().optional(),
  resolved: z.string().optional(),
  version: z.string(),
});
type YarnLockfileEntry = z.infer<typeof YarnLockfileEntrySchema>;

const NODE_MODULES_SEGMENT = 'node_modules/';
// Matches an alias version, which is the aliased package's key such as `real-name@1.2.3`, scoped or not.
// No other version starts with a name and an `@`.
const PNPM_ALIAS_VERSION_PATTERN = /^(?:@[^@/]+\/)?[^@:(/]+@/;
const PNPM_LINK_PREFIX = 'link:';
const PNPM_ROOT_IMPORTER = '.';
const PNPM_VIRTUAL_STORE_DIRECTORY = 'node_modules/.pnpm';
// Matches the hash pnpm puts at the end of a shortened store name.
// That is 26 base32 characters up to pnpm 9 and 32 hex characters from pnpm 10.
const PNPM_VIRTUAL_STORE_HASH_PATTERN = /^(?:[a-z2-7]{26}|[0-9a-f]{32})$/;
const YARN_METADATA_KEY = '__metadata';
const YARN_ROOT_WORKSPACE = '.';

// From a monorepo root lockfile, only this workspace's packages count, never a sibling's.
// An unknown lockfile format is refused rather than misread.
export async function readLockedTree(
  lockfileName: LockfileName,
  text: string,
  project: LockedProject,
  reader: ProjectReader,
): Promise<LockedTree> {
  switch (lockfileName) {
    case 'package-lock.json':
      return resolveNpmLockedTree(text, project);
    case 'pnpm-lock.yaml':
      return resolvePnpmLockedTree(
        text,
        project,
        await readPnpmVirtualStoreNames(reader),
      );
    case 'yarn.lock':
      return resolveYarnLockedTree(text, project);
  }
}

// npm keys each installed copy by its path, so a dependency resolves as in Node, from the nearest `node_modules` up.
function resolveNpmLockedTree(
  text: string,
  project: LockedProject,
): LockedTree {
  const lockfile = NpmLockfileSchema.safeParse(
    parseLockfileText('package-lock.json', text, JSON.parse),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'The file package-lock.json is not a lockfile of version 2 or 3. Run "npm install" with npm 7 or later.',
    );
  }
  const { packages } = lockfile.data;
  const resolveDependency = (
    directory: string,
    declared: DeclaredDependency,
  ): LockedDependency[] => {
    for (const key of resolveNodeModulesPaths(directory, declared.name)) {
      const entry = packages[key];
      if (entry !== undefined) {
        return entry.link === true ||
          entry.inBundle === true ||
          entry.version === undefined
          ? []
          : [
              {
                isOptional: declared.isOptional,
                key,
                package: {
                  integrity: entry.integrity ?? entry.resolved ?? null,
                  name: declared.name,
                  version: entry.version,
                },
              },
            ];
      }
    }
    return [];
  };
  return {
    projectDependencies: project.dependencies.flatMap(declared =>
      resolveDependency(project.path, declared),
    ),
    resolveDependencies: dependency => {
      const entry = packages[dependency.key];
      return [
        ...resolveDeclaredDependencies(entry?.dependencies, false),
        ...resolveDeclaredDependencies(entry?.optionalDependencies, true),
        ...resolveDeclaredDependencies(entry?.peerDependencies, false),
      ].flatMap(declared => resolveDependency(dependency.key, declared));
    },
    resolveInstallDirectories: dependency => [dependency.key],
  };
}

// pnpm installs each snapshot in a virtual store directory named after it.
// An alias contributes the aliased package's version and integrity under the declared name, as in every lockfile.
function resolvePnpmLockedTree(
  text: string,
  project: LockedProject,
  virtualStoreNames: ReadonlySet<string>,
): LockedTree {
  const lockfile = PnpmLockfileSchema.safeParse(
    parseLockfileText('pnpm-lock.yaml', text, parseYaml),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'The file pnpm-lock.yaml is not a lockfile of version 9.0. Run "pnpm install" with pnpm 9 or later.',
    );
  }
  const { importers, packages, snapshots } = lockfile.data;
  const importerPath = project.path === '' ? PNPM_ROOT_IMPORTER : project.path;
  const importer = importers[importerPath];
  if (importer === undefined) {
    throw new FingerprintError(
      `The file pnpm-lock.yaml holds no importer "${importerPath}". Run "pnpm install".`,
    );
  }
  const importedVersions = new Map(
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
  const resolveDependency = (
    declared: DeclaredDependency,
  ): LockedDependency[] => {
    const key = resolvePnpmSnapshotKey(declared);
    if (declared.range.startsWith(PNPM_LINK_PREFIX) || !(key in snapshots)) {
      return [];
    }
    // A snapshot key adds the resolved peers in parentheses. A package key does not.
    const packageKey = key.split('(')[0] ?? key;
    const resolution = packages[packageKey]?.resolution;
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
  };
  return {
    projectDependencies: project.dependencies.flatMap(declared => {
      const version = importedVersions.get(declared.name);
      return version === undefined
        ? []
        : resolveDependency({ ...declared, range: version });
    }),
    resolveDependencies: dependency => {
      const snapshot = snapshots[dependency.key];
      return [
        ...resolveDeclaredDependencies(snapshot?.dependencies, false),
        ...resolveDeclaredDependencies(snapshot?.optionalDependencies, true),
      ].flatMap(resolveDependency);
    },
    resolveInstallDirectories: (dependency, dependentDirectory) => {
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
        ...resolveNodeModulesPaths(dependentDirectory, dependency.package.name),
      ];
    },
  };
}

// Empty when another package manager installed the project.
async function readPnpmVirtualStoreNames(
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
    isShortenedVirtualStoreName(storeName, name),
  );
  return shortenedNames.length === 1 ? (shortenedNames[0] ?? null) : null;
}

function isShortenedVirtualStoreName(storeName: string, name: string): boolean {
  const separatorIndex = storeName.lastIndexOf('_');
  return (
    separatorIndex > 0 &&
    PNPM_VIRTUAL_STORE_HASH_PATTERN.test(storeName.slice(separatorIndex + 1)) &&
    name.startsWith(storeName.slice(0, separatorIndex))
  );
}

// yarn keys each entry by the `name@range` descriptors it satisfies, and records no install location.
// Classic records no workspace, so the project's ranges come from its package.json.
function resolveYarnLockedTree(
  text: string,
  project: LockedProject,
): LockedTree {
  const lockfile = parseLockfileText('yarn.lock', text, parseSyml);
  const entryKeysByDescriptor = new Map(
    Object.keys(lockfile).flatMap(key =>
      key.split(', ').map(descriptor => [descriptor, key]),
    ),
  );
  const resolveDependency = (
    declared: DeclaredDependency,
  ): LockedDependency[] => {
    const key = entryKeysByDescriptor.get(`${declared.name}@${declared.range}`);
    if (key === undefined) {
      return [];
    }
    const entry = parseYarnLockfileEntry(key, lockfile[key]);
    // A soft link is a workspace, link or portal, so it is the app's own code.
    if (entry.linkType === 'soft') {
      return [];
    }
    const { checksum, integrity, resolution, resolved, version } = entry;
    return [
      {
        isOptional: declared.isOptional,
        key,
        package: {
          integrity: integrity ?? checksum ?? resolved ?? resolution ?? null,
          name: declared.name,
          version,
        },
      },
    ];
  };
  const projectDependencies =
    YARN_METADATA_KEY in lockfile
      ? resolveBerryWorkspaceDependencies(
          lockfile,
          entryKeysByDescriptor,
          project,
        )
      : project.dependencies;
  return {
    projectDependencies: projectDependencies.flatMap(resolveDependency),
    resolveDependencies: dependency => {
      const entry = parseYarnLockfileEntry(
        dependency.key,
        lockfile[dependency.key],
      );
      return [
        ...Object.entries(entry.dependencies ?? {}).map(([name, range]) => ({
          isOptional: entry.dependenciesMeta?.[name]?.optional === 'true',
          name,
          range,
        })),
        ...resolveDeclaredDependencies(entry.optionalDependencies, true),
      ].flatMap(resolveDependency);
    },
    resolveInstallDirectories: (dependency, dependentDirectory) =>
      resolveNodeModulesPaths(dependentDirectory, dependency.package.name),
  };
}

// Berry records the workspace's descriptors with its own protocols added, so they replace the package.json ranges.
function resolveBerryWorkspaceDependencies(
  lockfile: Record<string, unknown>,
  entryKeysByDescriptor: Map<string, string>,
  project: LockedProject,
): DeclaredDependency[] {
  const workspacePath =
    project.path === '' ? YARN_ROOT_WORKSPACE : project.path;
  const workspaceKey = [...entryKeysByDescriptor].find(([descriptor]) =>
    descriptor.endsWith(`@workspace:${workspacePath}`),
  )?.[1];
  if (workspaceKey === undefined) {
    throw new FingerprintError(
      `The file yarn.lock holds no workspace "${workspacePath}". Run "yarn install".`,
    );
  }
  const workspaceRanges =
    parseYarnLockfileEntry(workspaceKey, lockfile[workspaceKey]).dependencies ??
    {};
  return project.dependencies.flatMap(declared => {
    const range = workspaceRanges[declared.name];
    return range === undefined ? [] : [{ ...declared, range }];
  });
}

function parseYarnLockfileEntry(
  key: string,
  value: unknown,
): YarnLockfileEntry {
  const entry = YarnLockfileEntrySchema.safeParse(value);
  if (!entry.success) {
    throw new FingerprintError(
      `The entry "${key}" in yarn.lock cannot be read.`,
    );
  }
  return entry.data;
}

export function resolveDeclaredDependencies(
  ranges: Record<string, string> | undefined,
  isOptional: boolean,
): DeclaredDependency[] {
  return Object.entries(ranges ?? {}).map(([name, range]) => ({
    isOptional,
    name,
    range,
  }));
}

// Node searches the directory's own `node_modules` first, then each ancestor that is not itself a `node_modules`.
function resolveNodeModulesPaths(directory: string, name: string): string[] {
  const segments = directory === '' ? [] : directory.split('/');
  return segments
    .map((_segment, index) => segments.slice(0, segments.length - index))
    .filter(ancestor => ancestor.at(-1) !== 'node_modules')
    .map(ancestor => `${ancestor.join('/')}/${NODE_MODULES_SEGMENT}`)
    .concat(NODE_MODULES_SEGMENT)
    .map(prefix => `${prefix}${name}`);
}

function parseLockfileText<T>(
  lockfileName: LockfileName,
  text: string,
  parse: (text: string) => T,
): T {
  try {
    return parse(text);
  } catch (error) {
    throw new FingerprintError(`The file ${lockfileName} does not parse.`, {
      cause: error,
    });
  }
}
