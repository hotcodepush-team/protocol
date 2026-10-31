import { z } from 'zod';

import { computeSha256Hex } from './hash/sha256.js';

export const ATTRIBUTE_KEY_MAX_LENGTH = 64;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 256;

/** An attribute key: 1 to 64 letters, digits, `_`, `-` or `.`. */
export const AttributeKeySchema = z
  .string()
  .min(1)
  .max(ATTRIBUTE_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_.-]+$/);

/**
 * An attribute value: at most 256 code points, with no control character (Unicode `Cc`).
 * The limit counts code points, not UTF-16 units or visible characters.
 */
export const AttributeValueSchema = z
  .string()
  .max(ATTRIBUTE_VALUE_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u);

export const AttributesSchema = z.record(
  AttributeKeySchema,
  AttributeValueSchema,
);

/**
 * Hashes an attribute as an `attribute` condition carries it: `sha256(key + '\0' + value)` over UTF-8.
 * The public index can confirm a guessed value but never lists one. A key never contains NUL.
 */
export function hashAttribute(key: string, value: string): string {
  return computeSha256Hex(`${key}\0${value}`);
}

/** Hashes a device id as a `device` condition lists it. */
export function hashDeviceId(deviceId: string): string {
  return computeSha256Hex(deviceId);
}

export function isValidAttributeKey(key: string): boolean {
  return AttributeKeySchema.safeParse(key).success;
}

export function isValidAttributeValue(value: string): boolean {
  return AttributeValueSchema.safeParse(value).success;
}
