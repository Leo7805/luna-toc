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
      missingIds?: unknown;
    } | null;
    if (data?.type === TOC_CONVERSATION_DELETED && isPermanentConversationId(data.routeKey)) {
      void tocAliasStore.removeConversation(data.routeKey).catch(() => undefined);
      navigatorController.handleConversationDeleted(data.routeKey);
    }
    if (data?.type !== TOC_LIFECYCLE_CHECK_RESULT || data.requestId !== requestId) return;
    const ownerId = typeof data.ownerId === 'string' && data.ownerId ? data.ownerId : null;
    setActiveConversationOwner(ownerId);
    if (!ownerId || !Array.isArray(data.missingIds)) return;
    for (const routeKey of data.missingIds) {
      if (!isPermanentConversationId(routeKey)) continue;
      // Never remove data that belongs to an unknown or different account.
      void tocAliasStore.owner(routeKey).then((savedOwner) => {
        if (savedOwner !== ownerId) return;
        return tocAliasStore.removeConversation(routeKey).then(() => {
          navigatorController.handleConversationDeleted(routeKey);
        });
      }).catch(() => undefined);
    }
  });
  // Only persisted titles need reconciliation; marking has been removed.
  void tocAliasStore.references().then((aliasIds) => {
    window.postMessage({
      type: TOC_LIFECYCLE_CHECK_REQUEST,
      requestId,
      conversationIds: aliasIds,
    }, location.origin);
  }).catch(() => undefined);
}
