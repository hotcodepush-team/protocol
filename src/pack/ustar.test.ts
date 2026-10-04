import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { computeSha256Hex } from '../hash/sha256.js';
import type { PackEntry, PackFileEntry } from './ustar.js';
import {
  buildPack,
  buildPackFileHeader,
  buildPackPatchHeader,
  PackFormatError,
  readPack,
} from './ustar.js';

interface PackFixture {
  entries: { content: string; sha256: string }[];
  packBase64: string;
  packSha256: string;
  refusedPacks: { name: string; packBase64: string }[];
}

type FixtureEntry =
  | { bodyBase64: string; sha256: string; type: 'file' }
  | { bodyBase64: string; fromSha256: string; toSha256: string; type: 'patch' };

interface PackEntriesFixture {
  deltaPack: {
    entries: FixtureEntry[];
    packBase64: string;
    packSha256: string;
  };
  skippedEntryPack: { entries: FixtureEntry[]; packBase64: string };
}

const FIXTURE = readFixture<PackFixture>('packs.json');
const ENTRIES_FIXTURE = readFixture<PackEntriesFixture>('pack-entries.json');
const IS_TAR_AVAILABLE = isCommandAvailable('tar', ['--version']);
const FROM_SHA256 = 'a'.repeat(64);
const TO_SHA256 = 'b'.repeat(64);

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

function isCommandAvailable(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** The name `tar` lists for an entry. */
function resolveEntryName(entry: FixtureEntry | PackEntry): string {
  return entry.type === 'file'
    ? entry.sha256
    : `patches/${entry.fromSha256}/${entry.toSha256}`;
}

function entryOfFixture(entry: FixtureEntry): PackEntry {
  const body = decodeBase64(entry.bodyBase64);
  return entry.type === 'file'
    ? { ...entryOf(body), sha256: entry.sha256 }
    : {
        body: streamOf(body),
        fromSha256: entry.fromSha256,
        sizeBytes: body.length,
        toSha256: entry.toSha256,
        type: 'patch',
      };
}

function patchEntryOf(bytes: Uint8Array): PackEntry {
  return {
    body: streamOf(bytes),
    fromSha256: FROM_SHA256,
    sizeBytes: bytes.length,
    toSha256: TO_SHA256,
    type: 'patch',
  };
}

function writeTemporaryPack(pack: Uint8Array): string {
  const path = join(
    mkdtempSync(join(tmpdir(), 'hotcodepush-pack-')),
    'bundle.pack',
  );
  writeFileSync(path, pack);
  return path;
}

function bytesOf(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function streamOf(
  bytes: Uint8Array,
  chunkSize = bytes.length,
): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return streamOfChunks(chunks);
}

function streamOfChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    },
  });
}

/** A stream that stays open after its bytes, recording whether it was cancelled. */
function openStreamOf(bytes: Uint8Array): {
  isCancelled: boolean;
  stream: ReadableStream<Uint8Array>;
} {
  const opened = {
    isCancelled: false,
    stream: new ReadableStream<Uint8Array>({
      cancel() {
        opened.isCancelled = true;
      },
      start(controller) {
        controller.enqueue(bytes);
      },
    }),
  };
  return opened;
}

