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

const NpmLockfileSchema = z.looseObject({
  lockfileVersion: z.int().min(2),
  packages: z.record(
    z.string(),
    z.looseObject({
      inBundle: z.boolean().optional(),
      integrity: z.string().optional(),
      link: z.boolean().optional(),
      resolved: z.string().optional(),
      version: z.string().optional(),
    }),
  ),
});

const PnpmLockfileSchema = z.looseObject({
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
});

/** An entry of either yarn format: classic records `integrity` and `resolved`, berry `checksum` and `resolution`. */
const YarnLockfileEntrySchema = z.looseObject({
  checksum: z.string().optional(),
  integrity: z.string().optional(),
  linkType: z.string().optional(),
  resolution: z.string().optional(),
  resolved: z.string().optional(),
  version: z.string(),
});

const NODE_MODULES_SEGMENT = 'node_modules/';
const YARN_METADATA_KEY = '__metadata';

/**
 * Every package the lockfile installs from a registry, a tarball or a
 * repository, once per name and version; workspace packages and links are
 * the app's own code, never a dependency, and bundled packages ride inside
 * their parent. A lockfile format this recipe was not written against is
 * refused rather than misread.
 */
export function resolveLockedPackages(
  lockfileName: LockfileName,
  text: string,
): LockedPackage[] {
  switch (lockfileName) {
    case 'package-lock.json':
      return resolveNpmLockedPackages(text);
    case 'pnpm-lock.yaml':
      return resolvePnpmLockedPackages(text);
    case 'yarn.lock':
      return resolveYarnLockedPackages(text);
  }
}

function resolveNpmLockedPackages(text: string): LockedPackage[] {
  const lockfile = NpmLockfileSchema.safeParse(
    parseLockfileText('package-lock.json', text, JSON.parse),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'package-lock.json is not a lockfile of version 2 or 3; run npm install with npm 7 or later',
    );
  }
  return Object.entries(lockfile.data.packages).flatMap(([path, entry]) => {
    const nameIndex = path.lastIndexOf(NODE_MODULES_SEGMENT);
    if (
      nameIndex === -1 ||
      entry.link === true ||
      entry.inBundle === true ||
      entry.version === undefined
    ) {
      return [];
    }
    return [
      {
        integrity: entry.integrity ?? entry.resolved ?? null,
        name: path.slice(nameIndex + NODE_MODULES_SEGMENT.length),
        version: entry.version,
      },
    ];
  });
}

function resolvePnpmLockedPackages(text: string): LockedPackage[] {
  const lockfile = PnpmLockfileSchema.safeParse(
    parseLockfileText('pnpm-lock.yaml', text, parseYaml),
  );
  if (!lockfile.success) {
    throw new FingerprintError(
      'pnpm-lock.yaml is not a lockfile of version 9.0; run pnpm install with pnpm 9 or later',
    );
  }
  return Object.entries(lockfile.data.packages).map(([key, entry]) => {
    const name = resolvePackageName(key);
    return {
      integrity:
        entry.resolution?.integrity ?? entry.resolution?.tarball ?? null,
      name,
      version: key.slice(name.length + 1),
    };
  });
}

function resolveYarnLockedPackages(text: string): LockedPackage[] {
  const lockfile = parseLockfileText('yarn.lock', text, parseSyml);
  return Object.entries(lockfile).flatMap(([descriptors, value]) => {
    if (descriptors === YARN_METADATA_KEY) {
      return [];
    }
    const entry = YarnLockfileEntrySchema.safeParse(value);
    if (!entry.success) {
      throw new FingerprintError(
        `yarn.lock holds an entry without a version, ${descriptors}`,
      );
    }
    // A soft link is a workspace, a link or a portal: the app's own code.
    if (entry.data.linkType === 'soft') {
      return [];
    }
    const { checksum, integrity, resolution, resolved, version } = entry.data;
    return [
      {
        integrity: integrity ?? checksum ?? resolved ?? resolution ?? null,
        name: resolvePackageName(descriptors),
        version,
      },
    ];
  });
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

/** The name in `name@rest`, scoped or not, since a package name holds no `@` after its first character. */
function resolvePackageName(descriptor: string): string {
  const separatorIndex = descriptor.indexOf('@', 1);
  if (separatorIndex === -1) {
    throw new FingerprintError(
      `the lockfile names a package without a version, ${descriptor}`,
    );
  }
  return descriptor.slice(0, separatorIndex);
}
