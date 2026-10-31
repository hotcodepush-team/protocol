import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Computes the SHA-256 of the bytes, or of a string's UTF-8 encoding. */
export function computeSha256(input: Uint8Array | string): Uint8Array {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return sha256(bytes);
}

/** Computes the SHA-256 as 64 lowercase hex characters, the hash form the protocol uses. */
export function computeSha256Hex(input: Uint8Array | string): string {
  return bytesToHex(computeSha256(input));
}
