/**
 * Takes `patches` out of the unsigned fixtures, once: every manifest and
 * envelope of `wire-rules.json` loses the field, in its manifest string too,
 * the seven patch-only cases go, and one case keeps an envelope stored before
 * the removal, which still parses; `expo-updates.json`'s input manifest and
 * `resource-files.json`'s description follow. `npm run fmt` formats the result.
 *
 *     node scripts/remove-manifest-patches.ts && npm run fmt
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface WireRuleCase {
  envelope?: Record<string, unknown>;
  manifest?: unknown;
  name: string;
}

type WireRules = Record<string, unknown> &
  Record<
    | 'acceptedEnvelopes'
    | 'acceptedManifests'
    | 'refusedEnvelopes'
    | 'refusedManifests',
    WireRuleCase[]
  >;

/** Seven cases: the patch path's name stands in the manifests and in the envelopes. */
const PATCH_ONLY_CASE_NAMES = [
  'should accept a manifest without patches entries',
  'should refuse a manifest without patches',
  'should refuse a patch path that climbs out of the bundle',
  'should refuse a patch hash that is not hex',
  'should refuse an envelope without patches',
  'should refuse a patch without sizeBytes',
];
const RENAMED_CASE_NAMES = new Map([
  [
    'should accept a field it does not know, on the envelope, a delta and a patch',
    'should accept a field it does not know, on the envelope and on a delta',
  ],
  [
    'should accept an envelope without deltas or patches entries',
    'should accept an envelope without deltas entries',
  ],
]);
const STORED_ENVELOPE_CASE_NAME =
  'should accept an envelope stored while bundles carried patches, on the envelope and in its manifest';

const wireRules = readFixture<WireRules>('wire-rules.json');
const storedEnvelope = wireRules.acceptedEnvelopes.find(
  ({ name }) => name === 'should accept the envelope as complete writes it',
)?.envelope;
if (storedEnvelope === undefined) {
  throw new Error('wire-rules.json holds no envelope as complete writes it');
}
let removedCaseCount = 0;
for (const key of [
  'acceptedEnvelopes',
  'acceptedManifests',
  'refusedEnvelopes',
  'refusedManifests',
] as const) {
  const keptCases = wireRules[key].filter(
    ({ name }) => !PATCH_ONLY_CASE_NAMES.includes(name),
  );
  removedCaseCount += wireRules[key].length - keptCases.length;
  wireRules[key] = keptCases.map(wireRuleCase => ({
    ...wireRuleCase,
    ...(wireRuleCase.envelope === undefined
      ? { manifest: removePatches(wireRuleCase.manifest) }
      : { envelope: removeEnvelopePatches(wireRuleCase.envelope) }),
    name: RENAMED_CASE_NAMES.get(wireRuleCase.name) ?? wireRuleCase.name,
  }));
}
if (removedCaseCount !== 7) {
  throw new Error(
    `removed ${removedCaseCount} cases, not the seven patch-only ones`,
  );
}
wireRules.acceptedEnvelopes.push({
  name: STORED_ENVELOPE_CASE_NAME,
  envelope: storedEnvelope,
});
writeFixture('wire-rules.json', wireRules);

const expoUpdates = readFixture<{ input: { bundleManifest: unknown } }>(
  'expo-updates.json',
);
expoUpdates.input.bundleManifest = removePatches(
  expoUpdates.input.bundleManifest,
);
writeFixture('expo-updates.json', expoUpdates);

const resourceFiles = readFixture<{ description: string }>(
  'resource-files.json',
);
const embeddedManifestSentence =
  "The embedded bundle's manifest is the bundle manifest without patches,";
if (!resourceFiles.description.includes(embeddedManifestSentence)) {
  throw new Error(
    'resource-files.json no longer describes the manifest without patches',
  );
}
resourceFiles.description = resourceFiles.description.replace(
  embeddedManifestSentence,
  "The embedded bundle's manifest is the bundle manifest,",
);
writeFixture('resource-files.json', resourceFiles);

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

function removeEnvelopePatches(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  const { manifest } = envelope;
  const keptEnvelope = removePatches(envelope) as Record<string, unknown>;
  if (typeof manifest !== 'string' || !manifest.startsWith('{')) {
    return keptEnvelope;
  }
  // The manifest strings are compact JSON with sorted keys, so dropping a key keeps them canonical.
  if (JSON.stringify(JSON.parse(manifest)) !== manifest) {
    throw new Error(`a manifest string is not compact JSON: ${manifest}`);
  }
  return {
    ...keptEnvelope,
    manifest: JSON.stringify(removePatches(JSON.parse(manifest))),
  };
}

function removePatches(document: unknown): unknown {
  if (typeof document !== 'object' || document === null) {
    return document;
  }
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== 'patches'),
  );
}

function writeFixture(name: string, fixture: unknown): void {
  writeFileSync(
    new URL(`../fixtures/${name}`, import.meta.url),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
}
