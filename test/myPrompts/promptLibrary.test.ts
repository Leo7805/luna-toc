/** @vitest-environment jsdom */
/**
 * Tests immutable editing, failed-write rollback, and concurrent CRUD
 * serialization in `promptLibrary.ts` backed by `promptStore.ts` (Finding #4B).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showPromptModal: vi.fn(),
  editorOpen: vi.fn(),
  usageRemove: vi.fn(async () => undefined),
  usageClear: vi.fn(async () => undefined),
  insertIntoChatGPTInput: vi.fn(),
}));

vi.mock('@/features/myPrompts/promptDialogController', () => ({
  showPromptModal: mocks.showPromptModal,
}));

vi.mock('@/features/myPrompts/promptEditor', () => ({
  promptEditorController: {
    open: mocks.editorOpen,
  },
}));

import {
  clearAllMyPrompts,
  deletePrompt,
  getMyPrompts,
  initializePromptLibrary,
  showDialog,
} from '@/features/myPrompts/promptLibrary';
import {
  createPromptStore,
  type SavedPrompt,
} from '@/features/myPrompts/promptStore';
import type { PromptUsageStore } from '@/features/myPrompts/promptUsageStore';

const STORAGE_KEY = 'lumaToc:myPromptsV1';

interface MockStorageEnv {
  persisted: Record<string, unknown>;
  failNextSets: number;
  deferNextSet: boolean;
  pendingSets: Array<() => void>;
}

function makePrompt(
  id: string,
  title: string,
  content: string,
  ts = 1000
): SavedPrompt {
  return { id, title, content, createdAt: ts, updatedAt: ts };
}

function setupEnvironment(initialPrompts: SavedPrompt[]): MockStorageEnv {
  let lastError: { message: string } | undefined;
  const env: MockStorageEnv = {
    persisted: { [STORAGE_KEY]: initialPrompts.map((p) => ({ ...p })) },
    failNextSets: 0,
    deferNextSet: false,
    pendingSets: [],
  };

  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-ext',
      get lastError() {
        return lastError;
      },
    },
    storage: {
      local: {
        get: (key: string, cb: (res: Record<string, unknown>) => void) => {
          queueMicrotask(() => {
            const list = env.persisted[key];
            cb(
              list !== undefined
                ? { [key]: (list as SavedPrompt[]).map((p) => ({ ...p })) }
                : {}
            );
          });
        },
        set: (items: Record<string, unknown>, cb: () => void) => {
          const shouldFail = env.failNextSets > 0;
          if (shouldFail) env.failNextSets -= 1;
          const cloned = (items[STORAGE_KEY] as SavedPrompt[]).map((p) => ({
            ...p,
          }));
          const finish = () => {
            lastError = shouldFail ? { message: 'set failed' } : undefined;
            if (!shouldFail) {
              env.persisted[STORAGE_KEY] = cloned;
            }
            try {
              cb();
            } finally {
              lastError = undefined;
            }
          };
          if (env.deferNextSet) {
            env.deferNextSet = false;
            env.pendingSets.push(finish);
            return;
          }
          queueMicrotask(finish);
        },
      },
      onChanged: {
        addListener: () => {},
      },
    },
  });

  const store = createPromptStore();
  const usageStore: PromptUsageStore = {
    getAll: async () => ({}),
    recordUse: async () => undefined,
    remove: mocks.usageRemove,
    clear: mocks.usageClear,
  };
  initializePromptLibrary({
    promptsStore: store,
    promptUsageStore: usageStore,
    insertIntoChatGPTInput: mocks.insertIntoChatGPTInput,
  });

  return env;
}

describe('promptLibrary immutable editing, rollback, and concurrent CRUD (Finding #4B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.showPromptModal.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('failed edit preserves original title, content, and updatedAt without mutating cached snapshot', async () => {
    const initial = [makePrompt('p-1', 'Original Title', 'Original Body', 1000)];
    const env = setupEnvironment(initial);
    const before = await getMyPrompts();

    let submitEdit: ((v: { title: string; content: string }) => Promise<void>) | null =
      null;
    mocks.editorOpen.mockImplementationOnce((_item, onSubmit) => {
      submitEdit = onSubmit;
    });

    showDialog(before[0]);
    env.failNextSets = 1;

    await expect(
      submitEdit!({ title: 'Edited Title', content: 'Edited Body' })
    ).rejects.toBeDefined();

    // Original snapshot, live store, and persisted storage must all remain untouched
    expect(before[0]).toEqual(
      makePrompt('p-1', 'Original Title', 'Original Body', 1000)
    );
    const afterFailure = await getMyPrompts();
    expect(afterFailure[0]).toEqual(
      makePrompt('p-1', 'Original Title', 'Original Body', 1000)
    );
    expect(env.persisted[STORAGE_KEY]).toEqual(initial);

    // Subsequent successful edit works cleanly and preserves createdAt
    mocks.editorOpen.mockImplementationOnce((_item, onSubmit) => {
      submitEdit = onSubmit;
    });
    showDialog(afterFailure[0]);
    await submitEdit!({ title: 'Saved Title', content: 'Saved Body' });

    const afterSuccess = await getMyPrompts();
    expect(afterSuccess[0].id).toBe('p-1');
    expect(afterSuccess[0].createdAt).toBe(1000);
    expect(afterSuccess[0].title).toBe('Saved Title');
    expect(afterSuccess[0].content).toBe('Saved Body');
  });

  it('concurrent Edit -> Delete does not resurrect the deleted prompt', async () => {
    const initial = [
      makePrompt('p-1', 'Prompt 1', 'Body 1', 1000),
      makePrompt('p-2', 'Prompt 2', 'Body 2', 2000),
    ];
    const env = setupEnvironment(initial);
    const prompts = await getMyPrompts();

    let submitEdit: ((v: { title: string; content: string }) => Promise<void>) | null =
      null;
    mocks.editorOpen.mockImplementationOnce((_item, onSubmit) => {
      submitEdit = onSubmit;
    });
    showDialog(prompts[0]);

    // Defer the Edit storage write, then trigger Delete of p-2 while Edit is in flight
    env.deferNextSet = true;
    const editPromise = submitEdit!({
      title: 'Prompt 1 Updated',
      content: 'Body 1 Updated',
    });
    const deletePromise = deletePrompt(prompts[1]);

    // Let edit's deferred set start and delete's confirmation modal resolve
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.pendingSets).toHaveLength(1);

    // Finish Edit's set -> Delete now runs against the updated collection
    env.pendingSets.shift()!();
    await Promise.all([editPromise, deletePromise]);

    const finalPrompts = await getMyPrompts();
    expect(finalPrompts).toHaveLength(1);
    expect(finalPrompts[0].id).toBe('p-1');
    expect(finalPrompts[0].title).toBe('Prompt 1 Updated');
    expect(mocks.usageRemove).toHaveBeenCalledWith('p-2');
  });

  it('failed deletePrompt does not remove usage metadata', async () => {
    const initial = [makePrompt('p-1', 'Prompt 1', 'Body 1', 1000)];
    const env = setupEnvironment(initial);
    const prompts = await getMyPrompts();

    env.failNextSets = 1;
    await deletePrompt(prompts[0]);

    expect(mocks.usageRemove).not.toHaveBeenCalled();
    expect((await getMyPrompts()).map((p) => p.id)).toEqual(['p-1']);
  });

  it('rapid same-millisecond Create -> Create produces unique IDs and preserves both prompts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(555555);
    const env = setupEnvironment([]);
    await getMyPrompts();

    const submitters: Array<
      (v: { title: string; content: string }) => Promise<void>
    > = [];
    mocks.editorOpen.mockImplementation((_item, onSubmit) => {
      submitters.push(onSubmit);
    });

    showDialog(null);
    showDialog(null);

    env.deferNextSet = true;
    const create1 = submitters[0]({ title: 'First', content: 'Body 1' });
    const create2 = submitters[1]({ title: 'Second', content: 'Body 2' });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.pendingSets).toHaveLength(1);
    env.pendingSets.shift()!();

    await Promise.all([create1, create2]);

    const finalPrompts = await getMyPrompts();
    expect(finalPrompts).toHaveLength(2);
    expect(new Set(finalPrompts.map((p) => p.id)).size).toBe(2);
    expect(finalPrompts.map((p) => p.title)).toEqual(['First', 'Second']);
  });

  it('clearAllMyPrompts queued after a pending create clears all prompts cleanly', async () => {
    const initial = [makePrompt('p-1', 'Prompt 1', 'Body 1', 1000)];
    const env = setupEnvironment(initial);
    await getMyPrompts();

    let submitCreate: ((v: { title: string; content: string }) => Promise<void>) | null =
      null;
    mocks.editorOpen.mockImplementationOnce((_item, onSubmit) => {
      submitCreate = onSubmit;
    });
    showDialog(null);

    env.deferNextSet = true;
    const createPromise = submitCreate!({ title: 'Second', content: 'Body 2' });
    const clearPromise = clearAllMyPrompts();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.pendingSets).toHaveLength(1);
    env.pendingSets.shift()!();

    await Promise.all([createPromise, clearPromise]);

    expect(await getMyPrompts()).toEqual([]);
    expect(env.persisted[STORAGE_KEY]).toEqual([]);
    expect(mocks.usageClear).toHaveBeenCalledTimes(1);
  });
});
