/**
 * Resolves account ownership in the isolated world and handles deletion notices
 * sent by the extension background after Chrome observes a successful mutation.
 */
import { CHATGPT_MESSAGE_TYPES } from '@/platforms/chatgpt/messages';
import { TOC_TRUSTED_CONVERSATION_DELETED, isPermanentConversationId } from './protocol';
import { getActiveConversationOwner, setActiveConversationOwner } from './conversationOwner';
import { SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import {
  ACCOUNT_SETTINGS_KEY, GET_ACTIVE_ACCOUNT_OWNER_MESSAGE, isValidAccountOwnerId,
  isValidAccountEmail,
} from '@/features/storage/accountSettings';
import { tocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import { navigatorController } from '@/navigation/navigatorController';

let installed = false;
let generation = 0;
let lastCheckAt = 0;
const MIN_RECHECK_INTERVAL_MS = 2_000;
const deletionChecksInFlight = new Set<string>();

export interface TrustedConversationIdentity {
  ownerId: string;
  email?: string;
}

/** Returns only identity fields verified by ChatGPT's authenticated session endpoint. */
export async function readTrustedConversationIdentity(
  trustedFetch: typeof fetch
): Promise<TrustedConversationIdentity | null> {
  try {
    const response = await trustedFetch(
      new URL('/api/auth/session', location.origin).toString(),
      { method: 'GET', credentials: 'include', cache: 'no-store' }
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') return null;
    const user = (payload as { user?: unknown }).user;
    if (!user || typeof user !== 'object') return null;
    const account = user as { id?: unknown; email?: unknown };
    if (!isValidAccountOwnerId(account.id)) return null;
    return {
      ownerId: account.id,
      ...(isValidAccountEmail(account.email) ? { email: account.email } : {}),
    };
  } catch {
    return null;
  }
}

/** Compatibility wrapper for callers that need only the verified account ID. */
export async function readTrustedConversationOwner(
  trustedFetch: typeof fetch
): Promise<string | null> {
  return (await readTrustedConversationIdentity(trustedFetch))?.ownerId ?? null;
}

async function registerVerifiedAccount(ownerId: string, email?: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId,
      ...(email ? { email } : {}),
    }, (response: { ok?: boolean; error?: string } | undefined) => {
      if (chrome.runtime.lastError || response?.ok !== true) {
        console.warn('[LunaTOC] Account preferences could not be initialized');
      }
      resolve();
    });
  });
}

/** A new generation invalidates earlier replies, including delayed successful auth. */
export async function refreshTrustedConversationOwner(
  trustedFetch: typeof fetch = globalThis.fetch
): Promise<void> {
  const current = ++generation;
  setActiveConversationOwner(null);
  const identity = typeof trustedFetch === 'function'
    ? await readTrustedConversationIdentity(trustedFetch)
    : null;
  const ownerId = identity?.ownerId ?? null;
  if (generation !== current) return;
  if (identity) await registerVerifiedAccount(identity.ownerId, identity.email);
  if (generation === current) setActiveConversationOwner(ownerId);
}

/**
 * Handles only a deletion notice sent through the extension runtime by the
 * background webRequest observer. Page-originated postMessage is not trusted.
 */
export async function handleTrustedConversationDeletion(
  routeKey: string,
  trustedFetch: typeof fetch = globalThis.fetch
): Promise<boolean> {
  const ownerId = getActiveConversationOwner();
  if (!ownerId || !isPermanentConversationId(routeKey) ||
      typeof trustedFetch !== 'function') return false;
  const key = ownerId + '\u0000' + routeKey;
  if (deletionChecksInFlight.has(key)) return false;
  deletionChecksInFlight.add(key);

  try {
    const verifiedOwner = await readTrustedConversationOwner(trustedFetch);
    if (verifiedOwner !== ownerId || getActiveConversationOwner() !== ownerId) return false;

    let savedOwner: string | null;
    try {
      savedOwner = await tocAliasStore.owner(routeKey);
    } catch {
      // A storage read failure is not proof that the route has no saved owner.
      return false;
    }
    if (savedOwner && savedOwner !== ownerId) return false;
    if (getActiveConversationOwner() !== ownerId) return false;

    let localCleanupSucceeded = false;
    try {
      await tocAliasStore.removeConversation(routeKey);
      localCleanupSucceeded = true;
    } catch (error) {
      // The remote mutation was confirmed by Chrome. Clear stale navigation even
      // if local storage is temporarily unavailable, but report cleanup failure.
      console.warn('[LunaTOC] Confirmed conversation deletion; local alias cleanup failed', error);
    }
    if (getActiveConversationOwner() !== ownerId) return false;
    navigatorController.handleConversationDeleted(routeKey);
    return localCleanupSucceeded;
  } finally {
    deletionChecksInFlight.delete(key);
  }
}
/** Recheck after navigation/focus; page-originated identity values are never accepted. */
export function initializeConversationLifecycle(): void {
  if (installed) return;
  installed = true;

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      const payload = message as { type?: unknown; routeKey?: unknown };
      if (payload.type === GET_ACTIVE_ACCOUNT_OWNER_MESSAGE) {
        if (sender.id !== chrome.runtime.id) {
          sendResponse({ ownerId: null });
          return false;
        }
        sendResponse({ ownerId: getActiveConversationOwner() });
        return false;
      }
      if (payload.type !== TOC_TRUSTED_CONVERSATION_DELETED) return;
      // Only an extension runtime message can carry this authority; a page can
      // dispatch arbitrary window.postMessage events but cannot invoke this channel.
      if (sender.id !== chrome.runtime.id || !isPermanentConversationId(payload.routeKey)) {
        sendResponse({ ok: false });
        return false;
      }
      void handleTrustedConversationDeletion(payload.routeKey).then(
        (ok) => sendResponse({ ok }),
        () => sendResponse({ ok: false })
      );
      return true;
    });
  }

  // A replace-mode restore can remove the currently active account from the map.
  // Re-register it through the same trusted content-script path instead of leaving writes permanently disabled.
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[ACCOUNT_SETTINGS_KEY]) return;
      const ownerId = getActiveConversationOwner();
      const map = changes[ACCOUNT_SETTINGS_KEY].newValue;
      if (ownerId && (!map || typeof map !== 'object' || Array.isArray(map) ||
          !Object.hasOwn(map, ownerId))) {
        void registerVerifiedAccount(ownerId);
      }
    });
  }

  const check = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastCheckAt < MIN_RECHECK_INTERVAL_MS) return;
    lastCheckAt = now;
    void refreshTrustedConversationOwner();
  };
  check(true);
  window.addEventListener('focus', () => check());
  window.addEventListener('popstate', () => check());
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as { type?: unknown } | null;
    if (data?.type === CHATGPT_MESSAGE_TYPES.routeChanged) check();
    // Deliberately ignore all page postMessage deletion claims. The background
    // observer uses chrome.runtime to send verified successful mutation events.
  });
}
