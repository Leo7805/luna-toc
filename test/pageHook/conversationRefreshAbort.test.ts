/**
 * @vitest-environment jsdom
 * Regression coverage for refresh cancellation, hung fetches, and late results.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installConversationRefresh } from '@/pageHook/conversationRefresh';
import {
  TOC_REFRESH_CANCEL,
  TOC_REFRESH_REQUEST,
  TOC_REFRESH_RESULT,
  TOC_REFRESH_TIMEOUT_MS,
} from '@/navigation/refresh/refreshProtocol';
import { getActivePlatform } from '@/platforms';

const routeKey = 'refresh-abort-conversation-123';
const originalPath = location.pathname;
const removers: Array<() => void> = [];

function emit(type: string, requestId: number): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: location.origin,
    data: { type, routeKey, requestId },
  }));
}

function startHook(mockFetch: typeof fetch): void {
  const addSpy = vi.spyOn(window, 'addEventListener');
  installConversationRefresh(mockFetch, getActivePlatform('chatgpt.com'));
  const handlers = addSpy.mock.calls
    .filter(([type]) => type === 'message')
    .map(([, handler]) => handler);
  addSpy.mockRestore();
  removers.push(() => {
    for (const handler of handlers) window.removeEventListener('message', handler);
  });
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function mappingResponse(text: string): Response {
  return {
    ok: true,
    json: async () => ({
      current_node: 'answer-1',
      mapping: {
        'question-1': {
          parent: null,
          message: {
            id: 'question-1',
            author: { role: 'user' },
            content: { parts: [text] },
            create_time: 1,
          },
        },
        'answer-1': {
          parent: 'question-1',
          message: {
            id: 'answer-1',
            author: { role: 'assistant' },
            content: { parts: ['Reply'] },
            create_time: 2,
          },
        },
      },
    }),
  } as Response;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe('page-hook on-demand refresh cancellation', () => {
  beforeEach(() => {
    history.replaceState(null, '', `/c/${routeKey}`);
  });

  afterEach(() => {
    for (const remove of removers.splice(0)) remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    history.replaceState(null, '', originalPath);
  });

  it('cancels the underlying fetch only after all coalesced request IDs cancel', () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn((_url: string, _init?: RequestInit) =>
      new Promise<Response>(() => {}));
    startHook(mockFetch as unknown as typeof fetch);

    emit(TOC_REFRESH_REQUEST, 11);
    emit(TOC_REFRESH_REQUEST, 12);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstSignal = mockFetch.mock.calls[0][1]?.signal as AbortSignal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);

    emit(TOC_REFRESH_CANCEL, 11);
    expect(firstSignal.aborted).toBe(false);
    emit(TOC_REFRESH_CANCEL, 12);
    expect(firstSignal.aborted).toBe(true);

    emit(TOC_REFRESH_REQUEST, 13);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(false);
  });

  it('aborts at the page-hook deadline, releases inFlight and allows a fresh attempt', () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn((_url: string, _init?: RequestInit) =>
      new Promise<Response>(() => {}));
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    startHook(mockFetch as unknown as typeof fetch);

    emit(TOC_REFRESH_REQUEST, 21);
    const previousSignal = mockFetch.mock.calls[0][1]?.signal as AbortSignal;
    vi.advanceTimersByTime(TOC_REFRESH_TIMEOUT_MS);
    expect(previousSignal.aborted).toBe(true);
    expect(post.mock.calls.map(([data]) => data)).toContainEqual({
      type: TOC_REFRESH_RESULT, routeKey, requestId: 21, payload: null,
    });

    emit(TOC_REFRESH_REQUEST, 22);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch.mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(false);
  });

  it('never publishes an obsolete result or deletes the newer inFlight entry', async () => {
    vi.useFakeTimers();
    const first = pendingResponse();
    const second = pendingResponse();
    const mockFetch = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    startHook(mockFetch as unknown as typeof fetch);

    emit(TOC_REFRESH_REQUEST, 31);
    emit(TOC_REFRESH_CANCEL, 31);
    emit(TOC_REFRESH_REQUEST, 32);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Simulate a transport that ignores AbortSignal and resolves too late.
    first.resolve(mappingResponse('Obsolete question'));
    await drain();
    expect(post.mock.calls.filter(([data]) =>
      (data as { type?: string }).type === TOC_REFRESH_RESULT)).toHaveLength(0);

    // A third caller should still coalesce with request 32, not restart request 31.
    emit(TOC_REFRESH_REQUEST, 33);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    second.resolve(mappingResponse('Current question'));
    await drain();

    const results = post.mock.calls.map(([data]) => data)
      .filter((data) => (data as { type?: string }).type === TOC_REFRESH_RESULT) as
      Array<{ requestId: number; payload: { messages: Array<{ id: string }> } }>;
    expect(results.map((result) => result.requestId)).toEqual([32, 33]);
    expect(results[0].payload.messages[0].id).toBe('question-1');
  });

  it('aborts an in-progress older-page request without starting more backfill', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ id: 'question-1', author: { role: 'user' } }],
          page_info: { has_previous_page: true, start_cursor: 'cursor-one' },
        }),
      })
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValue(mappingResponse('Retry question'));
    startHook(mockFetch as unknown as typeof fetch);

    emit(TOC_REFRESH_REQUEST, 41);
    await drain();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const backfillSignal = mockFetch.mock.calls[2][1].signal as AbortSignal;
    emit(TOC_REFRESH_CANCEL, 41);
    expect(backfillSignal.aborted).toBe(true);

    emit(TOC_REFRESH_REQUEST, 42);
    await drain();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
