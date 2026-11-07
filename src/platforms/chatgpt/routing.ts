/**
 * ChatGPT routing adapter: route-key extraction, new-chat sentinel, and
 * sidebar title resolution.
 *
 */
const CONVERSATION_PATH_PATTERN = /\/c\/([^/]+)/;

/** Returns the shared conversation key for ordinary and Project chat paths. */
export function getCurrentRouteKey(): string {
  const match = location.pathname.match(CONVERSATION_PATH_PATTERN);
  return match?.[1] || `new-chat:${location.pathname}`;
}

/** Creates the temporary key used before a conversation ID exists. */
export function newChatRouteKey(pathname: string): string {
  return `new-chat:${pathname}`;
}

/**
 * Returns the conversation-title text shown in the sidebar. Prefers the
 * document `<title>` (with the platform suffix stripped) when available.
 */
export function getSidebarTitle(_routeKey: string): string {
  const raw = (document.title || '').trim();
  if (!raw) return 'New chat';
  return raw.replace(/\s*[-–]\s*ChatGPT$/i, '').trim() || 'New chat';
}

/**
 * CSS selector used to find the conversation-link in the host sidebar.
 * ChatGPT renders the link as `a[href*="/c/<id>"]`.
 */
export function getConversationLinkSelector(conversationId: string): string {
  return `a[href*="/c/${conversationId}"]`;
}