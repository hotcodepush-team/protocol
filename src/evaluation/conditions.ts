import { hashAttribute, hashDeviceId } from '../attributes.js';
import type { ConditionType } from '../results.js';
import { CONDITION_TYPES } from '../results.js';
import type { Condition, KnownCondition } from '../wire/channel-index.js';
import type { DeviceInfo } from './device-info.js';
import { isVersionInRange, parseVersion } from './version-range.js';

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

/** Whether the device satisfies the condition; an unknown type never does. */
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
    case 'attribute': {
      // Own members only: an inherited `constructor` is no attribute the app set.
      const value = Object.hasOwn(device.attributes, condition.key)
        ? device.attributes[condition.key]
        : undefined;
      return (
        value !== undefined &&
        hashAttribute(condition.key, value) === condition.valueSha256
      );
    }
    case 'binary': {
      const binaryVersion = resolveBinaryVersion(device);
      return (
        binaryVersion !== null &&
        isVersionInRange(binaryVersion, condition.range) === true
      );
    }
    case 'device':
      return condition.hashedIds.includes(hashDeviceId(device.deviceId));
    case 'fingerprint':
      return (
        device.fingerprint !== null && device.fingerprint === condition.hash
      );
    case 'os': {
      const osVersion = parseVersion(device.osVersion);
      return (
        osVersion !== null &&
        isVersionInRange(osVersion, condition.range) === true
      );
    }
    case 'runtime':
      return (
        device.runtimeVersion !== null &&
        device.runtimeVersion === condition.version
      );
  }
}

/** The binary version with the build number as its fourth component, when both are numbers. */
function resolveBinaryVersion(device: DeviceInfo): readonly number[] | null {
  const version = parseVersion(device.binaryVersion);
  if (version === null) {
    return null;
  }
  const build = parseVersion(device.binaryBuild);
  return build !== null && build.length === 1
    ? [...version, ...build]
    : version;
}
