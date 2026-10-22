/** @vitest-environment jsdom */
/** Tests account binding independent of removed prompt bookmarks. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getActiveConversationOwner,
  setActiveConversationOwner,
} from '@/navigation/lifecycle/conversationOwner';
import { isPermanentConversationId } from '@/navigation/lifecycle/protocol';

describe('conversation ownership', () => {
  afterEach(() => setActiveConversationOwner(null));

  it('allows a verified account owner or an unverified state', () => {
    setActiveConversationOwner('account-1');
    expect(getActiveConversationOwner()).toBe('account-1');
    setActiveConversationOwner(null);
    expect(getActiveConversationOwner()).toBeNull();
  });

  it('rejects temporary route identities for persistent TOC data', () => {
    expect(isPermanentConversationId('local-12345678')).toBe(false);
    expect(isPermanentConversationId('conversation-123')).toBe(true);
  });
});
