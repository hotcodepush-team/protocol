import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { computeSha256Hex } from '../hash/sha256.js';
import type { PackEntry } from './ustar.js';
import {
  buildPack,
  buildPackHeader,
  PackFormatError,
  readPack,
} from './ustar.js';

interface PackFixture {
  entries: { content: string; sha256: string }[];
  packBase64: string;
  packSha256: string;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('../../fixtures/packs.json', import.meta.url), 'utf8'),
) as PackFixture;

function bytesOf(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function streamOf(
  bytes: Uint8Array,
  chunkSize = bytes.length,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
}

function entryOf(bytes: Uint8Array, chunkSize?: number): PackEntry {
  return {
    body: streamOf(bytes, chunkSize),
    sha256: computeSha256Hex(bytes),
    sizeBytes: bytes.length,
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

  test('should refuse a body shorter than its size', async () => {
    const entry = { ...entryOf(bytesOf('hello')), sizeBytes: 6 };
    await expect(collect(buildPack([entry]))).rejects.toThrow(PackFormatError);
  });

  test('should refuse a body longer than its size', async () => {
    const entry = { ...entryOf(bytesOf('hello')), sizeBytes: 4 };
    await expect(collect(buildPack([entry]))).rejects.toThrow(PackFormatError);
  });

  test('should list with tar when the machine has it', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const path = join(
      mkdtempSync(join(tmpdir(), 'hotcodepush-pack-')),
      'bundle.pack',
    );
    writeFileSync(path, pack);
    let listing: string;
    try {
      listing = execFileSync('tar', ['-tvf', path], { encoding: 'utf8' });
    } catch {
      return;
    }
    const lines = listing.trim().split('\n');
    expect(lines).toHaveLength(3);
    CONTENTS.forEach((bytes, index) => {
      expect(lines[index]).toContain(computeSha256Hex(bytes));
      expect(lines[index]).toMatch(new RegExp(`\\s${bytes.length}\\s`));
    });
  });
});

describe('buildPackHeader', () => {
  test('should leave every field but name, size and checksum zero', () => {
    const header = buildPackHeader('a'.repeat(64), 5);
    expect(header.subarray(64, 124).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(136, 148).every(byte => byte === 0)).toBe(true);
    expect(header.subarray(156).every(byte => byte === 0)).toBe(true);
    expect(new TextDecoder().decode(header.subarray(124, 136))).toBe(
      '00000000005\0',
    );
  });

  test('should refuse a name that is not a sha256', () => {
    expect(() => buildPackHeader('index.js', 5)).toThrow(PackFormatError);
  });
});

describe('readPack', () => {
  test('should read back the entries the writer wrote', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    const read: { bytes: Uint8Array; sha256: string; sizeBytes: number }[] = [];
    for await (const entry of readPack(streamOf(pack, 100))) {
      read.push({
        bytes: await collect(entry.body),
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
      });
    }
    expect(read.map(entry => entry.sha256)).toEqual(
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
    const names: string[] = [];
    for await (const entry of readPack(streamOf(pack))) {
      names.push(entry.sha256);
    }
    expect(names).toHaveLength(3);
  });

  test('should verify each entry against its name', async () => {
    const pack = await collect(
      buildPack(CONTENTS.map(bytes => entryOf(bytes))),
    );
    for await (const entry of readPack(streamOf(pack))) {
      expect(computeSha256Hex(await collect(entry.body))).toBe(entry.sha256);
    }
  });

  test('should refuse a header whose checksum does not match', async () => {
    const pack = await collect(buildPack([entryOf(bytesOf('hello'))]));
    pack[0] = 0x62;
    await expect(async () => {
      for await (const entry of readPack(streamOf(pack))) {
        await collect(entry.body);
      }
    }).rejects.toThrow(PackFormatError);
  });

  test('should refuse a pack that ends inside an entry', async () => {
    const pack = await collect(buildPack([entryOf(bytesOf('hello'))]));
    await expect(async () => {
      for await (const entry of readPack(streamOf(pack.subarray(0, 514)))) {
        await collect(entry.body);
      }
    }).rejects.toThrow(PackFormatError);
  });

  test('should read an empty pack', async () => {
    const names: string[] = [];
    for await (const entry of readPack(
      streamOf(await collect(buildPack([]))),
    )) {
      names.push(entry.sha256);
    }
    expect(names).toEqual([]);
  });
});
