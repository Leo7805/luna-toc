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
  let hydratePromise: Promise<PromptUsageMap> | null = null;
  let writeQueue = Promise.resolve();

  const copyCache = (): PromptUsageMap => ({ ...cache });

  const hydrate = (): Promise<PromptUsageMap> => {
    if (!hydratePromise) {
      hydratePromise = readUsage().then((usage) => {
        cache = usage;
        return copyCache();
      });
    }
    return hydratePromise;
  };

  if (isContextValid()) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      cache = normalizeUsageMap(changes[STORAGE_KEY].newValue);
      hydratePromise = Promise.resolve(copyCache());
    });
  }

  return {
    getAll: async () => ({ ...(await hydrate()) }),
    recordUse: (promptId) => {
      writeQueue = writeQueue.catch(() => undefined).then(async () => {
        await hydrate();
        const previous = cache[promptId];
        cache = {
          ...cache,
          [promptId]: {
            usageCount: (previous?.usageCount ?? 0) + 1,
            lastUsedAt: Date.now(),
          },
        };
        await writeUsage(cache);
      });
      return writeQueue;
    },
    remove: (promptId) => {
      writeQueue = writeQueue.catch(() => undefined).then(async () => {
        await hydrate();
        if (!cache[promptId]) return;
        const nextUsage = { ...cache };
        delete nextUsage[promptId];
        cache = nextUsage;
        await writeUsage(cache);
      });
      return writeQueue;
    },
  };
}

function isContextValid(): boolean {
  return (
    typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id
  );
}

function normalizeUsageMap(value: unknown): PromptUsageMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, PromptUsage] => {
      const usage = entry[1] as Partial<PromptUsage> | null;
      return (
        !!usage &&
        Number.isFinite(usage.usageCount) &&
        Number.isFinite(usage.lastUsedAt)
      );
    })
  );
}

function readUsage(): Promise<PromptUsageMap> {
  if (!isContextValid()) return Promise.resolve({});

  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(normalizeUsageMap(result[STORAGE_KEY]));
    });
  });
}

function writeUsage(usage: PromptUsageMap): Promise<void> {
  if (!isContextValid()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: usage }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}
