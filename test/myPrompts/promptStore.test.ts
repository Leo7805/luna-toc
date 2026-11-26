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
  failNextSets: number;
  deferNextGet: boolean;
  deferNextSet: boolean;
  persistImmediatelyOnDeferredSet: boolean;
  emitOnChangedOnSet: boolean;
  resolveDeferredGet: (() => void) | null;
  pendingSets: Array<() => void>;
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

function cloneTestValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>) }
        : item
    );
  }
  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>) };
  }
  return value;
}

function installMockChromeStorage(initialValue?: unknown): MockChromeStorage {
  const listeners = new Set<StorageChangedListener>();
  let lastError: { message: string } | undefined;

  const state: MockChromeStorage = {
    persisted:
      initialValue !== undefined
        ? { [STORAGE_KEY]: cloneTestValue(initialValue) }
        : {},
    getCalls: 0,
    setCalls: 0,
    failNextGets: 0,
    failNextSets: 0,
    deferNextGet: false,
    deferNextSet: false,
    persistImmediatelyOnDeferredSet: false,
    emitOnChangedOnSet: false,
    resolveDeferredGet: null,
    pendingSets: [],
    emitOnChanged(newValue, areaName = 'local', key = STORAGE_KEY) {
      const oldValue = state.persisted[key];
      if (newValue === undefined) {
        delete state.persisted[key];
      } else {
        state.persisted[key] = cloneTestValue(newValue);
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
          const shouldFail = state.failNextSets > 0;
          if (shouldFail) {
            state.failNextSets -= 1;
          }
          const clonedItems: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(items)) {
            clonedItems[k] = Array.isArray(v)
              ? (v as SavedPrompt[]).map((p) => ({ ...p }))
              : v;
          }

          const persistBeforeCallback =
            state.deferNextSet && state.persistImmediatelyOnDeferredSet;
          if (persistBeforeCallback && !shouldFail) {
            Object.assign(state.persisted, clonedItems);
          }

          const finish = () => {
            lastError = shouldFail
              ? { message: 'Simulated storage.local.set failure' }
              : undefined;
            if (!shouldFail) {
              if (!persistBeforeCallback) {
                Object.assign(state.persisted, clonedItems);
              }
              if (state.emitOnChangedOnSet && STORAGE_KEY in clonedItems) {
                for (const listener of listeners) {
                  listener(
                    { [STORAGE_KEY]: { newValue: clonedItems[STORAGE_KEY] } },
                    'local'
                  );
                }
              }
            }
            try {
              callback();
            } finally {
              lastError = undefined;
            }
          };

          if (state.deferNextSet) {
            state.deferNextSet = false;
            state.persistImmediatelyOnDeferredSet = false;
            state.pendingSets.push(finish);
            return;
          }

          queueMicrotask(finish);
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe('promptStore immutable snapshots, rollback, and write serialization (Finding #4B)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clones SavedPrompt objects so mutating returned items cannot corrupt internal store state', async () => {
    const initial = [makePrompt('p-1', 'Original Title', 'Original Body')];
    installMockChromeStorage(initial);
    const store = createPromptStore();

    const fetched = await store.getAll();
    fetched[0].title = 'Mutated Outside';
    fetched[0].content = 'Mutated Body';

    expect(store.getSnapshot()[0].title).toBe('Original Title');
    expect(store.getSnapshot()[0].content).toBe('Original Body');
    expect((await store.getAll())[0].title).toBe('Original Title');
  });

  it('serializes overlapping updates so Save B waits for Save A and derives from A committed state', async () => {
    const initial = [makePrompt('p-1', 'Initial')];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();
    await store.getAll();

    mock.deferNextSet = true;
    const storeWithUpdate = store as typeof store & {
      update?: (updater: (current: SavedPrompt[]) => SavedPrompt[]) => Promise<void>;
    };
    expect(typeof storeWithUpdate.update).toBe('function');

    const opA = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-2', 'From A'),
    ]);
    const opB = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-3', 'From B'),
    ]);

    // Flush microtasks: A's set() is in-flight, B must NOT have called set() yet
    await flushMicrotasks();
    expect(mock.setCalls).toBe(1);
    expect(mock.pendingSets).toHaveLength(1);

    // Resolve A; B now runs against [p-1, p-2] and writes [p-1, p-2, p-3]
    mock.pendingSets.shift()!();
    await opA;
    await opB;

    expect(mock.setCalls).toBe(2);
    expect(mock.persisted[STORAGE_KEY]).toEqual([
      makePrompt('p-1', 'Initial'),
      makePrompt('p-2', 'From A'),
      makePrompt('p-3', 'From B'),
    ]);
    expect(store.getSnapshot().map((p) => p.id)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('isolates failed writes: A failure does not block B, and B failure preserves A', async () => {
    const initial = [makePrompt('p-1', 'Initial')];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();
    await store.getAll();

    const storeWithUpdate = store as typeof store & {
      update?: (updater: (current: SavedPrompt[]) => SavedPrompt[]) => Promise<void>;
    };
    expect(typeof storeWithUpdate.update).toBe('function');

    // A fails, B succeeds
    mock.failNextSets = 1;
    mock.deferNextSet = true;
    const opA = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-fail-a', 'Should Fail'),
    ]);
    const opB = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-ok-b', 'Should Succeed'),
    ]);
    const settledA = opA.then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );

    await flushMicrotasks();
    mock.pendingSets.shift()!();

    expect((await settledA).ok).toBe(false);
    await opB;
    expect(mock.persisted[STORAGE_KEY]).toEqual([
      makePrompt('p-1', 'Initial'),
      makePrompt('p-ok-b', 'Should Succeed'),
    ]);
    expect(store.getSnapshot().map((p) => p.id)).toEqual(['p-1', 'p-ok-b']);

    // Now C fails after B succeeded -> B's state must remain intact
    mock.failNextSets = 1;
    const opC = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-fail-c', 'Fail C'),
    ]);
    await expect(opC).rejects.toBeDefined();
    expect(store.getSnapshot().map((p) => p.id)).toEqual(['p-1', 'p-ok-b']);
    expect(mock.persisted[STORAGE_KEY]).toEqual([
      makePrompt('p-1', 'Initial'),
      makePrompt('p-ok-b', 'Should Succeed'),
    ]);
  });

  it('preserves external onChanged state when a pending local write fails and avoids duplicate local echo notifications', async () => {
    const initial = [makePrompt('p-1', 'Initial')];
    const external = [makePrompt('p-1', 'Initial'), makePrompt('p-ext', 'From Tab B')];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();
    await store.getAll();

    const storeWithUpdate = store as typeof store & {
      update?: (updater: (current: SavedPrompt[]) => SavedPrompt[]) => Promise<void>;
    };
    expect(typeof storeWithUpdate.update).toBe('function');

    // 1. Local write fails after external onChanged arrived -> external state preserved
    mock.failNextSets = 1;
    mock.deferNextSet = true;
    const failingOp = storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-local', 'Will Fail'),
    ]);
    const settledFail = failingOp.then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );

    await flushMicrotasks();
    expect(mock.pendingSets).toHaveLength(1);

    mock.emitOnChanged(external);
    expect(store.getSnapshot()).toEqual(external);

    // Local write now fails; must NOT roll back external state
    mock.pendingSets.shift()!();
    expect((await settledFail).ok).toBe(false);
    expect(store.getSnapshot()).toEqual(external);

    // 2. Local write succeeds with onChanged echo before callback -> subscriber notified once (not twice)
    const subscriber = vi.fn();
    store.subscribe(subscriber);
    await Promise.resolve();
    subscriber.mockClear();

    mock.emitOnChangedOnSet = true;
    await storeWithUpdate.update!((current) => [
      ...current,
      makePrompt('p-echo', 'Echo Test'),
    ]);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().map((p) => p.id)).toEqual([
      'p-1',
      'p-ext',
      'p-echo',
    ]);
  });
});

