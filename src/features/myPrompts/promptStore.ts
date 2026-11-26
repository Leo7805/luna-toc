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
  update(updater: (prompts: SavedPrompt[]) => SavedPrompt[]): Promise<void>;
  subscribe(listener: PromptsChangedListener): () => void;
  getSnapshot(): SavedPrompt[];
}

class MalformedPromptsStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedPromptsStorageError';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and normalizes a single stored prompt record in memory without
 * mutating the input or discarding extra unknown fields.
 */
function parseStoredPromptRecord(
  entry: unknown,
  index: number,
  seenIds: Set<string>
): SavedPrompt {
  if (!isPlainRecord(entry)) {
    throw new MalformedPromptsStorageError(
      `Invalid My Prompts record at index ${index}: expected an object`
    );
  }

  const { id, title, content } = entry;
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new MalformedPromptsStorageError(
      `Invalid My Prompts record at index ${index}: expected non-empty string id`
    );
  }
  if (typeof title !== 'string') {
    throw new MalformedPromptsStorageError(
      `Invalid My Prompts record "${id}": expected string title`
    );
  }
  if (typeof content !== 'string') {
    throw new MalformedPromptsStorageError(
      `Invalid My Prompts record "${id}": expected string content`
    );
  }
  if (seenIds.has(id)) {
    throw new MalformedPromptsStorageError(
      `Invalid My Prompts storage payload: duplicate prompt id "${id}"`
    );
  }
  seenIds.add(id);

  const hasCreatedAt =
    typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt);
  const hasUpdatedAt =
    typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt);
  const createdAt = hasCreatedAt
    ? (entry.createdAt as number)
    : hasUpdatedAt
      ? (entry.updatedAt as number)
      : 0;
  const updatedAt = hasUpdatedAt
    ? (entry.updatedAt as number)
    : hasCreatedAt
      ? (entry.createdAt as number)
      : 0;

  return {
    ...entry,
    id,
    title,
    content,
    createdAt,
    updatedAt,
  } as SavedPrompt;
}

/**
 * Parses a raw Chrome storage value for My Prompts.
 * Treats `undefined` (missing/removed key) as a valid empty collection,
 * normalizes recognized legacy timestamp fields in memory, and rejects any
 * malformed root value, invalid record, or duplicate ID to prevent data loss.
 */
function parseStoredPrompts(rawValue: unknown): SavedPrompt[] {
  if (rawValue === undefined) {
    return [];
  }
  if (!Array.isArray(rawValue)) {
    throw new MalformedPromptsStorageError(
      'Invalid My Prompts storage payload: expected an array'
    );
  }

  const seenIds = new Set<string>();
  return rawValue.map((entry, index) =>
    parseStoredPromptRecord(entry, index, seenIds)
  );
}

function clonePrompts(prompts: SavedPrompt[]): SavedPrompt[] {
  return prompts.map((prompt) => ({ ...prompt }));
}

function arePromptListsEqual(
  left: SavedPrompt[],
  right: SavedPrompt[]
): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.content !== b.content ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt
    ) {
      return false;
    }
  }
  return true;
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
  let writeQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<PromptsChangedListener>();

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
    return parseStoredPrompts(result[storageKey]);
  }

  async function hydrateFromStorage(maxAttempts = 3): Promise<SavedPrompt[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await readPromptsRecord();
        return readPromptsList(result);
      } catch (error) {
        if (error instanceof MalformedPromptsStorageError) {
          throw error;
        }
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
            if (hasAuthoritativeState) {
              return getCacheCopy();
            }
            throw new MalformedPromptsStorageError(
              'My Prompts storage became invalid during hydration'
            );
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

        let nextPrompts: SavedPrompt[];
        try {
          nextPrompts = parseStoredPrompts(promptChange.newValue);
        } catch {
          storageGeneration += 1;
          hasAuthoritativeState = false;
          hydratePromise = null;
          return;
        }

        const changed =
          !hasAuthoritativeState || !arePromptListsEqual(cache, nextPrompts);
        storageGeneration += 1;
        hasAuthoritativeState = true;
        setCache(nextPrompts);
        if (changed) {
          notifyListeners();
        }
      });
    } catch (e) {
      // Ignore listener registration failures.
    }
  }

  function update(
    updater: (prompts: SavedPrompt[]) => SavedPrompt[]
  ): Promise<void> {
    const operation = writeQueue.catch(() => undefined).then(async () => {
      await hydrate();
      const nextPrompts = clonePrompts(updater(getCacheCopy()));

      if (!isContextValid()) {
        const changed = !arePromptListsEqual(cache, nextPrompts);
        setCache(nextPrompts);
        if (changed) {
          notifyListeners();
        }
        return;
      }

      const writeGenerationBefore = storageGeneration;
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ [storageKey]: nextPrompts }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }

          if (
            storageGeneration !== writeGenerationBefore &&
            !hasAuthoritativeState
          ) {
            resolve();
            return;
          }

          const changed = !arePromptListsEqual(cache, nextPrompts);
          setCache(nextPrompts);
          hasAuthoritativeState = true;
          storageGeneration += 1;
          if (changed) {
            notifyListeners();
          }
          resolve();
        });
      });
    });

    writeQueue = operation;
    return operation;
  }

  return {
    async getAll(): Promise<SavedPrompt[]> {
      await hydrate();
      return getCacheCopy();
    },
    saveAll(prompts: SavedPrompt[]): Promise<void> {
      const replacement = Array.isArray(prompts) ? clonePrompts(prompts) : [];
      return update(() => replacement);
    },
    update,
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
