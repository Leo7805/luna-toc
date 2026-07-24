/** Tests batched prompt-indexed fingerprint generation. */
import { describe, expect, it, vi } from 'vitest';
import {
  buildFingerprintIndex,
  flattenResponseTasks,
  mergeFingerprintRecords,
  shouldReplaceFingerprintRecord,
  upsertFingerprintRecord,
  type FingerprintIndexOptions,
  type ResponseFingerprintRecord,
} from '@/features/navigation/fingerprint/index';
import type { NavigationTurn } from '@/features/navigation/navigationData';

const options: FingerprintIndexOptions = {
  countPerAssistant: 3,
  probeLength: 4,
  verificationLength: 8,
  buildBatchSize: 10,
  buildTimeBudgetMs: Number.POSITIVE_INFINITY,
};

const turns: NavigationTurn[] = [
  {
    promptIndex: 0,
    prompt: { id: 'user-1', text: 'First prompt' },
    responses: [
      { id: 'ai-1', text: 'First response text' },
      { id: 'ai-2', text: 'Second response text' },
    ],
  },
  {
    promptIndex: 1,
    prompt: { id: 'user-2', text: 'Second prompt' },
    responses: [],
  },
];

describe('fingerprint index', () => {
  it('flattens responses while preserving prompt ownership and order', () => {
    expect(flattenResponseTasks(turns)).toEqual([
      { promptIndex: 0, response: turns[0]?.responses[0] },
      { promptIndex: 0, response: turns[0]?.responses[1] },
    ]);
  });

  it('creates one derived record per non-empty response', async () => {
    const index = await buildFingerprintIndex(
      turns,
      'derived',
      options
    );

    expect(index).toHaveLength(2);
    expect(index.map(({ responseId }) => responseId)).toEqual([
      'ai-1',
      'ai-2',
    ]);
    index.forEach((record) => {
      expect(record.promptIndex).toBe(0);
      expect(record.quality).toBe('derived');
      expect(record.fingerprints.length).toBeGreaterThan(0);
    });
  });

  it('marks DOM-built records as observed', async () => {
    const index = await buildFingerprintIndex(
      [turns[0]!],
      'observed',
      options
    );

    expect(index.every(({ quality }) => quality === 'observed')).toBe(true);
  });

  it('yields between configured batches without mutating the turns', async () => {
    const originalTurns = structuredClone(turns);
    const yieldControl = vi.fn(async () => undefined);

    await buildFingerprintIndex(
      turns,
      'derived',
      {
        ...options,
        buildBatchSize: 1,
      },
      yieldControl
    );

    expect(yieldControl).toHaveBeenCalledTimes(1);
    expect(turns).toEqual(originalTurns);
  });

  it('does not generate fingerprints for empty responses', async () => {
    const index = await buildFingerprintIndex(
      [
        {
          promptIndex: 0,
          prompt: { id: 'user', text: 'Prompt' },
          responses: [{ id: 'empty', text: ' \n ' }],
        },
      ],
      'derived',
      options
    );

    expect(index).toEqual([]);
  });

  it('allows observed records to replace derived records', () => {
    const derived = createRecord('derived', 'Derived');
    const observed = createRecord('observed', 'Observed');

    expect(shouldReplaceFingerprintRecord(derived, observed)).toBe(true);
    expect(mergeFingerprintRecords([derived], [observed])).toEqual([
      observed,
    ]);
  });

  it('does not allow derived records to replace observed records', () => {
    const observed = createRecord('observed', 'Observed');
    const derived = createRecord('derived', 'Derived');

    expect(shouldReplaceFingerprintRecord(observed, derived)).toBe(false);
    expect(upsertFingerprintRecord([observed], derived)).toEqual([
      observed,
    ]);
  });

  it('updates equal-quality records without creating duplicates', () => {
    const first = createRecord('observed', 'First');
    const updated = createRecord('observed', 'Updated');
    const merged = upsertFingerprintRecord([first], updated);

    expect(merged).toEqual([updated]);
    expect(merged).toHaveLength(1);
  });
});

function createRecord(
  quality: ResponseFingerprintRecord['quality'],
  probeText: string
): ResponseFingerprintRecord {
  return {
    responseId: 'response-1',
    promptIndex: 0,
    quality,
    fingerprints: [
      {
        responseId: 'response-1',
        sampleIndex: 0,
        textOffset: 0,
        probeText,
        verificationHash: 'hash',
        verificationLength: 4,
      },
    ],
  };
}
