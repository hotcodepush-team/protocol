import { describe, expect, test } from 'vitest';

import { CHANNEL_INDEX_SCHEMA } from './index.js';

describe('channel index schema', () => {
  test('should match the v1 in the channel index path', () => {
    expect(CHANNEL_INDEX_SCHEMA).toBe(1);
  });
});
