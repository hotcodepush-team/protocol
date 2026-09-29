import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { ChannelIndexSchema } from '../wire/channel-index.js';
import type { DeviceInfo } from './device-info.js';
import type {
  ChannelIndexEvaluation,
  EvaluationOutcome,
} from './evaluate-channel-index.js';
import { evaluateChannelIndex } from './evaluate-channel-index.js';

interface ExpectedOutcome {
  condition?: string;
  isMandatory?: boolean;
  reason?: string;
  releaseId: string | null;
  status: string;
}

interface ExpectedVerdict {
  condition?: string;
  isEligible: boolean;
  reason?: string;
  releaseId: string;
}

interface FixtureCase {
  device: DeviceInfo;
  expected: ExpectedOutcome;
  index: unknown;
  name: string;
  verdicts?: ExpectedVerdict[];
}

interface FixtureFile {
  cases: FixtureCase[];
  description: string;
}

const FIXTURES_URL = new URL('../../fixtures/evaluation/', import.meta.url);

function readFixtureFiles(): [string, FixtureFile][] {
  return readdirSync(FIXTURES_URL)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => [
      name,
      JSON.parse(
        readFileSync(new URL(name, FIXTURES_URL), 'utf8'),
      ) as FixtureFile,
    ]);
}

function resolveExpectedOutcome(outcome: EvaluationOutcome): ExpectedOutcome {
  const releaseId = outcome.release?.id ?? null;
  switch (outcome.status) {
    case 'AVAILABLE':
      return {
        isMandatory: outcome.isMandatory,
        releaseId,
        status: outcome.status,
      };
    case 'SKIPPED':
      return {
        ...(outcome.condition === undefined
          ? {}
          : { condition: outcome.condition }),
        reason: outcome.reason,
        releaseId,
        status: outcome.status,
      };
    case 'UP_TO_DATE':
      return { releaseId, status: outcome.status };
  }
}

function resolveExpectedVerdicts(
  evaluation: ChannelIndexEvaluation,
): ExpectedVerdict[] {
  return evaluation.verdicts.map(verdict => ({
    ...(verdict.condition === undefined
      ? {}
      : { condition: verdict.condition }),
    isEligible: verdict.isEligible,
    ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
    releaseId: verdict.release.id,
  }));
}

describe('evaluateChannelIndex', () => {
  describe.each(readFixtureFiles())('%s', (_name, file) => {
    test.each(
      file.cases.map(fixtureCase => [fixtureCase.name, fixtureCase] as const),
    )('%s', (_caseName, fixtureCase) => {
      const parsed = ChannelIndexSchema.safeParse(fixtureCase.index);
      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      const evaluation = evaluateChannelIndex(parsed.data, fixtureCase.device);
      expect(resolveExpectedOutcome(evaluation.outcome)).toEqual(
        fixtureCase.expected,
      );
      if (fixtureCase.verdicts !== undefined) {
        expect(resolveExpectedVerdicts(evaluation)).toEqual(
          fixtureCase.verdicts,
        );
      }
    });
  });

  test('should keep every verdict in newest-first order', () => {
    const file = readFixtureFiles().find(([name]) => name === 'available.json');
    const fixtureCase = file?.[1].cases.find(entry =>
      entry.name.includes('not by their order'),
    );
    expect(fixtureCase).toBeDefined();
    if (fixtureCase === undefined) {
      return;
    }
    const evaluation = evaluateChannelIndex(
      ChannelIndexSchema.parse(fixtureCase.index),
      fixtureCase.device,
    );
    expect(evaluation.verdicts.map(verdict => verdict.release.number)).toEqual([
      3, 2, 1,
    ]);
  });
});
