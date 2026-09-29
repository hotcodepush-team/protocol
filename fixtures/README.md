# Fixtures

The fixture suite of the device protocol: one JSON case per rule, each an input and the outcome it must produce.
Every protocol implementation runs the same cases — this package, the Swift package `HotCodePushProtocol` and the Android library `com.hotcodepush:protocol-android` — so identical behavior on every platform is a test, not a hope.
The files ship in the npm package, so a native core's test suite reads them from `node_modules/@hotcodepush/protocol/fixtures/`.

## `evaluation/*.json`

One file per rule of the evaluation, each `{ "description", "cases": [...] }`; a case is:

| Field      | Holds                                                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | the test title, `should …`                                                                                                                                                                                                                                                              |
| `index`    | a channel index, valid against `ChannelIndexSchema`                                                                                                                                                                                                                                     |
| `device`   | the `DeviceInfo` the evaluator takes: `appliedIndexSequence`, `attributes`, `binaryBuild`, `binaryVersion`, `builtAt`, `currentRelease` (`{ id, number }` or `null` for the embedded bundle), `deviceId`, `failedBundleIds`, `fingerprint`, `osVersion`, `reportedAt`, `runtimeVersion` |
| `expected` | the outcome: `status` (`UP_TO_DATE`, `AVAILABLE`, `SKIPPED`), `releaseId` (`null` for none or the embedded bundle), `isMandatory` on `AVAILABLE`, `reason` and the failing `condition` type on `SKIPPED`                                                                                |
| `verdicts` | optional: every release of the index newest first as `{ releaseId, isEligible, reason?, condition? }`; an empty array means the index held nothing for the device                                                                                                                       |

On `SKIPPED` with `RELEASE_REVOKED`, `releaseId` is the release the device resolves to, `null` for the embedded bundle; on every other `SKIPPED` it is the newest release the device will not take.

## `resource-files.json`

`{ name, resourceFile, embeddedBundleManifest }`: a resource file as the embed step writes it, valid against `ConfigurationSchema`, and its embedded bundle's manifest as a reader reads it — a bundle the embed step did not register carries only its files, and its absent `pack` reads as `null`, its absent `deltas` and `patches` as empty.

## `version-ranges.json`

`{ version, range, satisfied }` over the shared range subset — `satisfied` is `true`, `false`, or `null` when the range does not parse, which a condition treats as not satisfied.

## `rollout-buckets.json`

`{ deviceId, releaseId, bucket }`: FNV-1a 32-bit over the UTF-8 bytes of the device id followed by the release id, modulo 100; a device takes a release when its bucket is below the rollout percentage.

## `packs.json`

One pack as the writer produces it — `packBase64`, its `packSha256`, and `entries` in order with each content and its `sha256` — so a reader is tested against exact bytes and a writer against exact output.
