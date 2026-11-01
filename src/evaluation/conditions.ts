import { hashAttribute, hashDeviceId } from '../attributes.js';
import type { ConditionType } from '../results.js';
import { CONDITION_TYPES } from '../results.js';
import type { Condition, KnownCondition } from '../wire/channel-index.js';
import type { DeviceInfo } from './device-info.js';
import { isVersionInRange, parseVersion } from './version-range.js';

const BINARY_VERSION_MIN_COMPONENTS = 3;

export interface ConditionVerdict {
  isSatisfied: boolean;
  type: string;
}

export function isKnownCondition(
  condition: Condition,
): condition is KnownCondition {
  return isKnownConditionType(condition.type);
}

export function isKnownConditionType(type: string): type is ConditionType {
  return (CONDITION_TYPES as readonly string[]).includes(type);
}

/** Resolves whether the device satisfies the condition. An unknown type never does. */
export function resolveConditionVerdict(
  condition: Condition,
  device: DeviceInfo,
): ConditionVerdict {
  return {
    isSatisfied: isConditionSatisfied(condition, device),
    type: condition.type,
  };
}

function isConditionSatisfied(
  condition: Condition,
  device: DeviceInfo,
): boolean {
  if (!isKnownCondition(condition)) {
    return false;
  }
  switch (condition.type) {
    case 'attribute':
      return isAttributeConditionSatisfied(condition, device);
    case 'binary':
      return isVersionConditionSatisfied(condition, {
        version: resolveBinaryVersion(device),
      });
    case 'device':
      return condition.hashedIds.includes(hashDeviceId(device.deviceId));
    case 'fingerprint':
      return (
        device.fingerprint !== null &&
        device.fingerprint === condition.fingerprint
      );
    case 'os':
      return isVersionConditionSatisfied(condition, {
        version: parseVersion(device.osVersion),
      });
  }
}

function isAttributeConditionSatisfied(
  condition: Extract<KnownCondition, { type: 'attribute' }>,
  device: DeviceInfo,
): boolean {
  // Own members only, so an inherited key such as `constructor` never counts.
  const value = Object.hasOwn(device.attributes, condition.key)
    ? device.attributes[condition.key]
    : undefined;
  return (
    value !== undefined &&
    hashAttribute(condition.key, value) === condition.valueSha256
  );
}

function isVersionConditionSatisfied(
  condition: Extract<KnownCondition, { type: 'binary' | 'os' }>,
  { version }: { version: readonly number[] | null },
): boolean {
  return (
    version !== null && isVersionInRange(version, condition.range) === true
  );
}

// Appends the build number as at least the fourth component, so `1.0` build `57` is `1.0.0.57`.
function resolveBinaryVersion(device: DeviceInfo): readonly number[] | null {
  const version = parseVersion(device.binaryVersion);
  if (version === null) {
    return null;
  }
  const build = parseVersion(device.binaryBuild);
  if (build === null || build.length !== 1) {
    return version;
  }
  const paddedVersion = Array.from(
    { length: Math.max(version.length, BINARY_VERSION_MIN_COMPONENTS) },
    (_component, index) => version[index] ?? 0,
  );
  return [...paddedVersion, ...build];
}
