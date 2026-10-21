/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installConversationBackfill,
  startBackfillIfNeeded,
} from '@/pageHook/conversationBackfill';
import { getActivePlatform } from '@/platforms';

describe('conversationBackfill signal exhaustiveness', () => {
  let postedMessages: any[] = [];
  let messageHandler: (event: MessageEvent) => void;

  beforeEach(() => {
    postedMessages = [];
    messageHandler = (event: MessageEvent) => {
      postedMessages.push(event.data);
    };
    window.addEventListener('message', messageHandler);
  });

  afterEach(() => {
    window.removeEventListener('message', messageHandler);
    vi.restoreAllMocks();
  });

  it('1. has_previous_page === false terminates with complete: true', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ id: 'older-1', author: { role: 'user' } }],
        page_info: { has_previous_page: false, start_cursor: null },
      }),
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-exhaustion');
    const started = startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-exhaustion',
      null
    );

    expect(started).toBe(true);

    // Wait for async backfill chain
    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-exhaustion'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-exhaustion'
    );
    expect(endedMsg.complete).toBe(true);
  });

  it('2. has_previous_page === true + valid cursor continues backfill until exhaustion', async () => {
    const platform = getActivePlatform('chatgpt.com');
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            messages: [{ id: 'older-1' }],
            page_info: { has_previous_page: true, start_cursor: 'cursor-2' },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          messages: [{ id: 'older-2' }],
          page_info: { has_previous_page: false, start_cursor: null },
        }),
      };
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-multi-page');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-multi-page',
      null
    );

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-multi-page'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-multi-page'
    );
    expect(endedMsg.complete).toBe(true);
  });

  it('3. has_previous_page === true + missing cursor terminates with complete: false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ id: 'older-1' }],
        page_info: { has_previous_page: true, start_cursor: null }, // missing cursor despite has_previous_page
      }),
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-missing-cursor');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-missing-cursor',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-missing-cursor'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-missing-cursor'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('4. HTTP failure terminates with complete: false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-http-failure');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-http-failure',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-http-failure'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-http-failure'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('5. fetch exception / abort terminates with complete: false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-fetch-exception');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-fetch-exception',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-fetch-exception'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-fetch-exception'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('6. backfills 500+ prompts (11 pages) without stopping at an arbitrary page cap', async () => {
    const platform = getActivePlatform('chatgpt.com');
    let pageCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      pageCount += 1;
      const hasPrevious = pageCount < 11;
      return {
        ok: true,
        json: async () => ({
          messages: Array.from({ length: 50 }, (_, i) => ({
            id: `p${pageCount}-m${i}`,
            author: { role: 'user' },
          })),
          page_info: {
            has_previous_page: hasPrevious,
            start_cursor: hasPrevious ? `cursor-p${pageCount + 1}` : null,
          },
        }),
      };
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-500-prompts');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-500-prompts',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-500-prompts'
        )
      ).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(11);
    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-500-prompts'
    );
    expect(endedMsg.complete).toBe(true);
  });

  it('7. backfills 1,000+ prompts (21 pages) until full history complete: true', async () => {
    const platform = getActivePlatform('chatgpt.com');
    let pageCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      pageCount += 1;
      const hasPrevious = pageCount < 21;
      return {
        ok: true,
        json: async () => ({
          messages: Array.from({ length: 50 }, (_, i) => ({
            id: `p${pageCount}-m${i}`,
            author: { role: 'user' },
          })),
          page_info: {
            has_previous_page: hasPrevious,
            start_cursor: hasPrevious ? `cursor-p${pageCount + 1}` : null,
          },
        }),
      };
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-1000-prompts');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-1000-prompts',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-1000-prompts'
        )
      ).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(21);
    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-1000-prompts'
    );
    expect(endedMsg.complete).toBe(true);
  });

  it('8. stops immediately with complete: false when route changes during backfill', async () => {
    const platform = getActivePlatform('chatgpt.com');
    let pageCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      pageCount += 1;
      if (pageCount === 1) {
        window.history.replaceState({}, '', '/c/other-route');
      }
      return {
        ok: true,
        json: async () => ({
          messages: [{ id: `msg-${pageCount}` }],
          page_info: { has_previous_page: true, start_cursor: `cursor-p${pageCount + 1}` },
        }),
      };
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-route-cancel');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-route-cancel',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-route-cancel'
        )
      ).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-route-cancel'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('9. terminates cleanly with complete: false when cursor loop occurs', async () => {
    const platform = getActivePlatform('chatgpt.com');
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      const nextCursor = callCount % 2 === 1 ? 'cursor-loop-b' : 'cursor-loop-a';
      return {
        ok: true,
        json: async () => ({
          messages: [{ id: `loop-${callCount}` }],
          page_info: { has_previous_page: true, start_cursor: nextCursor },
        }),
      };
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-cursor-loop');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-loop-a' } },
      'test-cursor-loop',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-cursor-loop'
        )
      ).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-cursor-loop'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('10. missing page_info terminates with complete: false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ id: 'older-1', author: { role: 'user' } }],
        // page_info omitted
      }),
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    window.history.replaceState({}, '', '/c/test-missing-page-info-backfill');
    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-missing-page-info-backfill',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-missing-page-info-backfill'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-missing-page-info-backfill'
    );
    expect(endedMsg.complete).toBe(false);
  });
});
