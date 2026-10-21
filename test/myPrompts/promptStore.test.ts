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

  it('restores the prior cache and rejects a failed Chrome storage write', async () => {
    const store = createPromptStore();
    await store.getAll();
    writeError = 'quota exceeded';
    await expect(store.saveAll([])).rejects.toThrow('quota exceeded');
    await expect(store.getAll()).resolves.toEqual([original]);
  });
});