function entryOf(bytes: Uint8Array, chunkSize?: number): PackFileEntry {
  return {
    body: streamOf(bytes, chunkSize),
    sha256: computeSha256Hex(bytes),
    sizeBytes: bytes.length,
    type: 'file',
  };
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const joined = new Uint8Array(
    chunks.reduce((length, chunk) => length + chunk.length, 0),
  );
  chunks.reduce((offset, chunk) => {
    joined.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  return joined;
}

async function readContents(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array[]> {
  const contents: Uint8Array[] = [];
  for await (const entry of readPack(stream)) {
    contents.push(await collect(entry.body));
  }
  return contents;
}

async function readNames(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of readPack(stream)) {
    names.push(resolveEntryName(entry));
  }
  return names;
}

const CONTENTS = [
  new Uint8Array(0),
  bytesOf('hello'),
  new Uint8Array(1000).map((_, index) => index % 251),
];

describe('buildPack', () => {
  test('should write one header per entry, the bodies padded to blocks, and two end blocks', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    expect(pack.length).toBe(512 + 512 + 512 + 512 + 1024 + 1024);
    expect(pack.subarray(pack.length - 1024).every(byte => byte === 0)).toBe(
      true,
    );
  });

  test('should write identical bytes on every assembly, whatever the chunking', async () => {
    const first = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const second = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes, 7))),
    );
    expect(second).toEqual(first);
  });

  test('should reproduce the pinned fixture byte for byte', async () => {
    const entries = FIXTURE.entries.map(entry =>
      entryOf(bytesOf(entry.content)),
    );
    const pack = await collect(buildPack(entries));
    expect(Buffer.from(pack).toString('base64')).toBe(FIXTURE.packBase64);
    expect(computeSha256Hex(pack)).toBe(FIXTURE.packSha256);
  });

  test('should write a fresh end-of-archive buffer for every pack', async () => {
    const { value } = await buildPack([]).getReader().read();
    value?.fill(1);
    expect(await collect(buildPack([]))).toEqual(new Uint8Array(1024));
  });

  test('should refuse a body shorter than its size', async () => {
    const entry = { ...entryOf(bytesOf('hello')), sizeBytes: 6 };
    await expect(collect(buildPack([entry]))).rejects.toThrow(PackFormatError);
  });

  test('should refuse a body longer than its size', async () => {
    const entry = { ...entryOf(bytesOf('hello')), sizeBytes: 4 };
    await expect(collect(buildPack([entry]))).rejects.toThrow(PackFormatError);
  });

  test.runIf(IS_TAR_AVAILABLE)('should list with tar', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const listing = execFileSync('tar', ['-tvf', writeTemporaryPack(pack)], {
      encoding: 'utf8',
    });
    const lines = listing.trim().split('\n');
    expect(lines).toHaveLength(3);
    CONTENTS.forEach((bytes, index) => {
      expect(lines[index]).toContain(computeSha256Hex(bytes));
      expect(lines[index]).toMatch(new RegExp(`\\s${bytes.length}\\s`));
    });
  });

  test('should write a file entry and a patch entry that read back alike', async () => {
    const patch = bytesOf('BSDIFF40');
    const pack = await collect(
      buildPack([entryOf(bytesOf('hello')), patchEntryOf(patch)]),
    );
    const read: (Omit<PackEntry, 'body'> & { bytes: Uint8Array })[] = [];
    for await (const { body, ...entry } of readPack(streamOf(pack, 100))) {
      read.push({ ...entry, bytes: await collect(body) });
    }
    expect(read).toEqual([
      {
        bytes: bytesOf('hello'),
        sha256: computeSha256Hex(bytesOf('hello')),
        sizeBytes: 5,
        type: 'file',
      },
      {
        bytes: patch,
        fromSha256: FROM_SHA256,
        sizeBytes: patch.length,
        toSha256: TO_SHA256,
        type: 'patch',
      },
    ]);
  });

  test('should reproduce the pinned delta pack byte for byte', async () => {
    const pack = await collect(
      buildPack(ENTRIES_FIXTURE.deltaPack.entries.map(entryOfFixture)),
    );
    expect(Buffer.from(pack).toString('base64')).toBe(
      ENTRIES_FIXTURE.deltaPack.packBase64,
    );
    expect(computeSha256Hex(pack)).toBe(ENTRIES_FIXTURE.deltaPack.packSha256);
  });

  test('should refuse a patch entry whose body is longer than its size', async () => {
    const entry = { ...patchEntryOf(bytesOf('hello')), sizeBytes: 4 };
    await expect(collect(buildPack([entry]))).rejects.toThrow(
      `the entry patches/${FROM_SHA256}/${TO_SHA256} is longer than its 4 bytes`,
    );
  });

  test.runIf(IS_TAR_AVAILABLE)(
    'should list the pinned delta pack with tar, the patch entry under its full name',
    () => {
      const path = writeTemporaryPack(
        decodeBase64(ENTRIES_FIXTURE.deltaPack.packBase64),
      );
      const listing = execFileSync('tar', ['-tf', path], { encoding: 'utf8' });
      expect(listing.trim().split('\n')).toEqual(
        ENTRIES_FIXTURE.deltaPack.entries.map(resolveEntryName),
      );
    },
  );
});

