/**
 * ChatGPT content-side adapter.
 *
 * `inspectFetchRequest` classifies a `window.fetch` call site for the
 * page-hook entry. `createNavigationTurns` and
 * `createRenderedFingerprintCollector` delegate to the existing
 * platform-specific factories. `isNewChatRouteKey` mirrors the controller's
 * `new-chat:` / `WEB:` prefix check.
 */
import {
  getConversationIdFromApiPath,
  getConversationMessagesIdFromApiPath,
} from './conversationRequest';
import { getFetchUrl } from './chatGptFetchBumper';
import { getCurrentRouteKey } from './routing';
import { getFetchMethod } from '@/pageHook/fetchHelpers';
import type { ContentRequestMeta } from '../platformInterface';

const SEND_MESSAGE_PATH = '/backend-api/f/conversation';
const NEW_CHAT_PREFIX = 'new-chat:';
const NEW_CHAT_WEB_PREFIX = 'WEB:';

export function inspectFetchRequest(
  args: Parameters<typeof fetch>,
  fallbackRouteKey: string
): ContentRequestMeta | null {
  try {
    const input = args[0];
    const init = args[1] || {};
    const url = getFetchUrl(input);

    if (!url) {
      return null;
    }

    const method = getFetchMethod(input, init);
    const pathname = new URL(url, window.location.origin).pathname;
    const conversationId = getConversationIdFromApiPath(pathname);
    const messagesConversationId =
      getConversationMessagesIdFromApiPath(pathname);
    const effectiveConversationId = conversationId ?? messagesConversationId;
    const isConversationGet =
      method === 'GET' && effectiveConversationId !== null;

    return {
      isConversationGet,
      isInitialConversationLoad: conversationId !== null,
      isSendMessage: method === 'POST' && pathname === SEND_MESSAGE_PATH,
      routeKey: isConversationGet
        ? effectiveConversationId
        : fallbackRouteKey || getCurrentRouteKey(),
    };
  } catch {
    return null;
  }
}

export function isNewChatRouteKey(routeKey: string): boolean {
  return (
    routeKey.startsWith(NEW_CHAT_PREFIX) ||
    routeKey.startsWith(NEW_CHAT_WEB_PREFIX)
  );
}

// Re-export under interface-aligned names so the platform aggregator can
// wire these directly.
export { createChatGptNavigationTurns as createNavigationTurns } from './navigationAdapter';
export { createRenderedFingerprintCollector } from './renderedFingerprintCollector';