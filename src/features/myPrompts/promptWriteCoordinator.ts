/** Validates account-scoped prompt writes in the Manifest V3 background service worker. */
import type { SavedPrompt } from './promptStore';
import { createSerialWriteQueue, type SerialWriteQueue } from '@/features/storage/serialWriteQueue';

export const PROMPT_STORAGE_KEY = 'lumaToc:myPromptsV1'; // Existing installs keep this key.
export const PROMPT_COMMIT_TYPE = 'LUNA_TOC_PROMPTS_COMMIT_V1';
const MAX_RECORDS = 20_000;
const USAGE_STORAGE_KEY = 'lunaToc:promptUsageV1';

export type PromptCommitRequest =
  | { type: typeof PROMPT_COMMIT_TYPE; action: 'replace-account'; ownerId: string; next: SavedPrompt[] }
  | { type: typeof PROMPT_COMMIT_TYPE; action: 'clear-account'; ownerId: string }
  | { type: typeof PROMPT_COMMIT_TYPE; action: 'cleanup-unowned' };
export type PromptCommitResponse = { ok: true } | { ok: false; error: string };

type PromptStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'> &
  Partial<Pick<chrome.storage.StorageArea, 'remove'>>;

function validOwner(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 256;
}

function isValidPrompt(value: unknown): value is SavedPrompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && !!item.id && item.id.length <= 256 &&
    validOwner(item.ownerId) &&
    typeof item.title === 'string' && !!item.title.trim() && item.title.length <= 1_000 &&
    typeof item.content === 'string' && !!item.content.trim() && item.content.length <= 1_000_000 &&
    typeof item.createdAt === 'number' && Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 &&
    typeof item.updatedAt === 'number' && Number.isSafeInteger(item.updatedAt) && item.updatedAt >= 0;
}

export function isPromptList(value: unknown): value is SavedPrompt[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) return false;
  const ids = new Set<string>();
  for (const prompt of value) {
    if (!isValidPrompt(prompt) || ids.has(prompt.id)) return false;
    ids.add(prompt.id);
  }
  return true;
}

function readPersistedPrompts(value: unknown): { prompts: SavedPrompt[]; hadUnowned: boolean } {
  if (value === undefined) return { prompts: [], hadUnowned: false };
  if (!Array.isArray(value) || value.length > MAX_RECORDS) {
    throw new Error('Prompt storage contains invalid data; refusing to overwrite it');
  }
  const prompts: SavedPrompt[] = [];
  const ids = new Set<string>();
  let hadUnowned = false;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Prompt storage contains invalid data; refusing to overwrite it');
    }
    const raw = item as Record<string, unknown>;
    if (!validOwner(raw.ownerId)) {
      hadUnowned = true;
      continue;
    }
    if (!isValidPrompt(item) || ids.has(item.id)) {
      throw new Error('Prompt storage contains invalid data; refusing to overwrite it');
    }
    ids.add(item.id);
    prompts.push(item);
  }
  return { prompts, hadUnowned };
}

function readUsageMap(value: unknown): Record<string, { usageCount: number; lastUsedAt: number }> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_RECORDS) {
    throw new Error('Prompt usage storage contains too many records; refusing to overwrite it');
  }
  const result: Record<string, { usageCount: number; lastUsedAt: number }> = {};
  for (const [id, entry] of entries) {
    if (!id || id.length > 256 || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
    }
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.usageCount) || (item.usageCount as number) < 0 ||
        !Number.isSafeInteger(item.lastUsedAt) || (item.lastUsedAt as number) < 0) {
      throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
    }
    result[id] = {
      usageCount: item.usageCount as number,
      lastUsedAt: item.lastUsedAt as number,
    };
  }
  return result;
}

function pruneUsage(
  usage: Record<string, { usageCount: number; lastUsedAt: number }>,
  prompts: SavedPrompt[]
): Record<string, { usageCount: number; lastUsedAt: number }> {
  const validIds = new Set(prompts.map((prompt) => prompt.id));
  return Object.fromEntries(Object.entries(usage).filter(([id]) => validIds.has(id)));
}

/** Chrome may reorder object properties when round-tripping JSON-like storage. */
function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null ||
      typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => storageValuesEqual(value, right[index]));
  }
  const oldRecord = left as Record<string, unknown>;
  const newRecord = right as Record<string, unknown>;
  const keys = Object.keys(oldRecord);
  return keys.length === Object.keys(newRecord).length &&
    keys.every((key) => Object.hasOwn(newRecord, key) &&
      storageValuesEqual(oldRecord[key], newRecord[key]));
}

export function equalPromptLists(left: SavedPrompt[], right: SavedPrompt[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.id === other.id && item.ownerId === other.ownerId &&
      item.title === other.title && item.content === other.content &&
      item.createdAt === other.createdAt && item.updatedAt === other.updatedAt;
  });
}

export function isPromptCommitRequest(value: unknown): value is PromptCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type !== PROMPT_COMMIT_TYPE) return false;
  if (item.action === 'cleanup-unowned') return true;
  if (item.action === 'clear-account') return validOwner(item.ownerId);
  return item.action === 'replace-account' && validOwner(item.ownerId) &&
    isPromptList(item.next) &&
    (item.next as SavedPrompt[]).every((prompt) => prompt.ownerId === item.ownerId);
}

