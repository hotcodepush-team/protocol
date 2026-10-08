/**
 * The project as the fingerprint reads it, by paths relative to the project
 * root and `/`-separated, so the CLI hands in the file system and a test an
 * in-memory project.
 */
export interface ProjectReader {
  /** The entries of the directory at the path, or null when no directory is there. */
  readDirectory(path: string): Promise<ProjectDirectoryEntry[] | null>;
  /** The bytes of the file at the path, or null when no file is there. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** The path with every symbolic link resolved, relative to the root and `/`-separated, `..`-led when it lies outside the root, or null when nothing is there. */
  readRealPath(path: string): Promise<string | null>;
}

export interface ProjectDirectoryEntry {
  isDirectory: boolean;
  name: string;
}

export class FingerprintError extends Error {
  override readonly name = 'FingerprintError';
}

/** The JSON value of a file's text, or null when there is no text or it does not parse. */
export function parseProjectJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** The file's text, or null when no file is there. */
export async function readProjectText(
  reader: ProjectReader,
  path: string,
): Promise<string | null> {
  const bytes = await reader.readFile(path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
