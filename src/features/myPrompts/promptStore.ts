/** Account-scoped prompt storage with ordered writes and acknowledged background commits. */
import {
  PROMPT_COMMIT_TYPE,
  PROMPT_STORAGE_KEY,
  equalPromptLists,
  isPromptList,
  type PromptCommitRequest,
  type PromptCommitResponse,
} from './promptWriteCoordinator';
import {
  getActiveConversationOwner,
  subscribeActiveConversationOwner,
} from '@/navigation/lifecycle/conversationOwner';

export interface SavedPrompt {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type PromptsChangedListener = (prompts: SavedPrompt[]) => void;

export interface PromptStore {
  getAll(): Promise<SavedPrompt[]>;
  /** Clears only the verified account's prompts and their usage metadata. */
  clearAll(): Promise<void>;
  /** Applies an edit to the active account's latest prompt list. */
  update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void>;
  subscribe(listener: PromptsChangedListener): () => void;
}

const READ_RETRIES = 3;
function isContextValid(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function clone(prompts: SavedPrompt[]): SavedPrompt[] {
  return prompts.map((item) => ({ ...item }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStorage(): Promise<SavedPrompt[]> {
  return new Promise((resolve, reject) => {
    if (!isContextValid()) {
      reject(new Error('Invalid extension context'));
      return;
    }
    chrome.storage.local.get(PROMPT_STORAGE_KEY, (values) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? 'Prompt storage read failed'));
        return;
      }
      const raw: unknown = values[PROMPT_STORAGE_KEY];
      if (raw !== undefined && !isPromptList(raw)) {
        reject(new Error('Prompt storage contains invalid data; refusing to overwrite it'));
        return;
      }
      resolve(clone(raw === undefined ? [] : raw));
    });
  });
}

async function readFresh(): Promise<SavedPrompt[]> {
  let failure: unknown = null;
  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    try { return await readStorage(); }
    catch (error) {
      failure = error;
      if (attempt < READ_RETRIES - 1) await delay(80 * (attempt + 1));
    }
  }
  throw failure instanceof Error ? failure : new Error('Prompt storage could not be read');
}

function backgroundCommit(request: PromptCommitRequest): Promise<void> {
  if (!isContextValid()) {
    return Promise.reject(new Error('Invalid extension context: prompts were not saved'));
  }
  if (request.action === 'replace-account' &&
      (!isPromptList(request.next) || request.next.some((prompt) => prompt.ownerId !== request.ownerId))) {
    return Promise.reject(new Error('Invalid prompt data: prompts were not saved'));
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: PromptCommitResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Background writer unavailable'));
      } else if (response?.ok === true) {
        resolve();
      } else {
        reject(new Error(response && 'error' in response
          ? response.error : 'Background writer did not confirm the save'));
      }
    });
  });
}

export function createPromptStore(): PromptStore {
  let cache: SavedPrompt[] = [];
  let hydrated = false;
  let writeQueue: Promise<void> = Promise.resolve();
  let cleanupPromise: Promise<void> | null = null;
  const listeners = new Set<PromptsChangedListener>();

  const snapshot = (): SavedPrompt[] => {
    const ownerId = getActiveConversationOwner();
    return ownerId ? clone(cache.filter((prompt) => prompt.ownerId === ownerId)) : [];
  };
  const notify = (): void => {
    const next = snapshot();
    listeners.forEach((listener) => {
      try { listener(clone(next)); } catch { /* Listener errors cannot abort a save. */ }
    });
  };
  const publish = (prompts: SavedPrompt[]): void => {
    cache = clone(prompts);
    hydrated = true;
    notify();
  };
  const ensureUnownedCleaned = (): Promise<void> => {
    if (!cleanupPromise) {
      cleanupPromise = backgroundCommit({
        type: PROMPT_COMMIT_TYPE, action: 'cleanup-unowned',
      }).catch((error) => {
        cleanupPromise = null;
        throw error;
      });
    }
    return cleanupPromise;
  };

  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[PROMPT_STORAGE_KEY]) return;
        const next = changes[PROMPT_STORAGE_KEY].newValue;
        if (next === undefined) publish([]);
        else if (isPromptList(next)) publish(next);
        else {
          cleanupPromise = null;
          void ensureUnownedCleaned().catch(() => undefined);
        }
      });
    } catch { /* Context might already have been invalidated. */ }
  }

  subscribeActiveConversationOwner(() => {
    notify();
    void getAll().catch(() => undefined);
  });

  async function getAll(): Promise<SavedPrompt[]> {
    const ownerId = getActiveConversationOwner();
    if (!ownerId) {
      try { await ensureUnownedCleaned(); } catch { /* Never expose unbound data. */ }
      return [];
    }
    await writeQueue;
    try {
      await ensureUnownedCleaned();
      const latest = await readFresh();
      if (!hydrated || !equalPromptLists(cache, latest)) publish(latest);
      return snapshot();
    } catch (error) {
      if (hydrated) return snapshot();
      throw error;
    }
  }


  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const task = writeQueue.catch(() => undefined).then(operation);
    writeQueue = task.catch(() => undefined);
    return task;
  };

  return {
    getAll,
    clearAll(): Promise<void> {
      const ownerId = getActiveConversationOwner();
      if (!ownerId) return Promise.reject(new Error('ChatGPT account not verified; prompts were not cleared'));
      return enqueue(async () => {
        if (ownerId !== getActiveConversationOwner()) {
          throw new Error('ChatGPT account changed; prompts were not cleared');
        }
        await ensureUnownedCleaned();
        const latest = await readFresh();
        if (ownerId !== getActiveConversationOwner()) {
          throw new Error('ChatGPT account changed; prompts were not cleared');
        }
        await backgroundCommit({
          type: PROMPT_COMMIT_TYPE, action: 'clear-account', ownerId,
        });
        publish(latest.filter((prompt) => prompt.ownerId !== ownerId));
      });
    },
    update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void> {
      const ownerId = getActiveConversationOwner();
      if (!ownerId) return Promise.reject(new Error('ChatGPT account not verified; prompts were not saved'));
      return enqueue(async () => {
        if (ownerId !== getActiveConversationOwner()) {
          throw new Error('ChatGPT account changed; prompts were not saved');
        }
        await ensureUnownedCleaned();
        const latest = await readFresh();
        const current = latest.filter((prompt) => prompt.ownerId === ownerId);
        const nextOwned = transform(clone(current));
        if (!isPromptList(nextOwned) || nextOwned.some((prompt) => prompt.ownerId !== ownerId)) {
          throw new Error('Invalid prompt update');
        }
        const nextAll = [...latest.filter((prompt) => prompt.ownerId !== ownerId), ...nextOwned];
        if (!isPromptList(nextAll)) throw new Error('Invalid prompt update');
        if (ownerId !== getActiveConversationOwner()) {
          throw new Error('ChatGPT account changed; prompts were not saved');
        }
        await backgroundCommit({
          type: PROMPT_COMMIT_TYPE, action: 'replace-account', ownerId, next: nextOwned,
        });
        publish(nextAll);
      });
    },
    subscribe(listener: PromptsChangedListener): () => void {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
