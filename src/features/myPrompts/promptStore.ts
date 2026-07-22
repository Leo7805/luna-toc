/**
 * Shared prompt storage helper for ChatTOC My Prompts.
 */
const storageKey = 'chatToc:myPrompts';

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
}

function isContextValid(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
  );
}

export function createPromptStore(): PromptStore {
  let cache: SavedPrompt[] = [];
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
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await readPromptsRecord();
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
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
