/** @vitest-environment jsdom */
/** Guards against silent prompt loss after extension context invalidation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPromptStore } from '@/features/myPrompts/promptStore';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

const key = 'lumaToc:myPromptsV1';
const original: SavedPrompt = { id: 'saved', title: 'Saved', content: 'Keep me', createdAt: 1, updatedAt: 1 };
let writeError: string | null;
let writeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeError = null;
  writeSpy = vi.fn((value: Record<string, unknown>, callback: () => void) => {
    (chrome.runtime as unknown as { lastError: { message: string } | null }).lastError =
      writeError ? { message: writeError } : null;
    callback();
    (chrome.runtime as unknown as { lastError: { message: string } | null }).lastError = null;
  });
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension-test', lastError: null },
    storage: {
      local: {
        get: vi.fn((_key: string, callback: (result: Record<string, unknown>) => void) => {
          callback({ [key]: [original] });
        }),
        set: writeSpy,
      },
      onChanged: { addListener: vi.fn() },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('promptStore persistence', () => {
  it('rejects an invalidated extension context without falsely saving', async () => {
    const store = createPromptStore();
    await expect(store.getAll()).resolves.toEqual([original]);
    (chrome.runtime as unknown as { id: string }).id = '';
    await expect(store.saveAll([])).rejects.toThrow('prompts were not saved');
    await expect(store.getAll()).resolves.toEqual([original]);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('refuses to overwrite prompts if storage hydration never succeeded', async () => {
    const local = chrome.storage.local as unknown as { get: ReturnType<typeof vi.fn> };
    local.get.mockImplementation((_key: string, callback: (value: unknown) => void) => {
      (chrome.runtime as unknown as { lastError: { message: string } | null }).lastError =
        { message: 'storage unavailable' };
      callback({});
      (chrome.runtime as unknown as { lastError: { message: string } | null }).lastError = null;
    });
    const store = createPromptStore();
    await expect(store.saveAll([])).rejects.toThrow('refusing to overwrite');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('never exposes mutable cached prompt objects', async () => {
    const store = createPromptStore();
    const first = await store.getAll();
    first[0].title = 'Changed outside storage';
    expect((await store.getAll())[0].title).toBe('Saved');
  });

  it('rolls back edits to an existing prompt when storage rejects a write', async () => {
    const store = createPromptStore();
    await store.getAll();
    writeError = 'quota exceeded';
    await expect(store.update((prompts) => {
      prompts[0].title = 'Unsaved change';
      return prompts;
    })).rejects.toThrow('quota exceeded');
    expect((await store.getAll())[0].title).toBe('Saved');
  });

  it('serializes concurrent transformations instead of losing an update', async () => {
    const store = createPromptStore();
    const operations = [
      store.update((prompts) => [...prompts, {
        id: 'one', title: 'One', content: '1', createdAt: 2, updatedAt: 2,
      }]),
      store.update((prompts) => [...prompts, {
        id: 'two', title: 'Two', content: '2', createdAt: 3, updatedAt: 3,
      }]),
    ];
    await Promise.all(operations);
    expect((await store.getAll()).map((prompt) => prompt.id)).toEqual(['saved', 'one', 'two']);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect((writeSpy.mock.calls[1][0][key] as SavedPrompt[]).map((prompt) => prompt.id))
      .toEqual(['saved', 'one', 'two']);
  });

  it('restores the prior cache and rejects a failed Chrome storage write', async () => {
    const store = createPromptStore();
    await store.getAll();
    writeError = 'quota exceeded';
    await expect(store.saveAll([])).rejects.toThrow('quota exceeded');
    await expect(store.getAll()).resolves.toEqual([original]);
  });
});
