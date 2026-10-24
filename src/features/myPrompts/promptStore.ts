/** My Prompts storage: all mutations are committed by the extension background. */
import {
  PROMPT_COMMIT_TYPE,
  PROMPT_STORAGE_KEY,
  equalPromptLists,
  isPromptList,
  type PromptCommitResponse,
} from './promptWriteCoordinator';

export interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type PromptsChangedListener = (prompts: SavedPrompt[]) => void;

export interface PromptStore {
  getAll(): Promise<SavedPrompt[]>;
  /** Replaces the observed snapshot, rejecting concurrent changes. Prefer update(). */
  saveAll(prompts: SavedPrompt[]): Promise<void>;
  /** Delete an observed snapshot and its usage together. */
  clearAll(observedPrompts: SavedPrompt[]): Promise<void>;
  update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void>;
  subscribe(listener: PromptsChangedListener): () => void;
}

const MAX_CONFLICT_RETRIES = 8;
const READ_RETRIES = 3;

function isContextValid(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function samePrompt(left: SavedPrompt | undefined, right: SavedPrompt | undefined): boolean {
  if (!left || !right) return left === right;
  return left.id === right.id && left.title === right.title &&
    left.content === right.content && left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt;
}

/** Finds IDs changed by a transform, so a conflict retry cannot clobber those same records. */
function changedIds(before: SavedPrompt[], after: SavedPrompt[]): Set<string> {
  const original = new Map(before.map((item) => [item.id, item]));
  const changed = new Set<string>();
  for (const item of after) {
    if (!samePrompt(original.get(item.id), item)) changed.add(item.id);
    original.delete(item.id);
  }
  for (const id of original.keys()) changed.add(id);
  return changed;
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

/** Rejects invalid extension contexts and unexpected background responses. */
function backgroundCommit(expected: SavedPrompt[], next: SavedPrompt[]): Promise<'ok' | 'conflict'> {
  if (!isContextValid()) {
    return Promise.reject(new Error('Invalid extension context: prompts were not saved'));
  }
  if (!isPromptList(next)) {
    return Promise.reject(new Error('Invalid prompt data: prompts were not saved'));
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: PROMPT_COMMIT_TYPE, expected: clone(expected), next: clone(next),
    }, (response: PromptCommitResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Background writer unavailable'));
      } else if (response?.ok === true) {
        resolve('ok');
      } else if (response?.ok === false && 'conflict' in response) {
        resolve('conflict');
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
  const listeners = new Set<PromptsChangedListener>();
  // Associates a returned mutable list with the exact persisted state it came from.
  // Storage change events must never silently advance a caller's replace precondition.
  const observed = new WeakMap<SavedPrompt[], SavedPrompt[]>();

  const snapshot = (): SavedPrompt[] => clone(cache);
  const exportSnapshot = (): SavedPrompt[] => {
    const copy = snapshot();
    observed.set(copy, snapshot());
    return copy;
  };
  const publish = (prompts: SavedPrompt[]): void => {
    cache = clone(prompts);
    hydrated = true;
    const next = snapshot();
    listeners.forEach((listener) => {
      try { listener(clone(next)); } catch { /* Listener errors cannot abort a save. */ }
    });
  };

  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[PROMPT_STORAGE_KEY]) return;
        const next = changes[PROMPT_STORAGE_KEY].newValue;
        if (next === undefined) publish([]);
        else if (isPromptList(next)) publish(next);
        // Ignore malformed storage changes rather than poisoning the cache.
      });
    } catch { /* Context might already have been invalidated. */ }
  }

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const task = writeQueue.catch(() => undefined).then(operation);
    writeQueue = task.catch(() => undefined);
    return task;
  };

  return {
    async getAll(): Promise<SavedPrompt[]> {
      await writeQueue;
      try {
        const latest = await readFresh();
        if (!hydrated || !equalPromptLists(cache, latest)) publish(latest);
        return exportSnapshot();
      } catch (error) {
        if (hydrated) return exportSnapshot();
        throw error;
      }
    },
    saveAll(prompts: SavedPrompt[]): Promise<void> {
      // Unobserved lists have no safe base for a whole-library replacement.
      // The exact getAll() array can be edited in place and supplied here.
      const base = observed.get(prompts);
      if (!base) return Promise.reject(new Error('Read prompts before replacing the full collection'));
      const expected = clone(base);
      const next = clone(prompts);
      return enqueue(async () => {
        // Never infer a replacement baseline from a newer storage notification.
        const latest = await readFresh();
        if (!equalPromptLists(expected, latest)) {
          publish(latest);
          throw new Error('Prompts changed in another tab; reload before replacing them');
        }
        const result = await backgroundCommit(expected, next);
        if (result !== 'ok') throw new Error('Prompts changed in another tab; reload before replacing them');
        publish(next);
      });
    },
    clearAll(observedPrompts: SavedPrompt[]): Promise<void> {
      const baseline = observed.get(observedPrompts);
      if (!baseline) return Promise.reject(new Error('Read prompts before clearing the collection'));
      const expected = clone(baseline);
      return enqueue(async () => {
        const latest = await readFresh();
        if (!equalPromptLists(expected, latest)) {
          publish(latest);
          throw new Error('其他标签页已修改提示词，请重新确认清空操作。');
        }
        if (!isContextValid()) throw new Error('Invalid extension context: prompts were not cleared');
        const response = await new Promise<PromptCommitResponse>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: PROMPT_COMMIT_TYPE, action: 'clear-all', expected },
            (result: PromptCommitResponse | undefined) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'Background writer unavailable'));
              else if (result && typeof result.ok === 'boolean') resolve(result);
              else reject(new Error('Background writer did not confirm the clear'));
            }
          );
        });
        if (!response.ok) {
          if ('conflict' in response) throw new Error('其他标签页已修改提示词，请重新确认清空操作。');
          throw new Error(response.error);
        }
        publish([]);
      });
    },
    update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void> {
      return enqueue(async () => {
        for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
          const latest = await readFresh();
          const next = transform(clone(latest));
          if (!isPromptList(next)) throw new Error('Invalid prompt update');
          const result = await backgroundCommit(latest, next);
          if (result === 'ok') {
            publish(next);
            return;
          }
          // A concurrent change to any of our edited IDs is a real conflict,
          // not an excuse to silently use last-writer-wins on that record.
          const updated = await readFresh();
          const beforeIds = new Map(latest.map((item) => [item.id, item]));
          const updatedIds = new Map(updated.map((item) => [item.id, item]));
          const destructiveClear = latest.length > 0 && next.length === 0;
          if ((destructiveClear && !equalPromptLists(latest, updated)) ||
              [...changedIds(latest, next)].some((id) =>
                !samePrompt(beforeIds.get(id), updatedIds.get(id)))) {
            publish(updated);
            throw new Error('Prompts changed in another tab; conflicting edits were not saved');
          }
          // Unrelated additions or edits can safely be replayed on the latest list.
        }
        const latest = await readFresh();
        publish(latest);
        throw new Error('Prompts changed repeatedly in other tabs; please retry');
      });
    },
    subscribe(listener: PromptsChangedListener): () => void {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
