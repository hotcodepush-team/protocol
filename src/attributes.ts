import { z } from 'zod';

import { computeSha256Hex } from './hash/sha256.js';

export const ATTRIBUTE_KEY_MAX_LENGTH = 64;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 256;

/** A key is an identifier: letters, digits, `_`, `-` and `.`, at most 64 characters. */
export const AttributeKeySchema = z
  .string()
  .min(1)
  .max(ATTRIBUTE_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_.-]+$/);

/** A value is a printable string without control characters, at most 256 characters. */
export const AttributeValueSchema = z
  .string()
  .max(ATTRIBUTE_VALUE_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u);

export const AttributesSchema = z.record(
  AttributeKeySchema,
  AttributeValueSchema,
);

/**
 * The hash an `attribute` condition carries: `sha256(key + '\0' + value)` over
 * the UTF-8 bytes, so the public index confirms a guess but never lists a value;
 * the NUL separator is safe because a key can never contain one.
 */
export function hashAttribute(key: string, value: string): string {
  return computeSha256Hex(`${key}\0${value}`);
}

/** The hash a `device` condition lists for one device id. */
export function hashDeviceId(deviceId: string): string {
  return computeSha256Hex(deviceId);
}

export function isValidAttributeKey(key: string): boolean {
  return AttributeKeySchema.safeParse(key).success;
}

export function isValidAttributeValue(value: string): boolean {
  return AttributeValueSchema.safeParse(value).success;
}
