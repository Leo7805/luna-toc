/**
 * Connects browser-page lifecycle events with local TOC titles and caches.
 * Performs one validation per page load and does not schedule background polls.
 */
import { setActiveConversationOwner } from './conversationOwner';
import { navigatorController } from '@/navigation/navigatorController';
import { tocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
  TOC_CONVERSATION_DELETED,
  isPermanentConversationId,
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
      routeKey?: unknown;
      ownerId?: unknown;
    } | null;
    if (data?.type === TOC_CONVERSATION_DELETED && isPermanentConversationId(data.routeKey)) {
      void tocAliasStore.removeConversation(data.routeKey).catch(() => undefined);
      navigatorController.handleConversationDeleted(data.routeKey);
    }
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
