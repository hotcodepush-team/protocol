# Fixtures

The fixture suite of the device protocol: one JSON case per rule, each an input and the outcome it must produce.
Every protocol implementation runs the same cases — this package, the Swift package `HotCodePushCore` and the Android library `com.hotcodepush:core-android` — so identical behavior on every platform is a test, not a hope.
The files ship in the npm package, so a native core's test suite reads them from `node_modules/@hotcodepush/protocol/fixtures/`.

## `evaluation/*.json`

One file per rule of the evaluation, each `{ "description", "cases": [...] }`; a case is:

| Field              | Holds                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | the test title, `should …`                                                                                                                                                                                                                    |
| `index`            | a channel index, valid against `ChannelIndexSchema`                                                                                                                                                                                           |
| `device`           | the `DeviceInfo` the evaluator takes: `attributes`, `binaryBuild`, `binaryVersion`, `builtAt`, `currentRelease` (`{ id, number }` or `null` for the embedded bundle), `deviceId`, `failedBundleIds`, `fingerprint`, `osVersion`, `reportedAt` |
| `expected`         | the outcome: `status` (`UP_TO_DATE`, `AVAILABLE`, `SKIPPED`), `releaseId` (`null` for none or the embedded bundle), `isMandatory` on `AVAILABLE`, `reason` and the failing `condition` type on `SKIPPED`                                      |
| `verdicts`         | optional: every release of the index newest first as `{ releaseId, isEligible, reason?, condition? }`; an empty array means the index held nothing for the device                                                                             |
| `acknowledgements` | optional: the `202`s the device received, oldest first, each `{ hasReport, reportedAt }`; a runner folds them from `null` with the rule of `device-events.json`'s `acknowledgements` and checks the result is `device.reportedAt`             |

On `SKIPPED` with `RELEASE_REVOKED`, `releaseId` is the release the device resolves to, `null` for the embedded bundle; on every other `SKIPPED` it is the newest release the device will not take.
The `capped.json` cases with `acknowledgements` pin the cap against the stamp the device keeps: a batch of events alone or a report with a changed fact acknowledged after `cappedAt` leaves a counted device counted; a month's first report acknowledged after `cappedAt` puts the device beyond the cap, even after a batch of events alone was acknowledged before it; and the new month's first report replaces last month's stamp, before the cap or after it.

## `resource-files.json`

`{ name, resourceFile, embeddedBundleManifest }`: a resource file as the build step writes it, valid against `ConfigurationSchema`, and its embedded bundle's manifest as a reader reads it — the bundle manifest, the same shape whether the build step registered the bundle or not, `embeddedBundleId` null when it did not.
`embeddedBundleManifest` is `null` in a build that bundled no JavaScript, a React Native or Expo debug build the development server serves: a reader takes the file, and every check answers `SKIPPED` with `BUILD_DEBUG`.
The file carries `channelId`, the id the build step resolved from the project's `channel` name, the SDK options with their defaults where the project left them out, and `filesBaseUrl` and `updatesBaseUrl` in a build against staging or the local stack alone; a reader applies the defaults the schema names. The file carries no CLI key: `extraFingerprintPaths` is left out and nothing names a build directory; one case spells out every SDK option at its default.
`channelId` is `null` in a build whose build step ran without a token or offline and could not resolve the name: a reader takes the file, an explicit check answers `FAILED` with `CHANNEL_UNKNOWN`, the automatic ones stay silent, and the device requests nothing and reports nothing until a channel is set at runtime.
`publicKeys` are the project's public keys as the build step re-encoded them for the platform the file is written for, `{ der, keyId }` each: `der` the base64 of the key's PKCS #1 DER in an iOS build and of its SPKI DER in an Android build, so the platform's own API imports it with no ASN.1 handled on the device, `keyId` the fingerprint over the SPKI bytes; one case per platform carries them.
`refusedResourceFiles` are `{ name, resourceFile }` a reader refuses: a `checkIntervalSeconds` below 60, the floor, since a zero made the core check in a tight loop.

## `version-ranges.json`

