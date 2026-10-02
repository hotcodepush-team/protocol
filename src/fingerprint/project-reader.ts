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
}

export interface ProjectDirectoryEntry {
  isDirectory: boolean;
  name: string;
}

export class FingerprintError extends Error {
  override readonly name = 'FingerprintError';
}

/** The file's text, or null when no file is there. */
export async function readProjectText(
  reader: ProjectReader,
  path: string,
): Promise<string | null> {
  const bytes = await reader.readFile(path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
