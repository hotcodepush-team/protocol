import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { ChannelsIndexSchema } from './channels-index.js';

interface WireRulesFixture {
  acceptedChannelsIndexes: { channelsIndex: unknown; name: string }[];
  refusedChannelsIndexes: { channelsIndex: unknown; name: string }[];
}

const WIRE_RULES = JSON.parse(
  readFileSync(
    new URL('../../fixtures/wire-rules.json', import.meta.url),
    'utf8',
  ),
) as WireRulesFixture;

describe('the wire rules', () => {
  test.each(
    WIRE_RULES.acceptedChannelsIndexes.map(accepted => [
      accepted.name,
      accepted,
    ]),
  )('%s', (_name, accepted) => {
    expect(ChannelsIndexSchema.safeParse(accepted.channelsIndex).success).toBe(
      true,
    );
  });

  test.each(
    WIRE_RULES.refusedChannelsIndexes.map(refused => [refused.name, refused]),
  )('%s', (_name, refused) => {
    expect(ChannelsIndexSchema.safeParse(refused.channelsIndex).success).toBe(
      false,
    );
  });
});
