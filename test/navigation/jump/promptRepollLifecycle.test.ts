/** @vitest-environment jsdom */
/**
 * Regression tests for the deferred 600ms repoll timer and session cleanup
 * lifecycle in `promptNavigation.ts` (Phase 5E).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findPrompt: vi.fn(),
  findPromptByText: vi.fn(() => null as HTMLElement | null),
  getContainer: vi.fn(),
  createJumpId: vi.fn(() => 'jump-repoll-id'),
  getTestConfig: vi.fn(() => null),
  logEvent: vi.fn(),
  queryVirtualJumpTarget: vi.fn(),
  holdViewport: vi.fn(() => ({ status: 'ok' as const })),
  scrollToBottom: vi.fn(() => ({
    status: 'unavailable' as const,
    reason: 'test-default',
  })),
  readMountedWithSidebarIdx: vi.fn(() => []),
  onJumpStart: vi.fn(),
  onJumpComplete: vi.fn(),
  onJumpFailed: vi.fn(),
  clearJumpProgress: vi.fn(),
  notifyJumpFailed: vi.fn(),
  keepFollowing: vi.fn(),
  cleanupPromptJumpSessionSpy: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    id: 'chatgpt',
    navigation: {
      getScrollContainer: mocks.getContainer,
      findRenderedPrompt: mocks.findPrompt,
      findRenderedPromptByText: mocks.findPromptByText,
      readMountedWithSidebarIdx: mocks.readMountedWithSidebarIdx,
      queryVirtualJumpTarget: mocks.queryVirtualJumpTarget,
      holdViewport: mocks.holdViewport,
      scrollToBottom: mocks.scrollToBottom,
      promptTopOffsetPx: 16,
    },
    diagnostics: {
      createJumpId: mocks.createJumpId,
      getTestConfig: mocks.getTestConfig,
      logEvent: mocks.logEvent,
    },
    config: {
      selectors: {
        userMessage: '[data-chatgpt-search-unit-key$=":user"]',
        assistantMessage: '[data-chatgpt-search-unit-key$=":assistant"]',
        messageId: 'data-chatgpt-search-message-ids',
      },
    },
  }),
}));

vi.mock('@/navigation/follow/follow', () => ({
  keepFollowing: mocks.keepFollowing,
}));

vi.mock('@/navigation/jump/prompt/promptJumpSession', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/navigation/jump/prompt/promptJumpSession')
    >();
  return {
    ...actual,
    cleanupPromptJumpSession: (session: Parameters<typeof actual.cleanupPromptJumpSession>[0]) => {
      mocks.cleanupPromptJumpSessionSpy(session);
      return actual.cleanupPromptJumpSession(session);
    },
  };
});

import { clearPromptHighlightOverlay } from '@/navigation/jump/promptHighlightOverlay';
import {
  cancelActiveNavigationSearch,
  initializePromptNavigation,
  jumpToMessage,
} from '@/navigation/jump/promptNavigation';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

/**
 * Creates a connected DOM element inside `container` with `scrollIntoView`
 * stubbed for jsdom so `applyTargetLandingAlignment` succeeds cleanly.
 */
function createConnectedTarget(container: HTMLElement): HTMLDivElement {
  const el = document.createElement('div');
  el.scrollIntoView = vi.fn();
  container.appendChild(el);
  return el;
}

/**
 * Creates a detached DOM element (`isConnected === false`) so fast-path
 * coordination hands it off while initial `applyTargetLandingAlignment`
 * returns `null` and enters the 600ms deferred repoll path.
 */
function createDetachedTarget(): HTMLDivElement {
  return document.createElement('div');
}

/**
 * Creates a DOM element whose `isConnected` returns `true` for the first read
 * (passing `latest && latest.isConnected` inside the repoll callback) and
 * `false` on the second read (causing `applyTargetLandingAlignment` to return
 * `null` and hit `scroll-failed-after-repoll`).
 */
