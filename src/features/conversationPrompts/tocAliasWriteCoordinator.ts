/** Validates and persists account-bound TOC alias updates in the MV3 worker. */
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';
import { createSerialWriteQueue, type SerialWriteQueue } from '@/features/storage/serialWriteQueue';

export const TOC_ALIAS_PREFIX = 'chatToc:aliases:v1:';
export const TOC_ALIAS_DELETED_PREFIX = 'chatToc:aliases:deleted:v1:';
export const TOC_ALIAS_COMMIT_TYPE = 'LUNA_TOC_ALIAS_COMMIT_V1';

export interface TocAliasRecord {
  ownerId: string;
  aliases: Record<string, string>;
}
export type TocAliasCommitRequest =
  | {
    type: typeof TOC_ALIAS_COMMIT_TYPE;
    action: 'update';
    routeKey: string;
    messageId: string;
    label: string | null;
    ownerId: string;
  }
  | { type: typeof TOC_ALIAS_COMMIT_TYPE; action: 'delete-conversation'; routeKey: string; ownerId: string }
  | { type: typeof TOC_ALIAS_COMMIT_TYPE; action: 'cleanup-conversation'; routeKey: string; expected: TocAliasRecord }
  | { type: typeof TOC_ALIAS_COMMIT_TYPE; action: 'cleanup-unowned' };

export type TocAliasCommitResponse =
  | { ok: true; record: TocAliasRecord | null }
  | { ok: true; deleted: true }
  | { ok: true; cleaned: number }
  | { ok: false; conflict: true }
  | { ok: false; error: string };

type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

export const isValidTocMessageId = (value: unknown): value is string =>
  typeof value === 'string' && !!value && value.length <= 256 &&
  value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
const validLabel = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && !!value.trim() && value.length <= 240);
const validOwner = (value: unknown): value is string =>
  typeof value === 'string' && !!value && value.length <= 256;

function isUnownedRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return !validOwner(record.ownerId);
}

export function isTocAliasCommitRequest(value: unknown): value is TocAliasCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type !== TOC_ALIAS_COMMIT_TYPE) return false;
  if (input.action === 'cleanup-unowned') return true;
  if (!isPermanentConversationId(input.routeKey)) return false;
  if (input.action === 'delete-conversation') return validOwner(input.ownerId);
  if (input.action === 'cleanup-conversation') {
    try { return parseTocAliasRecord(input.expected) !== null; }
    catch { return false; }
  }
  return input.action === 'update' && isValidTocMessageId(input.messageId) &&
    validLabel(input.label) && validOwner(input.ownerId);
}

/** Reject malformed records and all records without a verified account owner. */
export function parseTocAliasRecord(value: unknown): TocAliasRecord | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid saved TOC aliases');
  }
  const raw = value as Record<string, unknown>;
  if (!validOwner(raw.ownerId) || !raw.aliases ||
      typeof raw.aliases !== 'object' || Array.isArray(raw.aliases)) {
    throw new Error('Invalid saved TOC aliases');
  }
  const entries = Object.entries(raw.aliases as Record<string, unknown>);
  if (entries.length > 20_000 ||
      entries.some(([id, label]) => !isValidTocMessageId(id) || !validLabel(label) || label === null)) {
    throw new Error('Invalid saved TOC aliases');
  }
  return { ownerId: raw.ownerId, aliases: Object.fromEntries(entries) as Record<string, string> };
}

function sameRecord(a: TocAliasRecord, b: TocAliasRecord): boolean {
  const keys = Object.keys(a.aliases);
  return a.ownerId === b.ownerId &&
    keys.length === Object.keys(b.aliases).length &&
    keys.every((key) => Object.hasOwn(b.aliases, key) && a.aliases[key] === b.aliases[key]);
}

/** Background writes are serialized with prompts, settings, usage and backup restore. */
export function createTocAliasWriteCoordinator(
  storage: Storage = chrome.storage.local,
  queue: SerialWriteQueue = createSerialWriteQueue()
) {
  return {
    commit(request: unknown): Promise<TocAliasCommitResponse> {
      return queue.run(async (): Promise<TocAliasCommitResponse> => {
        if (!isTocAliasCommitRequest(request)) {
          return { ok: false, error: 'Invalid TOC alias request' };
        }
        try {
          if (request.action === 'cleanup-unowned') {
            const all = await storage.get(null) as Record<string, unknown>;
            const staleKeys = Object.entries(all)
              .filter(([key, value]) => key.startsWith(TOC_ALIAS_PREFIX) && isUnownedRecord(value))
              .map(([key]) => key);
            if (staleKeys.length) await storage.remove(staleKeys);
            return { ok: true, cleaned: staleKeys.length };
          }

          const key = TOC_ALIAS_PREFIX + request.routeKey;
          const deletionKey = TOC_ALIAS_DELETED_PREFIX + request.routeKey;
          const state = await storage.get([key, deletionKey]);
          if (request.action === 'delete-conversation' ||
              request.action === 'cleanup-conversation') {
            if (request.action === 'cleanup-conversation') {
              // Do not delete a newer edit, restored record, or another account's data.
              if (Object.hasOwn(state, deletionKey)) return { ok: false, conflict: true };
              const current = parseTocAliasRecord(state[key]);
              if (!current || !sameRecord(current, request.expected)) {
                return { ok: false, conflict: true };
              }
            } else {
              const current = parseTocAliasRecord(state[key]);
              if (current && current.ownerId !== request.ownerId) {
                return { ok: false, error: 'Conversation belongs to another account' };
              }
            }
            if (!Object.hasOwn(state, deletionKey)) await storage.set({ [deletionKey]: true });
            await storage.remove(key);
            return { ok: true, deleted: true };
          }
          if (Object.hasOwn(state, deletionKey)) {
            return { ok: false, error: 'Conversation has been deleted' };
          }
          const previous = parseTocAliasRecord(state[key]);
          if (previous && previous.ownerId !== request.ownerId) {
            return { ok: false, error: 'Conversation belongs to another account' };
          }
          const oldLabel = previous?.aliases[request.messageId] ?? null;
          const aliases: Record<string, string> = Object.assign(Object.create(null), previous?.aliases);
          if (request.label === null) delete aliases[request.messageId];
          else aliases[request.messageId] = request.label;
          if (Object.keys(aliases).length === 0) {
            if (previous) await storage.remove(key);
            return { ok: true, record: null };
          }
          const record = { ownerId: request.ownerId, aliases };
          if (oldLabel !== request.label || record.ownerId !== previous?.ownerId) {
            await storage.set({ [key]: record });
          }
          return { ok: true, record };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'TOC alias storage failed' };
        }
      });
    },
  };
}
