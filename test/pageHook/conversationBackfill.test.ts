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

  it('6. backfillMaxPages reached while history remains terminates with complete: false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    // Always returns has_previous_page: true with a valid cursor
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{ id: 'older' }],
        page_info: { has_previous_page: true, start_cursor: 'next-cursor' },
      }),
    });

    installConversationBackfill({
      originalFetch: mockFetch as unknown as typeof fetch,
      platform,
    });

    startBackfillIfNeeded(
      { page_info: { has_previous_page: true, start_cursor: 'cursor-1' } },
      'test-max-pages-cap',
      null
    );

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-max-pages-cap'
        )
      ).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(platform.config.backfillMaxPages);

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-max-pages-cap'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('7. missing page_info terminates with complete: false', async () => {
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
