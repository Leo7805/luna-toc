/**
 * Connects browser-page lifecycle events with local TOC titles and caches.
 * Performs one validation per page load and does not schedule background polls.
 * Page-originated deletion notifications are advisory, never storage authority.
 */
import { setActiveConversationOwner } from './conversationOwner';
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
  TOC_CONVERSATION_DELETED,
} from './protocol';

let installed = false;

/** Starts a single authenticated startup reconciliation for saved TOC titles. */
export function initializeConversationLifecycle(): void {
  if (installed) return;
  installed = true;
  const requestId = Date.now();
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data as {
      type?: unknown;
      requestId?: unknown;
      ownerId?: unknown;
    } | null;
    // Messages on the page's window are controlled by page scripts. Even a
    // same-origin "deletion confirmed" message cannot prove the HTTP mutation
    // succeeded, so it must never delete extension-owned aliases or caches.
    // Preserve local data until a separate trusted user action handles cleanup.
    if (data?.type === TOC_CONVERSATION_DELETED) return;
    if (data?.type !== TOC_LIFECYCLE_CHECK_RESULT || data.requestId !== requestId) return;
    const ownerId = typeof data.ownerId === 'string' && data.ownerId ? data.ownerId : null;
    setActiveConversationOwner(ownerId);

  });
  // Capture account identity only. A missing GET result is not proof of deletion.
  window.postMessage({
    type: TOC_LIFECYCLE_CHECK_REQUEST,
    requestId,
  }, location.origin);
}
