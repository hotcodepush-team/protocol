// Writes fixtures/pack-entries.json. Run with `node scripts/generate-pack-entries-fixture.ts`.
// The two valid patches in pack-entries/ were made once with Colin Percival's bsdiff 4.3.
// When the contents below change, make new ones with `bsdiff base target base-to-target.bsdiff`.
// The hostile patch is crafted here, so it needs no diff tool.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { encodeBase64 } from '../src/base64.ts';
import type { PackEntry } from '../src/pack/ustar.ts';
import { buildPack, buildPackPatchHeader } from '../src/pack/ustar.ts';

interface FixtureFile {
  bytes: Uint8Array;
  name: string;
  sha256: string;
}

const CHECKSUM_FIELD_LENGTH = 8;
const CHECKSUM_FIELD_OFFSET = 148;
const END_BLOCKS_LENGTH = 1024;
// The first triple seeks 100000000 bytes back, so the second reads before the start of the base.
const HOSTILE_CONTROL_TRIPLES = [
  [100, 0, -100_000_000],
  [100, 0, 0],
];
const BSPATCH_PATH = '/usr/bin/bspatch';
const PREFIX_FIELD_LENGTH = 155;
const PREFIX_FIELD_OFFSET = 345;
const WORK_DIRECTORY = mkdtempSync(join(tmpdir(), 'hotcodepush-pack-entries-'));

const ASSET = buildFixtureFile(
  'asset',
  '{"title":"Release 2","subtitle":"Delivered as a delta"}\n',
);
const BASE = buildFixtureFile(
  'base',
  buildBundleSource('Hello from release 1', '1.0.0'),
);
const OTHER = buildFixtureFile(
  'other',
  buildBundleSource('Hello from another build', '9.9.9'),
);
const TARGET = buildFixtureFile(
  'target',
  buildBundleSource('Hello from release 2', '1.0.1'),
);

const IS_BSPATCH_AVAILABLE = existsSync(BSPATCH_PATH);
const PATCH = readVerifiedPatch(BASE, TARGET);
const PATCH_TO_OTHER = readVerifiedPatch(BASE, OTHER);
const TRUNCATED_PATCH = PATCH.subarray(0, Math.floor(PATCH.length / 2));
if (IS_BSPATCH_AVAILABLE) {
  assertRefusedByBspatch(BASE, TRUNCATED_PATCH);
}
const HOSTILE_PATCH = buildHostilePatch();

const FILE_ENTRY_BODY = gzipSync(ASSET.bytes);
const SKIPPED_ENTRY_BODY = new Uint8Array(600).map((_, index) => index % 251);
const SKIPPED_ENTRY_PREFIX = `future/${BASE.sha256}`;

const delta = await collect(buildPack([buildFileEntry(), buildPatchEntry()]));
const fileEntryPack = await collect(buildPack([buildFileEntry()]));
const skippedEntryPack = concatenate([
  fileEntryPack.subarray(0, fileEntryPack.length - END_BLOCKS_LENGTH),
  buildSkippedEntryHeader(SKIPPED_ENTRY_BODY.length),
  SKIPPED_ENTRY_BODY,
  new Uint8Array(resolvePadding(SKIPPED_ENTRY_BODY.length)),
  await collect(buildPack([buildPatchEntry()])),
]);
const targetInManifest = [
  {
    path: 'index.bundle',
    sha256: TARGET.sha256,
    sizeBytes: TARGET.bytes.length,
  },
];
const patchEntry = {
  bodyBase64: encodeBase64(PATCH),
  fromSha256: BASE.sha256,
  toSha256: TARGET.sha256,
};
const entries = [
  {
    bodyBase64: encodeBase64(FILE_ENTRY_BODY),
    sha256: ASSET.sha256,
    type: 'file',
  },
  { ...patchEntry, type: 'patch' },
];

