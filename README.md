# @hotcodepush/protocol

The HotCodePush update-protocol client for JavaScript: the wire types, the evaluator and the fixture suite behind every HotCodePush SDK.

## Installation

The package is not on npm yet; install it from GitHub:

```sh
npm install github:hotcodepush-team/protocol-js#main
```

## Usage

```ts
import { CHANNEL_INDEX_SCHEMA } from '@hotcodepush/protocol';

console.log(CHANNEL_INDEX_SCHEMA); // 1, the channel index format this client reads
```

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

## License

See [LICENSE](./LICENSE).
