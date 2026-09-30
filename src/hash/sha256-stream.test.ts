import { describe, expect, test } from 'vitest';

import {
  Sha256TransformStream,
  computeSha256HexOfStream,
} from './sha256-stream.js';
import { computeSha256Hex } from './sha256.js';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    },
  });
}

const BYTES = new Uint8Array(1500).map((_, index) => (index * 7) % 256);

describe('computeSha256HexOfStream', () => {
  test('should hash a chunked stream like the whole buffer', async () => {
    const stream = streamOf([
      BYTES.subarray(0, 100),
      BYTES.subarray(100, 1000),
      BYTES.subarray(1000),
    ]);
    expect(await computeSha256HexOfStream(stream)).toBe(
      computeSha256Hex(BYTES),
    );
  });

  test.each([55, 56, 63, 64, 65])(
    'should hash %i bytes split into one-byte chunks like the whole buffer',
    async length => {
      const bytes = BYTES.subarray(0, length);
      const chunks = Array.from(bytes, byte => Uint8Array.of(byte));
      expect(await computeSha256HexOfStream(streamOf(chunks))).toBe(
        computeSha256Hex(bytes),
      );
    },
  );

  test('should hash an empty stream', async () => {
    expect(await computeSha256HexOfStream(streamOf([]))).toBe(
      computeSha256Hex(new Uint8Array()),
    );
  });
});

describe('Sha256TransformStream', () => {
  test('should pass every byte through and resolve the digest at the end', async () => {
    const transform = new Sha256TransformStream();
    const output = streamOf([
      BYTES.subarray(0, 700),
      BYTES.subarray(700),
    ]).pipeThrough(transform);
    const received: number[] = [];
    for await (const chunk of output) {
      received.push(...chunk);
    }
    expect(new Uint8Array(received)).toEqual(BYTES);
    expect(await transform.digest).toBe(computeSha256Hex(BYTES));
  });
});