const fixture = {
  description:
    "The entry kinds of a pack and what a device does with a patch entry. A file entry is a file's stored object, the gzip the bucket serves, named by the content hash. A patch entry is named patches/{from}/{to} — patches/{from} in the ustar prefix field, {to} in the name field, the ustar magic and version set — and its body is a BSDIFF40 patch that turns the bytes of the file from into those of the file to. A reader composes prefix/name when the prefix is not empty and skips, with its body, an entry named neither by a content hash nor patches/{hash}/{hash}. files are the contents the cases name by sha256. delta is a pack of a file entry and a patch entry as the writer produces it. skippedEntryPack holds a file entry, an entry named skippedName, and a patch entry; a reader yields the two entries. patchCases are a patch entry, the files the device holds (its file store and embedded bundle) and the files of the signed manifest it downloads, with the outcome: applied, the patched bytes hashing to toSha256; fallback, the device fetching the file toSha256 as it fetches any file the pack did not bring; ignored, when toSha256 is not a file of the manifest.",
  files: [ASSET, BASE, OTHER, TARGET].map(file => ({
    contentBase64: encodeBase64(file.bytes),
    name: file.name,
    sha256: file.sha256,
  })),
  delta: {
    entries,
    packBase64: encodeBase64(delta),
    packSha256: computeSha256Hex(delta),
  },
  skippedEntryPack: {
    entries,
    packBase64: encodeBase64(skippedEntryPack),
    skippedName: `${SKIPPED_ENTRY_PREFIX}/${TARGET.sha256}`,
  },
  patchCases: [
    {
      name: 'should apply a patch to the base the device holds',
      heldSha256s: [BASE.sha256],
      manifestFiles: targetInManifest,
      patchEntry,
      outcome: 'applied',
    },
    {
      name: 'should fetch the file when the device does not hold the base',
      heldSha256s: [],
      manifestFiles: targetInManifest,
      patchEntry,
      outcome: 'fallback',
    },
    {
      name: 'should fetch the file when the patch is truncated',
      heldSha256s: [BASE.sha256],
      manifestFiles: targetInManifest,
      patchEntry: { ...patchEntry, bodyBase64: encodeBase64(TRUNCATED_PATCH) },
      outcome: 'fallback',
    },
    {
      name: 'should fetch the file when the patched bytes hash to another file',
      heldSha256s: [BASE.sha256],
      manifestFiles: targetInManifest,
      patchEntry: { ...patchEntry, bodyBase64: encodeBase64(PATCH_TO_OTHER) },
      outcome: 'fallback',
    },
    {
      name: 'should fetch the file when the patch seeks before the start of the base',
      heldSha256s: [BASE.sha256],
      manifestFiles: targetInManifest,
      patchEntry: { ...patchEntry, bodyBase64: encodeBase64(HOSTILE_PATCH) },
      outcome: 'fallback',
    },
    {
      name: 'should ignore a patch to a file the manifest does not list',
      heldSha256s: [BASE.sha256],
      manifestFiles: [
        {
          path: 'index.bundle',
          sha256: OTHER.sha256,
          sizeBytes: OTHER.bytes.length,
        },
      ],
      patchEntry,
      outcome: 'ignored',
    },
  ],
};

writeFileSync(
  new URL('../fixtures/pack-entries.json', import.meta.url),
  `${JSON.stringify(fixture, null, 2)}\n`,
);

function buildBundleSource(greeting: string, version: string): string {
  return [
    'var __BUNDLE_START_TIME__=Date.now();',
    `__d(function(g,r,i,a,m,e,d){m.exports={greeting:${JSON.stringify(greeting)},version:${JSON.stringify(version)}}},0,[]);`,
    '__d(function(g,r,i,a,m,e,d){var s=r(0);console.log(s.greeting+" ("+s.version+")")},1,[0]);',
    '__r(1);',
    '',
  ].join('\n');
}

function buildFileEntry(): PackEntry {
  return {
    body: streamOf(FILE_ENTRY_BODY),
    sha256: ASSET.sha256,
    sizeBytes: FILE_ENTRY_BODY.length,
    type: 'file',
  };
}

function buildFixtureFile(name: string, content: string): FixtureFile {
  const bytes = new TextEncoder().encode(content);
  return { bytes, name, sha256: computeSha256Hex(bytes) };
}

