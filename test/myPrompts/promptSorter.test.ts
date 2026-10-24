/** Tests pure sorting logic and sort modes for saved prompts. */
import { describe, expect, it } from 'vitest';

import { sortMyPrompts } from '@/features/myPrompts/promptSorter';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

function createPrompt(id: string, title: string, updatedAt: number): SavedPrompt {
  return {
    id,
    ownerId: 'account-1',
    title,
    content: `Content for ${title}`,
    createdAt: 1000,
    updatedAt,
  };
}

describe('promptSorter', () => {
  it('returns an empty array when given an empty list', () => {
    expect(sortMyPrompts([], 'updated_desc')).toEqual([]);
  });

  it('does not mutate the original array and returns a new copy', () => {
    const p1 = createPrompt('1', 'B', 100);
    const p2 = createPrompt('2', 'A', 200);
    const original = [p1, p2];

    const sorted = sortMyPrompts(original, 'updated_desc');

    expect(sorted).not.toBe(original);
    expect(original[0]).toBe(p1);
    expect(original[1]).toBe(p2);
  });

  it('sorts by updated_desc (newest modified first)', () => {
    const p1 = createPrompt('1', 'Oldest', 100);
    const p2 = createPrompt('2', 'Newest', 300);
    const p3 = createPrompt('3', 'Middle', 200);

    const result = sortMyPrompts([p1, p2, p3], 'updated_desc');

    expect(result.map((p) => p.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by updated_asc (oldest modified first)', () => {
    const p1 = createPrompt('1', 'Oldest', 100);
    const p2 = createPrompt('2', 'Newest', 300);
    const p3 = createPrompt('3', 'Middle', 200);

    const result = sortMyPrompts([p1, p2, p3], 'updated_asc');

    expect(result.map((p) => p.id)).toEqual(['1', '3', '2']);
  });

  it('sorts by name_asc (alphabetical title A-Z)', () => {
    const p1 = createPrompt('1', 'Zebra', 300);
    const p2 = createPrompt('2', 'Apple', 100);
    const p3 = createPrompt('3', 'Mango', 200);

    const result = sortMyPrompts([p1, p2, p3], 'name_asc');

    expect(result.map((p) => p.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('sorts by name_desc (alphabetical title Z-A)', () => {
    const p1 = createPrompt('1', 'Zebra', 300);
    const p2 = createPrompt('2', 'Apple', 100);
    const p3 = createPrompt('3', 'Mango', 200);

    const result = sortMyPrompts([p1, p2, p3], 'name_desc');

    expect(result.map((p) => p.title)).toEqual(['Zebra', 'Mango', 'Apple']);
  });
});
