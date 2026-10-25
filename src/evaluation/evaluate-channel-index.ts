import type { ConditionType, SkippedReason } from '../results.js';
import type { ChannelIndex, IndexRelease } from '../wire/channel-index.js';
import type { ConditionVerdict } from './conditions.js';
import { isKnownConditionType, resolveConditionVerdict } from './conditions.js';
import type { DeviceInfo } from './device-info.js';
import { resolveRolloutBucket } from './rollout.js';

/** The per-release verdict, the explanation behind the outcome and the probe's output. */
export interface ReleaseVerdict {
  /** The type of the condition that failed, for `device_incompatible` and `device_not_targeted`. */
  condition?: ConditionType;
  conditions: ConditionVerdict[];
  isEligible: boolean;
  /** Why the device will not take the release, when it is not eligible. */
  reason?: SkippedReason;
  release: IndexRelease;
}

/**
 * The outcome for the device. On `skipped` with `release_revoked`, `release`
 * is the release the device resolves to — `null` for the embedded bundle —
 * since its running release is dead; on every other `skipped`, `release` is
 * the newest release the device will not take. On `up_to_date`, `release` is
 * the running release as the index carries it, `null` when it does not.
 */
export type EvaluationOutcome =
  | { release: IndexRelease | null; status: 'up_to_date' }
  | { isMandatory: boolean; release: IndexRelease; status: 'available' }
  | {
      condition?: ConditionType;
      reason: SkippedReason;
      release: IndexRelease | null;
      status: 'skipped';
    };

export interface ChannelIndexEvaluation {
  outcome: EvaluationOutcome;
  /** Every release of the index, newest first; empty when the index holds nothing for the device. A revoked release is never the newer release a `skipped` names: it is not on offer. */
  verdicts: ReleaseVerdict[];
}

const EMBEDDED_RELEASE_NUMBER = 0;

/**
 * The device protocol's evaluation: the release the device takes, or the
 * reason it does not, from the index and what the device knows. One function
 * decides and explains, and the fixture suite pins every rule for the Swift
 * and Kotlin evaluators.
 */
export function evaluateChannelIndex(
  index: ChannelIndex,
  device: DeviceInfo,
): ChannelIndexEvaluation {
  const currentIndexRelease = resolveCurrentIndexRelease(index, device);
  if (isDeviceBeyondCap(index, device)) {
    return {
      outcome: {
        reason: 'spending_cap_reached',
        release: null,
        status: 'skipped',
      },
      verdicts: [],
    };
  }
  const verdicts = [...index.releases]
    .sort((left, right) => right.number - left.number)
    .map(release => resolveReleaseVerdict(release, index, device));
  const currentNumber =
    device.currentRelease?.number ?? EMBEDDED_RELEASE_NUMBER;
  const isCurrentRevoked =
    device.currentRelease !== null &&
    isReleaseRevoked(device.currentRelease, index);
  const eligibleVerdicts = verdicts.filter(verdict => verdict.isEligible);
  const newerVerdict = verdicts.find(
    verdict =>
      verdict.release.number > currentNumber &&
      verdict.reason !== 'release_revoked',
  );
  const newerEligibleVerdict = eligibleVerdicts.find(
    verdict => verdict.release.number > currentNumber,
  );
  const olderEligibleVerdict = eligibleVerdicts.find(
    verdict => verdict.release.number < currentNumber,
  );
  if (!index.isPaused && newerEligibleVerdict !== undefined) {
    const target = newerEligibleVerdict.release;
    return {
      outcome: {
        isMandatory: isMandatoryTransitively(
          target,
          currentNumber,
          eligibleVerdicts,
        ),
        release: target,
        status: 'available',
      },
      verdicts,
    };
  }
  if (isCurrentRevoked) {
    return {
      outcome: {
        reason: 'release_revoked',
        release: olderEligibleVerdict?.release ?? null,
        status: 'skipped',
      },
      verdicts,
    };
  }
  if (index.isPaused && newerVerdict !== undefined) {
    return {
      outcome: {
        reason: 'channel_paused',
        release: newerVerdict.release,
        status: 'skipped',
      },
      verdicts,
    };
  }
  if (newerVerdict !== undefined && newerVerdict.reason !== undefined) {
    return {
      outcome: {
        ...(newerVerdict.condition === undefined
          ? {}
          : { condition: newerVerdict.condition }),
        reason: newerVerdict.reason,
        release: newerVerdict.release,
        status: 'skipped',
      },
      verdicts,
    };
  }
  return {
    outcome: { release: currentIndexRelease, status: 'up_to_date' },
    verdicts,
  };
}