function buildPatchEntry(): PackEntry {
  return {
    body: streamOf(PATCH),
    fromSha256: BASE.sha256,
    sizeBytes: PATCH.length,
    toSha256: TARGET.sha256,
    type: 'patch',
  };
}

// Stands in for an entry kind a later version may add.
function buildSkippedEntryHeader(sizeBytes: number): Uint8Array {
  const header = buildPackPatchHeader(BASE.sha256, TARGET.sha256, sizeBytes);
  header.fill(
    0,
    PREFIX_FIELD_OFFSET,
    PREFIX_FIELD_OFFSET + PREFIX_FIELD_LENGTH,
  );
  header.set(
    new TextEncoder().encode(SKIPPED_ENTRY_PREFIX),
    PREFIX_FIELD_OFFSET,
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

// A bspatch that trusts the seek in this patch reads out of bounds.
// Layout: `BSDIFF40`, the control and diff block lengths, the new size, then three bzip2 blocks.
function buildHostilePatch(): Uint8Array {
  const newSizeBytes = HOSTILE_CONTROL_TRIPLES.reduce(
    (sum, [diffLength = 0, extraLength = 0]) => sum + diffLength + extraLength,
    0,
  );
  const [control, diff, extra] = [
    concatenate(HOSTILE_CONTROL_TRIPLES.flat().map(encodeSignMagnitude)),
    new Uint8Array(newSizeBytes),
    new Uint8Array(0),
  ].map(compressWithBzip2);
  if (control === undefined || diff === undefined || extra === undefined) {
    throw new Error('bzip2 did not compress the three blocks');
  }
  return concatenate([
    new TextEncoder().encode('BSDIFF40'),
    encodeSignMagnitude(control.length),
    encodeSignMagnitude(diff.length),
    encodeSignMagnitude(newSizeBytes),
    control,
    diff,
    extra,
  ]);
}

function compressWithBzip2(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(
    execFileSync('/usr/bin/bzip2', ['-c'], { input: bytes }),
  );
}

// bsdiff stores the magnitude little-endian in 8 bytes and the sign in the top bit.
function encodeSignMagnitude(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const signBit = value < 0 ? 1n << 63n : 0n;
  new DataView(bytes.buffer).setBigUint64(
    0,
    BigInt(Math.abs(value)) | signBit,
    true,
  );
  return bytes;
}

function readVerifiedPatch(from: FixtureFile, to: FixtureFile): Uint8Array {
  const patchPath = fileURLToPath(
    new URL(`pack-entries/${from.name}-to-${to.name}.bsdiff`, import.meta.url),
  );
  const patch = new Uint8Array(readFileSync(patchPath));
  if (new TextDecoder().decode(patch.subarray(0, 8)) !== 'BSDIFF40') {
    throw new Error(`${patchPath} is not a BSDIFF40 patch`);
  }
  if (IS_BSPATCH_AVAILABLE) {
    const fromPath = writeWorkFile(`${from.name}.bin`, from.bytes);
    const patchedPath = join(WORK_DIRECTORY, `${from.name}-${to.name}.patched`);
    execFileSync(BSPATCH_PATH, [fromPath, patchedPath, patchPath]);
    if (computeSha256Hex(readFileSync(patchedPath)) !== to.sha256) {
      throw new Error(`bspatch does not turn ${from.name} into ${to.name}`);
    }
  }
  return patch;
}

function assertRefusedByBspatch(from: FixtureFile, patch: Uint8Array): void {
  const fromPath = writeWorkFile(`${from.name}.bin`, from.bytes);
  const patchPath = writeWorkFile('refused.bsdiff', patch);
  try {
    execFileSync(
      BSPATCH_PATH,
      [fromPath, join(WORK_DIRECTORY, 'refused.patched'), patchPath],
      {
        stdio: 'ignore',
      },
    );
  } catch {
    return;
  }
  throw new Error('bspatch applies the patch meant to be refused');
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return concatenate(chunks);
}

function computeSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

function resolvePadding(sizeBytes: number): number {
  return (512 - (sizeBytes % 512)) % 512;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function writeWorkFile(name: string, bytes: Uint8Array): string {
  const path = join(WORK_DIRECTORY, name);
  writeFileSync(path, bytes);
  return path;
}
