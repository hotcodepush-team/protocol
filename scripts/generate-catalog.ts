// Run with `npm run catalog`. A test fails when the committed file is stale.
import { writeFileSync } from 'node:fs';

import { CATALOG } from '../src/results.ts';

writeFileSync(
  new URL('../catalog.json', import.meta.url),
  `${JSON.stringify(CATALOG, null, 2)}\n`,
);