`{ version, range, satisfied }` over the shared range subset — `satisfied` is `true`, `false`, or `null` when the range does not parse, which a condition treats as not satisfied and `isValidVersionRange` refuses, the API's and the CLI's `range_syntax` rule.

## `rollout-buckets.json`

`{ deviceId, releaseId, bucket }`: FNV-1a 32-bit over the UTF-8 bytes of the device id followed by the release id, modulo 100; a device takes a release when its bucket is below the rollout percentage.

## `packs.json`

One pack as the writer produces it — `packBase64`, its `packSha256`, and `entries` in order with each content and its `sha256` — so a reader is tested against exact bytes and a writer against exact output.

`refusedPacks` lists the cuts and malformed ends every reader must refuse with a format error — an empty body, a cut between entries, a cut on a block boundary inside an entry, a cut inside a block, no end blocks, one end block, a zero block between entries, a header whose checksum does not match — each as `name` and `packBase64`.

## `pack-entries.json`

The two entry kinds of a pack and what a device does with a patch entry.
A file entry is named by the file's content hash, and its body is the file's stored object, the gzip the bucket serves.
A patch entry is named `patches/{from}/{to}` — `patches/{from}` in the ustar prefix field, `{to}` in the name field, the ustar magic and version set — `from` and `to` being the content hashes of two files, the hashes a manifest lists; its body is a raw BSDIFF40 patch over the files' contents, never gzip, that turns the bytes of `from` into the bytes of `to`.
A reader composes an entry's name as the prefix, a `/` and the name when the prefix is not empty, and skips an entry with any other name together with its body, so a later entry kind does not break a shipped reader.

`files` are the contents the cases name by hash, `{ name, contentBase64, sha256 }`.
`deltaPack` is a pack of a file entry and a patch entry as the writer produces it — `packBase64`, its `packSha256`, and `entries` in order, each with its `type` and `bodyBase64`, the file's `sha256` or the patch's `fromSha256` and `toSha256`.
`skippedEntryPack` holds a file entry, an entry named `skippedName` — `future/{hash}/{hash}`, through the prefix field as a later kind could be — and a patch entry; a reader yields its two `entries` and no error.
`patchCases` are `{ name, heldSha256s, manifestFiles, patchEntry, outcome }`: a patch entry, the hashes of the files the device holds in its file store and its embedded bundle, the files of the signed manifest it downloads, and one of three outcomes, none of which fails the update.
`applied`: the device applies the patch to the file `fromSha256` it holds, and the patched bytes hash to `toSha256`.
`fallback`: the device fetches the file `toSha256` as it fetches any file the pack did not bring — when it does not hold the base, the patch is truncated, the patched bytes hash to another file, or the patch's control triples seek before the start of the base.
`ignored`: `toSha256` is not a file of the manifest, and the device leaves the entry aside.

The two valid patches are fixed inputs in `scripts/pack-entries/`, written once by Colin Percival's bsdiff 4.3; the hostile one, whose control triples seek before the base, is crafted by the generator, `scripts/generate-pack-entries-fixture.ts`, so rebuilding the fixture needs no bsdiff.

## `pack-sources.json`

The pack a download requests and where it turns on each answer.
`cases` are `{ name, appId, baseBundleId, filesBaseUrl, updatesBaseUrl, envelope, missingFileCount, statuses, requests, packKind }`.
`baseBundleId` is the bundle the device runs, a release's or the embedded bundle's, `null` without a base; the hosts are as in `configured-hosts.json`, `null` for production; `missingFileCount` counts the manifest's files the device holds neither in its file store nor in its embedded bundle.
`statuses` are the answers to the requests in order, `requests` the packs requested, each `{ kind, maximumBytes, sizeBytes, url }`, and `packKind` the `downloaded` event's kind: `files` when no file was missing and no pack was requested, `null` when the download failed with `DOWNLOAD_FAILED`.
A device with a base requests a delta pack whenever a file is missing, one included, so the main bundle of a React Native or Expo update can arrive as a patch: the delta the envelope lists for its base, at that URL and size, else `{filesBaseUrl}/apps/{appId}/bundles/{bundleId}/deltas/{baseBundleId}`, whose size is unknown and at most the full pack's.
A device without a base requests the full pack.
A delta pack that answers 404 is not built yet, and the device asks the updates host at `{updatesBaseUrl}/v1/apps/{appId}/bundles/{bundleId}/deltas/{baseBundleId}`; whatever else that host answers, its redirect to the full pack above twenty objects included, sends the device to the full pack, since a device follows no redirect.
Any other answer of a delta pack on the files host, a redirect included, and any error of the full pack fail the download, which the next cycle retries.

