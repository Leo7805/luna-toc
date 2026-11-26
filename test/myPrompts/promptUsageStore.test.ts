/**
 * Tests fail-safe hydration, commit-on-success writes, storage change races,
 * malformed-data preservation, and snapshot isolation in `promptUsageStore.ts`
 * (Finding #4C.3).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPromptUsageStore,
  type PromptUsageMap,
} from '@/features/myPrompts/promptUsageStore';

const STORAGE_KEY = 'lunaToc:promptUsageV1';

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

function cloneRaw(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneRaw(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = cloneRaw(v);
    }
    return out;
  }
  return value;
}

function installMockChromeStorage(initialValue?: unknown): MockChromeStorage {
  const listeners = new Set<StorageChangedListener>();
  let lastError: { message: string } | undefined;

  const state: MockChromeStorage = {
    persisted:
      initialValue !== undefined ? { [STORAGE_KEY]: cloneRaw(initialValue) } : {},
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
        state.persisted[key] = cloneRaw(newValue);
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
          if (shouldFail) state.failNextGets -= 1;

          const snapshot =
            key in state.persisted
              ? { [key]: cloneRaw(state.persisted[key]) }
              : {};

          const deliver = () => {
            lastError = shouldFail
              ? { message: 'Simulated usage storage.local.get failure' }
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
          if (shouldFail) state.failNextSets -= 1;

          const clonedItems = cloneRaw(items) as Record<string, unknown>;
          const persistBeforeCallback =
            state.deferNextSet && state.persistImmediatelyOnDeferredSet;
          if (persistBeforeCallback && !shouldFail) {
            Object.assign(state.persisted, clonedItems);
          }

          const finish = () => {
            lastError = shouldFail
              ? { message: 'Simulated usage storage.local.set failure' }
              : undefined;
            if (!shouldFail) {
              if (!persistBeforeCallback) {
                Object.assign(state.persisted, clonedItems);
              }
              if (state.emitOnChangedOnSet && STORAGE_KEY in clonedItems) {
                for (const listener of listeners) {
                  listener(
                    { [STORAGE_KEY]: { newValue: cloneRaw(clonedItems[STORAGE_KEY]) } },
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe('promptUsageStore reliability (Finding #4C.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Test A: failed hydration rejects and blocks recordUse from erasing existing usage history', async () => {
    const existing: PromptUsageMap = {
      'p-1': { usageCount: 5, lastUsedAt: 1000 },
      'p-2': { usageCount: 3, lastUsedAt: 2000 },
    };
    const mock = installMockChromeStorage(existing);
    mock.failNextGets = 1;

    const store = createPromptUsageStore();
    await expect(store.recordUse('p-3')).rejects.toBeDefined();

    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(existing);
  });

  it('Test B: recovers cleanly after a transient read failure and preserves existing entries', async () => {
    const existing: PromptUsageMap = {
      'p-1': { usageCount: 4, lastUsedAt: 1000 },
    };
    const mock = installMockChromeStorage(existing);
    mock.failNextGets = 1;

    const store = createPromptUsageStore();
    await expect(store.getAll()).rejects.toBeDefined();

    // Storage recovers -> retry loads existing counts and preserves them on write
    const loaded = await store.getAll();
    expect(loaded).toEqual(existing);

    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await store.recordUse('p-2');

    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual({
      'p-1': { usageCount: 4, lastUsedAt: 1000 },
      'p-2': { usageCount: 1, lastUsedAt: 5000 },
    });
  });

  it('Test C: genuine missing storage key hydrates to an empty map and allows recording', async () => {
    const mock = installMockChromeStorage(undefined);
    const store = createPromptUsageStore();

    expect(await store.getAll()).toEqual({});
    expect(mock.getCalls).toBe(1);

    vi.spyOn(Date, 'now').mockReturnValue(3000);
    await store.recordUse('p-1');

    expect(mock.setCalls).toBe(1);
    expect(mock.persisted[STORAGE_KEY]).toEqual({
      'p-1': { usageCount: 1, lastUsedAt: 3000 },
    });
  });

  it('Test D: failed recordUse rejects without mutating committed cache or persisted counts', async () => {
    const existing: PromptUsageMap = {
      'p-1': { usageCount: 2, lastUsedAt: 1000 },
    };
    const mock = installMockChromeStorage(existing);
    const store = createPromptUsageStore();
    await store.getAll();

    mock.failNextSets = 1;
    await expect(store.recordUse('p-1')).rejects.toBeDefined();

    expect(await store.getAll()).toEqual(existing);
    expect(mock.persisted[STORAGE_KEY]).toEqual(existing);

    // Subsequent write succeeds cleanly from committed count (2 -> 3, not 4)
    vi.spyOn(Date, 'now').mockReturnValue(4000);
    await store.recordUse('p-1');
    expect(await store.getAll()).toEqual({
      'p-1': { usageCount: 3, lastUsedAt: 4000 },
    });
  });

  it('Test E: failed remove() and clear() preserve committed cache and do not leak into later writes', async () => {
    const existing: PromptUsageMap = {
      'p-1': { usageCount: 2, lastUsedAt: 1000 },
      'p-2': { usageCount: 7, lastUsedAt: 2000 },
    };
    const mock = installMockChromeStorage(existing);
    const store = createPromptUsageStore();
    await store.getAll();

    // Failed remove() must keep p-1 in cache and storage
    mock.failNextSets = 1;
    await expect(store.remove('p-1')).rejects.toBeDefined();
    expect(await store.getAll()).toEqual(existing);
    expect(mock.persisted[STORAGE_KEY]).toEqual(existing);

    // Failed clear() must keep both entries in cache and storage
    mock.failNextSets = 1;
    await expect(store.clear()).rejects.toBeDefined();
    expect(await store.getAll()).toEqual(existing);
    expect(mock.persisted[STORAGE_KEY]).toEqual(existing);

    // Later successful recordUse('p-3') must still preserve p-1 and p-2
    vi.spyOn(Date, 'now').mockReturnValue(9000);
    await store.recordUse('p-3');
    expect(mock.persisted[STORAGE_KEY]).toEqual({
      ...existing,
      'p-3': { usageCount: 1, lastUsedAt: 9000 },
    });

    // Successful remove() and clear() persist properly
    await store.remove('p-1');
    expect(await store.getAll()).toEqual({
      'p-2': { usageCount: 7, lastUsedAt: 2000 },
      'p-3': { usageCount: 1, lastUsedAt: 9000 },
    });
    await store.clear();
    expect(await store.getAll()).toEqual({});
    expect(mock.persisted[STORAGE_KEY]).toEqual({});
  });

  it('Test F: serializes overlapping recordUse calls and recovers cleanly across failed/succeeded writes', async () => {
    const mock = installMockChromeStorage({
      'p-1': { usageCount: 1, lastUsedAt: 1000 },
    });
    const store = createPromptUsageStore();
    await store.getAll();

    vi.spyOn(Date, 'now').mockReturnValue(2000);

    // Write A fails, Write B succeeds -> count goes 1 -> 2 (not 3)
    mock.failNextSets = 1;
    mock.deferNextSet = true;
    const writeA = store.recordUse('p-1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );
    const writeB = store.recordUse('p-1');

    await flushMicrotasks();
    expect(mock.setCalls).toBe(1);
    expect(mock.pendingSets).toHaveLength(1);
    mock.pendingSets.shift()!();

    expect((await writeA).ok).toBe(false);
    await writeB;
    expect(await store.getAll()).toEqual({
      'p-1': { usageCount: 2, lastUsedAt: 2000 },
    });

    // Write C succeeds, Write D fails -> count stays 3
    mock.deferNextSet = true;
    const writeC = store.recordUse('p-1');
    const writeD = store.recordUse('p-1').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );

    await flushMicrotasks();
    mock.failNextSets = 1; // Fail Write D when it runs after C
    mock.pendingSets.shift()!();

    await writeC;
    expect((await writeD).ok).toBe(false);
    expect(await store.getAll()).toEqual({
      'p-1': { usageCount: 3, lastUsedAt: 2000 },
    });

    // Repeated overlapping recordUse calls while earlier write is pending -> no lost increments
    mock.deferNextSet = true;
    const inc1 = store.recordUse('p-1');
    const inc2 = store.recordUse('p-1');
    const inc3 = store.recordUse('p-1');

    await flushMicrotasks();
    expect(mock.pendingSets).toHaveLength(1);
    mock.pendingSets.shift()!();
    await Promise.all([inc1, inc2, inc3]);

    expect(await store.getAll()).toEqual({
      'p-1': { usageCount: 6, lastUsedAt: 2000 },
    });
  });

  it('Test G: stale in-flight hydration cannot overwrite newer valid onChanged (non-empty and empty)', async () => {
    // 1. Newer non-empty onChanged
    const stale: PromptUsageMap = { 'p-1': { usageCount: 1, lastUsedAt: 100 } };
    const newer: PromptUsageMap = {
      'p-1': { usageCount: 5, lastUsedAt: 500 },
      'p-2': { usageCount: 2, lastUsedAt: 600 },
    };
    const mock1 = installMockChromeStorage(stale);
    mock1.deferNextGet = true;

    const store1 = createPromptUsageStore();
    const pending1 = store1.getAll();
    expect(mock1.resolveDeferredGet).not.toBeNull();

    mock1.emitOnChanged(newer);
    mock1.resolveDeferredGet!();

    expect(await pending1).toEqual(newer);
    expect(await store1.getAll()).toEqual(newer);

    // 2. Newer genuine empty onChanged
    const mock2 = installMockChromeStorage(stale);
    mock2.deferNextGet = true;

    const store2 = createPromptUsageStore();
    const pending2 = store2.getAll();
    expect(mock2.resolveDeferredGet).not.toBeNull();

    mock2.emitOnChanged({});
    mock2.resolveDeferredGet!();

    expect(await pending2).toEqual({});
    expect(await store2.getAll()).toEqual({});
  });

  it('Test H: handles valid local write echo before callback without rollback or corruption', async () => {
    const mock = installMockChromeStorage({
      'p-1': { usageCount: 1, lastUsedAt: 1000 },
    });
    const store = createPromptUsageStore();
    await store.getAll();

    mock.emitOnChangedOnSet = true;
    vi.spyOn(Date, 'now').mockReturnValue(2500);
    await store.recordUse('p-1');

    expect(await store.getAll()).toEqual({
      'p-1': { usageCount: 2, lastUsedAt: 2500 },
    });
    expect(mock.persisted[STORAGE_KEY]).toEqual({
      'p-1': { usageCount: 2, lastUsedAt: 2500 },
    });
  });

  it('Test I: handles external valid and invalid onChanged during pending local writes', async () => {
    // 1. Failed local write does not overwrite newer valid external update
    const initial: PromptUsageMap = { 'p-1': { usageCount: 1, lastUsedAt: 100 } };
    const external: PromptUsageMap = {
      'p-1': { usageCount: 1, lastUsedAt: 100 },
      'p-ext': { usageCount: 9, lastUsedAt: 900 },
    };
    const mock = installMockChromeStorage(initial);
    const store = createPromptUsageStore();
    await store.getAll();

    mock.failNextSets = 1;
    mock.deferNextSet = true;
    const failingLocal = store.recordUse('p-local').then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );
    await flushMicrotasks();
    mock.emitOnChanged(external);
    mock.pendingSets.shift()!();

    expect((await failingLocal).ok).toBe(false);
    expect(await store.getAll()).toEqual(external);

    // 2. Stale successful local write callback after newer invalid external onChanged
    // must NOT blindly restore write authority
    mock.deferNextSet = true;
    mock.persistImmediatelyOnDeferredSet = true;
    const earlierLocal = store.recordUse('p-1');
    await flushMicrotasks();
    expect(mock.pendingSets).toHaveLength(1);

    const corrupted = ['not', 'an', 'object'];
    mock.emitOnChanged(corrupted);

    // Earlier local write callback now succeeds -> must not restore authority
    mock.pendingSets.shift()!();
    await earlierLocal;

    const setsBeforeBlocked = mock.setCalls;
    await expect(store.recordUse('p-blocked')).rejects.toThrow();
    expect(mock.setCalls).toBe(setsBeforeBlocked);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corrupted);
  });

  it.each([
    ['null root', null],
    ['array root', [{ usageCount: 1, lastUsedAt: 1 }]],
    ['string root', 'corrupted'],
    ['number root', 42],
    ['null entry', { 'p-1': null }],
    ['primitive entry', { 'p-1': 'bad' }],
    ['missing usageCount', { 'p-1': { lastUsedAt: 100 } }],
    ['negative usageCount', { 'p-1': { usageCount: -1, lastUsedAt: 100 } }],
    ['non-finite usageCount', { 'p-1': { usageCount: Number.NaN, lastUsedAt: 100 } }],
    ['negative lastUsedAt', { 'p-1': { usageCount: 1, lastUsedAt: -5 } }],
    [
      'mixed valid and invalid entries',
      {
        'p-1': { usageCount: 3, lastUsedAt: 100 },
        'p-bad': { usageCount: 'oops', lastUsedAt: 200 },
      },
    ],
  ])(
    'Test J: rejects malformed storage (%s) without overwriting raw persisted data and recovers on valid state',
    async (_label, malformedValue) => {
      const mock = installMockChromeStorage(malformedValue);
      const store = createPromptUsageStore();

      await expect(store.getAll()).rejects.toThrow();
      await expect(store.recordUse('p-new')).rejects.toThrow();
      expect(mock.setCalls).toBe(0);
      expect(mock.persisted[STORAGE_KEY]).toEqual(malformedValue);

      // Recovery when storage becomes valid again (preserving extra unknown fields)
      const validWithExtra = {
        'p-1': { usageCount: 2, lastUsedAt: 1000, extraMeta: 'keep' },
      };
      mock.persisted[STORAGE_KEY] = validWithExtra;
      expect(await store.getAll()).toEqual(validWithExtra);
    }
  );

  it('Test K: invalid onChanged after hydration revokes authority and stale hydration cannot cancel invalidation', async () => {
    const valid: PromptUsageMap = { 'p-1': { usageCount: 4, lastUsedAt: 1000 } };
    const mock = installMockChromeStorage(valid);
    const store = createPromptUsageStore();

    expect(await store.getAll()).toEqual(valid);

    // Invalid onChanged revokes authority
    const corrupted = 'bad-usage-payload';
    mock.emitOnChanged(corrupted);

    await expect(store.recordUse('p-2')).rejects.toThrow();
    expect(mock.setCalls).toBe(0);
    expect(mock.persisted[STORAGE_KEY]).toEqual(corrupted);

    // Stale in-flight hydration resolving after invalid onChanged cannot restore authority
    const mock2 = installMockChromeStorage(valid);
    mock2.deferNextGet = true;
    const store2 = createPromptUsageStore();
    const pendingRead = store2.getAll().then(
      () => ({ ok: true as const }),
      () => ({ ok: false as const })
    );
    mock2.emitOnChanged(corrupted);
    mock2.resolveDeferredGet!();

    expect((await pendingRead).ok).toBe(false);
    await expect(store2.recordUse('p-2')).rejects.toThrow();
    expect(mock2.setCalls).toBe(0);

    // Valid onChanged restores normal operation
    mock2.emitOnChanged(valid);
    vi.spyOn(Date, 'now').mockReturnValue(7000);
    await store2.recordUse('p-1');
    expect(mock2.setCalls).toBe(1);
    expect(mock2.persisted[STORAGE_KEY]).toEqual({
      'p-1': { usageCount: 5, lastUsedAt: 7000 },
    });
  });

  it('defensively clones returned usage entries so external mutation cannot corrupt store cache', async () => {
    const initial: PromptUsageMap = {
      'p-1': { usageCount: 3, lastUsedAt: 1000 },
    };
    installMockChromeStorage(initial);
    const store = createPromptUsageStore();

    const fetched = await store.getAll();
    fetched['p-1'].usageCount = 999;
    fetched['p-1'].lastUsedAt = 999999;

    expect(await store.getAll()).toEqual(initial);
  });
});
