/** TOC alias cache with ordered local writes and account-scoped visibility. */
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';
import { getActiveConversationOwner, subscribeActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';
import {
  TOC_ALIAS_PREFIX, TOC_ALIAS_DELETED_PREFIX, TOC_ALIAS_COMMIT_TYPE,
  parseTocAliasRecord,
  type TocAliasRecord, type TocAliasCommitRequest, type TocAliasCommitResponse,
} from './tocAliasWriteCoordinator';

const empty = (): TocAliasRecord => ({ ownerId: '', aliases: {} });
const storageKey = (route: string) => TOC_ALIAS_PREFIX + route;
const tombstoneKey = (route: string) => TOC_ALIAS_DELETED_PREFIX + route;

function normalizeRecord(value: unknown): TocAliasRecord {
  try { return parseTocAliasRecord(value) ?? empty(); }
  catch { return empty(); }
}

function sendCommit(request: TocAliasCommitRequest): Promise<TocAliasCommitResponse> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    return Promise.reject(new Error('Invalid extension context: alias not saved'));
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: TocAliasCommitResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'TOC alias writer unavailable'));
      } else if (response?.ok === true || (response?.ok === false &&
        ('conflict' in response || 'error' in response))) {
        resolve(response);
      } else {
        reject(new Error('TOC alias writer did not confirm the save'));
      }
    });
  });
}

