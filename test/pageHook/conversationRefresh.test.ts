/**
 * @vitest-environment jsdom
 * Verifies on-demand refresh for project conversations and incomplete responses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConversationRefresh } from '@/pageHook/conversationRefresh';
import { TOC_REFRESH_REQUEST, TOC_REFRESH_RESULT } from '@/navigation/refresh/refreshProtocol';
import { getActivePlatform } from '@/platforms';

describe('conversation refresh on sidebar opening', () => {
  const originalPath = location.pathname;

  afterEach(() => {
    history.replaceState(null, '', originalPath);
    vi.restoreAllMocks();
  });

  it('refreshes a project conversation using captured headers, and rejects incomplete fallback data', async () => {
    const routeKey = 'project-conversation-123';
    history.replaceState(null, '', `/g/g-p-workspace/c/${routeKey}`);

    const user = {
      id: 'user-1',
      author: { role: 'user' },
      content: { parts: ['Current question'] },
      create_time: 1,
    };
    const reply = {
      id: 'reply-1',
      author: { role: 'assistant' },
      content: { parts: ['Current answer'] },
      create_time: 2,
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current_node: 'reply-1',
          mapping: {
            'user-1': { parent: null, message: user },
            'reply-1': { parent: 'user-1', message: reply },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [user],
          page_info: { has_previous_page: true },
        }),
      });

    const platform = getActivePlatform('chatgpt.com');
    const observeHeaders = installConversationRefresh(
      mockFetch as unknown as typeof fetch,
      platform
    );
    observeHeaders(routeKey, { authorization: 'Bearer captured-token' });

    const received: Array<{ type?: string; requestId?: number; payload?: unknown }> = [];
    const onResult = (event: MessageEvent) => {
      if (event.data?.type === TOC_REFRESH_RESULT) received.push(event.data);
    };
    window.addEventListener('message', onResult);

    try {
      const request = (requestId: number) => {
        window.dispatchEvent(new MessageEvent('message', {
          source: window,
          origin: location.origin,
          data: { type: TOC_REFRESH_REQUEST, routeKey, requestId },
        }));
      };

      request(1);
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0].payload).toMatchObject({
        messages: [user, reply],
        current_node: 'reply-1',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/backend-api/conversation/${routeKey}`),
        expect.objectContaining({
          credentials: 'include',
          headers: { authorization: 'Bearer captured-token' },
        })
      );

      request(2);
      await vi.waitFor(() => expect(received).toHaveLength(2));
      expect(received[1].payload).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener('message', onResult);
    }
  });
});
