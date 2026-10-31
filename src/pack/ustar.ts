// A pack is an uncompressed ustar archive. Unused header fields stay zero, so every assembly
// yields the same bytes, and `tar -tvf` can list a pack in a support case.
// A patch entry name is too long for the name field, so `patches/{from}` goes in the ustar prefix,
// which only counts when the ustar magic is set. A reader skips unknown names, so a later entry kind stays compatible.

export type PackEntry = PackFileEntry | PackPatchEntry;

/** A file's stored object, named by its content hash. */
export interface PackFileEntry {
  body: ReadableStream<Uint8Array>;
  sha256: string;
  sizeBytes: number;
  type: 'file';
}

/** A BSDIFF40 patch that turns the file `fromSha256` into the file `toSha256`. */
export interface PackPatchEntry {
  body: ReadableStream<Uint8Array>;
  fromSha256: string;
  sizeBytes: number;
  toSha256: string;
  type: 'patch';
}

export class PackFormatError extends Error {
  override readonly name = 'PackFormatError';
}

type PackEntryName =
  | Pick<PackFileEntry, 'sha256' | 'type'>
  | Pick<PackPatchEntry, 'fromSha256' | 'toSha256' | 'type'>;

const BLOCK_SIZE = 512;
const CHECKSUM_FIELD_LENGTH = 8;
const CHECKSUM_FIELD_OFFSET = 148;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
// The magic `ustar\0` followed by the version `00`.
const MAGIC_AND_VERSION = 'ustar\x0000';
const MAGIC_FIELD_OFFSET = 257;
const NAME_FIELD_LENGTH = 100;
const PATCH_NAME_PATTERN = /^patches\/([0-9a-f]{64})\/([0-9a-f]{64})$/;
const PREFIX_FIELD_LENGTH = 155;
const PREFIX_FIELD_OFFSET = 345;
const SIZE_FIELD_LENGTH = 12;
const SIZE_FIELD_OFFSET = 124;

/** Builds a pack as a stream, reading the entry bodies one after the other. */
export function buildPack(
  entries: AsyncIterable<PackEntry> | Iterable<PackEntry>,
): ReadableStream<Uint8Array> {
  return readableStreamFromAsyncIterable(generatePackChunks(entries));
}

/**
 * Reads the file and patch entries of a pack, in order, and skips entries of any other name.
 * A body not consumed before the next entry is drained. A pack cut before its two end-of-archive blocks throws.
 * The stream is cancelled and released however the iteration ends.
 */