## `wire-rules.json`

The rules every reader enforces before a byte is written, as whole documents in six arrays — `acceptedIndexes`, `refusedIndexes`, `acceptedManifests`, `refusedManifests`, `acceptedEnvelopes`, `refusedEnvelopes` — each case `{ name, index | manifest | envelope }`.
A wire URL is `http` or `https` with a host, nothing else, so `javascript:`, `file:`, `data:` and `ftp:` are refused where they stand; ids are `[A-Za-z0-9_-]{1,64}`, a hash is 64 lowercase hex, a manifest path is relative and `/`-separated with no empty, `.` or `..` segment, no backslash and no NUL, timestamps are UTC with a `Z`, and every field of a shape is present, a nullable one as `null`, never absent.
The refused cases pin where the three readers once diverged — a default for an absent field, a lenient type, an offset timestamp, a `..` segment hidden behind a combining mark — so a refusal is the same refusal on every platform.
A manifest or an envelope stored while bundles carried `patches` is accepted and the field ignored, as any field a reader does not know is; one accepted envelope carries it on itself and in its manifest.

## `device-events.json`

The batches the events endpoint, `POST /v1/apps/{appId}/events`, accepts and refuses, as `acceptedBatches` and `refusedBatches`, each case `{ name, batch }`, so a core tests its encoder against the endpoint's reading instead of a batch of its own.
The endpoint reads the batch whole and its events one by one: a batch whose `deviceId`, `sdkVersion`, `platform`, `events` or `report` breaks the shape is refused with `E_VALIDATION`, and the device drops the events it carried and keeps the report for the next sync; an event it cannot read is skipped and the rest kept, the `202` answering as for any batch.
An accepted case carries `skippedEventIndexes`, the positions of the events the endpoint skips, empty when it reads them all.
Every key of a shape is present, a nullable one as `null` — `report`, `toReleaseId` on a rollback to the embedded bundle, the report's `embeddedBundleId`, `fingerprint` and `releaseId` — and an optional one, `reason`, `condition` or `detail`, is left out, never `null`.
The accepted batches hold every event type with every skipped reason, condition type, pack kind and failure reason, a report with every fact and one with its nullable facts `null`, the empty batch the uptime check sends, and 200 events, the outbox's cap and so the largest batch a device sends; the refused batches end with one of 201, since the endpoint refuses anything above `MAX_EVENTS_PER_BATCH` whole.

`acknowledgements` are `{ name, reportedAt, acknowledgement, keptReportedAt }`: the stamp the device holds, `null` for none, a `202` as `{ hasReport, reportedAt }`, `hasReport` saying whether the acknowledged batch carried the device report, and the stamp the device keeps after it.
The device keeps the stamp of the first acknowledged batch of a UTC month that carried its report, the month read from the stamp itself; a later acknowledgement replaces it only when it falls in a later UTC month, and a batch of events alone never moves it.
The cases pin a report acknowledged again later in the same month after a fact changed, which keeps the stamp, the month read in UTC on both sides of midnight, the turn of the year, and an acknowledgement from an earlier month, which keeps the stamp.

## `attribute-values.json`

`cases` are `{ name, value, isValid }`: the one rule `setAttributes`, the report's attributes, an attribute condition's value and a failed event's `detail` share — at most 256 Unicode code points, counted neither in UTF-16 units nor in graphemes, and no control character, C0, DEL or C1.
The cases pin the three counts apart: 256 emoji are accepted, 257 code points of a combining pair are refused though they read as 129 characters, and U+0085 and U+009F are refused.

