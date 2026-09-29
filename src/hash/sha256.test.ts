import { describe, expect, test } from 'vitest';

import { Sha256, computeSha256Hex, encodeHex } from './sha256.js';

async function computeReferenceHex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return encodeHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  );
}

describe('computeSha256Hex', () => {
  test('should hash the empty input to the known digest', () => {
    expect(computeSha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('should hash a string as its utf-8 bytes', () => {
    expect(computeSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test.each([1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4097])(
    'should match WebCrypto for %i bytes',
    async length => {
      const bytes = new Uint8Array(length).map(
        (_, index) => (index * 31 + 7) % 256,
      );
      expect(computeSha256Hex(bytes)).toBe(await computeReferenceHex(bytes));
    },
  );
});

describe('Sha256', () => {
  test('should produce the same digest when the input is split across updates', async () => {
    const bytes = new Uint8Array(300).map((_, index) => (index * 13) % 256);
    const hash = new Sha256();
    hash.update(bytes.subarray(0, 10));
    hash.update(bytes.subarray(10, 70));
    hash.update(bytes.subarray(70));
    expect(encodeHex(hash.digest())).toBe(await computeReferenceHex(bytes));
  });
});
