import { z } from 'zod';

import { CHANNEL_INDEX_SCHEMA } from './channel-index.js';
import { NonEmptyStringSchema } from './primitives.js';

/** The discoverable channels of the app, for switching by name at runtime. Empty by default. */
export const ChannelsIndexSchema = z.looseObject({
  channels: z.array(
    z.looseObject({
      id: NonEmptyStringSchema,
      name: NonEmptyStringSchema,
    }),
  ),
  schema: z.literal(CHANNEL_INDEX_SCHEMA),
});
export type ChannelsIndex = z.infer<typeof ChannelsIndexSchema>;
