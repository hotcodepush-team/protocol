import type { LockedProject, LockedTree, LockfileName } from '../lockfiles.js';
import type { ProjectReader } from '../project-reader.js';
import { resolveNpmLockedTree } from './npm.js';
import { readPnpmVirtualStoreNames, resolvePnpmLockedTree } from './pnpm.js';
import { resolveYarnLockedTree } from './yarn.js';

// From a monorepo root lockfile, only this workspace's packages count, never a sibling's.
// An unknown lockfile format is refused rather than misread.
export async function readLockedTree(
  lockfile: { name: LockfileName; text: string },
  { project, reader }: { project: LockedProject; reader: ProjectReader },
): Promise<LockedTree> {
  switch (lockfile.name) {
    case 'package-lock.json':
      return resolveNpmLockedTree(lockfile.text, project);
    case 'pnpm-lock.yaml':
      return resolvePnpmLockedTree(lockfile.text, {
        project,
        virtualStoreNames: await readPnpmVirtualStoreNames(reader),
      });
    case 'yarn.lock':
      return resolveYarnLockedTree(lockfile.text, project);
  }
}
