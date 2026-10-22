/**
 * Page-hook protocol for a one-time startup validity check and confirmed deletions.
 */
export const TOC_LIFECYCLE_CHECK_REQUEST = 'LUNA_TOC_LIFECYCLE_CHECK_REQUEST';
export const TOC_LIFECYCLE_CHECK_RESULT = 'LUNA_TOC_LIFECYCLE_CHECK_RESULT';
export const TOC_CONVERSATION_DELETED = 'LUNA_TOC_CONVERSATION_DELETED';

/** Accepts only permanent ChatGPT conversation identifiers. */
export function isPermanentConversationId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9_-]{8,128}$/.test(value) &&
    !value.startsWith('local-');
}
