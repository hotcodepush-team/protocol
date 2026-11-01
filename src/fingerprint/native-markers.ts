import { z } from 'zod';

import type { ProjectDirectoryEntry, ProjectReader } from './project-reader.js';
import { parseProjectJson, readProjectText } from './project-reader.js';

const PackageJsonSchema = z.looseObject({
  capacitor: z.record(z.string(), z.unknown()).optional(),
});

export async function hasNativeMarkers(
  reader: ProjectReader,
  directory: string,
): Promise<boolean> {
  const entries = await reader.readDirectory(directory);
  if (entries === null) {
    return false;
  }
  return (
    hasFile(entries, 'plugin.xml') ||
    (await isCapacitorPlugin(reader, directory)) ||
    (await hasIosModule(reader, { directory, entries })) ||
    (await hasAndroidModule(reader, { directory, entries }))
  );
}

// A package.json that does not parse is no Capacitor plugin, but the other markers still count.
async function isCapacitorPlugin(
  reader: ProjectReader,
  directory: string,
): Promise<boolean> {
  const text = await readProjectText(reader, `${directory}/package.json`);
  const packageJson = PackageJsonSchema.safeParse(parseProjectJson(text));
  const capacitor = packageJson.data?.capacitor ?? {};
  return 'ios' in capacitor || 'android' in capacitor;
}

async function hasIosModule(
  reader: ProjectReader,
  {
    directory,
    entries,
  }: { directory: string; entries: ProjectDirectoryEntry[] },
): Promise<boolean> {
  if (!hasDirectory(entries, 'ios')) {
    return false;
  }
  const iosEntries = (await reader.readDirectory(`${directory}/ios`)) ?? [];
  return [...entries, ...iosEntries].some(
    entry => !entry.isDirectory && entry.name.endsWith('.podspec'),
  );
}

async function hasAndroidModule(
  reader: ProjectReader,
  {
    directory,
    entries,
  }: { directory: string; entries: ProjectDirectoryEntry[] },
): Promise<boolean> {
  if (!hasDirectory(entries, 'android')) {
    return false;
  }
  const androidEntries =
    (await reader.readDirectory(`${directory}/android`)) ?? [];
  return (
    hasFile(androidEntries, 'build.gradle') ||
    hasFile(androidEntries, 'build.gradle.kts')
  );
}

function hasDirectory(entries: ProjectDirectoryEntry[], name: string): boolean {
  return entries.some(entry => entry.isDirectory && entry.name === name);
}

function hasFile(entries: ProjectDirectoryEntry[], name: string): boolean {
  return entries.some(entry => !entry.isDirectory && entry.name === name);
}
