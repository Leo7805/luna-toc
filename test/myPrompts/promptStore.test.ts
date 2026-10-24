/** @vitest-environment jsdom */
/** Single-tab prompt persistence with an acknowledged background writer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPromptStore, type SavedPrompt } from '@/features/myPrompts/promptStore';
import { setActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';
import {
  createPromptWriteCoordinator, PROMPT_COMMIT_TYPE, PROMPT_STORAGE_KEY,
} from '@/features/myPrompts/promptWriteCoordinator';

const original: SavedPrompt = {
  id: 'saved', ownerId: 'account-1', title: 'Saved', content: 'Keep me', createdAt: 1, updatedAt: 1,
};
const make = (id: string): SavedPrompt => ({
  id, ownerId: 'account-1', title: id, content: id, createdAt: 2, updatedAt: 2,
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
  setActiveConversationOwner('account-1');
  data = { [PROMPT_STORAGE_KEY]: [original] };
  writeError = null;
  readError = null;
  sendError = null;
  listeners = [];
  getSpy = vi.fn((key: string | string[], callback?: (result: Record<string, unknown>) => void) => {
    if (readError) {
      if (callback) {
        (chrome.runtime as unknown as { lastError: unknown }).lastError = { message: readError };
        callback({});
        (chrome.runtime as unknown as { lastError: unknown }).lastError = null;
        return;
      }
      return Promise.reject(new Error(readError));
    }
    const keys = Array.isArray(key) ? key : [key];
    const result: Record<string, unknown> = Object.fromEntries(
      keys.filter((name) => Object.hasOwn(data, name)).map((name) => [name, copy(data[name])])
    );
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

afterEach(() => { vi.unstubAllGlobals(); setActiveConversationOwner(null); });

describe('single-tab My Prompts storage', () => {
  it('saves through the background and retains the storage key', async () => {
    const store = createPromptStore();
    await store.update((prompts) => [...prompts, make('added')]);
    expect(messages).toHaveBeenCalledWith(expect.objectContaining({
      type: PROMPT_COMMIT_TYPE, action: 'replace-account', ownerId: 'account-1', next: [original, make('added')],
    }), expect.any(Function));
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original, make('added')]);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('orders multiple changes within one tab without losing data', async () => {
    const store = createPromptStore();
    await Promise.all([
      store.update((prompts) => [...prompts, make('first')]),
      store.update((prompts) => [...prompts, make('second')]),
    ]);
    expect((await store.getAll()).map((prompt) => prompt.id))
      .toEqual(['saved', 'first', 'second']);
  });

  it('does not write from an invalid extension context', async () => {
    const store = createPromptStore();
    await store.getAll();
    (chrome.runtime as unknown as { id: string }).id = '';
    await expect(store.update(() => [])).rejects.toThrow('Invalid extension context');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('refuses updates when storage cannot be read', async () => {
    readError = 'storage unavailable';
    const store = createPromptStore();
    await expect(store.update(() => [])).rejects.toThrow('storage unavailable');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('returns isolated prompt copies', async () => {
    const store = createPromptStore();
    const copy = await store.getAll();
    copy[0].title = 'modified';
    expect((await store.getAll())[0].title).toBe('Saved');
  });

  it('keeps persisted data after write failure and permits a later save', async () => {
    const store = createPromptStore();
    writeError = 'quota exceeded';
    await expect(store.update(() => [])).rejects.toThrow('quota exceeded');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
    writeError = null;
    await store.update((prompts) => [...prompts, make('recovered')]);
    expect((await store.getAll()).map((prompt) => prompt.id)).toEqual(['saved', 'recovered']);
  });

  it('rejects invalid updates before writing', async () => {
    const store = createPromptStore();
    await expect(store.update(() => [make('dup'), make('dup')]))
      .rejects.toThrow('Invalid prompt update');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
  });

  it('clears prompts and usage together after confirmation', async () => {
    data['lunaToc:promptUsageV1'] = { saved: { usageCount: 4, lastUsedAt: 1 } };
    const store = createPromptStore();
    await store.clearAll();
    expect(data[PROMPT_STORAGE_KEY]).toEqual([]);
    expect(data['lunaToc:promptUsageV1']).toEqual({});
    expect(messages).toHaveBeenCalledWith(
      { type: PROMPT_COMMIT_TYPE, action: 'clear-account', ownerId: 'account-1' }, expect.any(Function)
    );
  });

  it('isolates prompt lists by verified account and preserves other accounts on edits', async () => {
    const otherAccount = { ...make('private-other'), ownerId: 'account-2' };
    const unowned = { id: 'legacy', title: 'Legacy', content: 'Delete me', createdAt: 1, updatedAt: 1 };
    const invalidOwner = { ...make('bad-owner'), ownerId: 123 };
    data[PROMPT_STORAGE_KEY] = [original, otherAccount, unowned, invalidOwner];
    const store = createPromptStore();
    expect((await store.getAll()).map((prompt) => prompt.id)).toEqual(['saved']);
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original, otherAccount]);
    await store.update((prompts) => [...prompts, make('added')]);
    expect(data[PROMPT_STORAGE_KEY]).toEqual([otherAccount, original, make('added')]);
    setActiveConversationOwner('account-2');
    expect((await store.getAll()).map((prompt) => prompt.id)).toEqual(['private-other']);
  });

  it('reports a background interruption without pretending to save', async () => {
    const store = createPromptStore();
    sendError = 'Service worker was suspended';
    await expect(store.update((prompts) => [...prompts, make('new')]))
      .rejects.toThrow('suspended');
    expect(data[PROMPT_STORAGE_KEY]).toEqual([original]);
    sendError = null;
    await store.update((prompts) => [...prompts, make('new')]);
    expect((await store.getAll()).length).toBe(2);
  });
});
