# CLAUDE.md

`@hotcodepush/protocol`, the one update-protocol client in TypeScript: the wire types, the evaluator and the fixture suite.
The Swift package `HotCodePushProtocol` (`protocol-ios`) and the Android library `com.hotcodepush:protocol-android` (`protocol-android`) implement the same functions and types, proven equal by this repo's fixtures.
The monorepo, the SDKs and the CLI consume it as a git dependency on the CI-built `dist` branch, `github:hotcodepush-team/protocol-js#dist`, until its publish decision; it is not the supported API, apps use the SDK for their framework.
Stack: TypeScript compiled by `tsc` into ESM in `dist/`, ESLint, Prettier, Vitest, Node 24.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
Its `sdk-api.md` (the SDK surface, types, statuses and reasons) and `architecture.md` (_The device protocol_, _Evolving the wire format_, _Testing_) are binding here.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/        the package source; index.ts is the public entry point
fixtures/   the fixture suite, shipped in the package: one JSON case per rule of the device protocol
dist/       the build output, never committed on main; dist.yml commits it to the dist branch
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
`dist.yml` appends every push to `main` — its tree plus the build output — as one commit to the `dist` branch, never force-pushed, so a consumer installs `#dist` without any install script and every commit a lockfile pins stays reachable; a `main` that does not build leaves `dist` where it was.
No releases yet: the version stays `0.0.0`, and release-please, npm provenance and pkg.pr.new arrive with the publish decision.

## Wire format

The channel index and the bundle manifest are parsed by native code compiled into customer binaries that stay in the field for years.

- Additive only: a field is never removed, renamed or retyped; a new field is optional, and readers ignore what they do not know.
- A change that cannot be additive is a new schema major with its own path, `v2`, and a handbook decision first — never an edit.
- `CHANNEL_INDEX_SCHEMA` is the format major and equals the `v1` in the path; a reader refuses an index whose `schema` is not the one it asked for.
- Conditions and directives are frozen once shipped: a new meaning is a new type, and an unknown type fails closed.
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