describe('buildPackFileHeader', () => {
  test('should leave every field but name, size and checksum zero', () => {
    const header = buildPackFileHeader('a'.repeat(64), 5);
    expect(header.subarray(64, 124).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(136, 148).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(156).every(byte => byte === 0)).toBe(true);
    expect(new TextDecoder().decode(header.subarray(124, 136))).toBe(
      '00000000005\0',
    );
  });

  test('should refuse a name that is not a sha256', () => {
    expect(() => buildPackFileHeader('index.js', 5)).toThrow(PackFormatError);
  });
});

describe('buildPackPatchHeader', () => {
  test('should write the from hash in the prefix, the to hash as the name and the ustar magic, every other field but size and checksum zero', () => {
    const header = buildPackPatchHeader(FROM_SHA256, TO_SHA256, 5);
    const decode = (start: number, end: number): string =>
      new TextDecoder().decode(header.subarray(start, end));
    expect(decode(0, 100)).toBe(TO_SHA256.padEnd(100, '\0'));
    expect(decode(124, 136)).toBe('00000000005\0');
    expect(decode(257, 265)).toBe('ustar\x0000');
    expect(decode(345, 500)).toBe(`patches/${FROM_SHA256}`.padEnd(155, '\0'));
    expect(header.subarray(100, 124).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(136, 148).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(156, 257).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(265, 345).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(500).every(byte => byte === 0)).toBe(true);
  });

  test.each([
    ['from', 'index.js', TO_SHA256],
    ['to', FROM_SHA256, 'index.js'],
  ])(
    'should refuse a %s that is not a sha256',
    (_side, fromSha256, toSha256) => {
      expect(() => buildPackPatchHeader(fromSha256, toSha256, 5)).toThrow(
        PackFormatError,
      );
    },
  );
});

