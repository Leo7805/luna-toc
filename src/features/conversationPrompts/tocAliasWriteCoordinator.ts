/** Coordinates TOC alias writes across content-script tabs in the MV3 worker. */
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';
import { createSerialWriteQueue, type SerialWriteQueue } from '@/features/storage/serialWriteQueue';

export const TOC_ALIAS_PREFIX = 'chatToc:aliases:v1:';
export const TOC_ALIAS_DELETED_PREFIX = 'chatToc:aliases:deleted:v1:';
export const TOC_ALIAS_COMMIT_TYPE = 'LUNA_TOC_ALIAS_COMMIT_V1';

export interface TocAliasRecord {
  ownerId: string | null;
  aliases: Record<string, string>;
}
export type TocAliasCommitRequest =
  | {
    type: typeof TOC_ALIAS_COMMIT_TYPE;
    action: 'update';
    routeKey: string;
    messageId: string;
    expected: string | null;
    label: string | null;
    ownerId: string | null;
  }
  | { type: typeof TOC_ALIAS_COMMIT_TYPE; action: 'delete-conversation'; routeKey: string };

export type TocAliasCommitResponse =
  | { ok: true; record: TocAliasRecord | null }
  | { ok: true; deleted: true }
  | { ok: false; conflict: true }
  | { ok: false; error: string };

type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

const validId = (value: unknown): value is string =>
  typeof value === 'string' && !!value && value.length <= 256 &&
  value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
const validLabel = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && !!value.trim() && value.length <= 240);
const validOwner = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && !!value && value.length <= 256);

export function isTocAliasCommitRequest(value: unknown): value is TocAliasCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  if (input.type !== TOC_ALIAS_COMMIT_TYPE || !isPermanentConversationId(input.routeKey)) return false;
  if (input.action === 'delete-conversation') return true;
  return input.action === 'update' && validId(input.messageId) &&
    validLabel(input.expected) && validLabel(input.label) && validOwner(input.ownerId);
}

/** Reject malformed saved records instead of overwriting data we cannot interpret. */
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
      entries.some(([id, label]) => !validId(id) || !validLabel(label) || label === null)) {
    throw new Error('Invalid saved TOC aliases');
  }
  return { ownerId: raw.ownerId, aliases: Object.fromEntries(entries) as Record<string, string> };
}

/**
 * Each job reads Chrome storage anew, so a restarted worker has no stale cache.
 * The injected queue serializes aliases against backup restore and other owned writes.
 */
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
        const key = TOC_ALIAS_PREFIX + request.routeKey;
        const deletionKey = TOC_ALIAS_DELETED_PREFIX + request.routeKey;
        try {
          const state = await storage.get([key, deletionKey]);
          if (request.action === 'delete-conversation') {
            // The durable fence must precede removal. If removal fails,
            // stale tabs are still blocked from resurrecting the conversation.
            if (!Object.hasOwn(state, deletionKey)) await storage.set({ [deletionKey]: true });
            await storage.remove(key);
            return { ok: true, deleted: true };
          }
          if (Object.hasOwn(state, deletionKey)) {
            return { ok: false, error: 'Conversation has been deleted' };
          }
          const previous = parseTocAliasRecord(state[key]);
          if (previous?.ownerId && request.ownerId && previous.ownerId !== request.ownerId) {
            return { ok: false, error: 'Conversation belongs to another account' };
          }
          const oldLabel = previous?.aliases[request.messageId] ?? null;
          if (oldLabel !== request.expected) return { ok: false, conflict: true };
          const aliases: Record<string, string> = Object.assign(Object.create(null), previous?.aliases);
          if (request.label === null) delete aliases[request.messageId];
          else aliases[request.messageId] = request.label;
          if (Object.keys(aliases).length === 0) {
            if (previous) await storage.remove(key);
            return { ok: true, record: null };
          }
          const record = { ownerId: request.ownerId ?? previous?.ownerId ?? null, aliases };
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
