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
 * A package the lockfile installs, under the name it is installed by, with
 * the lockfile's record of its bytes: the integrity hash, or the resolved
 * URL where the lockfile keeps no hash, or null where it keeps neither. So
 * a package built again under the same version, from a git URL, a tarball
 * or pkg.pr.new, differs, while a published version never does.
 */
export interface LockedPackage {
  integrity: string | null;
  name: string;
  version: string;
}

/**
 * A dependency as the lockfile resolved it: the lockfile's own key of the
 * installed copy, its package, and whether it is optional, which a platform
 * the package does not support never installs.
 */
export interface LockedDependency {
  isOptional: boolean;
  key: string;
  package: LockedPackage;
}

/**
 * The lockfile read as the project's dependency tree: the project's own
 * dependencies and each locked package's, as the lockfile resolved them, and
 * where each is installed. Workspace packages and links are the app's own
 * code, never a dependency, and bundled packages ride inside their parent, so
 * the tree holds neither; a dependency the lockfile does not install is not
 * in it either.
 */
export interface LockedTree {
  projectDependencies: LockedDependency[];
  resolveDependencies(dependency: LockedDependency): LockedDependency[];
  /**
   * Where the dependency may be installed, relative to the lockfile's
   * directory, the first that exists holding it: the directory the lockfile
   * implies, else the nearest `node_modules` from the directory of the
   * project or package depending on it, as Node resolves it.
   */
  resolveInstallDirectories(
    dependency: LockedDependency,
    dependentDirectory: string,
  ): string[];
}

/** The project the tree starts from: its directory relative to the lockfile's, empty when they are one, and its package.json's dependencies. */
export interface LockedProject {
  dependencies: DeclaredDependency[];
  path: string;
}

/** A dependency as a package.json or a lockfile entry declares it: the name, the range or the version a lockfile pinned, and whether it is optional. */
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

/** An entry of either yarn format: classic records `integrity` and `resolved`, berry `checksum` and `resolution`. */
const YarnLockfileEntrySchema = z.looseObject({
  checksum: z.string().optional(),
  dependencies: DependencyRangesSchema,
  /** Berry's: an optional dependency sits among the dependencies, marked here; parseSyml reads every scalar as a string. */
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
/** An aliased dependency's version is the aliased package's own key, `real-name@1.2.3`, scoped or not; no other version starts with a name and an `@`. */
const PNPM_ALIAS_VERSION_PATTERN = /^(?:@[^@/]+\/)?[^@:(/]+@/;
const PNPM_LINK_PREFIX = 'link:';
const PNPM_ROOT_IMPORTER = '.';
const PNPM_VIRTUAL_STORE_DIRECTORY = 'node_modules/.pnpm';
/** The hash ending a virtual-store name pnpm shortened: 26 base32 characters up to pnpm 9, 32 hex characters from pnpm 10. */
const PNPM_VIRTUAL_STORE_HASH_PATTERN = /^(?:[a-z2-7]{26}|[0-9a-f]{32})$/;
const YARN_METADATA_KEY = '__metadata';
const YARN_ROOT_WORKSPACE = '.';

/**
 * The project's dependency tree as the lockfile resolved it, so a monorepo's
 * root lockfile yields the packages this workspace installs and never a
 * sibling's. A lockfile format this recipe was not written against is
 * refused rather than misread. pnpm's virtual store is read for the names it
 * shortened, which the lockfile alone cannot tell.
 */
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

/** npm keys every installed copy by its path, so a dependency resolves as Node resolves it, from the nearest `node_modules` up, and is installed at its key. */
function resolveNpmLockedTree(
  text: string,
  project: LockedProject,
): LockedTree {
  const lockfile = NpmLockfileSchema.safeParse(
    parseLockfileText('package-lock.json', text, JSON.parse),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'package-lock.json is not a lockfile of version 2 or 3; run npm install with npm 7 or later',
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

/**
 * pnpm resolves the project's dependencies in its importer and every
 * package's in its snapshot, whose version carries the peers it resolved,
 * and installs each snapshot in a virtual store directory named after it.
 * An aliased dependency's version names the aliased package's snapshot; it
 * contributes that package's version and integrity under the name the
 * project declared, as an alias does from every lockfile, and is linked
 * under that name beside its dependent.
 */
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
      'pnpm-lock.yaml is not a lockfile of version 9.0; run pnpm install with pnpm 9 or later',
    );
  }
  const { importers, packages, snapshots } = lockfile.data;
  const importerPath = project.path === '' ? PNPM_ROOT_IMPORTER : project.path;
  const importer = importers[importerPath];
  if (importer === undefined) {
    throw new FingerprintError(
      `pnpm-lock.yaml holds no importer ${importerPath}; run pnpm install`,
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
    // The snapshot's version carries the resolved peers in parentheses; the package's does not.
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

/** The directories of pnpm's virtual store, one per snapshot; none when the project was installed another way. */
async function readPnpmVirtualStoreNames(
  reader: ProjectReader,
): Promise<ReadonlySet<string>> {
  const entries = await reader.readDirectory(PNPM_VIRTUAL_STORE_DIRECTORY);
  return new Set(
    (entries ?? []).filter(entry => entry.isDirectory).map(entry => entry.name),
  );
}

/** The snapshot a dependency's version names: an alias's version is the aliased package's own key, any other the dependency's version. */
function resolvePnpmSnapshotKey(declared: DeclaredDependency): string {
  return PNPM_ALIAS_VERSION_PATTERN.test(declared.range)
    ? declared.range
    : `${declared.name}@${declared.range}`;
}

/** The package a snapshot key names, everything before the `@` its version starts with. */
function resolvePnpmPackageName(snapshotKey: string): string {
  return snapshotKey.slice(0, snapshotKey.indexOf('@', 1));
}

/**
 * The directory of a snapshot in pnpm's virtual store, null when the store
 * holds none, so the package is found as Node finds it instead. pnpm names
 * it after the key, the characters a file name cannot hold replaced by `+`
 * and the peers' parentheses by `_`; a name too long or with capitals it
 * shortens to a prefix, an `_` and a hash, whose length and algorithm its
 * major and the platform choose, so such a snapshot's directory is the one
 * store entry whose prefix the unshortened name begins with.
 */
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

/**
 * yarn keys every entry by the descriptors it satisfies, `name@range`. Berry
 * records each workspace with its dependencies' descriptors, its own
 * protocols added; classic records no workspace, so the project's ranges
 * come from its package.json. Neither records where an entry is installed.
 */
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
    // A soft link is a workspace, a link or a portal: the app's own code.
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

/** The project's dependencies under the descriptors berry recorded on the project's workspace entry. */
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
      `yarn.lock holds no workspace ${workspacePath}; run yarn install`,
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
      `yarn.lock holds an entry it cannot read, ${key}`,
    );
  }
  return entry.data;
}

/** The dependencies of a `{ name: range }` record, every one optional or none. */
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

/**
 * The paths Node consults for a package from a directory, nearest first,
 * relative to the lockfile's directory: in the directory's own
 * `node_modules`, then in every ancestor's that is not itself a
 * `node_modules`.
 */
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
    throw new FingerprintError(`${lockfileName} does not parse`, {
      cause: error,
    });
  }
}
