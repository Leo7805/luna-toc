/**
 * @vitest-environment jsdom
 * The page hook may report account state, but it never authorizes local deletion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConversationLifecycle } from '@/pageHook/conversationLifecycle';
import {
  TOC_LIFECYCLE_CHECK_REQUEST,
  TOC_LIFECYCLE_CHECK_RESULT,
} from '@/navigation/lifecycle/protocol';

describe('ChatGPT page-hook lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('responds to lifecycle checks with a same-origin authenticated account only', async () => {
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
        data: { type: TOC_LIFECYCLE_CHECK_REQUEST, requestId: 101 },
      }));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ requestId: 101, ownerId: 'account-1' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('returns no account when the session request fails', async () => {
    const fetcher = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    installConversationLifecycle(fetcher);
    const seen: unknown[] = [];
    const listener = (event: MessageEvent) => {
      if (event.data?.type === TOC_LIFECYCLE_CHECK_RESULT) seen.push(event.data);
    };
    window.addEventListener('message', listener);
    try {
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: location.origin,
        data: { type: TOC_LIFECYCLE_CHECK_REQUEST, requestId: 102 },
      }));
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toMatchObject({ requestId: 102, ownerId: null });
    } finally {
      window.removeEventListener('message', listener);
    }
  });
});
