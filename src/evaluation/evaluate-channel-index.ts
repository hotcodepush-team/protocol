import type { ConditionType, SkippedReason } from '../results.js';
import type { ChannelIndex, IndexRelease } from '../wire/channel-index.js';
import type { ConditionVerdict } from './conditions.js';
import { isKnownConditionType, resolveConditionVerdict } from './conditions.js';
import type { DeviceInfo } from './device-info.js';
import { resolveRolloutBucket } from './rollout.js';

/** The verdict on one release. It explains the outcome and is what the probe prints. */
export interface ReleaseVerdict {
  /** The type of the failed condition, for `device_incompatible` and `device_not_targeted`. */
  conditionType?: ConditionType;
  conditions: ConditionVerdict[];
  isEligible: boolean;
  /** Why the device will not take the release, when it is not eligible. */
  reason?: SkippedReason;
  release: IndexRelease;
}

/**
 * The outcome for the device.
 * On `up_to_date`, `release` is the running release from the index, or `null` when the index lacks it.
 * On `skipped` with `release_revoked`, `release` is the release the device falls back to, `null` for the embedded bundle.
 * On any other `skipped`, `release` is the newest release the device will not take.
 */
export type EvaluationOutcome =
  | { release: IndexRelease | null; status: 'up_to_date' }
  | { isMandatory: boolean; release: IndexRelease; status: 'available' }
  | {
      conditionType?: ConditionType;
      reason: SkippedReason;
      release: IndexRelease | null;
      status: 'skipped';
    };

export interface ChannelIndexEvaluation {
  outcome: EvaluationOutcome;
  /**
   * Every release of the index, newest first. Empty when the index holds nothing for the device.
   * A revoked release is not on offer, so a `skipped` outcome never names it as the newer release.
   */
  verdicts: ReleaseVerdict[];
}

const EMBEDDED_RELEASE_NUMBER = 0;

/**
 * Evaluates the channel index for the device: the release it takes, or why it takes none.
 * The fixture suite pins every rule for the Swift and Kotlin evaluators.
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
  if (index.pausedAt === null && newerEligibleVerdict !== undefined) {
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
  if (index.pausedAt !== null && newerVerdict !== undefined) {
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
        ...(newerVerdict.conditionType === undefined
          ? {}
          : { conditionType: newerVerdict.conditionType }),
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

// The move is mandatory when the target or a release it skips is mandatory.
// Only releases the device could take count.
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
): { conditionType?: ConditionType; reason: SkippedReason } | null {
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
    resolveRolloutBucket(device.deviceId, release.id) >= release.rolloutPercent
  ) {
    return { reason: 'device_not_in_rollout' };
  }
  return null;
}

function resolveConditionReason(type: string): {
  conditionType?: ConditionType;
  reason: SkippedReason;
} {
  if (!isKnownConditionType(type)) {
    return { reason: 'condition_unsupported' };
  }
  switch (type) {
    case 'attribute':
    case 'device':
      return { conditionType: type, reason: 'device_not_targeted' };
    case 'binary':
    case 'fingerprint':
    case 'os':
      return { conditionType: type, reason: 'device_incompatible' };
  }
}