describe('promptStore malformed storage preservation and validation (Finding #4C.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['object', { version: 2, items: [] }],
    ['string', 'corrupted-payload'],
    ['number', 42],
    ['null', null],
  ])(
    'rejects defined non-array root storage value (%s) and blocks overwrites',
    async (_label, malformedValue) => {
      const mock = installMockChromeStorage(malformedValue);
      const store = createPromptStore();

      await expect(store.getAll()).rejects.toThrow();
      await expect(
        store.saveAll([makePrompt('p-new', 'New Prompt')])
      ).rejects.toThrow();
      await expect(
        store.update((current) => [...current, makePrompt('p-2', 'Added')])
      ).rejects.toThrow();

      expect(mock.setCalls).toBe(0);
      expect(mock.persisted[STORAGE_KEY]).toEqual(malformedValue);
      expect(store.getSnapshot()).toEqual([]);
    }
  );

  it.each([
    ['null element', [null]],
    ['primitive elements', ['bad', 123]],
    ['missing required fields', [{ id: 'p-1', title: 'Missing content' }]],
    [
      'non-string required fields',
      [{ id: 123, title: 'Numeric ID', content: 'Body', createdAt: 1, updatedAt: 1 }],
    ],
    [
      'mixed valid and invalid entries',
      [makePrompt('p-1', 'Valid One'), { id: 'p-2', title: 99, content: 'Broken' }],
    ],
  ])(
    'rejects array containing invalid prompt records (%s) without filtering or overwriting storage',
    async (_label, malformedArray) => {
      const mock = installMockChromeStorage(malformedArray);
      const store = createPromptStore();

      await expect(store.getAll()).rejects.toThrow();
      await expect(
        store.update((current) => [...current, makePrompt('p-new', 'New')])
      ).rejects.toThrow();
      await expect(
        store.saveAll([makePrompt('p-replace', 'Replace')])
      ).rejects.toThrow();

      expect(mock.setCalls).toBe(0);
      expect(mock.persisted[STORAGE_KEY]).toEqual(malformedArray);
    }
  );

  it('rejects prompt arrays with duplicate IDs and preserves raw storage untouched', async () => {
    const duplicated = [
      makePrompt('dup-1', 'First Version', 'Body A'),
      makePrompt('dup-1', 'Second Version', 'Body B'),
    ];
    const mock = installMockChromeStorage(duplicated);
    const store = createPromptStore();

    await expect(store.getAll()).rejects.toThrow();
    await expect(
      store.update((current) => [...current, makePrompt('p-3', 'New')])
    ).rejects.toThrow();

    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(duplicated);
  });

  it('normalizes recognized legacy timestamp fields in memory without writing back to storage and preserves unknown fields', async () => {
    const legacyRecords = [
      {
        id: 'legacy-1',
        title: 'Missing updatedAt',
        content: 'Body 1',
        createdAt: 1111,
        extraTag: 'keep-me',
      },
      {
        id: 'legacy-2',
        title: 'Missing createdAt',
        content: 'Body 2',
        updatedAt: 2222,
      },
      {
        id: 'legacy-3',
        title: 'Both missing or non-finite',
        content: 'Body 3',
        createdAt: Number.NaN,
        updatedAt: 'not-a-number',
      },
    ];
    const mock = installMockChromeStorage(legacyRecords);
    const store = createPromptStore();

    const prompts = await store.getAll();
    expect(mock.setCalls).toBe(0);
    expect(prompts).toEqual([
      {
        id: 'legacy-1',
        title: 'Missing updatedAt',
        content: 'Body 1',
        createdAt: 1111,
        updatedAt: 1111,
        extraTag: 'keep-me',
      },
      {
        id: 'legacy-2',
        title: 'Missing createdAt',
        content: 'Body 2',
        createdAt: 2222,
        updatedAt: 2222,
      },
      {
        id: 'legacy-3',
        title: 'Both missing or non-finite',
        content: 'Body 3',
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    // Persisted storage remains unmodified by hydration
    expect(mock.persisted[STORAGE_KEY]).toEqual(legacyRecords);
  });

  it('revokes authoritative state on malformed onChanged after hydration and blocks subsequent writes until valid state recovers', async () => {
    const initial = [
      makePrompt('p-1', 'Existing One'),
      makePrompt('p-2', 'Existing Two'),
    ];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();

    expect(await store.getAll()).toEqual(initial);

    // Malformed external update arrives via onChanged
    const corruptedPayload = { broken: true };
    mock.emitOnChanged(corruptedPayload);

    // Subsequent writes must re-validate and reject without calling set()
    await expect(
      store.update((current) => [...current, makePrompt('p-3', 'Should Block')])
    ).rejects.toThrow();
    await expect(
      store.saveAll([makePrompt('p-4', 'Should Also Block')])
    ).rejects.toThrow();
    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corruptedPayload);

    // Recovery via valid onChanged restores reads and writes
    const repaired = [makePrompt('p-1', 'Recovered One')];
    mock.emitOnChanged(repaired);
    expect(await store.getAll()).toEqual(repaired);

    await store.update((current) => [
      ...current,
      makePrompt('p-5', 'Post-Recovery'),
    ]);
    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual([
      makePrompt('p-1', 'Recovered One'),
      makePrompt('p-5', 'Post-Recovery'),
    ]);
  });

  it('does not let an older in-flight hydration restore authority after a newer malformed onChanged arrives', async () => {
    const staleValid = [makePrompt('p-1', 'Stale Valid')];
    const mock = installMockChromeStorage(staleValid);
    mock.deferNextGet = true;

    const store = createPromptStore();
    const pendingRead = store.getAll().then(
      (prompts) => ({ ok: true as const, prompts }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(mock.resolveDeferredGet).not.toBeNull();

    // Malformed onChanged arrives while initial hydration is in flight
    const corruptedPayload = [null, { bad: true }];
    mock.emitOnChanged(corruptedPayload);

    // Stale valid read now resolves -> must NOT restore write authority
    mock.resolveDeferredGet!();
    const readResult = await pendingRead;
    expect(readResult.ok).toBe(false);

    await expect(
      store.update((current) => [...current, makePrompt('p-2', 'Blocked')])
    ).rejects.toThrow();
    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corruptedPayload);

    // Repair storage directly and confirm next getAll() recovers
    mock.persisted[STORAGE_KEY] = [makePrompt('p-ok', 'Repaired')];
    expect(await store.getAll()).toEqual([makePrompt('p-ok', 'Repaired')]);
  });

  it('keeps write authority revoked if a pending local write fails after an invalid external onChanged', async () => {
    const initial = [makePrompt('p-1', 'Initial')];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();
    await store.getAll();

    mock.failNextSets = 1;
    mock.deferNextSet = true;
    const failingWrite = store
      .update((current) => [...current, makePrompt('p-local', 'Will Fail')])
      .then(
        () => ({ ok: true as const }),
        () => ({ ok: false as const })
      );

    await flushMicrotasks();
    expect(mock.pendingSets).toHaveLength(1);

    const corruptedPayload = 'corrupted-external-write';
    mock.emitOnChanged(corruptedPayload);

    mock.pendingSets.shift()!();
    expect((await failingWrite).ok).toBe(false);

    // Subsequent write must remain blocked while storage is malformed
    await expect(
      store.update((current) => [...current, makePrompt('p-after', 'Blocked')])
    ).rejects.toThrow();
    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corruptedPayload);
  });

  it('does not restore write authority when an earlier local write callback succeeds after a newer malformed onChanged', async () => {
    const initial = [makePrompt('p-1', 'Initial')];
    const mock = installMockChromeStorage(initial);
    const store = createPromptStore();
    await store.getAll();

    // T1: Local write persists to storage, but its completion callback is deferred
    mock.deferNextSet = true;
    mock.persistImmediatelyOnDeferredSet = true;
    const firstWrite = store.update((current) => [
      ...current,
      makePrompt('p-local', 'Earlier Local Write'),
    ]);

    await flushMicrotasks();
    expect(mock.setCalls).toBe(1);
    expect(mock.pendingSets).toHaveLength(1);

    // T2: Newer external malformed write overwrites storage and delivers invalid onChanged
    const corruptedPayload = { version: 99, corrupted: true };
    mock.emitOnChanged(corruptedPayload);

    // T3: Earlier local write's stale success callback completes -> must NOT restore authority
    mock.pendingSets.shift()!();
    await firstWrite;

    // T4: Next queued update must revalidate persisted storage and reject without another set()
    const getCallsBeforeNextWrite = mock.getCalls;
    await expect(
      store.update((current) => [...current, makePrompt('p-blocked', 'Blocked')])
    ).rejects.toThrow();
    expect(mock.getCalls).toBeGreaterThan(getCallsBeforeNextWrite);
    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corruptedPayload);

    // T5: Recovery after valid authoritative state is re-established
    const repaired = [makePrompt('p-1', 'Recovered')];
    mock.emitOnChanged(repaired);
    await store.update((current) => [
      ...current,
      makePrompt('p-recovered', 'After Recovery'),
    ]);
    expect(mock.setCalls).toBe(2);
    expect(mock.persisted[STORAGE_KEY]).toEqual([
      makePrompt('p-1', 'Recovered'),
      makePrompt('p-recovered', 'After Recovery'),
    ]);
  });
});
