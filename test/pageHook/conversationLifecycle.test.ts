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

  it('reports authenticated identity and fails closed when the session request fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'account-1' } }) })
      .mockResolvedValueOnce({ ok: false });
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
      window.dispatchEvent(new MessageEvent('message', {
        source: window, origin: location.origin,
        data: { type: TOC_LIFECYCLE_CHECK_REQUEST, requestId: 102 },
      }));
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen).toContainEqual({ type: TOC_LIFECYCLE_CHECK_RESULT, requestId: 101, ownerId: 'account-1' });
      expect(seen).toContainEqual({ type: TOC_LIFECYCLE_CHECK_RESULT, requestId: 102, ownerId: null });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('message', listener);
    }
  });
});
