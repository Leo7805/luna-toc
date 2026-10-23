/**
 * Passive ChatGPT structure checks, without network access or message-text reads.
 */
import type { ChatGptContractId } from '@/config/config';

const CONVERSATION_ROUTE = /\/c\/[A-Za-z0-9_-]{8,128}(?:\/|$)/;

/** Returns whether current DOM evidence can support a marker-health verdict. */
export function canInspectChatGptDom(pathname: string, hasRenderedTurns: boolean): boolean {
  return CONVERSATION_ROUTE.test(pathname) && hasRenderedTurns;
}

/**
 * Only diagnose missing markers on a real conversation route with independent
 * evidence of rendered chat turns; empty and loading chats cannot qualify.
 */
export function missingChatGptDomMarkers(
  pathname: string,
  hasRenderedTurns: boolean,
  hasUserMessageMarker: boolean,
  hasMessageIdMarker: boolean
): ChatGptContractId[] {
  if (!canInspectChatGptDom(pathname, hasRenderedTurns)) return [];
  const missing: ChatGptContractId[] = [];
  if (!hasUserMessageMarker) missing.push('dom.selector.user-message');
  if (!hasMessageIdMarker) missing.push('dom.selector.message-id');
  return missing;
}
