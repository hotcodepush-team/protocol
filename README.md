# @hotcodepush/protocol

The HotCodePush update-protocol client for JavaScript: the wire types, the evaluator, the signatures, the fingerprint recipe and the fixture suite behind every HotCodePush SDK.

## Installation

The package is not on npm yet. Every commit is published to pkg.pr.new by CI, so install one by its commit SHA and bump it deliberately, never a branch:

```sh
npm install https://pkg.pr.new/hotcodepush-team/protocol/@hotcodepush/protocol@<sha>
```

## Usage

```ts
import {
  ChannelIndexSchema,
  evaluateChannelIndex,
} from '@hotcodepush/protocol';

const index = ChannelIndexSchema.parse(await response.json());
const { outcome, verdicts } = evaluateChannelIndex(index, deviceInfo);
// outcome: the release to take, or the reason not to; verdicts: every release explained
```

A release condition as the API and the database hold it, `ReleaseConditionSchema`, carries raw values: `{ type: 'attribute', key, value }` and `{ type: 'device', ids }`.
Only the public channel index carries hashes, and `toWireCondition` is the one bridge from the raw condition to the index.

`@hotcodepush/protocol/catalog.json` holds every value of the catalog, the statuses, reasons and strategies, for a reader outside TypeScript.

The package is the foundation of the HotCodePush SDKs, not their supported API: an app uses the SDK for its framework.
The Swift package `HotCodePushCore` and the Android library `com.hotcodepush:core-android` implement the same protocol, proven equal by this repo's fixtures.

## Documentation

See [hotcodepush.com/docs](https://hotcodepush.com/docs).

## Development

```sh
nvm use
npm ci
npm run build        # compiles src/ into dist/
npm test
npm run lint && npm run typecheck
npm run fmt          # ESLint's fixes and Prettier, run before every commit
```

`npm run catalog` writes `catalog.json` from `src/results.ts`; a test fails when the committed file is stale.
`CLAUDE.md` holds the layout and the rules.

## License

See [LICENSE](./LICENSE).
