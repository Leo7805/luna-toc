/** Serializes My Prompts commits in the Manifest V3 background service worker. */
import type { SavedPrompt } from './promptStore';
import { createSerialWriteQueue, type SerialWriteQueue } from '@/features/storage/serialWriteQueue';

export const PROMPT_STORAGE_KEY = 'lumaToc:myPromptsV1'; // Never rename: existing users depend on it.
export const PROMPT_COMMIT_TYPE = 'LUNA_TOC_PROMPTS_COMMIT_V1';
const MAX_RECORDS = 20_000;

export type PromptCommitRequest =
  | { type: typeof PROMPT_COMMIT_TYPE; expected: SavedPrompt[]; next: SavedPrompt[]; action?: undefined }
  | { type: typeof PROMPT_COMMIT_TYPE; action: 'clear-all'; expected: SavedPrompt[] };
export type PromptCommitResponse =
  | { ok: true }
  | { ok: false; conflict: true }
  | { ok: false; error: string };

type PromptStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'> & Partial<Pick<chrome.storage.StorageArea, 'remove'>>;
const USAGE_STORAGE_KEY = 'lunaToc:promptUsageV1';

function isValidPrompt(value: unknown): value is SavedPrompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && !!item.id && item.id.length <= 256 &&
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

/** Compares persisted values, not object identities or tab-local cache ages. */
export function equalPromptLists(left: SavedPrompt[], right: SavedPrompt[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.id === other.id && item.title === other.title &&
      item.content === other.content && item.createdAt === other.createdAt &&
      item.updatedAt === other.updatedAt;
  });
}

export function isPromptCommitRequest(value: unknown): value is PromptCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type !== PROMPT_COMMIT_TYPE || !isPromptList(item.expected)) return false;
  if (item.action === 'clear-all') return !Object.hasOwn(item, 'next');
  return item.action === undefined && isPromptList(item.next);
}

/**
 * All extension-owned writes share the injected background queue. A read/check/write
 * stays in one queued job so backup restoration cannot interleave with prompt commits.
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
          const isClear = request.action === 'clear-all';
          const keys = [PROMPT_STORAGE_KEY, USAGE_STORAGE_KEY];
          const result = await storage.get(isClear ? keys : PROMPT_STORAGE_KEY);
          const persisted: unknown = result[PROMPT_STORAGE_KEY];
          // Never wipe unreadable legacy data during a stale-tab commit.
          if (persisted !== undefined && !isPromptList(persisted)) {
            return { ok: false, error: 'Prompt storage contains invalid data; refusing to overwrite' };
          }
          const current = persisted === undefined ? [] : persisted as SavedPrompt[];
          if (!equalPromptLists(current, request.expected)) {
            return { ok: false, conflict: true };
          }
          if (isClear) {
            // Both related keys are changed in one background queue job. Chrome
            // storage is not transactional: verify and compensate on failures.
            const original = result as Record<string, unknown>;
            const hasUsage = Object.hasOwn(original, USAGE_STORAGE_KEY);
            const hasPrompts = Object.hasOwn(original, PROMPT_STORAGE_KEY);
            try {
              await storage.set({ [PROMPT_STORAGE_KEY]: [], [USAGE_STORAGE_KEY]: {} });
              const actual = await storage.get(keys);
              const usage = actual[USAGE_STORAGE_KEY];
              if (!Array.isArray(actual[PROMPT_STORAGE_KEY]) ||
                  (actual[PROMPT_STORAGE_KEY] as unknown[]).length !== 0 ||
                  !usage || typeof usage !== 'object' || Array.isArray(usage) ||
                  Object.keys(usage).length !== 0) {
                throw new Error('Clear-all storage verification failed');
              }
            } catch (failure) {
              try {
                const previous: Record<string, unknown> = {};
                if (hasPrompts) previous[PROMPT_STORAGE_KEY] = original[PROMPT_STORAGE_KEY];
                if (hasUsage) previous[USAGE_STORAGE_KEY] = original[USAGE_STORAGE_KEY];
                if (Object.keys(previous).length) await storage.set(previous);
                const absent = keys.filter((key) => !Object.hasOwn(original, key));
                if (absent.length) {
                  if (!storage.remove) throw new Error('Storage cannot remove absent keys');
                  await storage.remove(absent);
                }
                const restored = await storage.get(keys);
                if (keys.some((key) => JSON.stringify(restored[key]) !== JSON.stringify(original[key]))) {
                  throw new Error('Rollback verification failed');
                }
              } catch {
                return { ok: false, error: '清空失败，自动回滚也失败；请保留备份并停止覆盖本地数据。' };
              }
              return { ok: false, error: '清空失败，原数据已恢复：' +
                (failure instanceof Error ? failure.message : '存储异常') };
            }
            return { ok: true };
          }
          if (!equalPromptLists(current, request.next)) {
            await storage.set({ [PROMPT_STORAGE_KEY]: request.next });
          }
          return { ok: true };
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
