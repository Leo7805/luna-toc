/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigatorController } from '@/navigation/navigatorController';
import {
  TOC_EDIT_SUBMISSION,
  TOC_REFRESH_REQUEST,
  TOC_REFRESH_RESULT,
} from '@/navigation/refresh/refreshProtocol';
import { getActivePlatform } from '@/platforms';

describe('historical prompt edit refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refreshes immediately for an earlier parent and retries once if the first snapshot predates the edit', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-edit-refresh',
      },
    });
    document.body.innerHTML = `
      <div id="navigator-list"></div>
      <div class="navigator-hint"></div>
      <div id="sidebar-status-band"></div>
      <div id="luna-toc-status"></div>
    `;

    const platform = getActivePlatform('chatgpt.com');
    const routeKey = 'test-edit-refresh';
    navigatorController.init();
    navigatorController.attach();

    const emit = (type: string, data: Record<string, unknown>) => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        origin: location.origin,
        data: { type, ...data },
      }));
    };

    emit(platform.pageHook.messages.conversationData, {
      routeKey,
      payload: {
        current_node: 'answer-2',
        messages: [
          { id: 'question-1', author: { role: 'user' }, content: { parts: ['Original question'] }, create_time: 1 },
          { id: 'answer-1', author: { role: 'assistant' }, content: { parts: ['First answer'] }, create_time: 2 },
          { id: 'question-2', author: { role: 'user' }, content: { parts: ['Follow-up question'] }, create_time: 3 },
          { id: 'answer-2', author: { role: 'assistant' }, content: { parts: ['Second answer'] }, create_time: 4 },
        ],
      },
    });
    emit(platform.pageHook.messages.conversationEnded, {
      routeKey,
      complete: true,
    });

    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});

    // A normal next prompt is parented to the latest answer and must not cause a full refresh.
    emit(platform.pageHook.messages.newUserMessage, {
      routeKey,
      payload: {
        id: 'question-3',
        author: { role: 'user' },
        content: { parts: ['New tail question'] },
        parentMessageId: 'answer-2',
        create_time: 5,
      },
    });
    emit(TOC_EDIT_SUBMISSION, {
      stage: 'accepted',
      routeKey,
      messageId: 'question-3',
      parentMessageId: 'answer-2',
    });
    expect(postMessage.mock.calls.filter(([message]) =>
      (message as { type?: string })?.type === TOC_REFRESH_REQUEST
    )).toHaveLength(0);

    // Re-editing from the root is a historical branch change, not a new tail prompt.
    emit(platform.pageHook.messages.newUserMessage, {
      routeKey,
      payload: {
        id: 'edited-question-1',
        author: { role: 'user' },
        content: { parts: ['Edited first question'] },
        parentMessageId: 'root-node',
        create_time: 6,
      },
    });
    emit(TOC_EDIT_SUBMISSION, {
      stage: 'accepted',
      routeKey,
      messageId: 'edited-question-1',
      parentMessageId: 'root-node',
    });

    const requests = () => postMessage.mock.calls
      .map(([message]) => message as { type?: string; routeKey?: string; requestId?: number })
      .filter((message) => message.type === TOC_REFRESH_REQUEST);
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ routeKey, requestId: 1 });

    // First snapshot is valid but stale; wait for stream completion before one retry.
    emit(TOC_REFRESH_RESULT, {
      requestId: 1,
      routeKey,
      payload: {
        activeBranchVerified: true,
        current_node: 'question-3',
        messages: [
          { id: 'question-1', author: { role: 'user' }, content: { parts: ['Original question'] }, create_time: 1 },
          { id: 'answer-1', author: { role: 'assistant' }, content: { parts: ['First answer'] }, create_time: 2 },
          { id: 'question-2', author: { role: 'user' }, content: { parts: ['Follow-up question'] }, create_time: 3 },
          { id: 'answer-2', author: { role: 'assistant' }, content: { parts: ['Second answer'] }, create_time: 4 },
          { id: 'question-3', author: { role: 'user' }, content: { parts: ['New tail question'] }, create_time: 5 },
        ],
      },
    });
    expect(requests()).toHaveLength(1);

    emit(TOC_EDIT_SUBMISSION, {
      stage: 'finished',
      routeKey,
      messageId: 'edited-question-1',
      parentMessageId: 'root-node',
    });
    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    expect(requests()[1]).toMatchObject({ routeKey, requestId: 2 });

    emit(TOC_REFRESH_RESULT, {
      requestId: 2,
      routeKey,
      payload: {
        activeBranchVerified: true,
        current_node: 'edited-answer',
        messages: [
          { id: 'edited-question-1', author: { role: 'user' }, content: { parts: ['Edited first question'] }, create_time: 6 },
          { id: 'edited-answer', author: { role: 'assistant' }, content: { parts: ['Edited answer'] }, create_time: 7 },
        ],
      },
    });

    const list = document.getElementById('navigator-list')!;
    expect(list.textContent).toContain('Edited first question');
    expect(list.textContent).not.toContain('Follow-up question');
    expect(list.textContent).not.toContain('New tail question');
  });
});