/** A store instance owns only its rendering cache, never an independent writer. */
export function createTocAliasStore(onChanged: (routeKey: string) => void = () => {}) {
  const loaded = new Map<string, TocAliasRecord>();
  const loading = new Map<string, Promise<void>>();
  const knownRoutes = new Set<string>();
  const deleted = new Set<string>();
  const listeners = new Set<(routeKey: string) => void>();
  const changesSeen = new Map<string, number>();
  let writeQueue: Promise<void> = Promise.resolve();

  const notify = (routeKey: string): void => {
    onChanged(routeKey);
    listeners.forEach((listener) => listener(routeKey));
  };
  const markEvent = (routeKey: string): void => {
    changesSeen.set(routeKey, (changesSeen.get(routeKey) ?? 0) + 1);
  };

  /** The deletion fence is read together with data on every cache miss. */
  async function read(routeKey: string): Promise<void> {
    const ownerId = getActiveConversationOwner();
    if (!ownerId) {
      loaded.delete(routeKey);
      deleted.delete(routeKey);
      notify(routeKey);
      return;
    }
    const seen = changesSeen.get(routeKey) ?? 0;
    const values = await chrome.storage.local.get([storageKey(routeKey), tombstoneKey(routeKey)]);
    // A storage event or account switch that arrived while reading has newer cache state.
    if ((changesSeen.get(routeKey) ?? 0) !== seen || getActiveConversationOwner() !== ownerId) return;
    if (Object.hasOwn(values, tombstoneKey(routeKey))) {
      deleted.add(routeKey);
      loaded.delete(routeKey);
    } else {
      deleted.delete(routeKey);
      const record = normalizeRecord(values[storageKey(routeKey)]);
      loaded.set(routeKey, record.ownerId === ownerId ? record : empty());
    }
    notify(routeKey);
  }

  async function load(routeKey: string): Promise<void> {
    if (!isPermanentConversationId(routeKey)) return;
    knownRoutes.add(routeKey);
    if (!getActiveConversationOwner() || loaded.has(routeKey) || deleted.has(routeKey)) return;
    const pending = loading.get(routeKey);
    if (pending) return pending;
    const job = read(routeKey);
    loading.set(routeKey, job);
    try { await job; } finally {
      if (loading.get(routeKey) === job) loading.delete(routeKey);
    }
  }

  function get(routeKey: string, messageId: string): string | null {
    if (deleted.has(routeKey)) return null;
    const record = loaded.get(routeKey);
    const trustedOwner = getActiveConversationOwner();
    // A record is visible only to its verified owner.
    if (!trustedOwner || !record?.ownerId || record.ownerId !== trustedOwner) return null;
    return record.aliases[messageId] ?? null;
  }

  /** Saves a label without cross-tab version comparisons. */
  function update(
    routeKey: string, messageId: string, text: string | null,
    ownerId: string | null
  ): Promise<void> {
    if (!isPermanentConversationId(routeKey) || !messageId) {
      return Promise.reject(new Error('Conversation must have a permanent ID'));
    }
    const label = text?.trim() || null;
    if (label && label.length > 240) return Promise.reject(new Error('Title exceeds 240 characters'));
    if (deleted.has(routeKey)) return Promise.reject(new Error('Conversation has been deleted'));
    if (!ownerId || ownerId !== getActiveConversationOwner()) {
      return Promise.reject(new Error('ChatGPT account not verified; title not saved'));
    }
    const job = writeQueue.catch(() => undefined).then(async () => {
      if (deleted.has(routeKey)) throw new Error('Conversation has been deleted');
      if (ownerId !== getActiveConversationOwner()) throw new Error('ChatGPT account changed; title not saved');
      await load(routeKey);
      if (deleted.has(routeKey)) throw new Error('Conversation has been deleted');
      if (ownerId !== getActiveConversationOwner()) throw new Error('ChatGPT account changed; title not saved');
      const currentRecord = loaded.get(routeKey);
      const existingOwner = currentRecord?.ownerId;
      if (existingOwner && existingOwner !== ownerId) {
        throw new Error('Conversation alias belongs to another account');
      }
      const beforeEvents = changesSeen.get(routeKey) ?? 0;
      const response = await sendCommit({
        type: TOC_ALIAS_COMMIT_TYPE, action: 'update',
        routeKey, messageId, label, ownerId,
      });
      if (!response.ok) {
        const failure = 'error' in response ? response.error : 'Alias save was not accepted';
        if (failure === 'Conversation has been deleted') {
          deleted.add(routeKey);
          loaded.delete(routeKey);
          notify(routeKey);
        }
        throw new Error(failure);
      }
      if (!('record' in response)) throw new Error('Unexpected TOC alias response');
      if (!deleted.has(routeKey) && (changesSeen.get(routeKey) ?? 0) === beforeEvents) {
        loaded.set(routeKey, response.record ?? empty());
        notify(routeKey);
      }
    });
    writeQueue = job.catch(() => undefined);
    return job;
  }

  /** A deletion is fenced in persistent storage before aliases are removed. */
  function removeConversation(routeKey: string): Promise<void> {
    if (!isPermanentConversationId(routeKey)) return Promise.resolve();
    const ownerId = getActiveConversationOwner();
    if (!ownerId) return Promise.reject(new Error('ChatGPT account not verified; conversation aliases were not deleted'));
    deleted.add(routeKey);
    loaded.delete(routeKey);
    notify(routeKey);
    const job = writeQueue.catch(() => undefined).then(async () => {
      try {
        if (ownerId !== getActiveConversationOwner()) {
          throw new Error('ChatGPT account changed; conversation aliases were not deleted');
        }
        const response = await sendCommit({
          type: TOC_ALIAS_COMMIT_TYPE, action: 'delete-conversation', routeKey, ownerId,
        });
        if (!response.ok) throw new Error('error' in response ? response.error : 'Deletion conflict');
      } catch (error) {
        // An unacknowledged write may have installed the tombstone already.
        try {
          const result = await chrome.storage.local.get(tombstoneKey(routeKey));
          if (!Object.hasOwn(result, tombstoneKey(routeKey))) {
            deleted.delete(routeKey);
            loaded.delete(routeKey);
            await load(routeKey);
          }
        } catch { /* Keep the conservative deletion fence until next storage event. */ }
        throw error;
      }
      loaded.delete(routeKey);
      notify(routeKey);
    });
    writeQueue = job.catch(() => undefined);
    return job;
  }

  /** Never include conversations with an explicit successful deletion fence. */
  async function references(): Promise<string[]> {
    const ownerId = getActiveConversationOwner();
    if (!ownerId) return [];
    const values = await chrome.storage.local.get(null) as Record<string, unknown>;
    return Object.entries(values)
      .filter(([key, value]) => key.startsWith(TOC_ALIAS_PREFIX) &&
        normalizeRecord(value).ownerId === ownerId)
      .map(([key]) => key.slice(TOC_ALIAS_PREFIX.length))
      .filter((route) => isPermanentConversationId(route) &&
        !deleted.has(route) && !Object.hasOwn(values, tombstoneKey(route)));
  }

  async function owner(routeKey: string): Promise<string | null> {
    await load(routeKey);
    return deleted.has(routeKey) ? null : loaded.get(routeKey)?.ownerId || null;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      // Process deletion fences before alias writes from the same event.
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(TOC_ALIAS_DELETED_PREFIX)) continue;
        const route = key.slice(TOC_ALIAS_DELETED_PREFIX.length);
        markEvent(route);
        if (change.newValue !== undefined) {
          deleted.add(route);
          loaded.delete(route);
          notify(route);
        } else {
          deleted.delete(route);
          loaded.delete(route);
          void load(route).catch(() => undefined);
        }
      }
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(TOC_ALIAS_PREFIX)) continue;
        const route = key.slice(TOC_ALIAS_PREFIX.length);
        markEvent(route);
        if (deleted.has(route)) continue;
        const ownerId = getActiveConversationOwner();
        if (!ownerId) { notify(route); continue; }
        if (change.newValue === undefined) {
          if (loaded.get(route)?.ownerId === ownerId) loaded.delete(route);
          void load(route).catch(() => undefined);
          notify(route);
          continue;
        }
        const record = normalizeRecord(change.newValue);
        if (record.ownerId !== ownerId) continue;
        loaded.set(route, record);
        notify(route);
      }
    });
  }

  // Clear stale cache entries on account changes, then reload the same routes for the new owner.
  subscribeActiveConversationOwner(() => {
    const routes = [...new Set([...knownRoutes, ...loaded.keys(), ...loading.keys(), ...deleted])];
    loaded.clear();
    deleted.clear();
    loading.clear();
    changesSeen.clear();
    routes.forEach((routeKey) => {
      notify(routeKey);
      void load(routeKey).catch(() => undefined);
    });
  });

  // Unowned legacy aliases are explicitly unsupported and removed by the serialized writer.
  void sendCommit({ type: TOC_ALIAS_COMMIT_TYPE, action: 'cleanup-unowned' }).catch(() => undefined);

  return {
    load, get, update, removeConversation, references, owner,
    subscribe(fn: (routeKey: string) => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const tocAliasStore = createTocAliasStore();
