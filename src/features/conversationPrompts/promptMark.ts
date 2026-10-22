/**
 * Manages marked LunaTOC prompts, including per-conversation persistence and
 * mark button UI state.
 */
const STORAGE_PREFIX = 'chatToc:marks:';

interface PromptMarkOptions {
  conversationKey: string;
  onMarkChanged?: () => void;
}

let conversationKey: string | null = null;
let markedPromptIds = new Set<string>();
let activeOwnerId: string | null = null;
const MARK_OWNER_PREFIX = 'chatToc:markOwner:';
let onMarkChanged: () => void = () => {};

/**
 * Loads marked prompts for the active conversation.
 * @param {Object} options
 * @param {string} options.conversationKey
 */
export function initializePromptMark(options: PromptMarkOptions): void {
  conversationKey = options.conversationKey;
  onMarkChanged = options.onMarkChanged ?? onMarkChanged;
  markedPromptIds = load();
}

/**
 * Returns whether a message is currently marked.
 * @param {string} messageId
 * @returns {boolean}
 */
export function isPromptMarked(messageId: string): boolean {
  return markedPromptIds.has(messageId);
}

/**
 * Toggles the persisted collection state for one message and updates its row.
 * Used by both right-click and three-dot context menus.
 * @param {HTMLElement} item The visible directory row.
 * @param {string} messageId The underlying prompt ID.
 * @returns {boolean} Whether the prompt is marked after toggling.
 */
export function togglePromptMark(item: HTMLElement, messageId: string): boolean {
  const marked = toggle(messageId);
  item.classList.toggle('navigator-item-marked', marked);
  onMarkChanged();
  return marked;
}

/**
 * Toggles one prompt's mark state.
 * @param {string} messageId
 * @returns {boolean} true when the prompt is marked after toggling.
 */
function toggle(messageId: string): boolean {
  if (!messageId) return false;

  if (markedPromptIds.has(messageId)) {
    markedPromptIds.delete(messageId);
  } else {
    markedPromptIds.add(messageId);
  }

  save();
  return markedPromptIds.has(messageId);
}

/**
 * Loads marked prompt IDs from sessionStorage.
 * @returns {Set<string>}
 */
function load(): Set<string> {
  try {
    const rawValue = sessionStorage.getItem(getStorageKey());
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];

    return new Set(
      Array.isArray(parsedValue)
        ? parsedValue.filter(
            (value): value is string => typeof value === 'string'
          )
        : []
    );
  } catch {
    return new Set();
  }
}

/**
 * Persists marked prompt IDs to sessionStorage.
 */
function save(): void {
  try {
    if (markedPromptIds.size === 0) {
      sessionStorage.removeItem(getStorageKey());
      sessionStorage.removeItem(getOwnerKey(conversationKey));
      return;
    }
    sessionStorage.setItem(getStorageKey(), JSON.stringify([...markedPromptIds]));
    if (activeOwnerId) sessionStorage.setItem(getOwnerKey(conversationKey), activeOwnerId);
  } catch {}
}

/**
 * Returns the sessionStorage key for the active conversation.
 * @returns {string}
 */
function getStorageKey(): string {
  return `${STORAGE_PREFIX}${conversationKey}`;
}

/** Associates subsequent mark writes with the authenticated ChatGPT user. */
export function setPromptMarkOwner(ownerId: string | null): void {
  activeOwnerId = ownerId;
}

/** Returns the account binding for a previously saved mark collection. */
export function getPromptMarkOwner(routeKey: string): string | null {
  try {
    return sessionStorage.getItem(getOwnerKey(routeKey));
  } catch {
    return null;
  }
}

/** Lists permanent conversation identifiers referenced by marks. */
export function getStoredMarkConversationIds(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const routeKey = key.slice(STORAGE_PREFIX.length);
      if (/^[A-Za-z0-9_-]{8,128}$/.test(routeKey) && !routeKey.startsWith('local-')) {
        keys.push(routeKey);
      }
    }
  } catch {
    return [];
  }
  return keys;
}

/** Removes deleted-conversation marks and their account binding. */
export function clearPromptMarksForConversation(routeKey: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + routeKey);
    sessionStorage.removeItem(getOwnerKey(routeKey));
  } catch {
    return;
  }
  if (conversationKey === routeKey) {
    markedPromptIds.clear();
    onMarkChanged();
  }
}

function getOwnerKey(routeKey: string | null): string {
  return MARK_OWNER_PREFIX + routeKey;
}
