/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveConversationOwner, setActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';
import {
  isPermanentConversationId,
  TOC_TRUSTED_CONVERSATION_DELETED,
} from '@/navigation/lifecycle/protocol';

describe('conversation ownership and trusted deletion handling', () => {
  afterEach(() => {
    setActiveConversationOwner(null);
    vi.restoreAllMocks();
  });

  it('allows a verified account owner or an unverified state', () => {
    setActiveConversationOwner('account-1');
    expect(getActiveConversationOwner()).toBe('account-1');
    setActiveConversationOwner(null);
    expect(getActiveConversationOwner()).toBeNull();
  });

  it('reads the account email from the verified ChatGPT session', async () => {
    const { readTrustedConversationIdentity } = await import('@/navigation/lifecycle/conversationLifecycle');
    const trustedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ user: { id: 'account-1', email: 'person@example.com' } }),
    })) as unknown as typeof fetch;

    await expect(readTrustedConversationIdentity(trustedFetch)).resolves.toEqual({
      ownerId: 'account-1', email: 'person@example.com',
    });
  });

  it('ignores page-posted deletion events even when they reuse the extension message type', async () => {
    const { initializeConversationLifecycle } = await import('@/navigation/lifecycle/conversationLifecycle');
    const { tocAliasStore } = await import('@/features/conversationPrompts/tocAliasStore');
    const { navigatorController } = await import('@/navigation/navigatorController');
    const deleteAlias = vi.spyOn(tocAliasStore, 'removeConversation').mockResolvedValue(undefined);
    const clearConversation = vi.spyOn(navigatorController, 'handleConversationDeleted').mockImplementation(() => {});
    setActiveConversationOwner('account-1');
    try {
      initializeConversationLifecycle();
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: location.origin,
        data: { type: TOC_TRUSTED_CONVERSATION_DELETED, routeKey: 'conversation-123' },
      }));
      await Promise.resolve();
      expect(deleteAlias).not.toHaveBeenCalled();
      expect(clearConversation).not.toHaveBeenCalled();
    } finally {
      deleteAlias.mockRestore();
      clearConversation.mockRestore();
    }
  });

  it('cleans aliases only when the extension handler revalidates the current account', async () => {
    const { handleTrustedConversationDeletion } = await import('@/navigation/lifecycle/conversationLifecycle');
    const { tocAliasStore } = await import('@/features/conversationPrompts/tocAliasStore');
    const { navigatorController } = await import('@/navigation/navigatorController');
    setActiveConversationOwner('account-1');
    const aliasOwner = vi.spyOn(tocAliasStore, 'owner').mockResolvedValue('account-1');
    const deleteAlias = vi.spyOn(tocAliasStore, 'removeConversation').mockResolvedValue(undefined);
    const clearConversation = vi.spyOn(navigatorController, 'handleConversationDeleted').mockImplementation(() => {});
    const trustedFetch = vi.fn(async () => ({
      ok: true, json: async () => ({ user: { id: 'account-1' } }),
    })) as unknown as typeof fetch;
    try {
      await expect(handleTrustedConversationDeletion('conversation-123', trustedFetch)).resolves.toBe(true);
      expect(deleteAlias).toHaveBeenCalledWith('conversation-123');
      expect(clearConversation).toHaveBeenCalledWith('conversation-123');
      expect(trustedFetch).toHaveBeenCalledTimes(1);
    } finally {
      aliasOwner.mockRestore();
      deleteAlias.mockRestore();
      clearConversation.mockRestore();
    }
  });

  it('preserves aliases when the stored owner or trusted session differs', async () => {
    const { handleTrustedConversationDeletion } = await import('@/navigation/lifecycle/conversationLifecycle');
    const { tocAliasStore } = await import('@/features/conversationPrompts/tocAliasStore');
    const { navigatorController } = await import('@/navigation/navigatorController');
    setActiveConversationOwner('account-1');
    const aliasOwner = vi.spyOn(tocAliasStore, 'owner').mockResolvedValue('account-2');
    const deleteAlias = vi.spyOn(tocAliasStore, 'removeConversation').mockResolvedValue(undefined);
    const clearConversation = vi.spyOn(navigatorController, 'handleConversationDeleted').mockImplementation(() => {});
    const trustedFetch = vi.fn(async () => ({
      ok: true, json: async () => ({ user: { id: 'account-1' } }),
    })) as unknown as typeof fetch;
    try {
      await expect(handleTrustedConversationDeletion('conversation-123', trustedFetch)).resolves.toBe(false);
      expect(deleteAlias).not.toHaveBeenCalled();
      expect(clearConversation).not.toHaveBeenCalled();
      aliasOwner.mockResolvedValue('account-1');
      const wrongSession = vi.fn(async () => ({
        ok: true, json: async () => ({ user: { id: 'account-2' } }),
      })) as unknown as typeof fetch;
      await expect(handleTrustedConversationDeletion('conversation-123', wrongSession)).resolves.toBe(false);
      expect(deleteAlias).not.toHaveBeenCalled();
    } finally {
      aliasOwner.mockRestore();
      deleteAlias.mockRestore();
      clearConversation.mockRestore();
    }
  });

  it('does not clean if reading the stored alias owner fails', async () => {
    const { handleTrustedConversationDeletion } = await import('@/navigation/lifecycle/conversationLifecycle');
    const { tocAliasStore } = await import('@/features/conversationPrompts/tocAliasStore');
    const { navigatorController } = await import('@/navigation/navigatorController');
    setActiveConversationOwner('account-1');
    vi.spyOn(tocAliasStore, 'owner').mockRejectedValue(new Error('storage read failed'));
    const deleteAlias = vi.spyOn(tocAliasStore, 'removeConversation').mockResolvedValue(undefined);
    const clearConversation = vi.spyOn(navigatorController, 'handleConversationDeleted').mockImplementation(() => {});
    const trustedFetch = vi.fn(async () => ({
      ok: true, json: async () => ({ user: { id: 'account-1' } }),
    })) as unknown as typeof fetch;
    await expect(handleTrustedConversationDeletion('conversation-123', trustedFetch)).resolves.toBe(false);
    expect(deleteAlias).not.toHaveBeenCalled();
    expect(clearConversation).not.toHaveBeenCalled();
  });

  it('rejects temporary route identities for persistent TOC data', () => {
    expect(isPermanentConversationId('local-12345678')).toBe(false);
    expect(isPermanentConversationId('conversation-123')).toBe(true);
  });
});
