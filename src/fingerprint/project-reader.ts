/**
 * Reads the project for the fingerprint, by `/`-separated paths relative to the project root.
 * The CLI passes the file system, a test an in-memory project.
 */
export interface ProjectReader {
  /** Lists the directory at the path, or returns null when no directory is there. */
  readDirectory(path: string): Promise<ProjectDirectoryEntry[] | null>;
  /** Reads the file at the path, or returns null when no file is there. */
  readFile(path: string): Promise<Uint8Array | null>;
  /**
   * Resolves every symbolic link in the path, or returns null when nothing is there.
   * The result is `/`-separated and relative to the root, starting with `..` when it lies outside.
   */
  readRealPath(path: string): Promise<string | null>;
}

export interface ProjectDirectoryEntry {
  isDirectory: boolean;
  name: string;
}

export class FingerprintError extends Error {
  override readonly name = 'FingerprintError';
}

export function parseProjectJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readProjectText(
  reader: ProjectReader,
  path: string,
): Promise<string | null> {
  const bytes = await reader.readFile(path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
