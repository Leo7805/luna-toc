/** Validates prompt usage changes against persisted prompts before saving. */
import { createSerialWriteQueue, type SerialWriteQueue } from '@/features/storage/serialWriteQueue';
import { isPromptList, PROMPT_STORAGE_KEY } from './promptWriteCoordinator';
import type { PromptUsage, PromptUsageMap } from './promptUsageStore';

export const PROMPT_USAGE_COMMIT_TYPE = 'LUNA_TOC_PROMPT_USAGE_COMMIT_V1';
const STORAGE_KEY = 'lunaToc:promptUsageV1';
const MAX_RECORDS = 20_000;

export type PromptUsageCommitAction =
  | { action: 'record-use'; promptId: string }
  | { action: 'remove'; promptId: string }
  | { action: 'clear' }
  | { action: 'reconcile'; validPromptIds: string[] };
export type PromptUsageCommitRequest = PromptUsageCommitAction & { type: typeof PROMPT_USAGE_COMMIT_TYPE };
export type PromptUsageCommitResponse =
  | { ok: true; usage: PromptUsageMap }
  | { ok: false; error: string };
type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

function validId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 256;
}
function parseUsageMap(value: unknown): PromptUsageMap {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_RECORDS) throw new Error('Prompt usage storage contains too many records; refusing to overwrite it');
  const parsed: Array<[string, PromptUsage]> = [];
  for (const [id, item] of entries) {
    if (!validId(id) || !item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
    }
    const raw = item as Record<string, unknown>;
    if (!Number.isSafeInteger(raw.usageCount) || (raw.usageCount as number) < 0 ||
        !Number.isSafeInteger(raw.lastUsedAt) || (raw.lastUsedAt as number) < 0) {
      throw new Error('Prompt usage storage contains invalid data; refusing to overwrite it');
    }
    parsed.push([id, { usageCount: raw.usageCount as number, lastUsedAt: raw.lastUsedAt as number }]);
  }
  return Object.fromEntries(parsed);
}
function isRequest(value: unknown): value is PromptUsageCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type !== PROMPT_USAGE_COMMIT_TYPE) return false;
  if (input.action === 'clear') return true;
  if (input.action === 'record-use' || input.action === 'remove') return validId(input.promptId);
  if (input.action !== 'reconcile' || !Array.isArray(input.validPromptIds) ||
      input.validPromptIds.length > MAX_RECORDS) return false;
  return input.validPromptIds.every(validId) &&
    new Set(input.validPromptIds).size === input.validPromptIds.length;
}
function sameMap(left: PromptUsageMap, right: PromptUsageMap): boolean {
  const a = Object.keys(left).sort(), b = Object.keys(right).sort();
  return a.length === b.length && a.every((id, i) => id === b[i] &&
    left[id].usageCount === right[b[i]].usageCount && left[id].lastUsedAt === right[b[i]].lastUsedAt);
}
export function createPromptUsageWriteCoordinator(
  storage: Storage = chrome.storage.local,
  queue: SerialWriteQueue = createSerialWriteQueue()
): { commit(request: unknown): Promise<PromptUsageCommitResponse> } {
  return { commit(request: unknown): Promise<PromptUsageCommitResponse> {
    return queue.run(async (): Promise<PromptUsageCommitResponse> => {
      if (!isRequest(request)) return { ok: false, error: 'Invalid prompt usage request' };
      try {
        const result = await storage.get([STORAGE_KEY, PROMPT_STORAGE_KEY]);
        const current = parseUsageMap(result[STORAGE_KEY]);
        const next: PromptUsageMap = { ...current };
        switch (request.action) {
          case 'record-use': {
            const persistedPrompts: unknown = result[PROMPT_STORAGE_KEY];
            if (!isPromptList(persistedPrompts) ||
                !persistedPrompts.some((prompt) => prompt.id === request.promptId)) {
              return { ok: false, error: 'Prompt no longer exists; usage not recorded' };
            }
            const previous = current[request.promptId];
            if (previous && previous.usageCount >= Number.MAX_SAFE_INTEGER) {
              return { ok: false, error: 'Prompt usage count reached its supported limit' };
            }
            next[request.promptId] = { usageCount: (previous?.usageCount ?? 0) + 1, lastUsedAt: Date.now() };
            break;
          }
          case 'remove': delete next[request.promptId]; break;
          case 'clear': for (const id of Object.keys(next)) delete next[id]; break;
          case 'reconcile': {
            // Use the latest persisted prompt list, not a potentially stale tab-local snapshot.
            const persistedPrompts: unknown = result[PROMPT_STORAGE_KEY];
            if (persistedPrompts !== undefined && !isPromptList(persistedPrompts)) {
              throw new Error('Prompt storage contains invalid data; refusing to reconcile usage');
            }
            const valid = new Set((persistedPrompts === undefined ? [] : persistedPrompts).map((prompt) => prompt.id));
            for (const id of Object.keys(next)) if (!valid.has(id)) delete next[id];
            break;
          }
        }
        if (!sameMap(current, next)) await storage.set({ [STORAGE_KEY]: next });
        return { ok: true, usage: next };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Prompt usage storage write failed' };
      }
    });
  } };
}
