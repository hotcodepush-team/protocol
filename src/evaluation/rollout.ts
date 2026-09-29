const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The rollout bucket of a device for a release: FNV-1a over the UTF-8 bytes of
 * the device id followed by the release id, 32 bits, into a hundred buckets.
 * A device takes a release when its bucket is below the rollout percentage.
 */
export function resolveRolloutBucket(
  deviceId: string,
  releaseId: string,
): number {
  const bytes = new TextEncoder().encode(`${deviceId}${releaseId}`);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash % 100;
}
