/**
 * Resolves account ownership in the isolated world and verifies deletion hints
 * before removing local conversation aliases. MAIN-world messages are hints only.
 */
import { CHATGPT_MESSAGE_TYPES } from '@/platforms/chatgpt/messages';
import { TOC_CONVERSATION_DELETED, isPermanentConversationId } from './protocol';
import { getActiveConversationOwner, setActiveConversationOwner } from './conversationOwner';
import { SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import {
  GET_ACTIVE_ACCOUNT_OWNER_MESSAGE, isValidAccountOwnerId,
} from '@/features/storage/accountSettings';
import { tocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import { navigatorController } from '@/navigation/navigatorController';

let installed = false;
let generation = 0;
let lastCheckAt = 0;
const MIN_RECHECK_INTERVAL_MS = 2_000;
const deletionChecksInFlight = new Set<string>();

/** Returns null on an unverified response; never invent an account ID. */
export async function readTrustedConversationOwner(
  trustedFetch: typeof fetch
): Promise<string | null> {
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
    const id = (user as { id?: unknown }).id;
    return isValidAccountOwnerId(id) ? id : null;
  } catch {
    return null;
  }
}

async function registerVerifiedAccount(ownerId: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId,
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
  const ownerId = typeof trustedFetch === 'function'
    ? await readTrustedConversationOwner(trustedFetch)
    : null;
  if (generation !== current) return;
  if (ownerId) await registerVerifiedAccount(ownerId);
  if (generation === current) setActiveConversationOwner(ownerId);
}

/**
 * Confirms identity before and after checking both known conversation endpoint
 * forms. A page-posted deletion hint alone can never remove local data.
 */
export async function verifyConfirmedConversationDeletion(
  routeKey: string,
  expectedOwnerId: string,
  trustedFetch: typeof fetch = globalThis.fetch
): Promise<boolean> {
  if (!isPermanentConversationId(routeKey) ||
      !isValidAccountOwnerId(expectedOwnerId) ||
      getActiveConversationOwner() !== expectedOwnerId ||
      typeof trustedFetch !== 'function') return false;

  const ownerBefore = await readTrustedConversationOwner(trustedFetch);
  if (ownerBefore !== expectedOwnerId || getActiveConversationOwner() !== expectedOwnerId) return false;

  const savedOwner = await tocAliasStore.owner(routeKey).catch(() => null);
  if (savedOwner && savedOwner !== expectedOwnerId) return false;

  const endpoints = [
    `/backend-api/conversation/${encodeURIComponent(routeKey)}`,
    `/backend-api/conversations/${encodeURIComponent(routeKey)}`,
  ];
  const checks = await Promise.all(endpoints.map(async (path) => {
    try {
      return await trustedFetch(new URL(path, location.origin).toString(), {
        method: 'GET', credentials: 'include', cache: 'no-store',
      });
    } catch {
      return null;
    }
  }));
  // If either endpoint still returns the conversation, preserve the local alias.
  if (checks.some((response) => !response || response.ok ||
      (response.status !== 404 && response.status !== 410))) return false;

  const ownerAfter = await readTrustedConversationOwner(trustedFetch);
  return ownerAfter === expectedOwnerId && getActiveConversationOwner() === expectedOwnerId;
}

/** Deletes local aliases and clears navigation only after independent server corroboration. */
export async function handleConversationDeletionHint(
  routeKey: string,
  trustedFetch: typeof fetch = globalThis.fetch
): Promise<boolean> {
  const ownerId = getActiveConversationOwner();
  if (!ownerId || !isPermanentConversationId(routeKey)) return false;
  const key = ownerId + '\u0000' + routeKey;
  if (deletionChecksInFlight.has(key)) return false;
  deletionChecksInFlight.add(key);
  try {
    if (!await verifyConfirmedConversationDeletion(routeKey, ownerId, trustedFetch)) return false;
    if (getActiveConversationOwner() !== ownerId) return false;
    try {
      await tocAliasStore.removeConversation(routeKey);
    } catch (error) {
      // The server deletion is confirmed, so clear stale navigation state even if local storage is unavailable.
      console.warn('[LunaTOC] Confirmed conversation deletion; local alias cleanup failed', error);
    }
    if (getActiveConversationOwner() !== ownerId) return false;
    navigatorController.handleConversationDeleted(routeKey);
    return true;
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
      if (!message || typeof message !== 'object' ||
          (message as { type?: unknown }).type !== GET_ACTIVE_ACCOUNT_OWNER_MESSAGE) return;
      if (sender.id !== chrome.runtime.id) {
        sendResponse({ ownerId: null });
        return false;
      }
      sendResponse({ ownerId: getActiveConversationOwner() });
      return false;
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
    const data = event.data as { type?: unknown; routeKey?: unknown } | null;
    if (data?.type === CHATGPT_MESSAGE_TYPES.routeChanged) {
      check();
      return;
    }
    if (data?.type === TOC_CONVERSATION_DELETED && isPermanentConversationId(data.routeKey)) {
      void handleConversationDeletionHint(data.routeKey).catch((error) => {
        console.warn('[LunaTOC] Conversation deletion verification failed', error);
      });
    }
  });
}
