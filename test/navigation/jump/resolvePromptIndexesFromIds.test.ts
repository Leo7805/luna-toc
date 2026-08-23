/** Tests exact message-ID → prompt-index position resolution. */
import { describe, expect, it } from 'vitest';

import { resolvePromptIndexesFromIds } from '@/navigation/jump/visiblePositionResolver';

const prompts = [
  { id: 'prompt-a' },
  { id: 'prompt-b' },
  { id: 'prompt-c' },
  { id: 'prompt-d' },
];

describe('resolvePromptIndexesFromIds', () => {
  it('maps ids to their prompt indexes in order', () => {
    const position = resolvePromptIndexesFromIds(['prompt-b', 'prompt-d'], prompts);

    expect(position?.status).toBe('located');
    if (position?.status !== 'located') return;

    expect(position.firstPromptIndex).toBe(1);
    expect(position.lastPromptIndex).toBe(3);
    expect(position.matchedPromptIndexes).toEqual([1, 3]);
    expect(position.matchedBlocks).toEqual([
      { blockId: 'prompt-b', promptIndex: 1, source: 'user-message-id' },
      { blockId: 'prompt-d', promptIndex: 3, source: 'user-message-id' },
    ]);
  });

  it('sorts matched indexes regardless of input order', () => {
    const position = resolvePromptIndexesFromIds(['prompt-d', 'prompt-a'], prompts);

    expect(position?.status).toBe('located');
    if (position?.status !== 'located') return;

    expect(position.matchedPromptIndexes).toEqual([0, 3]);
    expect(position.firstPromptIndex).toBe(0);
    expect(position.lastPromptIndex).toBe(3);
  });

  it('skips null, empty, and unknown ids', () => {
    const position = resolvePromptIndexesFromIds(
      [null, undefined, '', 'unknown', 'prompt-b'],
      prompts
    );

    expect(position?.status).toBe('located');
    if (position?.status !== 'located') return;

    expect(position.matchedPromptIndexes).toEqual([1]);
    expect(position.matchedBlocks).toEqual([
      { blockId: 'prompt-b', promptIndex: 1, source: 'user-message-id' },
    ]);
  });

  it('deduplicates repeated ids', () => {
    const position = resolvePromptIndexesFromIds(
      ['prompt-b', 'prompt-b', 'prompt-c'],
      prompts
    );

    expect(position?.status).toBe('located');
    if (position?.status !== 'located') return;

    expect(position.matchedPromptIndexes).toEqual([1, 2]);
    expect(position.matchedBlocks).toHaveLength(2);
  });

  it('returns null when nothing matches', () => {
    expect(
      resolvePromptIndexesFromIds(['x', 'y', null, undefined], prompts)
    ).toBeNull();
  });

  it('returns null for empty prompts', () => {
    expect(resolvePromptIndexesFromIds(['prompt-a'], [])).toBeNull();
  });
});
