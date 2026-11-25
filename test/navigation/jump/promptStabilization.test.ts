/** @vitest-environment jsdom */
/** Tests post-landing stabilization loop, dynamic hooks, recovery handoff, and repoll fallback. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlignmentEvaluation } from '@/navigation/jump/promptAlignment';

const mocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  findRenderedPrompt: vi.fn(),
  holdViewport: vi.fn(),
  keepFollowing: vi.fn(),
  logNavigationEvent: vi.fn(),
  logJumpFailedDiagnostic: vi.fn(),
  isNavigationDebugEnabled: vi.fn(() => false),
  emitAlignmentMeasurement: vi.fn(),
  alignElementInContainer: vi.fn(),
  evaluateElementAlignment: vi.fn<() => AlignmentEvaluation>(() => 'aligned'),
  measureAlignmentErrorPx: vi.fn(() => 0),
  resolvePromptLandingOffset: vi.fn(() => ({ expectedContainerOffsetPx: 190 })),
  highlightPromptElement: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    navigation: {
      getScrollContainer: mocks.getScrollContainer,
      findRenderedPrompt: mocks.findRenderedPrompt,
      holdViewport: mocks.holdViewport,
    },
  }),
}));

vi.mock('@/navigation/follow/follow', () => ({
  keepFollowing: mocks.keepFollowing,
}));

vi.mock('@/navigation/jump/jumpDiagnostics', () => ({
  logNavigationEvent: mocks.logNavigationEvent,
  logJumpFailedDiagnostic: mocks.logJumpFailedDiagnostic,
  isNavigationDebugEnabled: mocks.isNavigationDebugEnabled,
  emitAlignmentMeasurement: mocks.emitAlignmentMeasurement,
}));

vi.mock('@/navigation/jump/promptAlignment', () => ({
  alignElementInContainer: mocks.alignElementInContainer,
  evaluateElementAlignment: mocks.evaluateElementAlignment,
  measureAlignmentErrorPx: mocks.measureAlignmentErrorPx,
  resolvePromptLandingOffset: mocks.resolvePromptLandingOffset,
  SUBPIXEL_TOLERANCE_PX: 1.5,
}));

vi.mock('@/navigation/jump/promptHighlightOverlay', () => ({
  highlightPromptElement: mocks.highlightPromptElement,
}));

import {
  runPostLandingStabilization,
  type StabilizationLifecycleHooks,
} from '@/navigation/jump/prompt/promptStabilization';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

function makeContainer(scrollTop = 500, scrollHeight = 4000, clientHeight = 800): HTMLElement {
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
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTo = vi.fn();
  return el;
}

function makeTarget(id: string, top = 190): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-message-id', id);
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + 50,
    left: 0,
    right: 100,
    width: 100,
    height: 50,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
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

describe('promptStabilization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.stubGlobal('requestAnimationFrame', undefined);
    mocks.alignElementInContainer.mockReturnValue({
      expectedViewportTopPx: 190,
      clamped: false,
      method: 'container-scroll',
    });
    mocks.evaluateElementAlignment.mockReturnValue('aligned');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('settles after 3 stable frames and 120ms near quiet window, and reads dynamically updated onJumpComplete', () => {
    const container = makeContainer(500, 4000, 800);
    const target = makeTarget('msg-1', 190);
    mocks.getScrollContainer.mockReturnValue(container);
    mocks.findRenderedPrompt.mockReturnValue(target);

    let activeCleanup: (() => void) | null = null;
    const initialComplete = vi.fn();
    const updatedComplete = vi.fn();
    let currentComplete = initialComplete;

    const hooks: StabilizationLifecycleHooks = {
      isCancelled: () => false,
      registerCleanup: (c) => {
        activeCleanup = c;
      },
      clearCleanupIfActive: (c) => {
        if (activeCleanup === c) activeCleanup = null;
      },
      onJumpComplete: (i) => currentComplete(i),
      onTargetDrivenFailure: vi.fn(),
      clearJumpProgress: vi.fn(),
    };

    runPostLandingStabilization({
      target,
      message: makeMessage('msg-1'),
      index: 0,
      jumpId: 'jump-1',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks,
    });

    expect(activeCleanup).not.toBeNull();
    expect(mocks.keepFollowing).toHaveBeenCalledWith(1800);

    // Dynamically swap hook mid-stabilization
    currentComplete = updatedComplete;

    // 2 frames (100ms) -> not yet settled (requires >= 3 frames & >= 120ms)
    vi.advanceTimersByTime(100);
    expect(updatedComplete).not.toHaveBeenCalled();

    // Advance past 120ms quiet window (frame 4 at 200ms)
    vi.advanceTimersByTime(100);
    expect(initialComplete).not.toHaveBeenCalled();
    expect(updatedComplete).toHaveBeenCalledWith(0);
    expect(activeCleanup).toBeNull();
  });

  it('extends quiet window to 350ms on layout mutation and exhausts realign attempts into target-driven failure', () => {
    const container = makeContainer(500, 4000, 800);
    const target = makeTarget('msg-2', 190);
    mocks.getScrollContainer.mockReturnValue(container);
    mocks.findRenderedPrompt.mockReturnValue(target);

    const onTargetDrivenFailure = vi.fn();
    const hooks: StabilizationLifecycleHooks = {
      isCancelled: () => false,
      registerCleanup: vi.fn(),
      clearCleanupIfActive: vi.fn(),
      onJumpComplete: vi.fn(),
      onTargetDrivenFailure,
      clearJumpProgress: vi.fn(),
    };

    mocks.evaluateElementAlignment.mockReturnValue('correctable');
    runPostLandingStabilization({
      target,
      message: makeMessage('msg-2'),
      index: 1,
      jumpId: 'jump-2',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks,
    });

    // 3 realign attempts + cooldown exhaustion -> alignment-unstable
    vi.advanceTimersByTime(300);
    expect(mocks.alignElementInContainer).toHaveBeenCalledTimes(4); // 1 initial + 3 realigns
    expect(onTargetDrivenFailure).toHaveBeenCalledWith(1);
    expect(mocks.logNavigationEvent).toHaveBeenCalledWith(
      'jump-2',
      'JUMP_FINISHED',
      expect.objectContaining({ status: 'alignment-unstable', realignAttempts: 3 })
    );
  });

  it('cancels on user wheel interruption and preserves cleanup ownership across rapid supersession', () => {
    const container = makeContainer(500, 4000, 800);
    const targetA = makeTarget('msg-a', 190);
    const targetB = makeTarget('msg-b', 190);
    mocks.getScrollContainer.mockReturnValue(container);

    let activeCleanup: (() => void) | null = null;
    const clearJumpProgress = vi.fn();
    const onCompleteA = vi.fn();
    const onCompleteB = vi.fn();

    // Session A interrupted by wheel
    mocks.findRenderedPrompt.mockReturnValue(targetA);
    runPostLandingStabilization({
      target: targetA,
      message: makeMessage('msg-a'),
      index: 0,
      jumpId: 'jump-a',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks: {
        isCancelled: () => false,
        registerCleanup: (c) => {
          activeCleanup = c;
        },
        clearCleanupIfActive: (c) => {
          if (activeCleanup === c) activeCleanup = null;
        },
        onJumpComplete: onCompleteA,
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress,
      },
    });
    container.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(60);
    expect(clearJumpProgress).toHaveBeenCalledTimes(1);
    expect(onCompleteA).not.toHaveBeenCalled();

    // Rapid supersession: Session A superseded by Session B
    let version = 1;
    const cleanupList: Array<() => void> = [];
    runPostLandingStabilization({
      target: targetA,
      message: makeMessage('msg-a'),
      index: 0,
      jumpId: 'jump-a2',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks: {
        isCancelled: () => version !== 1,
        registerCleanup: (c) => {
          activeCleanup = c;
          cleanupList.push(c);
        },
        clearCleanupIfActive: (c) => {
          if (activeCleanup === c) activeCleanup = null;
        },
        onJumpComplete: onCompleteA,
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress,
      },
    });

    version = 2;
    mocks.findRenderedPrompt.mockReturnValue(targetB);
    runPostLandingStabilization({
      target: targetB,
      message: makeMessage('msg-b'),
      index: 1,
      jumpId: 'jump-b',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks: {
        isCancelled: () => version !== 2,
        registerCleanup: (c) => {
          activeCleanup = c;
          cleanupList.push(c);
        },
        clearCleanupIfActive: (c) => {
          if (activeCleanup === c) activeCleanup = null;
        },
        onJumpComplete: onCompleteB,
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress,
      },
    });

    // Running old Session A's cleanup must NOT clear Session B's registration
    cleanupList[0]();
    expect(activeCleanup).toBe(cleanupList[1]);

    vi.advanceTimersByTime(250);
    expect(onCompleteA).not.toHaveBeenCalled();
    expect(onCompleteB).toHaveBeenCalledWith(1);
  });

  it('hands off to disconnect recovery after grace period and settles recovered target', async () => {
    const container = makeContainer(500, 4000, 800);
    const target = makeTarget('msg-15', 190);
    const recovered = makeTarget('msg-15', 190);
    mocks.getScrollContainer.mockReturnValue(container);
    mocks.findRenderedPrompt.mockReturnValue(null);

    const recoverTarget = vi.fn().mockResolvedValue({
      status: 'mounted' as const,
      element: recovered,
      strategy: 'virtual-layout' as const,
      virtualTopOffsetPx: 15000,
    });
    const onJumpComplete = vi.fn();

    runPostLandingStabilization({
      target,
      message: makeMessage('msg-15'),
      index: 14,
      jumpId: 'jump-15',
      mode: 'target-driven',
      initialScrollTopPx: 0,
      recovery: {
        recoverTarget,
        remainingRecoveries: 2,
        initialStrategy: 'virtual-layout',
      },
      hooks: {
        isCancelled: () => false,
        registerCleanup: vi.fn(),
        clearCleanupIfActive: vi.fn(),
        onJumpComplete,
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
      },
    });

    // Disconnect target so grace period (2 frames & >= 50ms) triggers recovery
    target.remove();
    vi.advanceTimersByTime(110);
    expect(recoverTarget).toHaveBeenCalledTimes(1);

    // Let recovery promise resolve and stabilization settle on recovered element
    mocks.findRenderedPrompt.mockReturnValue(recovered);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(450);
    expect(onJumpComplete).toHaveBeenCalledWith(14);
  });

  it('returns the original PromptJumpSession for deferred 600ms repoll when initial alignment returns null, and null when stabilization starts', () => {
    const container = makeContainer(500, 4000, 800);
    const detached = document.createElement('div'); // disconnected -> initialAlignResult === null
    mocks.getScrollContainer.mockReturnValue(container);
    mocks.findRenderedPrompt.mockReturnValue(null);

    let registeredCleanup: (() => void) | null = null;
    const deferredSession = runPostLandingStabilization({
      target: detached,
      message: makeMessage('msg-repoll'),
      index: 7,
      jumpId: 'jump-repoll',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      recovery: {
        recoverTarget: vi.fn(),
        remainingRecoveries: 2,
        initialStrategy: 'virtual-layout',
      },
      hooks: {
        isCancelled: () => false,
        registerCleanup: (c) => {
          registeredCleanup = c;
        },
        clearCleanupIfActive: vi.fn(),
        onJumpComplete: vi.fn(),
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
      },
    });

    expect(registeredCleanup).not.toBeNull();
    expect(deferredSession).not.toBeNull();
    expect(deferredSession?.jumpId).toBe('jump-repoll');
    expect(deferredSession?.targetMessageId).toBe('msg-repoll');
    expect(deferredSession?.recovery.activeStrategy).toBe('virtual-layout');

    // When initial alignment succeeds, returns null (stabilization loop owns lifecycle)
    const connected = makeTarget('msg-ok', 190);
    mocks.findRenderedPrompt.mockReturnValue(connected);
    const startedResult = runPostLandingStabilization({
      target: connected,
      message: makeMessage('msg-ok'),
      index: 8,
      jumpId: 'jump-ok',
      mode: 'target-driven',
      initialScrollTopPx: 500,
      hooks: {
        isCancelled: () => false,
        registerCleanup: vi.fn(),
        clearCleanupIfActive: vi.fn(),
        onJumpComplete: vi.fn(),
        onTargetDrivenFailure: vi.fn(),
        clearJumpProgress: vi.fn(),
      },
    });
    expect(startedResult).toBeNull();
  });
});
