/**
 * Resolves account ownership using an isolated-world same-origin request.
 * MAIN-world postMessage is controlled by page scripts and cannot attest identity.
 */
import { CHATGPT_MESSAGE_TYPES } from '@/platforms/chatgpt/messages';
import { setActiveConversationOwner } from './conversationOwner';

let installed = false;
let generation = 0;
let lastCheckAt = 0;
const MIN_RECHECK_INTERVAL_MS = 2_000;

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
    return typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : null;
  } catch {
    return null;
  }
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
  if (generation === current) setActiveConversationOwner(ownerId);
}

/** Recheck after navigation or focus, never use page-supplied identity or deletion claims. */
export function initializeConversationLifecycle(): void {
  if (installed) return;
  installed = true;
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
    if (event.data?.type === CHATGPT_MESSAGE_TYPES.routeChanged) check();
    // Deletion and identity messages from MAIN world are never storage authority.
  });
}
