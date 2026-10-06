import type { ConditionType, SkippedReason } from '../results.js';
import type { ChannelIndex, IndexRelease } from '../wire/channel-index.js';
import type { ConditionVerdict } from './conditions.js';
import { isKnownConditionType, resolveConditionVerdict } from './conditions.js';
import type { DeviceInfo } from './device-info.js';
import { resolveRolloutBucket } from './rollout.js';

/** The per-release verdict, the explanation behind the outcome and the probe's output. */
export interface ReleaseVerdict {
  /** The type of the condition that failed, for `INCOMPATIBLE` and `NOT_TARGETED`. */
  condition?: ConditionType;
  conditions: ConditionVerdict[];
  isEligible: boolean;
  /** Why the device will not take the release, when it is not eligible. */
  reason?: SkippedReason;
  release: IndexRelease;
}

/**
 * The outcome for the device. On `SKIPPED` with `RELEASE_REVOKED`, `release`
 * is the release the device resolves to — `null` for the embedded bundle —
 * since its running release is dead; on every other `SKIPPED`, `release` is
 * the newest release the device will not take. On `UP_TO_DATE`, `release` is
 * the running release as the index carries it, `null` when it does not.
 */
export type EvaluationOutcome =
  | { release: IndexRelease | null; status: 'UP_TO_DATE' }
  | { isMandatory: boolean; release: IndexRelease; status: 'AVAILABLE' }
  | {
      condition?: ConditionType;
      reason: SkippedReason;
      release: IndexRelease | null;
      status: 'SKIPPED';
    };

export interface ChannelIndexEvaluation {
  outcome: EvaluationOutcome;
  /** Every release of the index, newest first; empty when the index holds nothing for the device. A revoked release is never the newer release a `SKIPPED` names: it is not on offer. */
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
  if (
    device.appliedIndexSequence !== null &&
    index.sequence < device.appliedIndexSequence
  ) {
    return {
      outcome: { release: currentIndexRelease, status: 'UP_TO_DATE' },
      verdicts: [],
    };
  }
  if (isDeviceBeyondCap(index, device)) {
    return {
      outcome: {
        reason: 'SPENDING_CAP_REACHED',
        release: null,
        status: 'SKIPPED',
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
      verdict.reason !== 'RELEASE_REVOKED',
  );
  const newerEligibleVerdict = eligibleVerdicts.find(
    verdict => verdict.release.number > currentNumber,
  );
  const olderEligibleVerdict = eligibleVerdicts.find(
    verdict => verdict.release.number < currentNumber,
  );
  if (index.isPaused) {
    if (isCurrentRevoked) {
      return {
        outcome: {
          reason: 'RELEASE_REVOKED',
          release: olderEligibleVerdict?.release ?? null,
          status: 'SKIPPED',
        },
        verdicts,
      };
    }
    if (newerVerdict !== undefined) {
      return {
        outcome: {
          reason: 'CHANNEL_PAUSED',
          release: newerVerdict.release,
          status: 'SKIPPED',
        },
        verdicts,
      };
    }
    return {
      outcome: { release: currentIndexRelease, status: 'UP_TO_DATE' },
      verdicts,
    };
  }
  if (newerEligibleVerdict !== undefined) {
    const target = newerEligibleVerdict.release;
    return {
      outcome: {
        isMandatory: isMandatoryTransitively(target, currentNumber, verdicts),
        release: target,
        status: 'AVAILABLE',
      },
      verdicts,
    };
  }
  if (isCurrentRevoked) {
    return {
      outcome: {
        reason: 'RELEASE_REVOKED',
        release: olderEligibleVerdict?.release ?? null,
        status: 'SKIPPED',
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
        status: 'SKIPPED',
      },
      verdicts,
    };
  }
  return {
    outcome: { release: currentIndexRelease, status: 'UP_TO_DATE' },
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

/** A release is mandatory for the device when it or any release it skipped over is. */
function isMandatoryTransitively(
  target: IndexRelease,
  currentNumber: number,
  verdicts: readonly ReleaseVerdict[],
): boolean {
  return verdicts.some(
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
    return { reason: 'RELEASE_REVOKED' };
  }
  if (Date.parse(release.createdAt) < Date.parse(device.builtAt)) {
    return { reason: 'OLDER_THAN_BINARY' };
  }
  if (device.failedBundleIds.includes(release.bundleId)) {
    return { reason: 'FAILED_BEFORE' };
  }
  const failed = conditions.find(condition => !condition.isSatisfied);
  if (failed !== undefined) {
    return resolveConditionReason(failed.type);
  }
  if (resolveRolloutBucket(device.deviceId, release.id) >= release.rollout) {
    return { reason: 'NOT_IN_ROLLOUT' };
  }
  return null;
}

function resolveConditionReason(type: string): {
  condition?: ConditionType;
  reason: SkippedReason;
} {
  if (!isKnownConditionType(type)) {
    return { reason: 'UNSUPPORTED_CONDITION' };
  }
  switch (type) {
    case 'attribute':
    case 'device':
      return { condition: type, reason: 'NOT_TARGETED' };
    case 'binary':
    case 'fingerprint':
    case 'os':
      return { condition: type, reason: 'INCOMPATIBLE' };
  }
}
