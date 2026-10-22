/**
 * Manages cached prompt outline descriptors and cache invalidation rules.
 * Associates prompt indices with platform message IDs and verifies DOM
 * element connectedness before reusing cached headings.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import type { OutlineEntry } from './headingExtractor';
import { logOutlineDiagnostic } from './outlineDiagnostics';

export interface CachedPromptOutline {
  promptMessageId: string;
  answerId?: string;
  entries: OutlineEntry[];
}

const promptOutlines = new Map<number, CachedPromptOutline>();
const promptMessageIds = new Map<number, string>();
const promptAnswerIds = new Map<number, string>();

/**
 * Replaces the prompt index to message ID mapping for the active conversation.
 * Invalidates any cached outline whose associated message ID changed.
 * @param {Array<NavigatorMessage>} messages Messages in display order.
 * @returns {number[]} Array of prompt indices that were invalidated.
 */
export function setPromptMessages(messages: NavigatorMessage[]): number[] {
  const nextPromptMessageIds = new Map<number, string>();
  const nextAnswerIds = new Map<number, string>();
  messages.forEach((message, index) => {
    if (message.id) nextPromptMessageIds.set(index, message.id);
    if (message.answerId) nextAnswerIds.set(index, message.answerId);
  });

  const invalidatedIndices: number[] = [];
  promptOutlines.forEach((cachedOutline, index) => {
    if (
      cachedOutline.promptMessageId !== nextPromptMessageIds.get(index) ||
      cachedOutline.answerId !== nextAnswerIds.get(index)
    ) {
      invalidatePromptOutline(index, 'message-id-changed');
      invalidatedIndices.push(index);
    }
  });

  promptMessageIds.clear();
  promptAnswerIds.clear();
  nextPromptMessageIds.forEach((messageId, index) => {
    promptMessageIds.set(index, messageId);
  });
  nextAnswerIds.forEach((answerId, index) => {
    promptAnswerIds.set(index, answerId);
  });

  return invalidatedIndices;
}

/**
 * Returns a cached outline only when it still belongs to the prompt and its
 * heading elements remain connected to the DOM.
 */
export function getReusablePromptOutline(
  index: number,
  refreshEntries: () => OutlineEntry[]
): CachedPromptOutline | null {
  const cachedOutline = promptOutlines.get(index);
  const promptMessageId = promptMessageIds.get(index);
  if (!cachedOutline || !promptMessageId) return null;

  if (
    cachedOutline.promptMessageId !== promptMessageId ||
    cachedOutline.answerId !== promptAnswerIds.get(index)
  ) {
    invalidatePromptOutline(index, 'message-id-mismatch');
    return null;
  }

  if (cachedOutline.entries.every(({ element, text, sectionId }) =>
    element.isConnected &&
    (element.textContent ?? '').trim() === text &&
    (element.dataset.sectionId || '') === sectionId
  )) {
    return cachedOutline;
  }

  const refreshedEntries = refreshEntries();
  if (refreshedEntries.length === 0) {
    invalidatePromptOutline(index, 'disconnected-heading');
    return null;
  }

  const refreshedOutline = {
    promptMessageId,
    answerId: promptAnswerIds.get(index),
    entries: refreshedEntries,
  };
  promptOutlines.set(index, refreshedOutline);
  return refreshedOutline;
}

/**
 * Stores an extracted outline in the cache for the given prompt index.
 */
export function cachePromptOutline(
  index: number,
  entries: OutlineEntry[]
): boolean {
  const promptMessageId = promptMessageIds.get(index);
  if (!promptMessageId) return false;

  promptOutlines.set(index, {
    promptMessageId,
    answerId: promptAnswerIds.get(index),
    entries,
  });
  return true;
}

/**
 * Returns the cached heading entries for a prompt index, or an empty array.
 */
export function getCachedEntries(index: number): OutlineEntry[] {
  return promptOutlines.get(index)?.entries || [];
}

/**
 * Returns the recorded message ID for a prompt index, or null.
 */
export function getPromptMessageId(index: number): string | null {
  return promptMessageIds.get(index) || null;
}

/**
 * Clears all cached outlines and message IDs.
 */
export function clearOutlineCache(): void {
  promptOutlines.clear();
  promptMessageIds.clear();
  promptAnswerIds.clear();
}

/**
 * Removes one stale outline descriptor and logs the diagnostic reason.
 */
function invalidatePromptOutline(index: number, reason: string): boolean {
  if (!promptOutlines.delete(index)) return false;

  logOutlineDiagnostic('OUTLINE_CACHE_INVALIDATED', {
    promptIndex: index,
    promptMessageId: promptMessageIds.get(index) || null,
    reason,
  });
  return true;
}
