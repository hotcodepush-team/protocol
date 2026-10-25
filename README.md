# @hotcodepush/protocol

The HotCodePush update-protocol client for JavaScript: the wire types, the evaluator, the signatures, the fingerprint recipe and the fixture suite behind every HotCodePush SDK.

## Installation

The package is not on npm yet; every commit is published to pkg.pr.new by CI, and a consumer pins one commit and bumps it deliberately, never a branch:

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

`@hotcodepush/protocol/catalog.json` holds every value of the catalog, the statuses, reasons and strategies, for a reader outside TypeScript.

The package is the foundation of the HotCodePush SDKs, not their supported API: an app uses the SDK for its framework.

## Documentation

See [hotcodepush.com/docs](https://hotcodepush.com/docs).

## Development

```sh
nvm use
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run fmt` formats the code with Prettier.
`npm run catalog` writes `catalog.json` from `src/results.ts`; a test fails when the committed file is stale.

## License

See [LICENSE](./LICENSE).
