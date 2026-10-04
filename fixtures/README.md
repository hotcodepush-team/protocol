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

`{ name, resourceFile, embeddedBundleManifest }`: a resource file as the embed step writes it, valid against `ConfigurationSchema`, and its embedded bundle's manifest as a reader reads it — the bundle manifest, the same shape whether the embed step registered the bundle or not, `embeddedBundleId` null when it did not.
The file carries `channelId`, the id the embed step resolved from the project's `channel` name, the SDK options with their defaults where the project left them out, and `filesBaseUrl` and `updatesBaseUrl` in a build against staging or the local stack alone; a reader applies the defaults the schema names.
`channelId` is `null` in a build whose embed step ran without a token or offline and could not resolve the name: a reader takes the file, and the device then answers `FAILED` with `UNKNOWN_CHANNEL`, requests nothing and reports nothing until a channel is set at runtime.
`publicKeys` are the project's public keys as the embed step re-encoded them for the platform the file is written for, `{ der, keyId }` each: `der` the base64 of the key's PKCS #1 DER in an iOS build and of its SPKI DER in an Android build, so the platform's own API imports it with no ASN.1 handled on the device, `keyId` the fingerprint over the SPKI bytes; one case per platform carries them.

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
`patchCases` are `{ name, heldSha256s, manifestFiles, patchEntry, outcome }`: a patch entry, the hashes of the files the device holds in its file store and its embedded bundle, the files of the signed manifest it installs, and one of three outcomes, none of which fails the update.
`applied`: the device applies the patch to the file `fromSha256` it holds, and the patched bytes hash to `toSha256`.
`fallback`: the device fetches the file `toSha256` as it fetches any file the pack did not bring — when it does not hold the base, the patch is truncated, the patched bytes hash to another file, or the patch's control triples seek before the start of the base.
`ignored`: `toSha256` is not a file of the manifest, and the device leaves the entry aside.

The two valid patches are fixed inputs in `scripts/pack-entries/`, written once by Colin Percival's bsdiff 4.3; the hostile one, whose control triples seek before the base, is crafted by the generator, `scripts/generate-pack-entries-fixture.ts`, so rebuilding the fixture needs no bsdiff.

## `wire-rules.json`

The rules every reader enforces before a byte is written, as whole documents in six arrays — `acceptedIndexes`, `refusedIndexes`, `acceptedManifests`, `refusedManifests`, `acceptedEnvelopes`, `refusedEnvelopes` — each case `{ name, index | manifest | envelope }`.
Ids are `[A-Za-z0-9_-]{1,64}`, a hash is 64 lowercase hex, a manifest path is relative and `/`-separated with no empty, `.` or `..` segment, no backslash and no NUL, timestamps are UTC with a `Z`, and every field of a shape is present, a nullable one as `null`, never absent.
The refused cases pin where the three readers once diverged — a default for an absent field, a lenient type, an offset timestamp, a `..` segment hidden behind a combining mark — so a refusal is the same refusal on every platform.
A manifest or an envelope stored while bundles carried `patches` is accepted and the field ignored, as any field a reader does not know is; one accepted envelope carries it on itself and in its manifest.

## `signatures.json`

One scheme is allowed, `rsa-v1_5-sha256`: RSASSA-PKCS1-v1_5 with SHA-256, which Web Crypto, iOS's Security framework, Android's `Signature` and Expo's clients verify alike.
`keys` are test key pairs, `{ name, bits, publicKey, privateKey, fingerprint }`: the public key self-describing, `rsa-v1_5-sha256:` and the base64 of its SPKI DER, the private key the base64 of its PKCS #8 DER, the fingerprint `sha256:` and the hex SHA-256 of the SPKI bytes.
`manifests` are `{ name, envelope, publicKeys, devicePublicKeys, isValid }`: an envelope whose `manifest` is the canonical JSON of the signed content, verified against the listed keys; tampered bytes, a key the verifier does not hold, a null signature, a value under another prefix — `ed25519:` included, an unknown scheme — and a key under 2048 bits are refused.
A case lists its keys twice over: `publicKeys` as `hotcodepush.json` lists them, and `devicePublicKeys.android` and `devicePublicKeys.ios` as a resource file carries them, `{ der, keyId }` — the base64 of the SPKI DER for Android's `X509EncodedKeySpec`, of the PKCS #1 DER for iOS's `SecKeyCreateWithData`, each beside the fingerprint a signature names, since a device cannot recompute it from PKCS #1 bytes.
The size of a key is read from the key the platform imported, never from its bytes.
They are test keys, generated once, and sign nothing real.
`scripts/generate-signatures-fixture.ts` re-signs every case with those same keys through the built package, so it runs after `npm run build`; the scheme signs deterministically, so an unchanged manifest yields the same file.

## `fingerprints.json`

`cases` are sample projects, `{ name, files, nativeSourcePaths, contributors, fingerprint }`: a lockfile and the installed packages' marker files as `files`, the contributors the recipe yields — one entry per name, version and integrity, the lockfile's integrity hash, yarn berry's checksum, else the resolved URL — and the `fp1:` hash of the canonical contract.
npm, pnpm and yarn classic yield one fingerprint for one dependency set; yarn berry yields its own, since its checksum is not the registry's integrity.
`refusedProjects` are the projects the recipe refuses: two lockfiles, none, an npm lockfile below version 2, a pnpm lockfile below 9, a missing `node_modules`, a declared native source that does not exist.

## `expo-updates.json`

One uploaded Expo export as `input` — `bundleId`, `bundleManifest`, `createdAt`, `expoClientConfig`, `exportMetadata`, `filesBaseUrl`, `runtimeVersion` — and the documents built from it: `manifests` per platform, the launch asset keyed by its SHA-256 hex and every asset by the MD5 hex of its export path, each naming its own update id in the metadata under `hotcodepush-update`, and the two `directives`, `noUpdateAvailable` and `rollBackToEmbedded`, Expo's own.
A manifest's bytes are what the CLI signs at upload and the bridge serves verbatim.
The bridge serves no directive, since it holds no key to sign one with: it answers the protocol's empty `204` for no update and says which stored update a client runs through `expo-manifest-filters` on that metadata key.

## `bounds.json`

The writer-side bounds, `deviceConditionMaxHashedIds` and `releaseMaxConditions`, tied to the package's exported constants by a test; a writer refuses a release above them, a reader parses any count, so raising a number later stays additive.
