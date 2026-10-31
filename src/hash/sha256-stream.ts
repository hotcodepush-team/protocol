import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Passes bytes through unchanged. `digest` resolves with the SHA-256 hex of all of them at the end. */
export class Sha256TransformStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  readonly digest: Promise<string>;

  constructor() {
    const hash = sha256.create();
    let resolveDigest: (digest: string) => void = () => undefined;
    const digest = new Promise<string>(resolve => {
      resolveDigest = resolve;
    });
    super({
      flush() {
        resolveDigest(bytesToHex(hash.digest()));
      },
      transform(chunk, controller) {
        hash.update(chunk);
        controller.enqueue(chunk);
      },
    });
    this.digest = digest;
  }
}

/** Computes the SHA-256 hex of a stream, reading it to the end. */
export async function computeSha256HexOfStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const hash = sha256.create();
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return bytesToHex(hash.digest());
}
