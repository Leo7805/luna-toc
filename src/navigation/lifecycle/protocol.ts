/** Cross-context protocol constants. Page postMessage values are never deletion authority. */
export const TOC_LIFECYCLE_CHECK_REQUEST = 'LUNA_TOC_LIFECYCLE_CHECK_REQUEST';
export const TOC_LIFECYCLE_CHECK_RESULT = 'LUNA_TOC_LIFECYCLE_CHECK_RESULT';
/** Sent through chrome.runtime from the extension service worker after a successful observed mutation. */
export const TOC_TRUSTED_CONVERSATION_DELETED = 'LUNA_TOC_TRUSTED_CONVERSATION_DELETED_V1';

/** Accepts only permanent ChatGPT conversation identifiers. */
export function isPermanentConversationId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9_-]{8,128}$/.test(value) &&
    !value.startsWith('local-');
}