## `configured-hosts.json`

`cases` are `{ name, filesBaseUrl, updatesBaseUrl, url, isOnConfiguredHost }`, a base of `null` meaning the production host: a manifest, pack or delta URL is on a configured host when it starts with that base followed by a `/`; off it, the download is `MANIFEST_INVALID` before a byte is written.

## `manifest-identity.json`

`cases` are `{ name, appId, platform, manifest, isForDevice }`: a manifest is for the device when its `appId` is the app's id from the resource file and its `platforms` list the device's platform, signed or not; another app's manifest or a platform not listed is `MANIFEST_INVALID`, so an index pointing at another app's bundle serves nothing.

## `signatures.json`

One scheme is allowed, `rsa-v1_5-sha256`: RSASSA-PKCS1-v1_5 with SHA-256, which Web Crypto, iOS's Security framework and Android's `Signature` verify alike.
`keys` are test key pairs, `{ name, bits, publicKey, privateKey, fingerprint }`: the public key self-describing, `rsa-v1_5-sha256:` and the base64 of its SPKI DER, the private key the base64 of its PKCS #8 DER, the fingerprint `sha256:` and the hex SHA-256 of the SPKI bytes.
`manifests` are `{ name, envelope, publicKeys, devicePublicKeys, isValid }`: an envelope whose `manifest` is the canonical JSON of the signed content, verified against the listed keys; tampered bytes, a key the verifier does not hold, a null signature, a value under another prefix — `ed25519:` included, an unknown scheme — and a key under 2048 bits are refused.
A case lists its keys twice over: `publicKeys` as `hotcodepush.json` lists them, and `devicePublicKeys.android` and `devicePublicKeys.ios` as a resource file carries them, `{ der, keyId }` — the base64 of the SPKI DER for Android's `X509EncodedKeySpec`, of the PKCS #1 DER for iOS's `SecKeyCreateWithData`, each beside the fingerprint a signature names, since a device cannot recompute it from PKCS #1 bytes.
The size of a key is read from the key the platform imported, never from its bytes.
They are test keys, generated once, and sign nothing real.
`scripts/generate-signatures-fixture.ts` re-signs every case with those same keys through the built package, so it runs after `npm run build`; the scheme signs deterministically, so an unchanged manifest yields the same file.

## `fingerprints.json`

`cases` are sample projects, `{ name, projectPath, files, extraFingerprintPaths, contributors, fingerprint }`, `projectPath` the workspace's directory relative to the lockfile's, `''` for the root: a lockfile and the installed packages' marker files as `files`, the contributors the recipe yields — one entry per name, version and integrity, the lockfile's integrity hash, yarn berry's checksum, else the resolved URL — and the `fp1:` hash of the canonical contract.
npm, pnpm and yarn classic yield one fingerprint for one dependency set; yarn berry yields its own, since its checksum is not the registry's integrity.
An aliased package (`npm:` in its specifier) contributes the aliased package's version and integrity under the declared name, so the four formats agree; a pnpm store directory whose name pnpm shortened to a hash is found as the one `.pnpm` entry whose prefix the full name starts with, the walk up from the dependent standing in when none or several match.
`extraFingerprintPaths` are the paths `hotcodepush.json` lists under the same key, relative to the workspace's directory: `..` may reach a sibling workspace, and a path that leaves the lockfile's directory, symbolic links resolved, is refused. Their files appear in the contributors under the same key.
`refusedProjects` are the projects the recipe refuses: two lockfiles, none, an npm lockfile below version 2, a pnpm lockfile below 9, a locked package that is not installed, a workspace without a readable `package.json`, a workspace the pnpm or berry lockfile does not record, an extra fingerprint path that does not exist, one outside the lockfile's directory.

## `bounds.json`

The writer-side bounds, `deviceConditionMaxHashedIds` and `releaseMaxConditions`, tied to the package's exported constants by a test; a writer refuses a release above them, a reader parses any count, so raising a number later stays additive.
