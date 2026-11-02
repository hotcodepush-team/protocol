import { parseSyml } from '@yarnpkg/parsers';
import { z } from 'zod';

import type {
  DeclaredDependency,
  LockedDependency,
  LockedProject,
  LockedTree,
} from '../lockfiles.js';
import {
  DependencyRangesSchema,
  parseLockfileText,
  resolveDeclaredDependencies,
  resolveNodeModulesPaths,
} from '../lockfiles.js';
import { FingerprintError } from '../project-reader.js';

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

// The entries of a yarn.lock, and the entry key of each `name@range` descriptor it satisfies.
interface YarnLockfile {
  entries: Record<string, unknown>;
  entryKeysByDescriptor: Map<string, string>;
}

const YARN_METADATA_KEY = '__metadata';
const YARN_ROOT_WORKSPACE = '.';

// yarn keys each entry by the `name@range` descriptors it satisfies, and records no install location.
// Classic records no workspace, so the project's ranges come from its package.json.
export function resolveYarnLockedTree(
  text: string,
  project: LockedProject,
): LockedTree {
  const lockfile = parseYarnLockfile(text);
  const projectDependencies =
    YARN_METADATA_KEY in lockfile.entries
      ? resolveBerryWorkspaceDependencies(project, lockfile)
      : project.dependencies;
  return {
    projectDependencies: projectDependencies.flatMap(declared =>
      resolveYarnDependency(declared, lockfile),
    ),
    resolveDependencies: dependency =>
      resolveYarnEntryDependencies(
        parseYarnLockfileEntry(
          dependency.key,
          lockfile.entries[dependency.key],
        ),
      ).flatMap(declared => resolveYarnDependency(declared, lockfile)),
    resolveInstallDirectories: (dependency, dependentDirectory) =>
      resolveNodeModulesPaths(dependentDirectory, {
        name: dependency.package.name,
      }),
  };
}

function parseYarnLockfile(text: string): YarnLockfile {
  const entries = parseLockfileText(text, {
    lockfileName: 'yarn.lock',
    parse: parseSyml,
  });
  const entryKeysByDescriptor = new Map(
    Object.keys(entries).flatMap(key =>
      key.split(', ').map(descriptor => [descriptor, key]),
    ),
  );
  return { entries, entryKeysByDescriptor };
}

function resolveYarnDependency(
  declared: DeclaredDependency,
  lockfile: YarnLockfile,
): LockedDependency[] {
  const key = lockfile.entryKeysByDescriptor.get(
    `${declared.name}@${declared.range}`,
  );
  if (key === undefined) {
    return [];
  }
  const entry = parseYarnLockfileEntry(key, lockfile.entries[key]);
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
}

function resolveYarnEntryDependencies(
  entry: YarnLockfileEntry,
): DeclaredDependency[] {
  return [
    ...Object.entries(entry.dependencies ?? {}).map(([name, range]) => ({
      isOptional: entry.dependenciesMeta?.[name]?.optional === 'true',
      name,
      range,
    })),
    ...resolveDeclaredDependencies({
      isOptional: true,
      ranges: entry.optionalDependencies,
    }),
  ];
}

// Berry records the workspace's descriptors with its own protocols added, so they replace the package.json ranges.
function resolveBerryWorkspaceDependencies(
  project: LockedProject,
  lockfile: YarnLockfile,
): DeclaredDependency[] {
  const workspacePath =
    project.path === '' ? YARN_ROOT_WORKSPACE : project.path;
  const workspaceKey = [...lockfile.entryKeysByDescriptor].find(
    ([descriptor]) => descriptor.endsWith(`@workspace:${workspacePath}`),
  )?.[1];
  if (workspaceKey === undefined) {
    throw new FingerprintError(
      `The file yarn.lock holds no workspace "${workspacePath}". Run "yarn install".`,
    );
  }
  const workspaceRanges =
    parseYarnLockfileEntry(workspaceKey, lockfile.entries[workspaceKey])
      .dependencies ?? {};
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