function createDisconnectOnAlignTarget(): HTMLDivElement {
  const el = document.createElement('div');
  let reads = 0;
  Object.defineProperty(el, 'isConnected', {
    configurable: true,
    get: () => {
      reads += 1;
      return reads <= 1;
    },
  });
  return el;
}

function makeMessage(id: string): NavigatorMessage {
  return {
    id,
    text: `Prompt ${id}`,
    canMatchByText: true,
    createTime: 0,
  };
}

describe('prompt deferred repoll lifecycle', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.findPrompt.mockReset();
    mocks.onJumpComplete.mockReset();
    mocks.onJumpFailed.mockReset();
    document.body.innerHTML = '';

    container = document.createElement('div');
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    container.scrollTop = 0;
    document.body.appendChild(container);

    mocks.getContainer.mockReturnValue(container);
    mocks.queryVirtualJumpTarget.mockReturnValue(undefined);
    mocks.readMountedWithSidebarIdx.mockReturnValue([]);

    initializePromptNavigation({
      getVirtualSearchContext: () => ({
        conversationKey: 'conv-repoll',
        prompts: [makeMessage('msg-a'), makeMessage('msg-b')],
      }),
      onJumpStart: mocks.onJumpStart,
      onJumpComplete: mocks.onJumpComplete,
      onJumpFailed: mocks.onJumpFailed,
      clearJumpProgress: mocks.clearJumpProgress,
      notifyJumpFailed: mocks.notifyJumpFailed,
    });
  });

  afterEach(() => {
    cancelActiveNavigationSearch();
    clearPromptHighlightOverlay();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('A: cancels the 600ms repoll timer immediately when navigation is cancelled', () => {
    mocks.findPrompt.mockReturnValueOnce(createDetachedTarget());

    jumpToMessage(makeMessage('msg-a'), 0);
    expect(vi.getTimerCount()).toBe(1);

    cancelActiveNavigationSearch();

    // Fixed implementation must cancel the pending 600ms timer synchronously.
    expect(vi.getTimerCount()).toBe(0);

    mocks.findPrompt.mockClear();
    vi.advanceTimersByTime(650);

    expect(mocks.findPrompt).not.toHaveBeenCalled();
    expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    expect(mocks.onJumpFailed).not.toHaveBeenCalled();
  });

  it('B: superseding Jump A with Jump B cancels Jump A timer immediately and preserves Jump B cleanup', () => {
    const repolledB = createConnectedTarget(container);

    mocks.findPrompt
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(repolledB);

    jumpToMessage(makeMessage('msg-a'), 0);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(200);
    jumpToMessage(makeMessage('msg-b'), 1);

    // Jump A's timer was cleared; only Jump B's single 600ms timer remains.
    expect(vi.getTimerCount()).toBe(1);

    // Advancing past Jump A's original 600ms mark must not fire Jump A.
    vi.advanceTimersByTime(450);
    expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    expect(mocks.onJumpFailed).not.toHaveBeenCalled();

    // Advancing to Jump B's 600ms mark completes Jump B cleanly.
    vi.advanceTimersByTime(150);
    expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(1);
    expect(mocks.onJumpFailed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('C: successful repoll emits found-after-repoll, calls onJumpComplete, and releases session cleanup', () => {
    const repolled = createConnectedTarget(container);

    mocks.findPrompt
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(repolled);

    jumpToMessage(makeMessage('msg-a'), 0);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(600);

    expect(mocks.keepFollowing).toHaveBeenCalledWith(1800);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'jump-repoll-id',
      'JUMP_FINISHED',
      expect.objectContaining({ status: 'found-after-repoll' }),
      undefined
    );
    expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);
    expect(mocks.cleanupPromptJumpSessionSpy).toHaveBeenCalledTimes(1);

    // Subsequent cancellation must not re-dispose the already completed session.
    mocks.cleanupPromptJumpSessionSpy.mockClear();
    cancelActiveNavigationSearch();
    expect(mocks.cleanupPromptJumpSessionSpy).not.toHaveBeenCalled();
  });

  it('D1: failed repoll (scroll-failed-after-repoll) logs failure, notifies, and releases session cleanup', () => {
    mocks.findPrompt
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(createDisconnectOnAlignTarget());

    jumpToMessage(makeMessage('msg-a'), 0);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(600);

    expect(mocks.onJumpFailed).toHaveBeenCalledTimes(1);
    expect(mocks.onJumpFailed).toHaveBeenCalledWith(0);
    expect(mocks.onJumpComplete).not.toHaveBeenCalled();
    expect(mocks.cleanupPromptJumpSessionSpy).toHaveBeenCalledTimes(1);

    mocks.cleanupPromptJumpSessionSpy.mockClear();
    cancelActiveNavigationSearch();
    expect(mocks.cleanupPromptJumpSessionSpy).not.toHaveBeenCalled();
  });

  it('D2: failed repoll (target-disappeared-after-search) logs diagnostic, notifies, and releases session cleanup', () => {
    mocks.findPrompt
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(null);

    jumpToMessage(makeMessage('msg-a'), 0);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(600);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      'jump-repoll-id',
      'JUMP_FINISHED',
      expect.objectContaining({ status: 'target-disappeared-after-search' }),
      undefined
    );
    expect(mocks.onJumpFailed).toHaveBeenCalledTimes(1);
    expect(mocks.onJumpFailed).toHaveBeenCalledWith(0);
    expect(mocks.cleanupPromptJumpSessionSpy).toHaveBeenCalledTimes(1);

    mocks.cleanupPromptJumpSessionSpy.mockClear();
    cancelActiveNavigationSearch();
    expect(mocks.cleanupPromptJumpSessionSpy).not.toHaveBeenCalled();
  });

  it('E: already-cancelled navigation does not schedule a 600ms timer and releases cleanup immediately', () => {
    const target = createConnectedTarget(container);

    // Cancel synchronously during fast-path lookup so `session.isCancelled()`
    // is already true when `runPostLandingStabilization` runs.
    mocks.findPrompt.mockImplementationOnce(() => {
      cancelActiveNavigationSearch();
      return target;
    });

    jumpToMessage(makeMessage('msg-a'), 0);

    expect(vi.getTimerCount()).toBe(0);
    mocks.cleanupPromptJumpSessionSpy.mockClear();
    cancelActiveNavigationSearch();
    expect(mocks.cleanupPromptJumpSessionSpy).not.toHaveBeenCalled();
  });

  it('preserves a reentrant jump started synchronously from onJumpComplete', () => {
    const repolledA = createConnectedTarget(container);
    const repolledB = createConnectedTarget(container);

    mocks.findPrompt
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(repolledA)
      .mockReturnValueOnce(createDetachedTarget())
      .mockReturnValueOnce(repolledB);

    mocks.onJumpComplete.mockImplementationOnce(() => {
      // Synchronously start Jump B from Jump A's completion callback.
      jumpToMessage(makeMessage('msg-b'), 1);
    });

    jumpToMessage(makeMessage('msg-a'), 0);
    vi.advanceTimersByTime(600);

    // Jump B's 600ms repoll timer must still be scheduled and intact.
    expect(vi.getTimerCount()).toBe(1);
    expect(mocks.onJumpComplete).toHaveBeenCalledTimes(1);
    expect(mocks.onJumpComplete).toHaveBeenCalledWith(0);

    // Advancing 600ms completes Jump B without duplicate notifications.
    vi.advanceTimersByTime(600);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.onJumpComplete).toHaveBeenCalledTimes(2);
    expect(mocks.onJumpComplete).toHaveBeenNthCalledWith(2, 1);
    expect(mocks.onJumpFailed).not.toHaveBeenCalled();
  });
});
