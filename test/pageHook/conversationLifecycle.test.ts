/**
 * @vitest-environment jsdom
 * Verifies safe deletion detection and authenticated startup reconciliation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDeletionTarget,
  installConversationLifecycle,
  publishConfirmedDeletion,
} from '@/pageHook/conversationLifecycle';
import {
  TOC_CONVERSATION_DELETED,
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
} from '@/navigation/lifecycle/protocol';

describe('ChatGPT conversation lifecycle page hook', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('accepts successful delete and visibility removal but rejects archive', async () => {
    const url = '/backend-api/conversation/conversation-123';
    expect(await getDeletionTarget([url, { method: 'DELETE' }])).toBe('conversation-123');
    expect(await getDeletionTarget([url, { method: 'PATCH', body: JSON.stringify({ is_visible: false }) }]))
      .toBe('conversation-123');
    expect(await getDeletionTarget([url, { method: 'PATCH', body: JSON.stringify({ is_archived: true }) }]))
      .toBeNull();
    expect(await getDeletionTarget([url, { method: 'PATCH', body: JSON.stringify({ is_visible: true }) }]))
      .toBeNull();
  });

  it('publishes only successful deletion responses', async () => {
    const listener = vi.fn();
    window.addEventListener('message', listener);
    try {
      publishConfirmedDeletion({ ok: false } as Response, Promise.resolve('conversation-123'));
      await Promise.resolve();
      expect(listener).not.toHaveBeenCalled();
      publishConfirmedDeletion({ ok: true } as Response, Promise.resolve('conversation-123'));
      await vi.waitFor(() => expect(listener.mock.calls.some(
        ([event]) => event.data?.type === TOC_CONVERSATION_DELETED
      )).toBe(true));
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('verifies the signed-in user but never treats a possible 404 as a deletion', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'account-1' } }) });
    installConversationLifecycle(fetcher as unknown as typeof fetch);
    const seen: unknown[] = [];
    const listener = (event: MessageEvent) => {
      if (event.data?.type === TOC_LIFECYCLE_CHECK_RESULT) seen.push(event.data);
    };
    window.addEventListener('message', listener);
    try {
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: location.origin,
        data: {
          type: TOC_LIFECYCLE_CHECK_REQUEST,
          requestId: 101,
        },
      }));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({
        requestId: 101, ownerId: 'account-1',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('message', listener);
    }
  });
});