export function readPack(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<PackEntry> {
  return generatePackEntries(new ByteReader(stream));
}

/** Builds a file entry header: the content hash in the name field, with no magic. */
export function buildPackFileHeader(
  sha256: string,
  sizeBytes: number,
): Uint8Array {
  if (!HASH_PATTERN.test(sha256)) {
    throw new PackFormatError(
      `a file entry is named by its sha256, not ${JSON.stringify(sha256)}`,
    );
  }
  return buildPackHeader('', sha256, sizeBytes);
}

/** Builds a patch entry header: `patches/{from}` in the prefix field, `{to}` in the name field, and the ustar magic. */
export function buildPackPatchHeader(
  fromSha256: string,
  toSha256: string,
  sizeBytes: number,
): Uint8Array {
  if (!HASH_PATTERN.test(fromSha256) || !HASH_PATTERN.test(toSha256)) {
    throw new PackFormatError(
      `a patch entry is named by two sha256, not ${JSON.stringify(fromSha256)} and ${JSON.stringify(toSha256)}`,
    );
  }
  return buildPackHeader(`patches/${fromSha256}`, toSha256, sizeBytes);
}

// The magic is set only beside a prefix, so file entries keep the bytes of the first packs.
function buildPackHeader(
  prefix: string,
  name: string,
  sizeBytes: number,
): Uint8Array {
  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > 0o77777777777
  ) {
    throw new PackFormatError(
      `a pack entry size must fit the ustar size field, not ${sizeBytes}`,
    );
  }
  const encoder = new TextEncoder();
  const header = new Uint8Array(BLOCK_SIZE);
  header.set(encoder.encode(name), 0);
  if (prefix !== '') {
    header.set(encoder.encode(MAGIC_AND_VERSION), MAGIC_FIELD_OFFSET);
    header.set(encoder.encode(prefix), PREFIX_FIELD_OFFSET);
  }
  header.set(
    encoder.encode(`${sizeBytes.toString(8).padStart(11, '0')}\0`),
    SIZE_FIELD_OFFSET,
  );
  header.fill(
    0x20,
    CHECKSUM_FIELD_OFFSET,
    CHECKSUM_FIELD_OFFSET + CHECKSUM_FIELD_LENGTH,
  );
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(
    encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `),
    CHECKSUM_FIELD_OFFSET,
  );
  return header;
}

function resolvePackEntryName(entry: PackEntry): string {
  return entry.type === 'file'
    ? entry.sha256
    : `patches/${entry.fromSha256}/${entry.toSha256}`;
}

function resolvePadding(sizeBytes: number): number {
  return (BLOCK_SIZE - (sizeBytes % BLOCK_SIZE)) % BLOCK_SIZE;
}

async function* generatePackChunks(
  entries: AsyncIterable<PackEntry> | Iterable<PackEntry>,
): AsyncGenerator<Uint8Array> {
  for await (const entry of entries) {
    yield entry.type === 'file'
      ? buildPackFileHeader(entry.sha256, entry.sizeBytes)
      : buildPackPatchHeader(entry.fromSha256, entry.toSha256, entry.sizeBytes);
    let written = 0;
    for await (const chunk of entry.body) {
      written += chunk.length;
      if (written > entry.sizeBytes) {
        throw new PackFormatError(
          `the entry ${resolvePackEntryName(entry)} is longer than its ${entry.sizeBytes} bytes`,
        );
      }
      yield chunk;
    }
    if (written !== entry.sizeBytes) {
      throw new PackFormatError(
        `the entry ${resolvePackEntryName(entry)} holds ${written} of its ${entry.sizeBytes} bytes`,
      );
    }
    const padding = resolvePadding(entry.sizeBytes);
    if (padding > 0) {
      yield new Uint8Array(padding);
    }
  }
  yield new Uint8Array(BLOCK_SIZE * 2);
}

async function* generatePackEntries(
  reader: ByteReader,
): AsyncGenerator<PackEntry> {
  try {
    for (;;) {
      const header = await reader.readExactly(BLOCK_SIZE);
      if (isZeroBlock(header)) {
        if (!isZeroBlock(await reader.readExactly(BLOCK_SIZE))) {
          throw new PackFormatError(
            'a zero block is not followed by the second end-of-archive block',
          );
        }
        return;
      }
      const { name, sizeBytes } = parsePackHeader(header);
      const parsedName = parsePackEntryName(name);
      if (parsedName === null) {
        await reader.skip(sizeBytes + resolvePadding(sizeBytes));
        continue;
      }
      const entry = reader.readStream(sizeBytes);
      yield { ...parsedName, body: entry.stream, sizeBytes };
      await entry.drain();
      await reader.skip(resolvePadding(sizeBytes));
    }
  } finally {
    await reader.release();
  }
}

function isZeroBlock(block: Uint8Array): boolean {
  return block.every(byte => byte === 0);
}

function parsePackHeader(header: Uint8Array): {
  name: string;
  sizeBytes: number;
} {
  const checksumField = header.slice(
    CHECKSUM_FIELD_OFFSET,
    CHECKSUM_FIELD_OFFSET + CHECKSUM_FIELD_LENGTH,
  );
  const expectedChecksum = Number.parseInt(readField(checksumField), 8);
  const blank = new Uint8Array(header);
  blank.fill(
    0x20,
    CHECKSUM_FIELD_OFFSET,
    CHECKSUM_FIELD_OFFSET + CHECKSUM_FIELD_LENGTH,
  );
  const checksum = blank.reduce((sum, byte) => sum + byte, 0);
  if (checksum !== expectedChecksum) {
    throw new PackFormatError('a pack header checksum does not match');
  }
  const name = readField(header.subarray(0, NAME_FIELD_LENGTH));
  const prefix = readField(
    header.subarray(
      PREFIX_FIELD_OFFSET,
      PREFIX_FIELD_OFFSET + PREFIX_FIELD_LENGTH,
    ),
  );
  const sizeBytes = Number.parseInt(
    readField(
      header.subarray(SIZE_FIELD_OFFSET, SIZE_FIELD_OFFSET + SIZE_FIELD_LENGTH),
    ),
    8,
  );
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new PackFormatError('a pack header size is not octal');
  }
  return { name: prefix === '' ? name : `${prefix}/${name}`, sizeBytes };
}

function parsePackEntryName(name: string): PackEntryName | null {
  if (HASH_PATTERN.test(name)) {
    return { sha256: name, type: 'file' };
  }
  const match = PATCH_NAME_PATTERN.exec(name);
  const fromSha256 = match?.[1];
  const toSha256 = match?.[2];
  if (fromSha256 === undefined || toSha256 === undefined) {
    return null;
  }
  return { fromSha256, toSha256, type: 'patch' };
}

// By ustar convention, a field ends at its first NUL or space.
function readField(bytes: Uint8Array): string {
  const end = bytes.findIndex(byte => byte === 0 || byte === 0x20);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function readableStreamFromAsyncIterable(
  iterable: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return?.();
    },
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
  });
}

class ByteReader {
  private buffered: Uint8Array = new Uint8Array(0);
  private isDone = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  // Only the end-of-archive blocks end a pack, so a stream that ends first fails, even at a block boundary.
  async readExactly(length: number): Promise<Uint8Array> {
    while (this.buffered.length < length && !this.isDone) {
      await this.fill();
    }
    if (this.buffered.length < length) {
      throw new PackFormatError(
        'the pack ends before its end-of-archive blocks',
      );
    }
    const bytes = this.buffered.slice(0, length);
    this.buffered = this.buffered.subarray(length);
    return bytes;
  }

  // The drain skips whatever the consumer did not pull.
  readStream(length: number): {
    drain: () => Promise<void>;
    stream: ReadableStream<Uint8Array>;
  } {
    const state = { remaining: length };
    // A zero high-water mark pulls only when the consumer reads, so no read-ahead races the drain.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: async controller => {
          if (state.remaining === 0) {
            controller.close();
            return;
          }
          const chunk = (await this.readUpTo(state.remaining)).slice();
          state.remaining -= chunk.length;
          controller.enqueue(chunk);
          if (state.remaining === 0) {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 },
    );
    const drain = async (): Promise<void> => {
      await this.skip(state.remaining);
      state.remaining = 0;
    };
    return { drain, stream };
  }

  // Cancelling an errored stream rejects with the error the iteration already throws, so ignore it.
  async release(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
  }

  // Holds at most one chunk at a time.
  async skip(length: number): Promise<void> {
    for (let remaining = length; remaining > 0;) {
      remaining -= (await this.readUpTo(remaining)).length;
    }
  }

  private async fill(): Promise<void> {
    const { done, value } = await this.reader.read();
    if (done) {
      this.isDone = true;
      return;
    }
    if (this.buffered.length === 0) {
      this.buffered = value;
      return;
    }
    // Only needed when a header block spans two chunks.
    const joined = new Uint8Array(this.buffered.length + value.length);
    joined.set(this.buffered, 0);
    joined.set(value, this.buffered.length);
    this.buffered = joined;
  }

  private async readUpTo(maxLength: number): Promise<Uint8Array> {
    while (this.buffered.length === 0 && !this.isDone) {
      await this.fill();
    }
    if (this.buffered.length === 0) {
      throw new PackFormatError('the pack ends inside an entry');
    }
    const bytes = this.buffered.subarray(
      0,
      Math.min(maxLength, this.buffered.length),
    );
    this.buffered = this.buffered.subarray(bytes.length);
    return bytes;
  }
}
