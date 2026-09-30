/**
 * The pack: an uncompressed ustar archive whose entries are the requested
 * files' stored objects, named by their content hash, every header field but
 * name and size zero and the checksum computed, so the bytes are identical on
 * every assembly and `tar -tvf` lists a pack in a support case. The CLI writes
 * packs, the edge Worker writes them on demand, each core reads them.
 */

export interface PackEntry {
  body: ReadableStream<Uint8Array>;
  sha256: string;
  sizeBytes: number;
}

export class PackFormatError extends Error {
  override readonly name = 'PackFormatError';
}

const BLOCK_SIZE = 512;
const CHECKSUM_FIELD_OFFSET = 148;
const CHECKSUM_FIELD_LENGTH = 8;
const NAME_FIELD_LENGTH = 100;
const SIZE_FIELD_OFFSET = 124;
const SIZE_FIELD_LENGTH = 12;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The pack as a stream, from entries whose bodies are read one after the other. */
export function buildPack(
  entries: AsyncIterable<PackEntry> | Iterable<PackEntry>,
): ReadableStream<Uint8Array> {
  return readableStreamFromAsyncIterable(generatePackChunks(entries));
}

/** The entries of a pack, in order, refusing a pack cut before its two end-of-archive blocks; an entry's body must be consumed, or is drained, before the next one, and the stream is cancelled and released however the iteration ends. */
export function readPack(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<PackEntry> {
  return generatePackEntries(new ByteReader(stream));
}

export function buildPackHeader(sha256: string, sizeBytes: number): Uint8Array {
  if (!HASH_PATTERN.test(sha256)) {
    throw new PackFormatError(
      `a pack entry is named by its sha256, not ${JSON.stringify(sha256)}`,
    );
  }
  if (
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > 0o77777777777
  ) {
    throw new PackFormatError(
      `a pack entry size must fit the ustar size field, not ${sizeBytes}`,
    );
  }
  const header = new Uint8Array(BLOCK_SIZE);
  header.set(new TextEncoder().encode(sha256), 0);
  header.set(
    new TextEncoder().encode(`${sizeBytes.toString(8).padStart(11, '0')}\0`),
    SIZE_FIELD_OFFSET,
  );
  header.fill(
    0x20,
    CHECKSUM_FIELD_OFFSET,
    CHECKSUM_FIELD_OFFSET + CHECKSUM_FIELD_LENGTH,
  );
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.set(
    new TextEncoder().encode(`${checksum.toString(8).padStart(6, '0')}\0 `),
    CHECKSUM_FIELD_OFFSET,
  );
  return header;
}

function resolvePadding(sizeBytes: number): number {
  return (BLOCK_SIZE - (sizeBytes % BLOCK_SIZE)) % BLOCK_SIZE;
}

async function* generatePackChunks(
  entries: AsyncIterable<PackEntry> | Iterable<PackEntry>,
): AsyncGenerator<Uint8Array> {
  for await (const entry of entries) {
    yield buildPackHeader(entry.sha256, entry.sizeBytes);
    let written = 0;
    for await (const chunk of entry.body) {
      written += chunk.length;
      if (written > entry.sizeBytes) {
        throw new PackFormatError(
          `the entry ${entry.sha256} is longer than its ${entry.sizeBytes} bytes`,
        );
      }
      yield chunk;
    }
    if (written !== entry.sizeBytes) {
      throw new PackFormatError(
        `the entry ${entry.sha256} holds ${written} of its ${entry.sizeBytes} bytes`,
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
      const { sha256, sizeBytes } = parsePackHeader(header);
      const entry = reader.readStream(sizeBytes);
      yield { body: entry.stream, sha256, sizeBytes };
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
  sha256: string;
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
  const sha256 = readField(header.subarray(0, NAME_FIELD_LENGTH));
  if (!HASH_PATTERN.test(sha256)) {
    throw new PackFormatError(
      `a pack entry is named by its sha256, not ${JSON.stringify(sha256)}`,
    );
  }
  const sizeBytes = Number.parseInt(
    readField(
      header.subarray(SIZE_FIELD_OFFSET, SIZE_FIELD_OFFSET + SIZE_FIELD_LENGTH),
    ),
    8,
  );
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new PackFormatError('a pack header size is not octal');
  }
  return { sha256, sizeBytes };
}

/** The field's text up to its first NUL or space, the ustar convention. */
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

/** A reader over a byte stream that hands out exact byte counts and bounded sub-streams. */
class ByteReader {
  private buffered: Uint8Array = new Uint8Array(0);
  private isDone = false;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  /** Exactly `length` bytes; an error when the stream ends first, a block boundary included, since only the end-of-archive blocks end a pack. */
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

  /** A stream over the next `length` bytes, drawn from this reader as it is pulled, and the drain that skips what was not pulled. */
  readStream(length: number): {
    drain: () => Promise<void>;
    stream: ReadableStream<Uint8Array>;
  } {
    const state = { remaining: length };
    // A zero high-water mark pulls only for a consumer's read, so no pull ahead races the drain for the same bytes.
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

  /** Cancels what is left of the stream and releases its lock; cancelling a stream that errored rejects with the error the iteration already throws. */
  async release(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
  }

  /** Discards the next `length` bytes chunk by chunk, never holding more than one chunk. */
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
    // Joined only when a header block spans two chunks.
    const joined = new Uint8Array(this.buffered.length + value.length);
    joined.set(this.buffered, 0);
    joined.set(value, this.buffered.length);
    this.buffered = joined;
  }

  /** The next buffered bytes, at most `maxLength`, read past zero-length chunks; an error when the stream ends first. */
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