function isDeviceBeyondCap(index: ChannelIndex, device: DeviceInfo): boolean {
  if (index.cappedAt === null) {
    return false;
  }
  return (
    device.reportedAt === null ||
    Date.parse(device.reportedAt) >= Date.parse(index.cappedAt)
  );
}

/**
 * A release is mandatory for the device when it or any release it skips over
 * is, counting only the releases the device could take: one a condition, the
 * floor, a revocation, an earlier failure or the rollout keeps from it never
 * makes the move mandatory.
 */
function isMandatoryTransitively(
  target: IndexRelease,
  currentNumber: number,
  eligibleVerdicts: readonly ReleaseVerdict[],
): boolean {
  return eligibleVerdicts.some(
    verdict =>
      verdict.release.isMandatory &&
      verdict.release.number > currentNumber &&
      verdict.release.number <= target.number,
  );
}

function isReleaseRevoked(
  release: { id: string },
  index: ChannelIndex,
): boolean {
  return index.revokedReleaseIds.includes(release.id);
}

function resolveCurrentIndexRelease(
  index: ChannelIndex,
  device: DeviceInfo,
): IndexRelease | null {
  const current = device.currentRelease;
  if (current === null) {
    return null;
  }
  return index.releases.find(release => release.id === current.id) ?? null;
}

function resolveReleaseVerdict(
  release: IndexRelease,
  index: ChannelIndex,
  device: DeviceInfo,
): ReleaseVerdict {
  const conditions = release.conditions.map(condition =>
    resolveConditionVerdict(condition, device),
  );
  const skipped = resolveSkippedReason(release, conditions, index, device);
  if (skipped === null) {
    return { conditions, isEligible: true, release };
  }
  return { ...skipped, conditions, isEligible: false, release };
}

function resolveSkippedReason(
  release: IndexRelease,
  conditions: readonly ConditionVerdict[],
  index: ChannelIndex,
  device: DeviceInfo,
): { condition?: ConditionType; reason: SkippedReason } | null {
  if (isReleaseRevoked(release, index)) {
    return { reason: 'release_revoked' };
  }
  if (Date.parse(release.createdAt) < Date.parse(device.builtAt)) {
    return { reason: 'release_older_than_binary' };
  }
  if (device.failedBundleIds.includes(release.bundleId)) {
    return { reason: 'bundle_failed_before' };
  }
  const failed = conditions.find(condition => !condition.isSatisfied);
  if (failed !== undefined) {
    return resolveConditionReason(failed.type);
  }
  if (
    resolveRolloutBucket(device.deviceId, release.id) >=
    release.rolloutPercentage
  ) {
    return { reason: 'device_not_in_rollout' };
  }
  return null;
}

function resolveConditionReason(type: string): {
  condition?: ConditionType;
  reason: SkippedReason;
} {
  if (!isKnownConditionType(type)) {
    return { reason: 'condition_unsupported' };
  }
  switch (type) {
    case 'attribute':
    case 'device':
      return { condition: type, reason: 'device_not_targeted' };
    case 'binary':
    case 'fingerprint':
    case 'os':
      return { condition: type, reason: 'device_incompatible' };
  }
}
