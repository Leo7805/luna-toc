/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postConversationData } from '@/pageHook/conversationCapture';
import { getActivePlatform } from '@/platforms';

describe('conversationCapture completeness on initial load', () => {
  let postedMessages: any[] = [];
  let messageHandler: (event: MessageEvent) => void;

  beforeEach(() => {
    postedMessages = [];
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
      },
    });
    messageHandler = (event: MessageEvent) => {
      postedMessages.push(event.data);
    };
    window.addEventListener('message', messageHandler);
  });

  afterEach(() => {
    window.removeEventListener('message', messageHandler);
    vi.restoreAllMocks();
  });

  it('emits complete: false when page_info is missing from initial response', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const responsePayload = {
      messages: [{ id: 'msg-1', author: { role: 'user' } }],
      // page_info is omitted
    };

    const response = new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    postConversationData(response, 'test-missing-page-info', true, null);

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-missing-page-info'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-missing-page-info'
    );
    expect(endedMsg.complete).toBe(false);
  });

  it('emits complete: true only when page_info.has_previous_page is explicitly false', async () => {
    const platform = getActivePlatform('chatgpt.com');
    const responsePayload = {
      messages: [{ id: 'msg-1', author: { role: 'user' } }],
      page_info: { has_previous_page: false, start_cursor: null },
    };

    const response = new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    postConversationData(response, 'test-explicit-exhaustion', true, null);

    await vi.waitFor(() => {
      expect(
        postedMessages.some(
          (m) =>
            m.type === platform.pageHook.messages.conversationEnded &&
            m.routeKey === 'test-explicit-exhaustion'
        )
      ).toBe(true);
    });

    const endedMsg = postedMessages.find(
      (m) =>
        m.type === platform.pageHook.messages.conversationEnded &&
        m.routeKey === 'test-explicit-exhaustion'
    );
    expect(endedMsg.complete).toBe(true);
  });
});
