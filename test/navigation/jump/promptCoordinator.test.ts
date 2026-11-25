/** @vitest-environment jsdom */
/** Tests prompt target matching, native bottom-first settle, strategy mount, and coordinator handoff. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import type { VirtualStrategyAttempt } from '@/navigation/jump/strategies/types';

const mocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  findRenderedPrompt: vi.fn(),
  findRenderedPromptByText: vi.fn(),
  getMessageIdFromElement: vi.fn(),
  holdViewport: vi.fn(() => ({ status: 'ok' as const })),
  scrollToBottom: vi.fn(() => ({ status: 'unavailable' as const })),
  keepFollowing: vi.fn(),
  createNavigationJumpId: vi.fn(() => 'jump-coord-1'),
  logNavigationEvent: vi.fn(),
  logJumpFailedDiagnostic: vi.fn(),
  tryVirtualLayoutStrategy: vi.fn<() => VirtualStrategyAttempt>(),
  executeViewportWalkerStrategy: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    navigation: {
      getScrollContainer: mocks.getScrollContainer,
      findRenderedPrompt: mocks.findRenderedPrompt,
      findRenderedPromptByText: mocks.findRenderedPromptByText,
      getMessageIdFromElement: mocks.getMessageIdFromElement,
      holdViewport: mocks.holdViewport,
      scrollToBottom: mocks.scrollToBottom,
    },
  }),
}));

vi.mock('@/navigation/follow/follow', () => ({
  keepFollowing: mocks.keepFollowing,
}));

vi.mock('@/navigation/jump/jumpDiagnostics', () => ({
  createNavigationJumpId: mocks.createNavigationJumpId,
  logNavigationEvent: mocks.logNavigationEvent,
  logJumpFailedDiagnostic: mocks.logJumpFailedDiagnostic,
}));

vi.mock('@/navigation/jump/strategies/virtualLayoutStrategy', () => ({
  tryVirtualLayoutStrategy: mocks.tryVirtualLayoutStrategy,
}));

vi.mock('@/navigation/jump/strategies/viewportWalkerStrategy', () => ({
  executeViewportWalkerStrategy: mocks.executeViewportWalkerStrategy,
}));

import {
  coordinatePromptJump,
  hasConflictingElementMessageId,
  isUniquePromptTextInConversation,
  mountTargetViaStrategy,
  waitForNativeBottomSettle,
  type PromptCoordinatorHooks,
} from '@/navigation/jump/prompt/promptCoordinator';

function makeMessage(id: string, text: string): NavigatorMessage {
  return { id, text, canMatchByText: true, createTime: 0 };
}

function makeContainer(
  scrollTop = 500,
  scrollHeight = 4000,
  clientHeight = 800
): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let top = scrollTop;
  let height = scrollHeight;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', {
    get: () => height,
    set: (v: number) => {
      height = v;
    },
    configurable: true,
  });
  Object.defineProperty(el, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
  return el;
}

describe('promptCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.getMessageIdFromElement.mockReturnValue(null);
    mocks.findRenderedPrompt.mockReturnValue(null);
    mocks.findRenderedPromptByText.mockReturnValue(null);
    mocks.scrollToBottom.mockReturnValue({ status: 'unavailable' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('guards text fallback against duplicate/prefix prompts and conflicting element message IDs', () => {
    const p1 = makeMessage('id-1', 'Explain closures');
    const p2 = makeMessage('id-2', 'Explain closures in JS');
    const p3 = makeMessage('id-3', 'Unique question');

    expect(isUniquePromptTextInConversation([p1, p2, p3], p1)).toBe(false);
    expect(isUniquePromptTextInConversation([p1, p2, p3], p3)).toBe(true);

    const el = document.createElement('div');
    el.setAttribute('data-message-id', 'other-id');
    expect(hasConflictingElementMessageId(el, 'id-3')).toBe(true);

    el.setAttribute('data-message-id', 'id-3');
    expect(hasConflictingElementMessageId(el, 'id-3')).toBe(false);
  });

  it('handles missing context and already-mounted fast-path (exact UUID & unique text fallback)', () => {
    const p1 = makeMessage('id-1', 'Unique prompt');
    const onMissingContextFailure = vi.fn();
    const onTargetReady = vi.fn();
    const onTargetDrivenStart = vi.fn();

    const makeHooks = (
      conversationKey: string
    ): PromptCoordinatorHooks => ({
      getVirtualSearchContext: () => ({ conversationKey, prompts: [p1] }),
      isCancelled: () => false,
      onTargetDrivenStart,
      onMissingContextFailure,
      onMountFailure: vi.fn(),
      clearJumpProgress: vi.fn(),
      onTargetReady,
    });

    // Missing container -> onMissingContextFailure
    mocks.getScrollContainer.mockReturnValue(null);
    coordinatePromptJump({
      message: p1,
      index: 0,
      mode: 'target-driven',
      hooks: makeHooks('conv-1'),
    });
    expect(onTargetDrivenStart).toHaveBeenCalledWith(0);
    expect(onMissingContextFailure).toHaveBeenCalledWith(0);
    expect(onTargetReady).not.toHaveBeenCalled();

    // Fast-path exact UUID hit
    const container = makeContainer(200, 4000, 800);
    const el = document.createElement('div');
    document.body.appendChild(el);
    mocks.getScrollContainer.mockReturnValue(container);
    mocks.findRenderedPrompt.mockReturnValue(el);

    coordinatePromptJump({
      message: p1,
      index: 0,
      mode: 'target-driven',
      hooks: makeHooks('conv-1'),
    });
    expect(onTargetReady).toHaveBeenCalledWith(
      expect.objectContaining({
        target: el,
        index: 0,
        jumpId: 'jump-coord-1',
        initialScrollTopPx: 200,
        recovery: expect.objectContaining({
          initialStrategy: 'fast-path',
          remainingRecoveries: 2,
        }),
      })
    );
  });

  it('settles waitForNativeBottomSettle on quiet bottom and cancels on wheel interruption', async () => {
    const container = makeContainer(3200, 4000, 800); // distFromBottom = 0
    const p1 = waitForNativeBottomSettle(container, () => false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p1).toBe('settled');
    expect(mocks.holdViewport).toHaveBeenCalledWith(container);

    const p2 = waitForNativeBottomSettle(container, () => false);
    container.dispatchEvent(new Event('wheel'));
    await vi.advanceTimersByTimeAsync(60);
    expect(await p2).toBe('cancelled');
  });

  it('orchestrates virtual-layout mounting, viewport-walker fallback, and cancellation in mountTargetViaStrategy', async () => {
    const container = makeContainer(0, 4000, 800);
    const mountedEl = document.createElement('div');
    document.body.appendChild(mountedEl);
    const ctx = {
      targetMessage: makeMessage('id-15', 'Prompt 15'),
      targetIndex: 14,
      prompts: [makeMessage('id-15', 'Prompt 15')],
      container,
      jumpId: 'jump-15',
      isCancelled: () => false,
    };

    // Virtual layout mounted
    mocks.tryVirtualLayoutStrategy.mockReturnValue({
      mode: 'virtual',
      promise: Promise.resolve({
        status: 'mounted',
        element: mountedEl,
        topOffsetPx: 12000,
      }),
    });
    expect(await mountTargetViaStrategy(ctx)).toEqual({
      status: 'mounted',
      element: mountedEl,
      strategy: 'virtual-layout',
      virtualTopOffsetPx: 12000,
    });

    // Capability failure -> falls back to viewport walker
    mocks.tryVirtualLayoutStrategy.mockReturnValue({
      mode: 'virtual',
      promise: Promise.resolve({
        status: 'capability-failure',
        reason: 'bridge-missing',
      }),
    });
    mocks.executeViewportWalkerStrategy.mockResolvedValue(mountedEl);
    expect(await mountTargetViaStrategy(ctx)).toEqual({
      status: 'mounted',
      element: mountedEl,
      strategy: 'viewport-walker',
    });

    // skipVirtualLayout bypasses virtual layout directly
    mocks.tryVirtualLayoutStrategy.mockClear();
    mocks.executeViewportWalkerStrategy.mockResolvedValue(null);
    expect(await mountTargetViaStrategy(ctx, { skipVirtualLayout: true })).toEqual({
      status: 'failed',
      reason: 'step-2-exhausted',
      strategy: 'viewport-walker',
    });
    expect(mocks.tryVirtualLayoutStrategy).not.toHaveBeenCalled();
  });

  it('uses live hooks on async mount failure and suppresses handoff when superseded', async () => {
    const container = makeContainer(0, 4000, 800);
    mocks.getScrollContainer.mockReturnValue(container);
    const p1 = makeMessage('id-60', 'Prompt 60');

    let resolveStrategy!: (res: { status: 'exhausted'; reason: string }) => void;
    mocks.tryVirtualLayoutStrategy.mockReturnValue({
      mode: 'virtual',
      promise: new Promise((resolve) => {
        resolveStrategy = resolve;
      }),
    });

    const initialMountFail = vi.fn();
    const updatedMountFail = vi.fn();
    let currentMountFail = initialMountFail;
    const onTargetReady = vi.fn();

    coordinatePromptJump({
      message: p1,
      index: 59,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({ conversationKey: 'conv-1', prompts: [p1] }),
        isCancelled: () => false,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: (i) => currentMountFail(i),
        clearJumpProgress: vi.fn(),
        onTargetReady,
      },
    });

    // Swap hook while mount is pending
    currentMountFail = updatedMountFail;
    resolveStrategy({ status: 'exhausted', reason: 'no-progress-timeout' });
    await vi.advanceTimersByTimeAsync(10);

    expect(initialMountFail).not.toHaveBeenCalled();
    expect(updatedMountFail).toHaveBeenCalledWith(59);
    expect(onTargetReady).not.toHaveBeenCalled();

    // Superseded mid-mount suppresses both onTargetReady and onMountFailure
    let version = 1;
    let resolveMount!: (res: { status: 'mounted'; element: HTMLElement }) => void;
    mocks.tryVirtualLayoutStrategy.mockReturnValue({
      mode: 'virtual',
      promise: new Promise((resolve) => {
        resolveMount = resolve;
      }),
    });
    const staleFail = vi.fn();
    coordinatePromptJump({
      message: p1,
      index: 59,
      mode: 'target-driven',
      hooks: {
        getVirtualSearchContext: () => ({ conversationKey: 'conv-1', prompts: [p1] }),
        isCancelled: () => version !== 1,
        onTargetDrivenStart: vi.fn(),
        onMissingContextFailure: vi.fn(),
        onMountFailure: staleFail,
        clearJumpProgress: vi.fn(),
        onTargetReady,
      },
    });
    version = 2; // superseded
    const el = document.createElement('div');
    document.body.appendChild(el);
    resolveMount({ status: 'mounted', element: el });
    await vi.advanceTimersByTimeAsync(10);

    expect(onTargetReady).not.toHaveBeenCalled();
    expect(staleFail).not.toHaveBeenCalled();
  });
});
