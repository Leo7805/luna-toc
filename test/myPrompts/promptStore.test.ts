/**
 * Tests fail-safe hydration, transient-failure recovery, and onChanged race
 * protection in `promptStore.ts` (Finding #4A).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPromptStore,
  type SavedPrompt,
} from '@/features/myPrompts/promptStore';

const STORAGE_KEY = 'lumaToc:myPromptsV1';

type StorageChangedListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string
) => void;

interface MockChromeStorage {
  persisted: Record<string, unknown>;
  getCalls: number;
  setCalls: number;
  failNextGets: number;
  deferNextGet: boolean;
  resolveDeferredGet: (() => void) | null;
  emitOnChanged: (
    newValue: unknown,
    areaName?: string,
    key?: string
  ) => void;
}

function makePrompt(id: string, title: string, content = `Body ${id}`): SavedPrompt {
  return {
    id,
    title,
    content,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function installMockChromeStorage(initialPrompts?: SavedPrompt[]): MockChromeStorage {
  const listeners = new Set<StorageChangedListener>();
  let lastError: { message: string } | undefined;

  const state: MockChromeStorage = {
    persisted: initialPrompts !== undefined ? { [STORAGE_KEY]: [...initialPrompts] } : {},
    getCalls: 0,
    setCalls: 0,
    failNextGets: 0,
    deferNextGet: false,
    resolveDeferredGet: null,
    emitOnChanged(newValue, areaName = 'local', key = STORAGE_KEY) {
      const oldValue = state.persisted[key];
      if (newValue === undefined) {
        delete state.persisted[key];
      } else {
        state.persisted[key] = Array.isArray(newValue) ? [...newValue] : newValue;
      }
      for (const listener of listeners) {
        listener({ [key]: { oldValue, newValue } }, areaName);
      }
    },
  };

  const mockChrome = {
    runtime: {
      id: 'test-extension-id',
      get lastError() {
        return lastError;
      },
    },
    storage: {
      local: {
        get: (
          key: string,
          callback: (result: Record<string, unknown>) => void
        ) => {
          state.getCalls += 1;
          const shouldFail = state.failNextGets > 0;
          if (shouldFail) {
            state.failNextGets -= 1;
          }
          const snapshot =
            key in state.persisted
              ? {
                  [key]: Array.isArray(state.persisted[key])
                    ? [...(state.persisted[key] as unknown[])]
                    : state.persisted[key],
                }
              : {};

          const deliver = () => {
            lastError = shouldFail
              ? { message: 'Simulated storage.local.get failure' }
              : undefined;
            try {
              callback(shouldFail ? {} : snapshot);
            } finally {
              lastError = undefined;
            }
          };

          if (state.deferNextGet) {
            state.deferNextGet = false;
            state.resolveDeferredGet = deliver;
            return;
          }

          queueMicrotask(deliver);
        },
        set: (items: Record<string, unknown>, callback: () => void) => {
          state.setCalls += 1;
          queueMicrotask(() => {
            lastError = undefined;
            Object.assign(state.persisted, items);
            callback();
          });
        },
      },
      onChanged: {
        addListener: (listener: StorageChangedListener) => {
          listeners.add(listener);
        },
      },
    },
  };

  vi.stubGlobal('chrome', mockChrome);
  return state;
}

describe('promptStore fail-safe hydration (Finding #4A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Test A: failed hydration rejects and blocks saveAll from overwriting existing persisted prompts', async () => {
    const existing = [
      makePrompt('p-1', 'Existing One'),
      makePrompt('p-2', 'Existing Two'),
    ];
    const mock = installMockChromeStorage(existing);
    mock.failNextGets = 3; // Fail all 3 hydration attempts

    const store = createPromptStore();
    const savePromise = store.saveAll([makePrompt('p-new', 'Brand New')]);
    // Attach rejection handler before advancing timers to avoid unhandled rejection warning
    const settled = savePromise.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );

    await vi.runAllTimersAsync();
    const result = await settled;

    // Must fail safely without calling storage.local.set or wiping persisted prompts
    expect(result.ok).toBe(false);
    expect(mock.getCalls).toBe(3);
    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(existing);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('Test B: recovers cleanly after a transient read failure and preserves existing prompts on later writes', async () => {
    const existing = [
      makePrompt('p-1', 'Persisted Alpha'),
      makePrompt('p-2', 'Persisted Beta'),
    ];
    const mock = installMockChromeStorage(existing);
    mock.failNextGets = 3; // Fail initial hydration completely

    const store = createPromptStore();
    const firstRead = store.getAll().then(
      (prompts) => ({ ok: true as const, prompts }),
      (error: unknown) => ({ ok: false as const, error })
    );
    await vi.runAllTimersAsync();
    const firstResult = await firstRead;
    expect(firstResult.ok).toBe(false);

    // Storage recovers: subsequent getAll() must retry and return persisted prompts
    const recovered = await store.getAll();
    expect(recovered).toEqual(existing);

    // Subsequent valid write includes existing prompts plus the new one
    const added = makePrompt('p-3', 'Persisted Gamma');
    await store.saveAll([...recovered, added]);

    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual([...existing, added]);
  });

  it('Test C: genuine empty or missing storage hydrates successfully to an empty collection', async () => {
    const mock = installMockChromeStorage(undefined);
    const store = createPromptStore();

    const prompts = await store.getAll();
    expect(prompts).toEqual([]);
    expect(mock.getCalls).toBe(1);

    // Writing to a genuinely empty collection succeeds normally
    const first = makePrompt('p-first', 'First Prompt');
    await store.saveAll([first]);
    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual([first]);
  });

  it('Test D1: older in-flight hydration cannot overwrite a newer non-empty onChanged update', async () => {
    const stale = [makePrompt('p-old', 'Stale Prompt')];
    const newer = [
      makePrompt('p-old', 'Stale Prompt'),
      makePrompt('p-new', 'Cross-Tab Prompt'),
    ];
    const mock = installMockChromeStorage(stale);
    mock.deferNextGet = true;

    const store = createPromptStore();
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    const hydratePromise = store.getAll();
    expect(mock.resolveDeferredGet).not.toBeNull();

    // Newer cross-tab update arrives before the initial read resolves
    mock.emitOnChanged(newer);
    expect(store.getSnapshot()).toEqual(newer);
    subscriber.mockClear();

    // Now the stale initial read finishes
    mock.resolveDeferredGet!();
    const resolved = await hydratePromise;

    // Must keep the newer collection and not emit the stale snapshot
    expect(resolved).toEqual(newer);
    expect(store.getSnapshot()).toEqual(newer);
    expect(subscriber).not.toHaveBeenCalled();
    expect(await store.getAll()).toEqual(newer);
  });

  it('Test D2: older in-flight hydration cannot overwrite a newer genuine empty onChanged update', async () => {
    const stale = [makePrompt('p-old', 'To Be Cleared')];
    const mock = installMockChromeStorage(stale);
    mock.deferNextGet = true;

    const store = createPromptStore();
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    const hydratePromise = store.getAll();
    expect(mock.resolveDeferredGet).not.toBeNull();

    // Another tab clears all prompts while hydration is in flight
    mock.emitOnChanged([]);
    expect(store.getSnapshot()).toEqual([]);
    subscriber.mockClear();

    // Stale read resolves with old prompt
    mock.resolveDeferredGet!();
    const resolved = await hydratePromise;

    expect(resolved).toEqual([]);
    expect(store.getSnapshot()).toEqual([]);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('Test E: valid onChanged arriving during a failing hydration establishes authoritative state without stale overwrite', async () => {
    const liveFromOtherTab = [makePrompt('p-live', 'From Tab B')];
    const mock = installMockChromeStorage([]);
    mock.failNextGets = 3;
    mock.deferNextGet = true;

    const store = createPromptStore();
    const pendingRead = store.getAll();
    expect(mock.resolveDeferredGet).not.toBeNull();

    // While attempt 1 is failing/pending, Tab B emits a valid storage change
    mock.emitOnChanged(liveFromOtherTab);
    expect(store.getSnapshot()).toEqual(liveFromOtherTab);

    // Let the failing read resolve its failure and finish retries
    mock.resolveDeferredGet!();
    await vi.runAllTimersAsync();
    const resolved = await pendingRead;

    // Newer authoritative state from onChanged is preserved
    expect(resolved).toEqual(liveFromOtherTab);
    expect(store.getSnapshot()).toEqual(liveFromOtherTab);
  });
});
