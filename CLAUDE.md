# CLAUDE.md

`@hotcodepush/protocol`, the one update-protocol client in TypeScript: the wire types, the evaluator and the fixture suite.
The Swift package `HotCodePushCore` (`core-ios`) and the Android library `com.hotcodepush:core-android` (`core-android`) implement the same functions and types, proven equal by this repo's fixtures.
The monorepo, the SDKs and the CLI consume it from pkg.pr.new until its publish decision — `npm install https://pkg.pr.new/hotcodepush-team/protocol/@hotcodepush/protocol@<sha>`, a consumer pinning one commit and bumping it deliberately, never `@main`; it is not the supported API, apps use the SDK for their framework.
Stack: TypeScript compiled by `tsc` into ESM in `dist/`, ESLint, Prettier, Vitest, Node 24.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
Its `sdk-api.md` (the SDK surface, types, statuses and reasons) and `architecture.md` (_The device protocol_, _Evolving the wire format_, _Testing_) are binding here.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/        the package source; index.ts is the root entry point and fingerprint/index.ts the one subpath entry, so a Worker that never fingerprints carries none of it
fixtures/   the fixture suite, shipped in the package: one JSON case per rule of the device protocol
scripts/    the fixture generators and the pack-entries one's two input patches; each runs with `node` on a developer's machine with nothing installed, the signatures one after `npm run build`, and CI reads the committed fixtures
dist/       the build output, never committed
```

Tests live beside the code they test, `*.test.ts` next to the file.

## Commands

| Command             | Does                                                          |
| ------------------- | ------------------------------------------------------------- |
| `npm run build`     | compile `src/` into `dist/` with declarations and source maps |
| `npm run fmt`       | format with Prettier                                          |
| `npm run lint`      | ESLint                                                        |
| `npm test`          | Vitest                                                        |
| `npm run typecheck` | `tsc --noEmit`                                                |

Run `npm run fmt` before every commit; lint, typecheck, test and build must pass, as `ci.yml` checks on every push and pull request.
`ci.yml`'s `preview` job publishes every push to `main` and every pull request to pkg.pr.new through its GitHub App, no secret involved; a consumer's install runs no script of ours, and a commit a lockfile pins stays installable.
No releases yet: the version stays `0.0.0`, and release-please and npm provenance arrive with the publish decision.

## Wire format

The channel index and the bundle manifest are parsed by native code compiled into customer binaries that stay in the field for years.

- Additive only: a field is never removed, renamed or retyped; a new field is optional, and readers ignore what they do not know.
  The rule binds from the first customer; the reshaping of 2026-10-02 — the manifest signing the client-known content alone, the directive gone — happened before anything shipped, on the owner's decision, as did the signing of 2026-10-04: `rsa-v1_5-sha256` the one scheme, and the resource file's public keys in the encoding each platform's own API imports.
  So did the delivery change of the same day: `patches` left the manifest, the envelope and the signed content, and the pack gained the patch entry `patches/{from}/{to}`, a BSDIFF40 patch between two files named by their content hashes.
  A manifest or an envelope stored with `patches` still parses, the field ignored, and a pack reader skips an entry of any other name with its body, so a later entry kind is additive.
- A change that cannot be additive is a new schema major with its own path, `v2`, and a handbook decision first — never an edit.
- `CHANNEL_INDEX_SCHEMA` is the format major and equals the `v1` in the path; a reader refuses an index whose `schema` is not the one it asked for.
- Conditions are frozen once shipped: a new meaning is a new type, and an unknown type fails closed; the index carries no directive, revocation being the plain revoked list every SDK understands.
- The bundle manifest has no majors: a reader reads every manifest ever released.
- Three numbers, three names: `schema` is the format major, `sequence` the materialization counter, `version` the team's version of a bundle.
- A rule of the protocol lands with its case in `fixtures/`, so all three implementations are held to it.

## Naming

- A name says what the function does on first read: the verb, the object and, where it matters, the qualifier.
- Prefixes from the monorepo's vocabulary: `fetch` HTTP, `resolve` derivations without I/O, `build` functions that assemble a document without sending it.
- Result variables carry the past participle of their operation, `fetchedIndex`.
- Alphabetical ordering within a scope.
- One thing per function, its name saying which; never a function that both decides something and phrases the message about it.
- Booleans carry `is` or `has`; a state with a moment is a timestamp such as `pausedAt`, never a boolean.
- Error codes are `E_` plus SCREAMING_SNAKE; SDK reasons are SCREAMING_SNAKE.
- Never the non-null assertion; nullish coalescing or a real check.
- Test titles read `should <verb> …`, lowercase, conditions starting with `when`.
- Fixtures and examples carry invented data only.

## Agent workspace

- `.mcp.json` is absent on purpose: the one server for this repo's stack, HotCodePush's own at `https://mcp.hotcodepush.com/mcp`, is not live yet; the file arrives with it.
- `.claude/skills/` holds the developer skills copied from `hotcodepush-team/.github` with the skills CLI and pinned in `skills-lock.json`; update them with `npx skills update`.
- `.github/copilot-instructions.md` holds the review criteria, the only Copilot-specific file.
- Commits are conventional commits; `main` is trunk, CI is the gate, and a commit that lands an issue says `Closes #<n>`.
