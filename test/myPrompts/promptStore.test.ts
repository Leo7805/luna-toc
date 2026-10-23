/** @vitest-environment jsdom */
/** Shared Chrome backing store + separate tab-local prompt stores. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPromptStore, type SavedPrompt } from '@/features/myPrompts/promptStore';
import {
  createPromptWriteCoordinator, PROMPT_COMMIT_TYPE, PROMPT_STORAGE_KEY,
} from '@/features/myPrompts/promptWriteCoordinator';

const original: SavedPrompt = {
  id: 'saved', title: 'Saved', content: 'Keep me', createdAt: 1, updatedAt: 1,
};
const make = (id: string): SavedPrompt => ({
  id, title: id, content: id, createdAt: 2, updatedAt: 2,
});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let data: Record<string, unknown>;
let writeError: string | null;
let readError: string | null;
let sendError: string | null;
let listeners: Array<(changes: Record<string, {newValue: unknown}>, area: string) => void>;
let writeSpy: ReturnType<typeof vi.fn>;
let messages: ReturnType<typeof vi.fn>;
let getSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  data = { [PROMPT_STORAGE_KEY]: [original] };
  writeError = null;
  readError = null;
  sendError = null;
  listeners = [];
  getSpy = vi.fn((key: string, callback?: (result: Record<string, unknown>) => void) => {
    if (readError) {
      if (callback) {
        (chrome.runtime as unknown as { lastError: unknown }).lastError = { message: readError };
        callback({});
        (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
        return;
      }
      return Promise.reject(new Error(readError));
    }
    const result: Record<string, unknown> = Object.hasOwn(data, key) ? { [key]: copy(data[key]) } : {};
    if (callback) { callback(result); return; }
    return Promise.resolve(result);
  });
  writeSpy = vi.fn(async (values: Record<string, unknown>) => {
    if (writeError) throw new Error(writeError);
    Object.assign(data, copy(values));
    for (const listener of listeners) {
      listener({ [PROMPT_STORAGE_KEY]: { newValue: copy(values[PROMPT_STORAGE_KEY]) } }, 'local');
    }
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-test',
      lastError: null,
      sendMessage: vi.fn(),
    },
    storage: {
      local: { get: getSpy, set: writeSpy },
      onChanged: { addListener: (listener: typeof listeners[number]) => { listeners.push(listener); } },
    },
  });
  const coordinator = createPromptWriteCoordinator(chrome.storage.local);
  messages = vi.fn((message: unknown, callback: (result: unknown) => void) => {
    if (sendError) {
      (chrome.runtime as unknown as { lastError: unknown }).lastError = { message: sendError };
      callback(undefined);
      (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
      return;
    }
    void coordinator.commit(message).then(callback);
  });
  (chrome.runtime.sendMessage as typeof messages) = messages;
});

afterEach(() => vi.unstubAllGlobals());

describe('My Prompts serial cross-tab persistence', () => {
  it('uses background messages rather than direct writes and preserves legacy key', async () => {
    const store = createPromptStore();
    await store.update((prompts) => [...prompts, make('added')]);
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({
      type: PROMPT_COMMIT_TYPE,
      expected: [original],
    }), expect.any(Function));
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original, make('added')]);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not allow a failed or invalidated extension context to write', async () => {
    const store = createPromptStore();
    await expect(store.getAll()).resolves.toEqual([original]);
    (chrome.runtime as unknown as { id: string }).id = '';
    await expect(store.update(() => [])).rejects.toThrow('Invalid extension context');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('refuses to modify data when storage hydration fails', async () => {
    readError = 'storage unavailable';
    const store = createPromptStore();
    await expect(store.update(() => [])).rejects.toThrow('storage unavailable');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('never exposes mutable cached prompt objects', async () => {
    const store = createPromptStore();
    const current = await store.getAll();
    current[0].title = 'Modified externally';
    expect((await store.getAll())[0].title).toBe('Saved');
  });

  it('keeps the previous data after a rejected background storage write', async () => {
    const store = createPromptStore();
    await store.getAll();
    writeError = 'quota exceeded';
    await expect(store.update(() => [])).rejects.toThrow('quota exceeded');
    expect(await store.getAll()).toEqual([original]);
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
  });

  it('two tabs adding distinct prompts concurrently both persist', async () => {
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    await Promise.all([
      tabA.update((prompts) => [...prompts, make('tab-a')]),
      tabB.update((prompts) => [...prompts, make('tab-b')]),
    ]);
    expect((await tabA.getAll()).map((prompt) => prompt.id).sort())
      .toEqual(['saved', 'tab-a', 'tab-b']);
    expect((await tabB.getAll()).map((prompt) => prompt.id).sort())
      .toEqual(['saved', 'tab-a', 'tab-b']);
    expect(writeSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent edits to different IDs preserve both updates', async () => {
    data[PROMPT_STORAGE_KEY] = [original, make('other')];
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    await Promise.all([
      tabA.update((prompts) => {
        prompts[0].title = 'from A'; return prompts;
      }),
      tabB.update((prompts) => {
        prompts[1].title = 'from B'; return prompts;
      }),
    ]);
    const current = await tabA.getAll();
    expect(current.map((prompt) => prompt.title)).toEqual(['from A', 'from B']);
  });

  it('same-record stale editor guard refuses to silently overwrite the other edit', async () => {
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    const observed = (await tabB.getAll())[0];
    await tabA.update((prompts) => {
      prompts[0].title = 'new A'; prompts[0].updatedAt = 2; return prompts;
    });
    await expect(tabB.update((prompts) => {
      if (prompts[0].updatedAt !== observed.updatedAt ||
          prompts[0].title !== observed.title) {
        throw new Error('Prompt was changed in another tab');
      }
      prompts[0].title = 'from B'; return prompts;
    })).rejects.toThrow('another tab');
    expect((await tabA.getAll())[0].title).toBe('new A');
  });

  it('does not delete an unexpected new prompt during guarded clear-all', async () => {
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    const before = await tabB.getAll();
    await tabA.update((prompts) => [...prompts, make('new')]);
    await expect(tabB.update((prompts) => {
      if (prompts.length !== before.length) throw new Error('New prompts appeared');
      return [];
    })).rejects.toThrow('New prompts');
    expect((await tabB.getAll()).length).toBe(2);
  });

  it('rejects full replace when another tab changed the snapshot', async () => {
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    const observed = await tabB.getAll();
    // A concurrent edit not yet broadcast to B is still checked against Chrome storage.
    listeners.length = 0;
    await tabA.update((prompts) => [...prompts, make('new')]);
    observed.length = 0;
    await expect(tabB.saveAll(observed)).rejects.toThrow('changed in another tab');
    expect((await tabA.getAll()).length).toBe(2);
  });

  it('background interruption is surfaced and a manual retry can succeed', async () => {
    const tabA = createPromptStore();
    sendError = 'Service worker was suspended';
    await expect(tabA.update((prompts) => [...prompts, make('new')]))
      .rejects.toThrow('suspended');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
    sendError = null;
    await tabA.update((prompts) => [...prompts, make('new')]);
    expect((await tabA.getAll()).length).toBe(2);
  });

  it('does not poison the queue after a failed write', async () => {
    const store = createPromptStore();
    writeError = 'quota exceeded';
    await expect(store.update(() => [])).rejects.toThrow('quota exceeded');
    writeError = null;
    await store.update((prompts) => [...prompts, make('recovered')]);
    expect((await store.getAll()).map((prompt) => prompt.id)).toEqual(['saved', 'recovered']);
  });


  it('rejects a stale list even when onChanged has already refreshed the local cache', async () => {
    const tabA = createPromptStore();
    const tabB = createPromptStore();
    const observed = await tabB.getAll();
    await tabA.update((prompts) => [...prompts, make('from-a')]);
    observed.push(make('from-b'));
    await expect(tabB.saveAll(observed)).rejects.toThrow('changed in another tab');
    expect((await tabB.getAll()).map((p) => p.id)).toEqual(['saved', 'from-a']);
  });

  it('permits explicitly observed whole-list replacement when unchanged', async () => {
    const tab = createPromptStore();
    const observed = await tab.getAll();
    observed.push(make('added'));
    await tab.saveAll(observed);
    expect((await tab.getAll()).map((p) => p.id)).toEqual(['saved', 'added']);
  });

  it('refuses an untracked copy as a destructive full-list replacement', async () => {
    const tab = createPromptStore();
    const observed = await tab.getAll();
    await expect(tab.saveAll([...observed])).rejects.toThrow('Read prompts');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
  });

  it('refuses an unverified full replacement rather than silently erasing data', async () => {
    const store = createPromptStore();
    await expect(store.saveAll([])).rejects.toThrow('Read prompts');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
  });
});
