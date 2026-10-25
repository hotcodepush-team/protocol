/**
 * Writes `catalog.json` from `CATALOG` in `src/results.ts`, the one source of
 * the values; a test fails when the committed file is stale.
 *
 *     npm run catalog
 */
import { writeFileSync } from 'node:fs';

import { CATALOG } from '../src/results.ts';

writeFileSync(
  new URL('../catalog.json', import.meta.url),
  `${JSON.stringify(CATALOG, null, 2)}\n`,
);
