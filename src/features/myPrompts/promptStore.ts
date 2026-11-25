/**
 * Shared prompt storage helper for LumaTOC My Prompts.
 */
const storageKey = 'lumaToc:myPromptsV1';

/**
 * Represents a saved prompt in the LumaTOC My Prompts feature.
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
  subscribe(listener: PromptsChangedListener): () => void;
  getSnapshot(): SavedPrompt[];
}

function isContextValid(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
  );
}

export function createPromptStore(): PromptStore {
  let cache: SavedPrompt[] = [];
  let hasAuthoritativeState = false;
  let storageGeneration = 0;
  let hydratePromise: Promise<SavedPrompt[]> | null = null;
  const listeners = new Set<PromptsChangedListener>();

  function getCacheCopy(): SavedPrompt[] {
    return [...cache];
  }

  function setCache(prompts: SavedPrompt[]): void {
    cache = Array.isArray(prompts) ? [...prompts] : [];
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
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await readPromptsRecord();
        return readPromptsList(result);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await wait(80 * attempt);
        }
      }
    }

    throw lastError ?? new Error('Failed to hydrate prompts from storage');
  }

  function hydrate(): Promise<SavedPrompt[]> {
    if (hasAuthoritativeState) {
      return Promise.resolve(getCacheCopy());
    }

    if (!hydratePromise) {
      const readGeneration = storageGeneration;
      const pending = hydrateFromStorage().then(
        (prompts) => {
          if (hydratePromise === pending) {
            hydratePromise = null;
          }
          if (storageGeneration !== readGeneration) {
            return getCacheCopy();
          }
          setCache(prompts);
          hasAuthoritativeState = true;
          notifyListeners();
          return getCacheCopy();
        },
        (error: unknown) => {
          if (hydratePromise === pending) {
            hydratePromise = null;
          }
          if (hasAuthoritativeState) {
            return getCacheCopy();
          }
          throw error;
        }
      );
      hydratePromise = pending;
    }

    return hydratePromise;
  }

  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        const promptChange = changes[storageKey];
        if (!promptChange) return;

        storageGeneration += 1;
        hasAuthoritativeState = true;
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

  return {
    async getAll(): Promise<SavedPrompt[]> {
      await hydrate();
      return getCacheCopy();
    },
    async saveAll(prompts: SavedPrompt[]): Promise<void> {
      const nextPrompts = Array.isArray(prompts) ? [...prompts] : [];
      await hydrate();
      const previousPrompts = getCacheCopy();
      setCache(nextPrompts);

      if (!isContextValid()) {
        notifyListeners();
        return;
      }

      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [storageKey]: nextPrompts }, () => {
          if (chrome.runtime.lastError) {
            setCache(previousPrompts);
            reject(chrome.runtime.lastError);
            return;
          }

          storageGeneration += 1;
          notifyListeners();
          resolve();
        });
      });
    },
    subscribe(listener: PromptsChangedListener): () => void {
      if (typeof listener !== 'function') {
        return () => {};
      }

      listeners.add(listener);
      void hydrate().catch(() => undefined);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): SavedPrompt[] {
      return cache;
    },
  };
}
