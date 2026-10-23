/** Per-tab alias cache tests using the real background coordinator and storage events. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import { createTocAliasWriteCoordinator, TOC_ALIAS_PREFIX,
  TOC_ALIAS_DELETED_PREFIX } from '@/features/conversationPrompts/tocAliasWriteCoordinator';

const route = 'conversation-123';
const key = TOC_ALIAS_PREFIX + route;
const deletedKey = TOC_ALIAS_DELETED_PREFIX + route;
const saved: Record<string, unknown> = {};
const listeners: Array<(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string) => void> = [];

let worker: ReturnType<typeof createTocAliasWriteCoordinator>;

beforeEach(() => {
  vi.unstubAllGlobals();
  for (const name of Object.keys(saved)) delete saved[name];
  listeners.length = 0;
  const emit = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => {
    listeners.forEach((listener) => listener(changes, 'local'));
  };
  const storage = {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return { ...saved };
      return Object.fromEntries((typeof keys === 'string' ? [keys] : keys)
        .filter((name) => Object.hasOwn(saved, name))
        .map((name) => [name, saved[name]]));
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      const changes: Record<string, { newValue: unknown; oldValue?: unknown }> = {};
      for (const [name, value] of Object.entries(values)) {
        changes[name] = { oldValue: saved[name], newValue: value };
        saved[name] = value;
      }
      emit(changes);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const name of typeof keys === 'string' ? [keys] : keys) {
        if (!Object.hasOwn(saved, name)) continue;
        changes[name] = { oldValue: saved[name], newValue: undefined };
        delete saved[name];
      }
      if (Object.keys(changes).length) emit(changes);
    }),
  };
  worker = createTocAliasWriteCoordinator(storage as unknown as chrome.storage.StorageArea);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      lastError: undefined,
      sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
        void worker.commit(message).then(callback);
      }),
    },
    storage: {
      local: storage,
      onChanged: { addListener: (fn: typeof listeners[number]) => { listeners.push(fn); } },
    },
  });
});

describe('TOC alias storage', () => {
  it('saves and restores labels scoped by conversation, message and owner', async () => {
    const store = createTocAliasStore();
    await store.update(route, 'message-1', '重命名标题', 'account-1');
    expect(store.get(route, 'message-1')).toBe('重命名标题');
    const reload = createTocAliasStore();
    await reload.load(route);
    expect(reload.get(route, 'message-1')).toBe('重命名标题');
    expect(await reload.owner(route)).toBe('account-1');
    await store.update(route, 'message-1', null, 'account-1');
    expect(store.get(route, 'message-1')).toBeNull();
    expect(saved[key]).toBeUndefined();
  });

  it('two tabs update independent messages without clobbering either change', async () => {
    const tabA = createTocAliasStore();
    const tabB = createTocAliasStore();
    await Promise.all([tabA.load(route), tabB.load(route)]);
    await Promise.all([
      tabA.update(route, 'msg-a', 'First', 'account-1', null),
      tabB.update(route, 'msg-b', 'Second', 'account-1', null),
    ]);
    expect(tabA.get(route, 'msg-a')).toBe('First');
    expect(tabB.get(route, 'msg-b')).toBe('Second');
    expect(tabA.get(route, 'msg-b')).toBe('Second');
    expect(saved[key]).toEqual({
      ownerId: 'account-1', aliases: { 'msg-a': 'First', 'msg-b': 'Second' },
    });
  });

  it('rejects stale editor and restore without overwriting a newer same-message edit', async () => {
    const tabA = createTocAliasStore();
    const tabB = createTocAliasStore();
    await Promise.all([tabA.load(route), tabB.load(route)]);
    const originallySeen = tabB.get(route, 'msg');
    await tabA.update(route, 'msg', 'New title', 'account-1', null);
    await expect(tabB.update(route, 'msg', 'Stale draft', 'account-1', originallySeen))
      .rejects.toThrow('another tab');
    await expect(tabB.update(route, 'msg', null, 'account-1', originallySeen))
      .rejects.toThrow('another tab');
    expect(tabA.get(route, 'msg')).toBe('New title');
    expect(tabB.get(route, 'msg')).toBe('New title');
    expect(saved[key]).toEqual({ ownerId: 'account-1', aliases: { msg: 'New title' } });
  });

  it('serializes delete after in-flight saves and rejects future updates', async () => {
    const store = createTocAliasStore();
    await store.load(route);
    let releaseWrite!: () => void;
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(async (value) => {
      await gate;
      await originalSet(value);
    });
    const pendingWrite = store.update(route, 'msg-1', 'pending', 'account-1');
    await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalled());
    const deletion = store.removeConversation(route);
    expect(store.get(route, 'msg-1')).toBeNull();
    await expect(store.update(route, 'msg-2', 'new', 'account-1')).rejects.toThrow();
    releaseWrite();
    await pendingWrite;
    await deletion;
    expect(saved[key]).toBeUndefined();
    expect(saved[deletedKey]).toBe(true);
    expect(await store.references()).toEqual([]);
  });

  it('remote deletion blocks stale tab and a fresh tab after worker restart', async () => {
    const tabA = createTocAliasStore();
    const tabB = createTocAliasStore();
    await tabA.update(route, 'msg', 'Saved', 'account-1');
    await tabB.load(route);
    await tabA.removeConversation(route);
    await expect(tabB.update(route, 'msg', 'Resurrect', 'account-1', 'Saved'))
      .rejects.toThrow('deleted');
    worker = createTocAliasWriteCoordinator(chrome.storage.local);
    const reload = createTocAliasStore();
    await reload.load(route);
    expect(reload.get(route, 'msg')).toBeNull();
    await expect(reload.update(route, 'msg', 'Old', 'account-1')).rejects.toThrow('deleted');
    expect(saved[key]).toBeUndefined();
  });

  it('rejects temporary conversations, keeps separate conversations and handles write failure', async () => {
    const store = createTocAliasStore();
    await expect(store.update('local-123456', 'msg', 'ignored', null)).rejects.toThrow();
    await store.update(route, 'msg', 'one', null);
    await store.update('conversation-456', 'msg', 'two', null);
    expect(await store.references()).toEqual([route, 'conversation-456']);
    await store.removeConversation(route);
    expect(store.get('conversation-456', 'msg')).toBe('two');
    const next = createTocAliasStore();
    const before = { ...saved };
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(next.update('conversation-456', 'msg', 'not saved', null)).rejects.toThrow();
    expect(saved).toEqual(before);
    await next.update('conversation-456', 'msg', 'saved later', null);
    expect(saved[TOC_ALIAS_PREFIX + 'conversation-456'])
      .toEqual({ ownerId: null, aliases: { msg: 'saved later' } });
  });

  it('does not claim a successful save when background messaging fails', async () => {
    const store = createTocAliasStore();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(() => {
      // Simulate lost/closed response channel; Chrome sets runtime.lastError.
      (chrome.runtime as unknown as { lastError?: { message: string } }).lastError =
        { message: 'worker disconnected' };
    });
    // Use a callback failure to exercise the rejected acknowledgement path.
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      (_request, callback) => {
        (chrome.runtime as unknown as { lastError?: { message: string } }).lastError =
          { message: 'worker disconnected' };
        callback?.();
        (chrome.runtime as unknown as { lastError?: { message: string } }).lastError = undefined;
      });
    // The first intentionally unacknowledged message must not be used here:
    // skip it and exercise the callback error in the following request.
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    vi.mocked(chrome.runtime.sendMessage).mockImplementationOnce(
      (_request, callback) => {
        (chrome.runtime as unknown as { lastError?: { message: string } }).lastError =
          { message: 'worker disconnected' };
        callback?.();
        (chrome.runtime as unknown as { lastError?: { message: string } }).lastError = undefined;
      });
    await expect(store.update(route, 'msg', 'unconfirmed', null)).rejects.toThrow('worker disconnected');
    expect(saved[key]).toBeUndefined();
  });
});
