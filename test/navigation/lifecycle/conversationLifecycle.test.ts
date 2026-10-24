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

  it('trusts only a direct isolated-world session fetch, not page-posted account IDs', async () => {
    const { readTrustedConversationOwner, refreshTrustedConversationOwner } =
      await import('@/navigation/lifecycle/conversationLifecycle');
    const trustedFetch = vi.fn(async () => ({
      ok: true, json: async () => ({ user: { id: 'verified-account' } }),
    })) as unknown as typeof fetch;
    expect(await readTrustedConversationOwner(trustedFetch)).toBe('verified-account');
    await refreshTrustedConversationOwner(trustedFetch);
    expect(getActiveConversationOwner()).toBe('verified-account');
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: location.origin,
      data: { type: 'LUNA_TOC_LIFECYCLE_CHECK_RESULT', requestId: Date.now(), ownerId: 'forged-account' },
    }));
    expect(getActiveConversationOwner()).toBe('verified-account');
    expect(trustedFetch).toHaveBeenCalledWith(
      new URL('/api/auth/session', location.origin).toString(),
      expect.objectContaining({ method: 'GET', credentials: 'include', cache: 'no-store' })
    );
    const failedFetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    await refreshTrustedConversationOwner(failedFetch);
    expect(getActiveConversationOwner()).toBeNull();
  });

  it('does not allow an older authenticated request to overwrite the latest session', async () => {
    const { refreshTrustedConversationOwner } =
      await import('@/navigation/lifecycle/conversationLifecycle');
    let release!: (value: unknown) => void;
    const delayedFetch = vi.fn(() => new Promise((resolve) => { release = resolve; })) as unknown as typeof fetch;
    const older = refreshTrustedConversationOwner(delayedFetch);
    await refreshTrustedConversationOwner(vi.fn(async () => ({
      ok: true, json: async () => ({ user: { id: 'current-account' } }),
    })) as unknown as typeof fetch);
    release({ ok: true, json: async () => ({ user: { id: 'stale-account' } }) });
    await older;
    expect(getActiveConversationOwner()).toBe('current-account');
  });

  it('rejects temporary route identities for persistent TOC data', () => {
    expect(isPermanentConversationId('local-12345678')).toBe(false);
    expect(isPermanentConversationId('conversation-123')).toBe(true);
  });
});
