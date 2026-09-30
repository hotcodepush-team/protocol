import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { computeSha256Hex } from './sha256.js';

async function computeReferenceHex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return bytesToHex(
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

  test('should hash the 56-byte two-block message to the known digest', () => {
    expect(
      computeSha256Hex(
        'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
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