describe('readPack', () => {
  test('should read back the entries the writer wrote', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const read: { bytes: Uint8Array; name: string; sizeBytes: number }[] = [];
    for await (const entry of readPack(streamOf(pack, 100))) {
      read.push({
        bytes: await collect(entry.body),
        name: resolveEntryName(entry),
        sizeBytes: entry.sizeBytes,
      });
    }
    expect(read.map(entry => entry.name)).toEqual(
      CONTENTS.map(bytes => computeSha256Hex(bytes)),
    );
    expect(read.map(entry => entry.sizeBytes)).toEqual(
      CONTENTS.map(bytes => bytes.length),
    );
    read.forEach((entry, index) =>
      expect(entry.bytes).toEqual(CONTENTS[index]),
    );
  });

  test('should read the pinned fixture', async () => {
    const pack = new Uint8Array(Buffer.from(FIXTURE.packBase64, 'base64'));
    const contents: string[] = [];
    for await (const entry of readPack(streamOf(pack, 33))) {
      contents.push(new TextDecoder().decode(await collect(entry.body)));
    }
    expect(contents).toEqual(FIXTURE.entries.map(entry => entry.content));
  });

  test('should drain a body the consumer did not read', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    expect(await readNames(streamOf(pack))).toHaveLength(3);
  });

  test('should drain an unread entry that arrives in several chunks', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    expect(await readNames(streamOf(pack, 512))).toEqual(
      CONTENTS.map(bytes => computeSha256Hex(bytes)),
    );
  });

  test(
    'should drain an unread entry of 64 MiB within a second',
    { timeout: 1000 },
    async () => {
      const chunk = new Uint8Array(64 * 1024);
      const chunkCount = 1024;
      const chunks = [
        buildPackFileHeader('a'.repeat(64), chunk.length * chunkCount),
        ...Array.from({ length: chunkCount }, () => chunk),
        new Uint8Array(1024),
      ];
      expect(await readNames(streamOfChunks(chunks))).toEqual(['a'.repeat(64)]);
    },
  );

  test('should verify each entry against its name', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    for await (const entry of readPack(streamOf(pack))) {
      expect(computeSha256Hex(await collect(entry.body))).toBe(
        resolveEntryName(entry),
      );
    }
  });

  test.each(
    FIXTURE.refusedPacks.map(refusedPack => [refusedPack.name, refusedPack]),
  )('%s', async (_name, refusedPack) => {
    const pack = new Uint8Array(Buffer.from(refusedPack.packBase64, 'base64'));
    await expect(readContents(streamOf(pack, 100))).rejects.toThrow(
      PackFormatError,
    );
  });

  test('should read past a zero-length chunk inside an entry', async () => {
    const pack = await collect(buildPack([entryOf(bytesOf('hello'))]));
    const stream = streamOfChunks([
      pack.subarray(0, 512),
      new Uint8Array(0),
      pack.subarray(512),
    ]);
    expect(await readContents(stream)).toEqual([bytesOf('hello')]);
  });

  test('should cancel the source and release it when the consumer leaves early', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const opened = openStreamOf(pack);
    const names: string[] = [];
    for await (const entry of readPack(opened.stream)) {
      names.push(resolveEntryName(entry));
      break;
    }
    expect(names).toHaveLength(1);
    expect(opened.isCancelled).toBe(true);
    expect(opened.stream.locked).toBe(false);
  });

  test('should cancel the source and release it when the pack is refused', async () => {
    const pack = await collect(buildPack([entryOf(bytesOf('hello'))]));
    pack[0] = 0x62;
    const opened = openStreamOf(pack);
    await expect(readContents(opened.stream)).rejects.toThrow(PackFormatError);
    expect(opened.isCancelled).toBe(true);
    expect(opened.stream.locked).toBe(false);
  });

  test('should release the source when the pack ends', async () => {
    const stream = streamOf(
      await collect(buildPack([entryOf(bytesOf('hello'))])),
    );
    await readContents(stream);
    expect(stream.locked).toBe(false);
  });

  test('should read an empty pack', async () => {
    expect(await readNames(streamOf(await collect(buildPack([]))))).toEqual([]);
  });

  test('should read the pinned delta pack', async () => {
    const pack = decodeBase64(ENTRIES_FIXTURE.deltaPack.packBase64);
    const read: { bodyBase64: string; name: string }[] = [];
    for await (const entry of readPack(streamOf(pack, 33))) {
      read.push({
        bodyBase64: Buffer.from(await collect(entry.body)).toString('base64'),
        name: resolveEntryName(entry),
      });
    }
    expect(read).toEqual(
      ENTRIES_FIXTURE.deltaPack.entries.map(entry => ({
        bodyBase64: entry.bodyBase64,
        name: resolveEntryName(entry),
      })),
    );
  });

  test('should skip an entry of an unknown name with its body and read the entries around it', async () => {
    const pack = decodeBase64(ENTRIES_FIXTURE.skippedEntryPack.packBase64);
    const read: { bodyBase64: string; name: string }[] = [];
    for await (const entry of readPack(streamOf(pack, 100))) {
      read.push({
        bodyBase64: Buffer.from(await collect(entry.body)).toString('base64'),
        name: resolveEntryName(entry),
      });
    }
    expect(read).toEqual(
      ENTRIES_FIXTURE.skippedEntryPack.entries.map(entry => ({
        bodyBase64: entry.bodyBase64,
        name: resolveEntryName(entry),
      })),
    );
  });

  test('should refuse a pack cut inside an entry it skips', async () => {
    const pack = decodeBase64(ENTRIES_FIXTURE.skippedEntryPack.packBase64);
    await expect(
      readContents(streamOf(pack.subarray(0, 512 + 512 + 512 + 300))),
    ).rejects.toThrow(PackFormatError);
  });
});
