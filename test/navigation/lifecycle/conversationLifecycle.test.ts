/** @vitest-environment jsdom */
/** Tests account binding independent of removed prompt bookmarks. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveConversationOwner,
  setActiveConversationOwner,
} from '@/navigation/lifecycle/conversationOwner';
import { isPermanentConversationId, TOC_CONVERSATION_DELETED } from '@/navigation/lifecycle/protocol';

describe('conversation ownership', () => {
  afterEach(() => setActiveConversationOwner(null));

  it('allows a verified account owner or an unverified state', () => {
    setActiveConversationOwner('account-1');
    expect(getActiveConversationOwner()).toBe('account-1');
    setActiveConversationOwner(null);
    expect(getActiveConversationOwner()).toBeNull();
  });


  it('rejects an untrusted same-origin deletion event without clearing local data or UI state', async () => {
    const { initializeConversationLifecycle } = await import('@/navigation/lifecycle/conversationLifecycle');
    const { tocAliasStore } = await import('@/features/conversationPrompts/tocAliasStore');
    const { navigatorController } = await import('@/navigation/navigatorController');
    const deleteAlias = vi.spyOn(tocAliasStore, 'removeConversation').mockResolvedValue(undefined);
    const clearConversation = vi.spyOn(navigatorController, 'handleConversationDeleted').mockImplementation(() => {});
    try {
      initializeConversationLifecycle();
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: location.origin,
        data: { type: TOC_CONVERSATION_DELETED, routeKey: 'conversation-123' },
      }));
      expect(deleteAlias).not.toHaveBeenCalled();
      expect(clearConversation).not.toHaveBeenCalled();
    } finally {
      deleteAlias.mockRestore();
      clearConversation.mockRestore();
    }
  });

  it('rejects temporary route identities for persistent TOC data', () => {
    expect(isPermanentConversationId('local-12345678')).toBe(false);
    expect(isPermanentConversationId('conversation-123')).toBe(true);
  });
});
