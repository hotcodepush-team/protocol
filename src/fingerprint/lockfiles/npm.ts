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

type NpmLockfilePackages = z.infer<typeof NpmLockfileSchema>['packages'];

// npm keys each installed copy by its path, so a dependency resolves as in Node, from the nearest `node_modules` up.
export function resolveNpmLockedTree(
  text: string,
  project: LockedProject,
): LockedTree {
  const packages = parseNpmLockfilePackages(text);
  return {
    projectDependencies: project.dependencies.flatMap(declared =>
      resolveNpmDependency(declared, { directory: project.path, packages }),
    ),
    resolveDependencies: dependency => {
      const entry = packages[dependency.key];
      return [
        ...resolveDeclaredDependencies({
          isOptional: false,
          ranges: entry?.dependencies,
        }),
        ...resolveDeclaredDependencies({
          isOptional: true,
          ranges: entry?.optionalDependencies,
        }),
        ...resolveDeclaredDependencies({
          isOptional: false,
          ranges: entry?.peerDependencies,
        }),
      ].flatMap(declared =>
        resolveNpmDependency(declared, { directory: dependency.key, packages }),
      );
    },
    resolveInstallDirectories: dependency => [dependency.key],
  };
}

function parseNpmLockfilePackages(text: string): NpmLockfilePackages {
  const lockfile = NpmLockfileSchema.safeParse(
    parseLockfileText(text, {
      lockfileName: 'package-lock.json',
      parse: JSON.parse,
    }),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'The file package-lock.json is not a lockfile of version 2 or 3. Run "npm install" with npm 7 or later.',
    );
  }
  return lockfile.data.packages;
}

function resolveNpmDependency(
  declared: DeclaredDependency,
  { directory, packages }: { directory: string; packages: NpmLockfilePackages },
): LockedDependency[] {
  for (const key of resolveNodeModulesPaths(directory, {
    name: declared.name,
  })) {
    const entry = packages[key];
    if (entry === undefined) {
      continue;
    }
    if (
      entry.link === true ||
      entry.inBundle === true ||
      entry.version === undefined
    ) {
      return [];
    }
    return [
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
  return [];
}
