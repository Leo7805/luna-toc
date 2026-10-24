/** @vitest-environment jsdom */
/** A two-key clear must remain consistent under concurrent and partial writes. */
import { describe, expect, it, vi } from 'vitest';
import { createPromptWriteCoordinator, PROMPT_COMMIT_TYPE, PROMPT_STORAGE_KEY } from '@/features/myPrompts/promptWriteCoordinator';
import { createPromptUsageWriteCoordinator, PROMPT_USAGE_COMMIT_TYPE } from '@/features/myPrompts/promptUsageWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const USAGE = 'lunaToc:promptUsageV1';
const prompt: SavedPrompt = { id: 'saved', title: 'Saved', content: 'Text', createdAt: 1, updatedAt: 1 };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const clear = () => ({ type: PROMPT_COMMIT_TYPE, action: 'clear-all' as const, expected: [prompt] });

function harness() {
  const state: Record<string, unknown> = {
    [PROMPT_STORAGE_KEY]: [prompt],
    [USAGE]: { saved: { usageCount: 3, lastUsedAt: 1 } },
  };
  let failAfterMutation = false;
  let alwaysFail = false;
  const get = vi.fn(async (keys: string | string[]) =>
    Object.fromEntries((Array.isArray(keys) ? keys : [keys])
      .filter((key) => Object.hasOwn(state, key)).map((key) => [key, clone(state[key])]))
  );
  const set = vi.fn(async (values: Record<string, unknown>) => {
    if (alwaysFail) throw new Error('storage offline');
    Object.assign(state, clone(values));
    if (failAfterMutation) {
      failAfterMutation = false;
      throw new Error('partial storage write');
    }
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
  });
  const storage = { get, set, remove } as unknown as chrome.storage.StorageArea;
  return { state, get, set, remove, storage,
    failAfterMutation: () => { failAfterMutation = true; },
    failPermanently: () => { alwaysFail = true; } };
}

describe('coordinated clear-all', () => {
  it('clears prompts and usage together and rejects stale repeat clears', async () => {
    const box = harness();
    const writer = createPromptWriteCoordinator(box.storage);
    expect(await writer.commit(clear())).toEqual({ ok: true });
    expect(box.state[PROMPT_STORAGE_KEY]).toEqual([]);
    expect(box.state[USAGE]).toEqual({});
    expect(await writer.commit(clear())).toEqual({ ok: false, conflict: true });
  });

  it('rolls back both keys after partial write failure', async () => {
    const box = harness();
    box.failAfterMutation();
    const result = await createPromptWriteCoordinator(box.storage).commit(clear());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('已恢复') });
    expect(box.state[PROMPT_STORAGE_KEY]).toEqual([prompt]);
    expect(box.state[USAGE]).toEqual({ saved: { usageCount: 3, lastUsedAt: 1 } });
  });

  it('accepts verified rollback when Chrome reorders nested JSON object keys', async () => {
    const box = harness();
    const originalGet = box.get.getMockImplementation()!;
    let readCount = 0;
    box.get.mockImplementation(async (keys: string | string[]) => {
      const values = await originalGet(keys);
      readCount += 1;
      if (readCount > 1 && values[USAGE]) {
        const usage = (values[USAGE] as Record<string, { usageCount: number; lastUsedAt: number }>).saved;
        if (usage) values[USAGE] = { saved: { lastUsedAt: usage.lastUsedAt, usageCount: usage.usageCount } };
      }
      return values;
    });
    box.failAfterMutation();
    expect(await createPromptWriteCoordinator(box.storage).commit(clear()))
      .toMatchObject({ ok: false, error: expect.stringContaining('已恢复') });
  });

  it('does not claim rollback succeeded during a persistent storage failure', async () => {
    const box = harness();
    box.failPermanently();
    const result = await createPromptWriteCoordinator(box.storage).commit(clear());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('回滚也失败') });
  });

  it('serializes a usage update after a successful clear', async () => {
    const box = harness();
    const queue = createSerialWriteQueue();
    const writer = createPromptWriteCoordinator(box.storage, queue);
    const usage = createPromptUsageWriteCoordinator(box.storage, queue);
    const [cleared, recorded] = await Promise.all([
      writer.commit(clear()),
      usage.commit({ type: PROMPT_USAGE_COMMIT_TYPE, action: 'record-use', promptId: 'saved' }),
    ]);
    expect(cleared).toEqual({ ok: true });
    // The usage operation is serialized; it cannot restore the deleted prompt.
    expect(box.state[PROMPT_STORAGE_KEY]).toEqual([]);
    expect(recorded).toMatchObject({ ok: false, error: expect.stringContaining('no longer exists') });
    expect(box.state[USAGE]).toEqual({});
  });
});
