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
      navigatorController.handleConversationDeleted(data.routeKey);
    }
    if (data?.type !== TOC_LIFECYCLE_CHECK_RESULT || data.requestId !== requestId) return;
    const ownerId = typeof data.ownerId === 'string' && data.ownerId ? data.ownerId : null;
    setPromptMarkOwner(ownerId);
    if (!ownerId || !Array.isArray(data.missingIds)) return;
    for (const routeKey of data.missingIds) {
      if (!isPermanentConversationId(routeKey)) continue;
      // Legacy unowned marks and marks belonging to another account are never pruned.
      if (getPromptMarkOwner(routeKey) !== ownerId) continue;
      clearPromptMarksForConversation(routeKey);
      navigatorController.handleConversationDeleted(routeKey);
    }
  });
  window.postMessage({
    type: TOC_LIFECYCLE_CHECK_REQUEST,
    requestId,
    conversationIds: getStoredMarkConversationIds(),
  }, location.origin);
}