async function writeAndVerify(
  storage: PromptStorage,
  keys: string[],
  original: Record<string, unknown>,
  values: Record<string, unknown>,
  label: string
): Promise<PromptCommitResponse> {
  try {
    await storage.set(values);
    const actual = await storage.get(keys);
    for (const key of Object.keys(values)) {
      if (!storageValuesEqual(values[key], actual[key])) {
        throw new Error(label + ' storage verification failed');
      }
    }
    return { ok: true };
  } catch (failure) {
    try {
      const previous: Record<string, unknown> = {};
      for (const key of keys) {
        if (Object.hasOwn(original, key)) previous[key] = original[key];
      }
      if (Object.keys(previous).length) await storage.set(previous);
      const absent = keys.filter((key) => !Object.hasOwn(original, key));
      if (absent.length) {
        if (!storage.remove) throw new Error('Storage cannot remove absent keys');
        await storage.remove(absent);
      }
      const restored = await storage.get(keys);
      if (keys.some((key) => !storageValuesEqual(restored[key], original[key]))) {
        throw new Error('Rollback verification failed');
      }
    } catch {
      return { ok: false, error: label + '失败，自动回滚也失败：' +
        (failure instanceof Error ? failure.message : '存储异常') + '；请保留备份并停止覆盖本地数据。' };
    }
    return {
      ok: false,
      error: label + '失败，原数据已恢复：' +
        (failure instanceof Error ? failure.message : '存储异常'),
    };
  }
}

/**
 * All prompt writes run in the shared background queue. Account replacement
 * merges only the active account's list and preserves every other account.
 */
export function createPromptWriteCoordinator(
  storage: PromptStorage = chrome.storage.local,
  queue: SerialWriteQueue = createSerialWriteQueue()
): { commit(request: unknown): Promise<PromptCommitResponse> } {
  return {
    commit(request: unknown): Promise<PromptCommitResponse> {
      return queue.run(async (): Promise<PromptCommitResponse> => {
        if (!isPromptCommitRequest(request)) {
          return { ok: false, error: 'Invalid prompt update request' };
        }
        try {
          const keys = [PROMPT_STORAGE_KEY, USAGE_STORAGE_KEY];
          const result = await storage.get(keys);
          const persisted = readPersistedPrompts(result[PROMPT_STORAGE_KEY]);
          const usage = readUsageMap(result[USAGE_STORAGE_KEY]);
          const current = persisted.prompts;
          const cleanedUsage = pruneUsage(usage, current);

          if (request.action === 'cleanup-unowned') {
            const values: Record<string, unknown> = {};
            if (persisted.hadUnowned) values[PROMPT_STORAGE_KEY] = current;
            if (Object.hasOwn(result, USAGE_STORAGE_KEY) &&
                !storageValuesEqual(result[USAGE_STORAGE_KEY], cleanedUsage)) {
              values[USAGE_STORAGE_KEY] = cleanedUsage;
            }
            if (Object.keys(values).length) {
              await storage.set(values);
              const actual = await storage.get(keys);
              for (const key of Object.keys(values)) {
                if (!storageValuesEqual(values[key], actual[key])) {
                  return { ok: false, error: '清理未绑定账号的数据后核验失败。' };
                }
              }
            }
            return { ok: true };
          }

          const ownerId = request.ownerId;
          const otherAccounts = current.filter((prompt) => prompt.ownerId !== ownerId);
          const currentAccountIds = new Set(otherAccounts.map((prompt) => prompt.id));
          const nextOwned = request.action === 'replace-account' ? request.next : [];
          if (nextOwned.some((prompt) => currentAccountIds.has(prompt.id))) {
            return { ok: false, error: '提示词 ID 与其他账号的数据冲突，未保存。' };
          }
          const nextPrompts = request.action === 'clear-account'
            ? otherAccounts
            : [...otherAccounts, ...nextOwned];
          if (!isPromptList(nextPrompts)) {
            return { ok: false, error: 'Invalid prompt update request' };
          }
          const nextUsage = pruneUsage(cleanedUsage, nextPrompts);
          const values: Record<string, unknown> = {};
          const shouldWritePrompts = Object.hasOwn(result, PROMPT_STORAGE_KEY) ||
            persisted.hadUnowned || nextPrompts.length > 0;
          if (shouldWritePrompts &&
              !storageValuesEqual(result[PROMPT_STORAGE_KEY], nextPrompts)) {
            values[PROMPT_STORAGE_KEY] = nextPrompts;
          }
          if (Object.hasOwn(result, USAGE_STORAGE_KEY) &&
              !storageValuesEqual(result[USAGE_STORAGE_KEY], nextUsage)) {
            values[USAGE_STORAGE_KEY] = nextUsage;
          }
          if (!Object.keys(values).length) return { ok: true };
          return writeAndVerify(storage, Object.keys(values), result, values,
            request.action === 'clear-account' ? '清空提示词' : '保存提示词');
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Prompt storage write failed',
          };
        }
      });
    },
  };
}
