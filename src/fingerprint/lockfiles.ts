import { parseSyml } from '@yarnpkg/parsers';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

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
 * dependencies and each locked package's, as the lockfile resolved them.
 * Workspace packages and links are the app's own code, never a dependency,
 * and bundled packages ride inside their parent, so the tree holds neither;
 * a dependency the lockfile does not install is not in it either.
 */
export interface LockedTree {
  projectDependencies: LockedDependency[];
  resolveDependencies(dependency: LockedDependency): LockedDependency[];
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
const PNPM_LINK_PREFIX = 'link:';
const PNPM_ROOT_IMPORTER = '.';
const YARN_METADATA_KEY = '__metadata';
const YARN_ROOT_WORKSPACE = '.';

/**
 * The project's dependency tree as the lockfile resolved it, so a monorepo's
 * root lockfile yields the packages this workspace installs and never a
 * sibling's. A lockfile format this recipe was not written against is
 * refused rather than misread.
 */
export function resolveLockedTree(
  lockfileName: LockfileName,
  text: string,
  project: LockedProject,
): LockedTree {
  switch (lockfileName) {
    case 'package-lock.json':
      return resolveNpmLockedTree(text, project);
    case 'pnpm-lock.yaml':
      return resolvePnpmLockedTree(text, project);
    case 'yarn.lock':
      return resolveYarnLockedTree(text, project);
  }
}

/** npm keys every installed copy by its path, so a dependency resolves as Node resolves it, from the nearest `node_modules` up. */
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
    for (const prefix of resolveNodeModulesPrefixes(directory)) {
      const key = `${prefix}${declared.name}`;
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
  };
}

/** pnpm resolves the project's dependencies in its importer and every package's in its snapshot, whose version carries the peers it resolved. */
function resolvePnpmLockedTree(
  text: string,
  project: LockedProject,
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
    const key = `${declared.name}@${declared.range}`;
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
          version: packageKey.slice(declared.name.length + 1),
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
  };
}

/**
 * yarn keys every entry by the descriptors it satisfies, `name@range`. Berry
 * records each workspace with its dependencies' descriptors, its own
 * protocols added; classic records no workspace, so the project's ranges
 * come from its package.json.
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
 * The `node_modules` directories Node consults from a directory, nearest
 * first, each as the prefix of a lockfile key: the directory's own, then
 * every ancestor's that is not itself a `node_modules`.
 */
function resolveNodeModulesPrefixes(directory: string): string[] {
  const segments = directory === '' ? [] : directory.split('/');
  return segments
    .map((_segment, index) => segments.slice(0, segments.length - index))
    .filter(ancestor => ancestor.at(-1) !== 'node_modules')
    .map(ancestor => `${ancestor.join('/')}/${NODE_MODULES_SEGMENT}`)
    .concat(NODE_MODULES_SEGMENT);
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
