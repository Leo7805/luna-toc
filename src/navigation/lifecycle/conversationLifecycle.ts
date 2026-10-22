/**
 * Connects browser-page lifecycle events with tab-local TOC marks and caches.
 * Performs one validation per page load and does not schedule background polls.
 */
import {
  clearPromptMarksForConversation,
  getPromptMarkOwner,
  getStoredMarkConversationIds,
  setPromptMarkOwner,
} from '@/features/conversationPrompts/promptMark';
import { navigatorController } from '@/navigation/navigatorController';
import { tocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
  TOC_CONVERSATION_DELETED,
  isPermanentConversationId,
} from './protocol';

let installed = false;

/** Starts a single authenticated startup reconciliation for saved marks. */
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
      clearPromptMarksForConversation(data.routeKey);
      void tocAliasStore.removeConversation(data.routeKey).catch(() => undefined);
      navigatorController.handleConversationDeleted(data.routeKey);
    }
    if (data?.type !== TOC_LIFECYCLE_CHECK_RESULT || data.requestId !== requestId) return;
    const ownerId = typeof data.ownerId === 'string' && data.ownerId ? data.ownerId : null;
    setPromptMarkOwner(ownerId);
    if (!ownerId || !Array.isArray(data.missingIds)) return;
    for (const routeKey of data.missingIds) {
      if (!isPermanentConversationId(routeKey)) continue;
      // Never remove data that belongs to an unknown or different account.
      const markedForAccount = getPromptMarkOwner(routeKey) === ownerId;
      if (markedForAccount) clearPromptMarksForConversation(routeKey);
      void tocAliasStore.owner(routeKey).then((savedOwner) => {
        if (savedOwner !== ownerId) return;
        return tocAliasStore.removeConversation(routeKey).then(() => {
          navigatorController.handleConversationDeleted(routeKey);
        });
      }).catch(() => undefined);
      if (markedForAccount) navigatorController.handleConversationDeleted(routeKey);
    }
  });
  // Resolve both session marks and persisted titles before the single startup check.
  void tocAliasStore.references().then((aliasIds) => {
    window.postMessage({
      type: TOC_LIFECYCLE_CHECK_REQUEST,
      requestId,
      conversationIds: [...new Set([...getStoredMarkConversationIds(), ...aliasIds])],
    }, location.origin);
  }).catch(() => {
    window.postMessage({
      type: TOC_LIFECYCLE_CHECK_REQUEST,
      requestId,
      conversationIds: getStoredMarkConversationIds(),
    }, location.origin);
  });
}
