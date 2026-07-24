/**
 * Stores transient and confirmed scroll anchors for virtual-list navigation.
 */
import { APP_CONFIG } from '@/config/config';

const CACHE_VERSION = 2;
const DEFAULT_STORAGE_KEY = 'chatToc:navigationAnchors';

export interface NavigationAnchorInput {
  conversationKey: string;
  promptId: string;
  promptIndex: number;
  scrollTop: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface NavigationAnchor extends NavigationAnchorInput {
  scrollProgress: number;
  updatedAt: number;
}

export interface ConfirmedAnchorQuery {
  conversationKey: string;
  promptId: string;
  promptIndex: number;
  viewportWidth: number;
}

export interface NavigationAnchorStorage {
  read(): Promise<unknown>;
  write(value: PersistentNavigationAnchorCache): Promise<void>;
}

export interface NavigationAnchorStoreOptions {
  storage?: NavigationAnchorStorage;
  now?: () => number;
  maxConversations?: number;
  maxAnchorsPerConversation?: number;
  maxAgeMs?: number;
  viewportWidthTolerance?: number;
}

export interface NavigationAnchorStore {
  recordObservation(input: NavigationAnchorInput): NavigationAnchor;
  getObservedAnchors(conversationKey: string): NavigationAnchor[];
  recordConfirmed(input: NavigationAnchorInput): Promise<NavigationAnchor>;
  findConfirmed(query: ConfirmedAnchorQuery): Promise<NavigationAnchor | null>;
  getConfirmedAnchors(conversationKey: string): Promise<NavigationAnchor[]>;
}

interface PersistentConversationAnchors {
  lastUsedAt: number;
  anchors: NavigationAnchor[];
}

export interface PersistentNavigationAnchorCache {
  version: number;
  conversations: Record<string, PersistentConversationAnchors>;
}

/**
 * Creates a two-level anchor store: observations remain in memory, while only
 * confirmed successful jump positions are persisted.
 *
 * @example
 * const anchors = createNavigationAnchorStore();
 * anchors.recordObservation(measurement);
 * await anchors.recordConfirmed(measurement);
 */
export function createNavigationAnchorStore(
  options: NavigationAnchorStoreOptions = {}
): NavigationAnchorStore {
  const config = APP_CONFIG.navigation.anchorCache;
  const storage = options.storage || createChromeNavigationAnchorStorage();
  const now = options.now || Date.now;
  const maxConversations =
    options.maxConversations ?? config.maxConversations;
  const maxAnchorsPerConversation =
    options.maxAnchorsPerConversation ?? config.maxAnchorsPerConversation;
  const maxAgeMs = options.maxAgeMs ?? config.maxAgeMs;
  const viewportWidthTolerance =
    options.viewportWidthTolerance ?? config.viewportWidthTolerance;
  const observedByConversation = new Map<
    string,
    Map<string, NavigationAnchor>
  >();
  let persistentCachePromise: Promise<PersistentNavigationAnchorCache> | null =
    null;

  function recordObservation(
    input: NavigationAnchorInput
  ): NavigationAnchor {
    const anchor = createNavigationAnchor(input, now());
    const conversationAnchors =
      observedByConversation.get(anchor.conversationKey) ||
      new Map<string, NavigationAnchor>();

    conversationAnchors.set(anchor.promptId, anchor);
    observedByConversation.set(anchor.conversationKey, conversationAnchors);
    return cloneAnchor(anchor);
  }

  function getObservedAnchors(conversationKey: string): NavigationAnchor[] {
    return sortAnchors(
      [...(observedByConversation.get(conversationKey)?.values() || [])].map(
        cloneAnchor
      )
    );
  }

  async function recordConfirmed(
    input: NavigationAnchorInput
  ): Promise<NavigationAnchor> {
    const anchor = createNavigationAnchor(input, now());
    const cache = await getPersistentCache();
    const conversation = cache.conversations[anchor.conversationKey] || {
      lastUsedAt: anchor.updatedAt,
      anchors: [],
    };
    const nextAnchors = conversation.anchors.filter(
      ({ promptId }) => promptId !== anchor.promptId
    );

    nextAnchors.push(anchor);
    conversation.lastUsedAt = anchor.updatedAt;
    conversation.anchors = keepMostRecent(
      nextAnchors,
      maxAnchorsPerConversation
    );
    cache.conversations[anchor.conversationKey] = conversation;
    prunePersistentCache(cache, now(), {
      maxAgeMs,
      maxConversations,
    });
    await storage.write(clonePersistentCache(cache));

    return cloneAnchor(anchor);
  }

  async function findConfirmed(
    query: ConfirmedAnchorQuery
  ): Promise<NavigationAnchor | null> {
    const cache = await getPersistentCache();
    const currentTime = now();
    const conversation = cache.conversations[query.conversationKey];

    if (!conversation) return null;

    const anchor = conversation.anchors.find(
      (candidate) =>
        candidate.promptId === query.promptId &&
        candidate.promptIndex === query.promptIndex &&
        currentTime - candidate.updatedAt <= maxAgeMs &&
        Math.abs(candidate.viewportWidth - query.viewportWidth) <=
          viewportWidthTolerance
    );

    return anchor ? cloneAnchor(anchor) : null;
  }

  async function getConfirmedAnchors(
    conversationKey: string
  ): Promise<NavigationAnchor[]> {
    const cache = await getPersistentCache();
    const currentTime = now();
    const anchors = cache.conversations[conversationKey]?.anchors || [];

    return sortAnchors(
      anchors
        .filter((anchor) => currentTime - anchor.updatedAt <= maxAgeMs)
        .map(cloneAnchor)
    );
  }

  async function getPersistentCache(): Promise<PersistentNavigationAnchorCache> {
    persistentCachePromise ||= storage.read().then((value) => {
      const cache = parsePersistentCache(value);
      prunePersistentCache(cache, now(), {
        maxAgeMs,
        maxConversations,
      });
      return cache;
    });

    return persistentCachePromise;
  }

  return {
    recordObservation,
    getObservedAnchors,
    recordConfirmed,
    findConfirmed,
    getConfirmedAnchors,
  };
}

/**
 * Creates a Chrome local-storage adapter for confirmed navigation anchors.
 */
export function createChromeNavigationAnchorStorage(
  storageKey = DEFAULT_STORAGE_KEY
): NavigationAnchorStorage {
  return {
    async read() {
      const values = await chrome.storage.local.get(storageKey);
      return values[storageKey];
    },
    async write(value) {
      await chrome.storage.local.set({ [storageKey]: value });
    },
  };
}

/**
 * Normalizes one measured scroll location into a reusable anchor.
 */
export function createNavigationAnchor(
  input: NavigationAnchorInput,
  updatedAt = Date.now()
): NavigationAnchor {
  const maximumScrollTop = Math.max(
    0,
    input.scrollHeight - input.viewportHeight
  );
  const scrollTop = clamp(input.scrollTop, 0, maximumScrollTop);

  return {
    conversationKey: input.conversationKey,
    promptId: input.promptId,
    promptIndex: Math.max(0, Math.trunc(input.promptIndex)),
    scrollTop,
    scrollHeight: Math.max(0, input.scrollHeight),
    viewportWidth: Math.max(0, input.viewportWidth),
    viewportHeight: Math.max(0, input.viewportHeight),
    scrollProgress:
      maximumScrollTop > 0 ? scrollTop / maximumScrollTop : 0,
    updatedAt,
  };
}

/**
 * Accepts only the current cache schema and safe anchor-shaped records.
 */
function parsePersistentCache(value: unknown): PersistentNavigationAnchorCache {
  if (!isRecord(value) || value.version !== CACHE_VERSION) {
    return createEmptyPersistentCache();
  }

  const conversationsValue = value.conversations;
  if (!isRecord(conversationsValue)) return createEmptyPersistentCache();

  const conversations: Record<string, PersistentConversationAnchors> = {};

  Object.entries(conversationsValue).forEach(
    ([conversationKey, conversationValue]) => {
      if (!isRecord(conversationValue)) return;

      const lastUsedAt = conversationValue.lastUsedAt;
      const anchorsValue = conversationValue.anchors;
      if (typeof lastUsedAt !== 'number' || !Array.isArray(anchorsValue)) {
        return;
      }

      const anchors = anchorsValue.filter(isNavigationAnchor).map(cloneAnchor);
      if (anchors.length === 0) return;

      conversations[conversationKey] = {
        lastUsedAt,
        anchors,
      };
    }
  );

  return {
    version: CACHE_VERSION,
    conversations,
  };
}

/**
 * Removes expired conversations and applies the conversation-level LRU limit.
 */
function prunePersistentCache(
  cache: PersistentNavigationAnchorCache,
  currentTime: number,
  limits: { maxAgeMs: number; maxConversations: number }
): void {
  Object.entries(cache.conversations).forEach(
    ([conversationKey, conversation]) => {
      conversation.anchors = conversation.anchors.filter(
        ({ updatedAt }) => currentTime - updatedAt <= limits.maxAgeMs
      );

      if (conversation.anchors.length === 0) {
        delete cache.conversations[conversationKey];
      }
    }
  );

  const retainedConversations = Object.entries(cache.conversations)
    .sort(
      ([, first], [, second]) => second.lastUsedAt - first.lastUsedAt
    )
    .slice(0, Math.max(0, limits.maxConversations));

  cache.conversations = Object.fromEntries(retainedConversations);
}

/**
 * Keeps the most recently confirmed anchors within one conversation.
 */
function keepMostRecent(
  anchors: NavigationAnchor[],
  limit: number
): NavigationAnchor[] {
  return [...anchors]
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .slice(0, Math.max(0, limit));
}

/**
 * Returns anchors in prompt order for interpolation consumers.
 */
function sortAnchors(anchors: NavigationAnchor[]): NavigationAnchor[] {
  return anchors.sort(
    (first, second) =>
      first.promptIndex - second.promptIndex ||
      first.updatedAt - second.updatedAt
  );
}

/**
 * Checks persisted values before they enter navigation calculations.
 */
function isNavigationAnchor(value: unknown): value is NavigationAnchor {
  if (!isRecord(value)) return false;

  return (
    typeof value.conversationKey === 'string' &&
    typeof value.promptId === 'string' &&
    [
      value.promptIndex,
      value.scrollTop,
      value.scrollHeight,
      value.viewportWidth,
      value.viewportHeight,
      value.scrollProgress,
      value.updatedAt,
    ].every((field) => typeof field === 'number' && Number.isFinite(field))
  );
}

/**
 * Returns whether a value can be inspected as a plain record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Creates the versioned empty persisted-cache shape.
 */
function createEmptyPersistentCache(): PersistentNavigationAnchorCache {
  return {
    version: CACHE_VERSION,
    conversations: {},
  };
}

/**
 * Clones one anchor before crossing the store boundary.
 */
function cloneAnchor(anchor: NavigationAnchor): NavigationAnchor {
  return { ...anchor };
}

/**
 * Clones persisted state before passing it to an external storage adapter.
 */
function clonePersistentCache(
  cache: PersistentNavigationAnchorCache
): PersistentNavigationAnchorCache {
  return {
    version: cache.version,
    conversations: Object.fromEntries(
      Object.entries(cache.conversations).map(
        ([conversationKey, conversation]) => [
          conversationKey,
          {
            lastUsedAt: conversation.lastUsedAt,
            anchors: conversation.anchors.map(cloneAnchor),
          },
        ]
      )
    ),
  };
}

/**
 * Restricts a number to an inclusive range.
 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
