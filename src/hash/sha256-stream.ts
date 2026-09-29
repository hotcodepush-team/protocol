import { Sha256, encodeHex } from './sha256.js';

/** A pass-through whose `digest` resolves with the SHA-256 hex of every byte that flowed through. */
export class Sha256TransformStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  readonly digest: Promise<string>;

  constructor() {
    const hash = new Sha256();
    let resolveDigest: (digest: string) => void = () => undefined;
    const digest = new Promise<string>(resolve => {
      resolveDigest = resolve;
    });
    super({
      flush() {
        resolveDigest(encodeHex(hash.digest()));
      },
      transform(chunk, controller) {
        hash.update(chunk);
        controller.enqueue(chunk);
      },
    });
    this.digest = digest;
  }
}

/** The SHA-256 hex of a stream, consumed to its end. */
export async function computeSha256HexOfStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const hash = new Sha256();
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return encodeHex(hash.digest());
}
