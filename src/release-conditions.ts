import { z } from 'zod';

import {
  AttributeKeySchema,
  AttributeValueSchema,
  hashAttribute,
  hashDeviceId,
} from './attributes.js';
import type { Condition } from './wire/channel-index.js';
import {
  BinaryConditionSchema,
  DEVICE_CONDITION_HASHED_ID_COUNT_LIMIT,
  FingerprintConditionSchema,
  OsConditionSchema,
} from './wire/channel-index.js';
import { UuidSchema } from './wire/primitives.js';

// Strict, unlike the wire: the API shape is ours and complete, so an unknown field is a mistake.

/** An `attribute` condition as the API and the database hold it, with the raw value. */
export const AttributeReleaseConditionSchema = z.strictObject({
  key: AttributeKeySchema,
  type: z.literal('attribute'),
  value: AttributeValueSchema,
});

/** A `binary` condition as the API and the database hold it. */
export const BinaryReleaseConditionSchema = z.strictObject(
  BinaryConditionSchema.shape,
);

/** A `device` condition as the API and the database hold it, with the raw device ids. */
export const DeviceReleaseConditionSchema = z.strictObject({
  ids: z.array(UuidSchema).max(DEVICE_CONDITION_HASHED_ID_COUNT_LIMIT),
  type: z.literal('device'),
});

/** A `fingerprint` condition as the API and the database hold it. */
export const FingerprintReleaseConditionSchema = z.strictObject(
  FingerprintConditionSchema.shape,
);

/** An `os` condition as the API and the database hold it. */
export const OsReleaseConditionSchema = z.strictObject(OsConditionSchema.shape);

/** A release condition as the API and the database hold it. Only the public index carries hashes. */
export const ReleaseConditionSchema = z.discriminatedUnion('type', [
  AttributeReleaseConditionSchema,
  BinaryReleaseConditionSchema,
  DeviceReleaseConditionSchema,
  FingerprintReleaseConditionSchema,
  OsReleaseConditionSchema,
]);
export type ReleaseCondition = z.infer<typeof ReleaseConditionSchema>;

/** Converts a release condition into the hashed shape the channel index carries. */
export function toWireCondition(condition: ReleaseCondition): Condition {
  switch (condition.type) {
    case 'attribute':
      return {
        key: condition.key,
        type: 'attribute',
        valueSha256: hashAttribute(condition.key, condition.value),
      };
    case 'device':
      return { hashedIds: condition.ids.map(hashDeviceId), type: 'device' };
    case 'binary':
    case 'fingerprint':
    case 'os':
      return condition;
  }
}
