import { z } from 'zod';

import type { ProjectDirectoryEntry, ProjectReader } from './project-reader.js';
import { readProjectText } from './project-reader.js';

const PackageJsonSchema = z.looseObject({
  capacitor: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Whether the package in the directory ships native code, by its own markers:
 * a Capacitor plugin's `capacitor` field with an `ios` or an `android` entry,
 * a Cordova plugin's `plugin.xml`, a React Native module's `ios` directory
 * with a podspec beside or inside it, or its `android` directory with a
 * Gradle build file.
 */
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
    (await hasIosModule(reader, directory, entries)) ||
    (await hasAndroidModule(reader, directory, entries))
  );
}

/** A package.json that does not parse, or carries no object there, is no Capacitor plugin; its other markers still count. */
async function isCapacitorPlugin(
  reader: ProjectReader,
  directory: string,
): Promise<boolean> {
  const text = await readProjectText(reader, `${directory}/package.json`);
  const packageJson = PackageJsonSchema.safeParse(parsePackageJson(text));
  const capacitor = packageJson.data?.capacitor ?? {};
  return 'ios' in capacitor || 'android' in capacitor;
}

async function hasIosModule(
  reader: ProjectReader,
  directory: string,
  entries: ProjectDirectoryEntry[],
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
  directory: string,
  entries: ProjectDirectoryEntry[],
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

function parsePackageJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
