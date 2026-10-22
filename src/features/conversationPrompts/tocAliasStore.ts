/**
 * Persists user-defined TOC display labels independently of ChatGPT messages.
 * Entries are scoped by permanent conversation ID and optional ChatGPT account.
 */
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';

const PREFIX = 'chatToc:aliases:v1:';
interface AliasRecord {
  ownerId: string | null;
  aliases: Record<string, string>;
}

/** Creates a tab-local alias cache backed by Chrome extension storage. */
export function createTocAliasStore(onChanged: (routeKey: string) => void = () => {}) {
  const loaded = new Map<string, AliasRecord>();
  const loading = new Map<string, Promise<void>>();
  const deleted = new Set<string>();
  const listeners = new Set<(routeKey: string) => void>();
  const notify = (routeKey: string): void => { onChanged(routeKey); listeners.forEach((fn) => fn(routeKey)); };
  let writeQueue = Promise.resolve();

  const storageKey = (routeKey: string): string => PREFIX + routeKey;

  /** Loads saved labels for a conversation, guarding against concurrent writes. */
  async function load(routeKey: string): Promise<void> {
    if (!isPermanentConversationId(routeKey) || loaded.has(routeKey) || deleted.has(routeKey)) return;
    const existing = loading.get(routeKey);
    if (existing) return existing;
    const pending = (async () => {
      const data = await chrome.storage.local.get(storageKey(routeKey));
      if (!loaded.has(routeKey) && !deleted.has(routeKey)) {
        loaded.set(routeKey, normalizeRecord(data[storageKey(routeKey)]));
        notify(routeKey);
      }
    })();
    loading.set(routeKey, pending);
    try { await pending; } finally { loading.delete(routeKey); }
  }

  /** Returns the override for a message without changing its original text. */
  function get(routeKey: string, messageId: string): string | null {
    return deleted.has(routeKey) ? null : loaded.get(routeKey)?.aliases[messageId] ?? null;
  }

  /** Writes or restores one alias with serialized updates and failure rollback. */
  function update(routeKey: string, messageId: string, text: string | null, ownerId: string | null): Promise<void> {
    if (!isPermanentConversationId(routeKey) || !messageId) {
      return Promise.reject(new Error('Conversation must have a permanent ID'));
    }
    const label = text?.trim() || null;
    if (label && label.length > 240) return Promise.reject(new Error('Title exceeds 240 characters'));
    if (deleted.has(routeKey)) return Promise.reject(new Error('Conversation has been deleted'));
    const job = writeQueue.catch(() => undefined).then(async () => {
      if (deleted.has(routeKey)) throw new Error('Conversation has been deleted');
      await load(routeKey);
      if (deleted.has(routeKey)) throw new Error('Conversation has been deleted');
      const previous = loaded.get(routeKey)!;
      const aliases = { ...previous.aliases };
      if (label) aliases[messageId] = label;
      else delete aliases[messageId];
      const next = { ownerId: ownerId ?? previous.ownerId, aliases };
      loaded.set(routeKey, next);
      notify(routeKey);
      try {
        if (Object.keys(aliases).length) {
          await chrome.storage.local.set({ [storageKey(routeKey)]: next });
        } else {
          await chrome.storage.local.remove(storageKey(routeKey));
        }
      } catch (error) {
        if (!deleted.has(routeKey)) {
          loaded.set(routeKey, previous);
          notify(routeKey);
        }
        throw error;
      }
    });
    writeQueue = job.catch(() => undefined);
    return job;
  }

  /** Tombstones and removes a deleted conversation after any pending writes. */
  function removeConversation(routeKey: string): Promise<void> {
    if (!isPermanentConversationId(routeKey)) return Promise.resolve();
    // Reject newly queued updates immediately, then remove after previous writes.
    deleted.add(routeKey);
    loaded.delete(routeKey);
    notify(routeKey);
    const job = writeQueue.catch(() => undefined).then(async () => {
      await chrome.storage.local.remove(storageKey(routeKey));
      loaded.delete(routeKey);
      notify(routeKey);
    });
    writeQueue = job.catch(() => undefined);
    return job;
  }

  /** Finds local conversation references for the one-time startup validator. */
  async function references(): Promise<string[]> {
    const values = await chrome.storage.local.get(null);
    return Object.keys(values)
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => key.slice(PREFIX.length))
      .filter((routeKey) => isPermanentConversationId(routeKey) && !deleted.has(routeKey));
  }

  /** Returns the persisted owner binding, if one exists. */
  async function owner(routeKey: string): Promise<string | null> {
    if (!loaded.has(routeKey)) await load(routeKey);
    return deleted.has(routeKey) ? null : loaded.get(routeKey)?.ownerId ?? null;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        const routeKey = key.slice(PREFIX.length);
        if (deleted.has(routeKey)) continue;
        loaded.set(routeKey, normalizeRecord(change.newValue));
        notify(routeKey);
      }
    });
  }

  return {
    load, get, update, removeConversation, references, owner,
    subscribe(fn: (routeKey: string) => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/** Validates persisted shape before rendering externally sourced storage data. */
function normalizeRecord(value: unknown): AliasRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ownerId: null, aliases: {} };
  }
  const raw = value as Record<string, unknown>;
  const aliases = raw.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases)
    ? Object.fromEntries(Object.entries(raw.aliases).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !!entry[1].trim() && entry[1].length <= 240
    ))
    : {};
  return { ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : null, aliases };
}

/** Shared storage cache for navigation and page lifecycle observers. */
export const tocAliasStore = createTocAliasStore();
