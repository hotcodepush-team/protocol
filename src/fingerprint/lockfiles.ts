import { z } from 'zod';

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

export const DependencyRangesSchema = z
  .record(z.string(), z.string())
  .optional();

export const NODE_MODULES_SEGMENT = 'node_modules/';

export function resolveDeclaredDependencies({
  isOptional,
  ranges,
}: {
  isOptional: boolean;
  ranges: Record<string, string> | undefined;
}): DeclaredDependency[] {
  return Object.entries(ranges ?? {}).map(([name, range]) => ({
    isOptional,
    name,
    range,
  }));
}

// Node searches the directory's own `node_modules` first, then each ancestor that is not itself a `node_modules`.
export function resolveNodeModulesPaths(
  directory: string,
  { name }: { name: string },
): string[] {
  const segments = directory === '' ? [] : directory.split('/');
  return segments
    .map((_segment, index) => segments.slice(0, segments.length - index))
    .filter(ancestor => ancestor.at(-1) !== 'node_modules')
    .map(ancestor => `${ancestor.join('/')}/${NODE_MODULES_SEGMENT}`)
    .concat(NODE_MODULES_SEGMENT)
    .map(prefix => `${prefix}${name}`);
}

export function parseLockfileText<T>(
  text: string,
  {
    lockfileName,
    parse,
  }: { lockfileName: LockfileName; parse: (text: string) => T },
): T {
  try {
    return parse(text);
  } catch (error) {
    throw new FingerprintError(`The file ${lockfileName} does not parse.`, {
      cause: error,
    });
  }
}
