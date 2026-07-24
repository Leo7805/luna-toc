/** Tests batched prompt-indexed fingerprint generation. */
import { describe, expect, it, vi } from 'vitest';
import {
  buildFingerprintIndex,
  flattenResponseTasks,
  type FingerprintIndexOptions,
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

  it('groups multiple responses under their prompt index', async () => {
    const index = await buildFingerprintIndex(turns, options);

    expect(index).toHaveLength(2);
    expect(index[0]?.promptIndex).toBe(0);
    expect(index[0]?.fingerprints.length).toBeGreaterThan(0);
    expect(
      new Set(index[0]?.fingerprints.map(({ responseId }) => responseId))
    ).toEqual(new Set(['ai-1', 'ai-2']));
    expect(index[1]).toEqual({
      promptIndex: 1,
      fingerprints: [],
    });
  });

  it('yields between configured batches without mutating the turns', async () => {
    const originalTurns = structuredClone(turns);
    const yieldControl = vi.fn(async () => undefined);

    await buildFingerprintIndex(
      turns,
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
      options
    );

    expect(index).toEqual([{ promptIndex: 0, fingerprints: [] }]);
  });
});
