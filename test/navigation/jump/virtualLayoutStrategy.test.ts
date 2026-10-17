/** @vitest-environment jsdom */
/**
 * Tests React virtual-layout jump strategy, Sticky Virtual Mode, and mount waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startDomQuiescenceProgressObserver,
  tryVirtualLayoutStrategy,
  waitForTargetMount,
} from '@/navigation/jump/strategies/virtualLayoutStrategy';
import { JUMP_STRATEGY_CONFIG } from '@/navigation/jump/strategies/config';
import type { VirtualJumpTargetResult } from '@/platforms/platformInterface';
import type {
  VirtualStrategyAttempt,
  VirtualStrategyExecutionResult,
} from '@/navigation/jump/strategies/types';

const mocks = vi.hoisted(() => ({
  findRenderedPrompt: vi.fn(),
  readMountedWithSidebarIdx: vi.fn(),
  queryVirtualJumpTarget: vi.fn(),
  getActivePlatformThrow: { value: false },
  queryVirtualJumpTargetMissing: { value: false },
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => {
    if (mocks.getActivePlatformThrow.value) {
      throw new Error('Platform resolution failed');
    }
    return {
      id: 'chatgpt',
      navigation: {
        findRenderedPrompt: mocks.findRenderedPrompt,
        readMountedWithSidebarIdx: mocks.readMountedWithSidebarIdx,
        queryVirtualJumpTarget: mocks.queryVirtualJumpTargetMissing.value
          ? undefined
          : mocks.queryVirtualJumpTarget,
      },
    };
  },
}));

function createValidTargetResult(): VirtualJumpTargetResult {
  return {
    status: 'ok',
    targetIndex: 1,
    topOffsetPx: 450,
    turnCount: 3,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  mocks.getActivePlatformThrow.value = false;
  mocks.queryVirtualJumpTargetMissing.value = false;
  mocks.findRenderedPrompt.mockReturnValue(null);
  mocks.readMountedWithSidebarIdx.mockReturnValue([]);
  mocks.queryVirtualJumpTarget.mockReturnValue({
    status: 'unavailable',
    reason: 'default-mock',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function assertUnsupported(
  attempt: VirtualStrategyAttempt
): asserts attempt is { readonly mode: 'unsupported'; readonly reason: string } {
  expect(attempt.mode).toBe('unsupported');
  if (attempt.mode !== 'unsupported') {
    throw new Error(`Expected unsupported attempt, got ${attempt.mode}`);
  }
}

function assertVirtual(
  attempt: VirtualStrategyAttempt
): asserts attempt is {
  readonly mode: 'virtual';
  readonly promise: Promise<VirtualStrategyExecutionResult>;
} {
  expect(attempt.mode).toBe('virtual');
  if (attempt.mode !== 'virtual') {
    throw new Error(`Expected virtual attempt, got ${attempt.mode}`);
  }
}

describe('tryVirtualLayoutStrategy — Initial Selection Phase', () => {
  it('returns mode unsupported when virtualLayout config is disabled', () => {
    const container = document.createElement('div');
    const originalEnabled = JUMP_STRATEGY_CONFIG.virtualLayout.enabled;
    (JUMP_STRATEGY_CONFIG.virtualLayout as { enabled: boolean }).enabled = false;

    try {
      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
        targetIndex: 1,
        prompts: [],
        container,
        jumpId: 'test-jump',
        isCancelled: () => false,
      });

      assertUnsupported(attempt);
      expect(attempt.reason).toBe('config-disabled');
      expect(mocks.queryVirtualJumpTarget).not.toHaveBeenCalled();
    } finally {
      (JUMP_STRATEGY_CONFIG.virtualLayout as { enabled: boolean }).enabled = originalEnabled;
    }
  });

  it('returns mode virtual resolving cancelled when pre-cancelled', async () => {
    const container = document.createElement('div');
    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => true,
    });

    assertVirtual(attempt);
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('cancelled');
    expect(mocks.queryVirtualJumpTarget).not.toHaveBeenCalled();
  });

  it('returns mode unsupported when platform resolution throws', () => {
    const container = document.createElement('div');
    mocks.getActivePlatformThrow.value = true;

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('platform-resolution-failed');
  });

  it('returns mode unsupported when queryVirtualJumpTarget is missing', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTargetMissing.value = true;

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('bridge-unavailable');
  });

  it('returns mode unsupported when queryVirtualJumpTarget throws', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockImplementation(() => {
      throw new Error('Host query threw error');
    });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('bridge-query-threw');
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledWith(container, 'msg-2');
  });

  it('returns mode unsupported when layout is unavailable', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'unavailable',
      reason: 'bridge-not-installed',
    });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('bridge-unavailable');
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledWith(container, 'msg-2');
  });

  it('returns mode unsupported when queryVirtualJumpTarget returns null or malformed at runtime', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockReturnValue(null as any);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('bridge-result-invalid');
  });

  it('returns mode unsupported when direction is newer/down (+1)', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });
    // Mounted prompt at index 5. Target index 10 => 10 > 5 => direction +1 (newer)
    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 5, unitKey: 'k-5' },
    ]);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-target', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 10,
      prompts: [
        { id: 'msg-5', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-target', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('downward-virtual-pagination-unimplemented');
  });

  it('returns mode unsupported when direction is unknown (no mounted prompts)', () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });
    mocks.readMountedWithSidebarIdx.mockReturnValue([]);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-target', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [{ id: 'msg-target', text: '', canMatchByText: true, createTime: 0 }],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertUnsupported(attempt);
    expect(attempt.reason).toBe('unknown-direction');
  });

  it('locks mode virtual when target-not-in-layout and direction is older (-1)', () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn();
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });
    // Mounted prompt at index 10. Target index 0 => 0 < 10 => direction -1 (older)
    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 10, unitKey: 'k-10' },
    ]);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-10', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
  });

  it('locks mode virtual when initial status is ok', () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn();
    mocks.queryVirtualJumpTarget.mockReturnValue(createValidTargetResult());

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
  });
});

describe('tryVirtualLayoutStrategy — Direct Virtual Jump', () => {
  it('executes exactly one coarse scrollTo with topOffsetPx and mounts target', async () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn();
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 5,
      topOffsetPx: 1200,
      turnCount: 20,
    });

    const targetElement = document.createElement('div');
    mocks.findRenderedPrompt.mockReturnValue(targetElement);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    expect(container.scrollTo).toHaveBeenCalledOnce();
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 1200,
      behavior: 'auto',
    });

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }
  });

  it('resolves capability-failure when topOffsetPx is invalid', async () => {
    const container = document.createElement('div');
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 1,
      topOffsetPx: NaN,
      turnCount: 3,
    });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('capability-failure');
  });

  it('resolves exhausted when target fails to mount within mountTimeoutMs after coarse scroll (NO walker fallback)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.scrollTo = vi.fn();
    mocks.queryVirtualJumpTarget.mockReturnValue(createValidTargetResult());
    mocks.findRenderedPrompt.mockReturnValue(null);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(1100);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('exhausted');
    if (outcome.status === 'exhausted') {
      expect(outcome.reason).toBe('target-mount-timeout');
    }
    container.remove();
  });

  it('resolves cancelled when jump is cancelled during mount wait after coarse scroll', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.scrollTo = vi.fn();
    mocks.queryVirtualJumpTarget.mockReturnValue(createValidTargetResult());
    mocks.findRenderedPrompt.mockReturnValue(null);

    let cancelled = false;
    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => cancelled,
    });

    assertVirtual(attempt);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(100);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('cancelled');
    container.remove();
  });

  it('resolves exhausted safely when container.scrollTo throws during direct jump', async () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn(() => {
      throw new Error('Direct scroll blocked by host');
    });
    mocks.queryVirtualJumpTarget.mockReturnValue(createValidTargetResult());

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 1,
      prompts: [],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('exhausted');
    if (outcome.status === 'exhausted') {
      expect(outcome.reason).toBe('container-scroll-threw');
    }
  });
});

describe('waitForTargetMount', () => {
  it('resolves immediately if target is already mounted', async () => {
    const container = document.createElement('div');
    const target = document.createElement('div');
    mocks.findRenderedPrompt.mockReturnValue(target);

    const promise = waitForTargetMount('msg-1', container, () => false, 1000);
    const result = await promise;

    expect(result).toBe(target);
  });

  it('resolves null if pre-cancelled', async () => {
    const container = document.createElement('div');
    const promise = waitForTargetMount('msg-1', container, () => true, 1000);
    const result = await promise;

    expect(result).toBeNull();
  });

  it('resolves target element when mounted via MutationObserver callback', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let observerCallback: MutationCallback | null = null;
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      }
    );

    const promise = waitForTargetMount('msg-2', container, () => false, 1000);

    const target = document.createElement('div');
    mocks.findRenderedPrompt.mockReturnValue(target);

    // Trigger mutation callback
    observerCallback!([], {} as any);

    const result = await promise;
    expect(result).toBe(target);

    vi.unstubAllGlobals();
    container.remove();
  });

  it('resolves null when mount wait times out after mountTimeoutMs', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const promise = waitForTargetMount('msg-2', container, () => false, 1000);

    // Fast-forward past timeout
    await vi.advanceTimersByTimeAsync(1100);

    const result = await promise;
    expect(result).toBeNull();

    container.remove();
  });

  it('resolves null without throwing when MutationObserver throws an error', async () => {
    const container = document.createElement('div');
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {
          throw new Error('Host observation blocked');
        }
        disconnect() {}
      }
    );

    const promise = waitForTargetMount('msg-1', container, () => false, 1000);
    const result = await promise;

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('startDomQuiescenceProgressObserver', () => {
  it('handles 53ms regression: continues observing after premature quiescence until subsequent growth resolves progress', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Initial check: turnCount 50
    // Burst 1 (at 43ms + 10ms quiet = 53ms): turnCount 50 -> 50 (incidental mutation)
    // Burst 2 (at 200ms + 10ms quiet = 210ms): turnCount 50 -> 100 (actual history prepend)
    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({
        status: 'target-not-in-layout',
        turnCount: 50,
      })
      .mockReturnValue({
        status: 'target-not-in-layout',
        turnCount: 100,
      });

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
    });

    // Burst 1: DOM mutation at 43ms
    await vi.advanceTimersByTimeAsync(43);
    document.body.appendChild(document.createElement('span'));

    // Debounce window (10ms) expires at t = 53ms
    await vi.advanceTimersByTimeAsync(10);

    // Bridge query 1 ran, reported 50 -> 50. Session must still be pending!
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledOnce();

    // Burst 2: DOM mutation at 200ms
    await vi.advanceTimersByTimeAsync(147);
    document.body.appendChild(document.createElement('div'));

    // Debounce window (10ms) expires at t = 210ms
    await vi.advanceTimersByTimeAsync(10);

    // Bridge query 2 ran, reported 50 -> 100. Session now resolves progress!
    const outcome = await session.promise;
    expect(outcome.status).toBe('progress');
    if (outcome.status === 'progress') {
      expect(outcome.result.turnCount).toBe(100);
    }

    container.remove();
  });

  it('wakes and resolves cancelled within 100ms when idle and no DOM mutations occur', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let cancelled = false;
    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => cancelled,
    });

    // Observer is attached, but no DOM mutations occur
    cancelled = true;

    // Advance 100ms for lightweight cancellation wake-up interval
    await vi.advanceTimersByTimeAsync(100);

    const outcome = await session.promise;
    expect(outcome.status).toBe('cancelled');
    // Bridge must never have been queried for cancellation
    expect(mocks.queryVirtualJumpTarget).not.toHaveBeenCalled();

    container.remove();
  });

  it('resolves timeout when 1500ms budget expires without progress', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
    });

    // Advance 1500ms total budget
    await vi.advanceTimersByTimeAsync(1500);

    const outcome = await session.promise;
    expect(outcome.status).toBe('timeout');

    container.remove();
  });

  it('disposes cleanly and aborts when dispose() is called manually', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
    });

    session.dispose();
    const outcome = await session.promise;
    expect(outcome.status).toBe('cancelled');

    container.remove();
  });
});

describe('Sticky Older-History Virtual Pagination', () => {
  it('executes older pagination: scrolls to top once, awaits settle, then scrolls to final target', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);
    container.scrollTo = vi.fn();

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 10, unitKey: 'k-10' },
    ]);

    // Query 1: initial target-not-in-layout (turnCount 50)
    // Query 2 (after settle): ok (turnCount 150, topOffsetPx 1200)
    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({
        status: 'target-not-in-layout',
        turnCount: 50,
      })
      .mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 1200,
        turnCount: 150,
      });

    const targetElement = document.createElement('div');
    targetElement.id = 'target-el';

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-10', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

    mocks.findRenderedPrompt.mockReturnValue(targetElement);

    // Host mutations occur and debounce settles
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }

    // Exactly one boundary scroll (top: 0) and one target scroll (top: 1200)
    expect(container.scrollTo).toHaveBeenCalledTimes(2);
    expect(container.scrollTo).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'auto' });
    expect(container.scrollTo).toHaveBeenNthCalledWith(2, { top: 1200, behavior: 'auto' });

    container.remove();
  });

  it('executes multiple prepend cycles until target appears (50 -> 100 -> 150)', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);
    container.scrollTo = vi.fn();

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 20, unitKey: 'k-20' },
    ]);

    // Initial query: turnCount 50
    // Cycle 1 settle -> Query 2: turnCount 100 (target-not-in-layout)
    // Cycle 2 settle -> Query 3: turnCount 150 (ok, topOffsetPx 850)
    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({
        status: 'target-not-in-layout',
        turnCount: 50,
      })
      .mockReturnValueOnce({
        status: 'target-not-in-layout',
        turnCount: 100,
      })
      .mockReturnValue({
        status: 'ok',
        targetIndex: 0,
        topOffsetPx: 850,
        turnCount: 150,
      });

    const targetElement = document.createElement('div');
    mocks.findRenderedPrompt.mockReturnValue(targetElement);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-20', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    // Cycle 1 boundary scroll
    expect(container.scrollTo).toHaveBeenCalledTimes(1);
    expect(container.scrollTo).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'auto' });

    // Host mutations occur during cycle 1
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    // Cycle 2 boundary scroll triggered after cycle 1 settle
    expect(container.scrollTo).toHaveBeenCalledTimes(2);
    expect(container.scrollTo).toHaveBeenNthCalledWith(2, { top: 0, behavior: 'auto' });

    // Host mutations occur during cycle 2
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    // Target mounts and final target scroll triggered after cycle 2 settle
    expect(container.scrollTo).toHaveBeenCalledTimes(3);
    expect(container.scrollTo).toHaveBeenNthCalledWith(3, { top: 850, behavior: 'auto' });

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }

    container.remove();
  });

  it('resolves exhausted without walker fallback when 1500ms expires without turnCount growth', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);
    container.scrollTo = vi.fn();

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 10, unitKey: 'k-10' },
    ]);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-10', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(1500);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('exhausted');

    container.remove();
  });

  it('resolves capability-failure when bridge returns unavailable mid-pagination', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);
    container.scrollTo = vi.fn();

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 10, unitKey: 'k-10' },
    ]);

    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({
        status: 'target-not-in-layout',
        turnCount: 50,
      })
      .mockReturnValue({
        status: 'unavailable',
        reason: 'bridge-disconnected',
      });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-10', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('capability-failure');

    container.remove();
  });

  it('resolves exhausted cleanly when container.scrollTo throws during boundary scroll', async () => {
    const container = document.createElement('div');
    container.scrollTo = vi.fn(() => {
      throw new Error('Scroll to top failed');
    });

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 10, unitKey: 'k-10' },
    ]);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50,
    });

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-10', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('exhausted');
  });
});
