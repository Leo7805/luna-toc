/**
 * Shared prompt storage helper for LunaTOC My Prompts.
 */
// Preserve the legacy key so users retain previously saved prompts.
const storageKey = 'lumaToc:myPromptsV1';

/**
 * Represents a saved prompt in the LunaTOC My Prompts feature.
 */
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
  saveAll(prompts: SavedPrompt[]): Promise<void>;
  update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void>;
  subscribe(listener: PromptsChangedListener): () => void;
}

function isContextValid(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
  );
}

export function createPromptStore(): PromptStore {
  let cache: SavedPrompt[] = [];
  let hydratePromise: Promise<SavedPrompt[]> | null = null;
  let hydrationVerified = false;
  let writeQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<PromptsChangedListener>();

  // Copies records as well as the array: callers must not mutate cached data.
  function clonePrompts(prompts: SavedPrompt[]): SavedPrompt[] {
    return prompts.map((prompt) => ({ ...prompt }));
  }

  function getCacheCopy(): SavedPrompt[] {
    return clonePrompts(cache);
  }

  function setCache(prompts: SavedPrompt[]): void {
    cache = Array.isArray(prompts) ? clonePrompts(prompts) : [];
  }

  function notifyListeners(): void {
    const prompts = getCacheCopy();
    listeners.forEach((listener) => {
      try {
        listener(prompts);
      } catch (e) {
        // Ignore listener failures.
      }
    });
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function readPromptsRecord(): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!isContextValid()) {
        reject(new Error('Invalid extension context'));
        return;
      }

      chrome.storage.local.get(storageKey, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve(result as Record<string, unknown>);
      });
    });
  }

  function readPromptsList(result: Record<string, unknown>): SavedPrompt[] {
    return Array.isArray(result[storageKey]) ? [...result[storageKey]] : [];
  }

  async function hydrateFromStorage(maxAttempts = 3): Promise<SavedPrompt[]> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await readPromptsRecord();
        hydrationVerified = true;
        return readPromptsList(result);
      } catch (error) {
        if (attempt < maxAttempts) {
          await wait(80 * attempt);
        }
      }
    }

    return getCacheCopy();
  }

  function hydrate(): Promise<SavedPrompt[]> {
    if (!hydratePromise) {
      hydratePromise = hydrateFromStorage().then((prompts) => {
        setCache(prompts);
        // Retry the next read rather than permanently caching a failed load.
        if (!hydrationVerified) hydratePromise = null;
        return getCacheCopy();
      });
    }

    return hydratePromise;
  }

  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        const promptChange = changes[storageKey];
        if (!promptChange) return;

        setCache(
          Array.isArray(promptChange.newValue)
            ? (promptChange.newValue as SavedPrompt[])
            : []
        );
        notifyListeners();
      });
    } catch (e) {
      // Ignore listener registration failures.
    }
  }

  async function persist(prompts: SavedPrompt[]): Promise<void> {
    await hydrate();
    if (!hydrationVerified) {
      throw new Error('Prompt storage could not be read; refusing to overwrite it');
    }
    if (!isContextValid()) {
      throw new Error('Invalid extension context: prompts were not saved');
    }

    const previous = getCacheCopy();
    const next = clonePrompts(prompts);
    setCache(next);
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [storageKey]: next }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'Prompt storage write failed'));
          } else {
            resolve();
          }
        });
      });
      notifyListeners();
    } catch (error) {
      setCache(previous);
      notifyListeners();
      throw error;
    }
  }

  // Serialize reads/modifications/writes in this extension context.
  function enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const pending = writeQueue.catch(() => undefined).then(operation);
    writeQueue = pending.catch(() => undefined);
    return pending;
  }

  return {
    async getAll(): Promise<SavedPrompt[]> {
      await hydrate();
      await writeQueue;
      return getCacheCopy();
    },
    saveAll(prompts: SavedPrompt[]): Promise<void> {
      const snapshot = clonePrompts(Array.isArray(prompts) ? prompts : []);
      return enqueueWrite(() => persist(snapshot));
    },
    update(transform: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void> {
      return enqueueWrite(async () => {
        await hydrate();
        if (!hydrationVerified) {
          throw new Error('Prompt storage could not be read; refusing to overwrite it');
        }
        await persist(transform(getCacheCopy()));
      });
    },
    subscribe(listener: PromptsChangedListener): () => void {
      if (typeof listener !== 'function') {
        return () => {};
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
