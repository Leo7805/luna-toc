/** Identifies ChatGPT full-conversation API requests across supported paths. */

const FULL_CONVERSATION_PATH_PATTERN =
  /^\/backend-api\/conversations?\/([^/]+)\/?$/;

const FULL_CONVERSATION_MESSAGES_PATH_PATTERN =
  /^\/backend-api\/conversations?\/([^/]+)\/messages\/?$/;

/**
 * Returns the conversation ID for a full-conversation API path.
 * Subresources such as `/textdocs` are intentionally excluded.
 *
 * @example
 * getConversationIdFromApiPath('/backend-api/conversations/example-id');
 */
export function getConversationIdFromApiPath(
  pathname: string
): string | null {
  const match = pathname.match(FULL_CONVERSATION_PATH_PATTERN);
  const conversationId = match ? decodeURIComponent(match[1]) : null;

  return conversationId === 'init' ? null : conversationId;
}

/**
 * Returns the conversation ID for a paginated messages sub-resource path.
 * The `/messages` suffix marks an older-page request, which ChatGPT issues when
 * scrolling back through history; it returns the same `messages` payload shape.
 *
 * @example
 * getConversationMessagesIdFromApiPath(
 *   '/backend-api/conversations/example-id/messages'
 * );
 */
export function getConversationMessagesIdFromApiPath(
  pathname: string
): string | null {
  const match = pathname.match(FULL_CONVERSATION_MESSAGES_PATH_PATTERN);
  const conversationId = match ? decodeURIComponent(match[1]) : null;

  return conversationId === 'init' ? null : conversationId;
}
