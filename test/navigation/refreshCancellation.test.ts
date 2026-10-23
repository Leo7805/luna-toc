/**
 * @vitest-environment jsdom
 * Controller-side cancellation regression: deadline, late reply and route switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActivePlatform } from '@/platforms';
import {
  TOC_REFRESH_CANCEL,
  TOC_REFRESH_REQUEST,
  TOC_REFRESH_RESULT,
  TOC_REFRESH_TIMEOUT_MS,
} from '@/navigation/refresh/refreshProtocol';

const routeKey = 'refresh-controller-conversation-123';

describe('navigation refresh cancellation lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, host: 'chatgpt.com', pathname: `/c/${routeKey}` },
    });
    document.body.innerHTML = [
      '<div id="navigator-list"></div>',
      '<div class="navigator-hint"></div>',
      '<div id="sidebar-status-band"></div>',
      '<div id="luna-toc-status"></div>',
    ].join('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('cancels timed-out fetches, rejects late responses and retries with a new ID', async () => {
    vi.resetModules();
    const { navigatorController } = await import('@/navigation/navigatorController');
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    navigatorController.init();
    navigatorController.attach();
    navigatorController.refreshCurrentConversation();

    const sent = () => post.mock.calls.map(([data]) => data) as
      Array<{ type: string; routeKey: string; requestId: number }>;
    const first = sent().find((message) => message.type === TOC_REFRESH_REQUEST);
    expect(first?.routeKey).toBe(routeKey);

    vi.advanceTimersByTime(TOC_REFRESH_TIMEOUT_MS);
    expect(sent()).toContainEqual({
      type: TOC_REFRESH_CANCEL, routeKey, requestId: first!.requestId,
    });
    expect(document.getElementById('luna-toc-status')?.textContent).toContain('未验证');

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: {
        type: TOC_REFRESH_RESULT,
        routeKey,
        requestId: first!.requestId,
        payload: { messages: [], page_info: { has_previous_page: false } },
      },
    }));
    expect(document.getElementById('luna-toc-status')?.textContent).toContain('未验证');

    navigatorController.refreshCurrentConversation();
    const requests = sent().filter((message) => message.type === TOC_REFRESH_REQUEST);
    expect(requests).toHaveLength(2);
    expect(requests[1].requestId).toBeGreaterThan(first!.requestId);

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: {
        type: TOC_REFRESH_RESULT,
        routeKey,
        requestId: requests[1].requestId,
        payload: { messages: [], activeBranchVerified: true, page_info: { has_previous_page: false } },
      },
    }));
    expect(document.getElementById('luna-toc-status')?.textContent).not.toContain('未验证');
    vi.advanceTimersByTime(TOC_REFRESH_TIMEOUT_MS);
    expect(sent().filter((message) => message.type === TOC_REFRESH_CANCEL))
      .toHaveLength(1);
  });

  it('aborts an outstanding route request when navigation changes', async () => {
    vi.resetModules();
    const { navigatorController } = await import('@/navigation/navigatorController');
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    navigatorController.init();
    navigatorController.attach();
    navigatorController.refreshCurrentConversation();

    const messages = () => post.mock.calls.map(([data]) => data) as
      Array<{ type: string; routeKey: string; requestId: number }>;
    const requested = messages().find((msg) => msg.type === TOC_REFRESH_REQUEST);
    expect(requested).toBeDefined();

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location, host: 'chatgpt.com',
        pathname: '/c/next-controller-conversation-456',
      },
    });
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: { type: getActivePlatform('chatgpt.com').pageHook.messages.routeChanged },
    }));
    expect(messages()).toContainEqual({
      type: TOC_REFRESH_CANCEL,
      routeKey,
      requestId: requested!.requestId,
    });
  });
});
