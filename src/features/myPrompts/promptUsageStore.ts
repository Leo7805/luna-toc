/**
 * Persists local usage statistics used to rank My Prompts autocomplete items.
 */
const STORAGE_KEY = 'lunaToc:promptUsageV1';

/** Usage metadata recorded for a saved prompt. */
export interface PromptUsage {
  usageCount: number;
  lastUsedAt: number;
}

/** Usage records keyed by saved prompt ID. */
export type PromptUsageMap = Record<string, PromptUsage>;

/** Storage API for reading and updating prompt usage metadata. */
export interface PromptUsageStore {
  getAll(): Promise<PromptUsageMap>;
  recordUse(promptId: string): Promise<void>;
  remove(promptId: string): Promise<void>;
  clear(): Promise<void>;
}

class MalformedPromptUsageStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedPromptUsageStorageError';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Clones each usage record so callers cannot mutate the store's internal cache.
 */
function cloneUsageMap(usage: PromptUsageMap): PromptUsageMap {
  const copy: PromptUsageMap = {};
  for (const [id, entry] of Object.entries(usage)) {
    copy[id] = { ...entry };
  }
  return copy;
}

/**
 * Validates a raw Chrome Storage value for prompt usage metadata.
 * Treats `undefined` (missing/removed key) as an empty map and rejects any
 * malformed root payload or invalid entry to prevent silent data loss.
 */
function parseStoredUsageMap(rawValue: unknown): PromptUsageMap {
  if (rawValue === undefined) {
    return {};
  }
  if (!isPlainRecord(rawValue)) {
    throw new MalformedPromptUsageStorageError(
      'Invalid prompt usage storage payload: expected an object'
    );
  }

  const parsed: PromptUsageMap = {};
  for (const [promptId, entry] of Object.entries(rawValue)) {
    if (!isPlainRecord(entry)) {
      throw new MalformedPromptUsageStorageError(
        `Invalid prompt usage entry for "${promptId}": expected an object`
      );
    }

    const { usageCount, lastUsedAt } = entry;
    if (
      typeof usageCount !== 'number' ||
      !Number.isFinite(usageCount) ||
      usageCount < 0
    ) {
      throw new MalformedPromptUsageStorageError(
        `Invalid prompt usageCount for "${promptId}"`
      );
    }
    if (
      typeof lastUsedAt !== 'number' ||
      !Number.isFinite(lastUsedAt) ||
      lastUsedAt < 0
    ) {
      throw new MalformedPromptUsageStorageError(
        `Invalid prompt lastUsedAt for "${promptId}"`
      );
    }

    parsed[promptId] = {
      ...entry,
      usageCount,
      lastUsedAt,
    } as PromptUsage;
  }

  return parsed;
}

/**
 * Creates a cached usage store backed by chrome.storage.local.
 *
 * @example
 * const store = createPromptUsageStore();
 * await store.recordUse(promptId);
 */
export function createPromptUsageStore(): PromptUsageStore {
  let cache: PromptUsageMap = {};
  let hasAuthoritativeState = false;
  let storageGeneration = 0;
  let hydratePromise: Promise<PromptUsageMap> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();

  const hydrate = (): Promise<PromptUsageMap> => {
    if (hasAuthoritativeState) {
      return Promise.resolve(cloneUsageMap(cache));
    }

    if (!hydratePromise) {
      const readGeneration = storageGeneration;
      const pending = readUsage().then(
        (usage) => {
          if (hydratePromise === pending) {
            hydratePromise = null;
          }
          if (storageGeneration !== readGeneration) {
            if (hasAuthoritativeState) {
              return cloneUsageMap(cache);
            }
            throw new MalformedPromptUsageStorageError(
              'Prompt usage storage became invalid during hydration'
            );
          }
          cache = cloneUsageMap(usage);
          hasAuthoritativeState = true;
          return cloneUsageMap(cache);
        },
        (error: unknown) => {
          if (hydratePromise === pending) {
            hydratePromise = null;
          }
          if (hasAuthoritativeState) {
            return cloneUsageMap(cache);
          }
          throw error;
        }
      );
      hydratePromise = pending;
    }

    return hydratePromise;
  };

  if (isContextValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;

        let nextUsage: PromptUsageMap;
        try {
          nextUsage = parseStoredUsageMap(changes[STORAGE_KEY].newValue);
        } catch {
          storageGeneration += 1;
          hasAuthoritativeState = false;
          hydratePromise = null;
          return;
        }

        cache = cloneUsageMap(nextUsage);
        storageGeneration += 1;
        hasAuthoritativeState = true;
      });
    } catch {
      // Ignore listener registration failures.
    }
  }

  const runWrite = (
    updater: (current: PromptUsageMap) => PromptUsageMap | null
  ): Promise<void> => {
    const operation = writeQueue.catch(() => undefined).then(async () => {
      await hydrate();
      const nextUsage = updater(cloneUsageMap(cache));
      if (nextUsage === null) {
        return;
      }

      const writeGenerationBefore = storageGeneration;
      await writeUsage(nextUsage);

      if (
        storageGeneration !== writeGenerationBefore &&
        !hasAuthoritativeState
      ) {
        return;
      }

      cache = cloneUsageMap(nextUsage);
      hasAuthoritativeState = true;
      storageGeneration += 1;
    });

    writeQueue = operation;
    return operation;
  };

  return {
    getAll: async () => {
      await hydrate();
      return cloneUsageMap(cache);
    },
    recordUse: (promptId) =>
      runWrite((current) => {
        const previous = current[promptId];
        return {
          ...current,
          [promptId]: {
            ...(previous ?? {}),
            usageCount: (previous?.usageCount ?? 0) + 1,
            lastUsedAt: Date.now(),
          },
        };
      }),
    remove: (promptId) =>
      runWrite((current) => {
        if (!(promptId in current)) return null;
        const nextUsage = { ...current };
        delete nextUsage[promptId];
        return nextUsage;
      }),
    clear: () => runWrite(() => ({})),
  };
}

function isContextValid(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
  );
}

function readUsage(): Promise<PromptUsageMap> {
  return new Promise((resolve, reject) => {
    if (!isContextValid()) {
      reject(new Error('Invalid extension context'));
      return;
    }

    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      try {
        resolve(parseStoredUsageMap(result[STORAGE_KEY]));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeUsage(usage: PromptUsageMap): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isContextValid()) {
      reject(new Error('Invalid extension context'));
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEY]: usage }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}
