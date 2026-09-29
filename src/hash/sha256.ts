const BLOCK_SIZE = 64;

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

/**
 * An incremental SHA-256, pure TypeScript so it runs synchronously everywhere
 * the protocol runs — Node, Workers and browsers alike — and so the evaluator
 * needs no async hashing for the attribute and device conditions.
 */
export class Sha256 {
  private readonly block = new Uint8Array(BLOCK_SIZE);
  private blockLength = 0;
  private readonly schedule = new Uint32Array(64);
  private readonly state = new Uint32Array(INITIAL_STATE);
  private totalLength = 0;

  digest(): Uint8Array {
    const bitLength = this.totalLength * 8;
    this.update(new Uint8Array([0x80]));
    while (this.blockLength !== BLOCK_SIZE - 8) {
      this.update(new Uint8Array([0]));
    }
    const lengthBytes = new Uint8Array(8);
    new DataView(lengthBytes.buffer).setBigUint64(0, BigInt(bitLength));
    this.update(lengthBytes);
    const digest = new Uint8Array(32);
    const view = new DataView(digest.buffer);
    this.state.forEach((word, index) => view.setUint32(index * 4, word));
    return digest;
  }

  update(bytes: Uint8Array): this {
    let offset = 0;
    while (offset < bytes.length) {
      const chunkLength = Math.min(
        BLOCK_SIZE - this.blockLength,
        bytes.length - offset,
      );
      this.block.set(
        bytes.subarray(offset, offset + chunkLength),
        this.blockLength,
      );
      this.blockLength += chunkLength;
      offset += chunkLength;
      if (this.blockLength === BLOCK_SIZE) {
        this.compressBlock();
        this.blockLength = 0;
      }
    }
    this.totalLength += bytes.length;
    return this;
  }

  private compressBlock(): void {
    const schedule = this.schedule;
    const view = new DataView(this.block.buffer);
    for (let index = 0; index < 16; index++) {
      schedule[index] = view.getUint32(index * 4);
    }
    for (let index = 16; index < 64; index++) {
      const w15 = schedule[index - 15] ?? 0;
      const w2 = schedule[index - 2] ?? 0;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      schedule[index] =
        ((schedule[index - 16] ?? 0) + s0 + (schedule[index - 7] ?? 0) + s1) >>>
        0;
    }
    const state = this.state;
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 =
        (h +
          s1 +
          choice +
          (ROUND_CONSTANTS[index] ?? 0) +
          (schedule[index] ?? 0)) >>>
        0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((word, index) => {
      state[index] = ((state[index] ?? 0) + word) >>> 0;
    });
  }
}

/** The SHA-256 of the bytes, or of the string's UTF-8 encoding. */
export function computeSha256(input: Uint8Array | string): Uint8Array {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return new Sha256().update(bytes).digest();
}

/** The SHA-256 as 64 lowercase hexadecimal characters, the protocol's hash form. */
export function computeSha256Hex(input: Uint8Array | string): string {
  return encodeHex(computeSha256(input));
}

export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
