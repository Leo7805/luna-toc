/** @vitest-environment jsdom */
/**
 * Tests React virtual-layout jump strategy, Sticky Virtual Mode, and mount waiting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startDomQuiescenceProgressObserver,
  tryVirtualLayoutStrategy,
  waitForTargetMount,
  stimulateTopBoundary,
  getLowestMountedConnectedIndex,
} from '@/navigation/jump/strategies/virtualLayoutStrategy';
import { JUMP_STRATEGY_CONFIG } from '@/navigation/jump/strategies/config';
import { DOM_SETTLE_CONFIG } from '@/navigation/jump/domSettle';
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

    // Because minQuerySpacingMs is 250ms and Burst 1 ran at 53ms,
    // Burst 2 query is scheduled for t = 303ms (250ms after Query 1).
    // Advance timers past minQuerySpacingMs window
    await vi.advanceTimersByTimeAsync(100);

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

  it('resolves timeout when 8000ms no-progress watchdog budget expires without progress', async () => {
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
      timeoutMs: 8000,
    });

    // Advance beyond 8000ms total watchdog budget
    await vi.advanceTimersByTimeAsync(8100);

    const outcome = await session.promise;
    expect(outcome.status).toBe('timeout');

    container.remove();
  });

  it('observes past 1500ms and resolves progress when growth occurs at 4000ms', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 100,
    });

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
      pollIntervalMs: 0, // disable poll to test mutation trigger specifically
    });

    // No activity at 1500ms (legacy timeout threshold)
    await vi.advanceTimersByTimeAsync(1500);

    // Mutation occurs at 4000ms
    await vi.advanceTimersByTimeAsync(2500);
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    const outcome = await session.promise;
    expect(outcome.status).toBe('progress');
    if (outcome.status === 'progress') {
      expect(outcome.result.turnCount).toBe(100);
    }

    container.remove();
  });

  it('detects growth via 2000ms fallback polling when DOM mutations are completely absent', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

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
      pollIntervalMs: 2000,
    });

    // No DOM mutations occur at all.
    // Poll 1 fires at 2000ms -> turnCount 50 (no progress)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledOnce();

    // Poll 2 fires at 4000ms -> turnCount 100 (progress!)
    await vi.advanceTimersByTimeAsync(2000);

    const outcome = await session.promise;
    expect(outcome.status).toBe('progress');
    if (outcome.status === 'progress') {
      expect(outcome.result.turnCount).toBe(100);
    }

    container.remove();
  });

  it('final query at 8000ms watchdog deadline resolves progress if layout expanded right at boundary', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    mocks.queryVirtualJumpTarget.mockImplementation(() => ({
      status: 'target-not-in-layout',
      turnCount: 100,
    }));

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
      pollIntervalMs: 0,
      timeoutMs: 8000,
    });

    // Fast-forward to 8000ms watchdog deadline
    await vi.advanceTimersByTimeAsync(8000);

    const outcome = await session.promise;
    expect(outcome.status).toBe('progress');
    if (outcome.status === 'progress') {
      expect(outcome.result.turnCount).toBe(100);
    }

    container.remove();
  });

  it('final query at 8000ms watchdog deadline resolves ok if target appeared in layout', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 0,
      topOffsetPx: 600,
      turnCount: 100,
    });

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-0',
      previousTurnCount: 50,
      isCancelled: () => false,
      pollIntervalMs: 0,
      timeoutMs: 8000,
    });

    // Fast-forward to 8000ms watchdog deadline
    await vi.advanceTimersByTimeAsync(8000);

    const outcome = await session.promise;
    expect(outcome.status).toBe('ok');

    container.remove();
  });

  it('throttles rapid mutation bursts to minQuerySpacingMs and preserves pending check', async () => {
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
      pollIntervalMs: 0,
      minQuerySpacingMs: 250,
    });

    // Burst 1 at 0ms, settles at 10ms -> Query 1 runs immediately
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(1);

    // Burst 2 at 50ms, settles at 60ms (only 50ms since Query 1 < 250ms spacing)
    await vi.advanceTimersByTimeAsync(40);
    document.body.appendChild(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(10);
    // Must NOT have run query 2 yet (throttled)
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(1);

    // Advance to 260ms (250ms after Query 1) -> Query 2 runs!
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(2);

    session.dispose();
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

  it('recognizes progress when turnCount is constant but connected DOM elements move closer to target with exact debounce timing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const promptEl = document.createElement('div');
    promptEl.setAttribute('data-chatgpt-search-message-ids', 'msg-10');
    promptEl.setAttribute('data-chatgpt-search-unit-key', 'msg-10:user');
    container.appendChild(promptEl);

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: promptEl, sidebarIdx: 10, unitKey: 'msg-10:user' },
    ]);

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'target-not-in-layout',
      turnCount: 50, // Constant turn count!
    });

    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId: 'msg-1',
      prompts: [{ id: 'msg-1' }, { id: 'msg-10' }, { id: 'msg-20' }],
      previousLowestIndex: 20,
      previousTurnCount: 50,
      isCancelled: () => false,
      minQuerySpacingMs: 0,
    });

    // Trigger MutationObserver
    container.appendChild(document.createElement('span'));

    // Before debounceMs, session remains pending and query has not fired
    await vi.advanceTimersByTimeAsync(DOM_SETTLE_CONFIG.debounceMs - 2);
    expect(mocks.queryVirtualJumpTarget).not.toHaveBeenCalled();

    // Exactly at debounceMs, query executes and resolves progress
    await vi.advanceTimersByTimeAsync(2);
    expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledOnce();

    const outcome = await session.promise;
    expect(outcome.status).toBe('progress');

    container.remove();
  });

  it('ignores disconnected DOM elements when calculating lowest mounted index', () => {
    const detachedEl = document.createElement('div');
    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: detachedEl, sidebarIdx: 5, unitKey: 'msg-5:user' },
    ]);

    const lowest = getLowestMountedConnectedIndex(
      [{ id: 'msg-1' }, { id: 'msg-5' }],
      document
    );
    expect(lowest).toBeNull();
  });

  it('stimulates boundary with non-zero pulse and frame wait when scrollTop is at 0', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 10000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
    container.scrollTop = 0;
    document.body.appendChild(container);

    const scrollHistory: Array<{ value: number; time: number }> = [];
    Object.defineProperty(container, 'scrollTop', {
      get: () => (scrollHistory.length > 0 ? scrollHistory[scrollHistory.length - 1].value : 0),
      set: (val: number) => {
        scrollHistory.push({ value: val, time: performance.now() });
      },
      configurable: true,
    });
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number, _y?: number) => {
      const top = typeof opts === 'number' ? opts : (opts?.top ?? 0);
      scrollHistory.push({ value: top, time: performance.now() });
    }) as unknown as HTMLElement['scrollTo'];

    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });

    const pulsePromise = stimulateTopBoundary(container, () => false);

    // Advance timers past both double-rAF frame cycles
    await vi.advanceTimersByTimeAsync(200);
    await pulsePromise;

    // Verify sequence: pulse to 32, then return to 0 asynchronously
    expect(scrollHistory).toHaveLength(2);
    expect(scrollHistory[0].value).toBe(32);
    expect(scrollHistory[1].value).toBe(0);
    expect(scrollHistory[1].time).toBeGreaterThan(scrollHistory[0].time);

    window.requestAnimationFrame = originalRaf;
    container.remove();
  });

  it('aborts boundary stimulation early if cancelled during frame wait', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 10000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
    container.scrollTop = 0;
    document.body.appendChild(container);

    let cancelled = false;
    const scrollHistory: number[] = [];
    Object.defineProperty(container, 'scrollTop', {
      get: () => 0,
      set: (val: number) => scrollHistory.push(val),
      configurable: true,
    });
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number, _y?: number) => {
      const top = typeof opts === 'number' ? opts : (opts?.top ?? 0);
      scrollHistory.push(top);
    }) as unknown as HTMLElement['scrollTo'];

    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });

    const promise = stimulateTopBoundary(container, () => cancelled);

    // Cancel while waiting for first frame
    cancelled = true;
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    // Pulse write happened, but return-to-zero scroll was aborted due to cancellation
    expect(scrollHistory).toEqual([32]);

    window.requestAnimationFrame = originalRaf;
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

  it('resolves exhausted without walker fallback when 8000ms expires without turnCount growth', async () => {
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
    await vi.advanceTimersByTimeAsync(20100);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('exhausted');
    if (outcome.status === 'exhausted') {
      expect(outcome.reason).toBe('no-progress-timeout');
    }

    container.remove();
  });

  it('completes multi-batch pagination exceeding 6000ms total without timing out', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    document.body.appendChild(container);
    container.scrollTo = vi.fn();

    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 30, unitKey: 'k-30' },
    ]);

    // Initial query at t = 0: turnCount 50
    // Batch 1: at t = 3000ms, turnCount 100
    // Batch 2: at t = 6000ms, turnCount 150 (target found!)
    let turnCount = 50;
    mocks.queryVirtualJumpTarget.mockImplementation(() => {
      if (turnCount >= 150) {
        return {
          status: 'ok',
          targetIndex: 0,
          topOffsetPx: 500,
          turnCount: 150,
        };
      }
      return {
        status: 'target-not-in-layout',
        turnCount,
      };
    });

    const targetElement = document.createElement('div');
    mocks.findRenderedPrompt.mockReturnValue(targetElement);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-0', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-30', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-jump',
      isCancelled: () => false,
    });

    assertVirtual(attempt);

    // Batch 1: 3000ms elapses (past legacy 1500ms!), then layout grows to 100
    await vi.advanceTimersByTimeAsync(3000);
    turnCount = 100;
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    // Batch 2: another 3000ms elapses (total 6010ms!), then target appears
    await vi.advanceTimersByTimeAsync(3000);
    turnCount = 150;
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }

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

  it('refines cold-start direct virtual jump by re-querying updated topOffsetPx when initial estimate misses target', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 53648, configurable: true });
    document.body.appendChild(container);
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        container.scrollTop = opts.top;
      }
    });

    const targetElement = document.createElement('div');
    // Initial query returns stale cold-start estimate (9975); after scrolling there,
    // ChatGPT measures turns and re-query returns refined offset (2527).
    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({
        status: 'ok',
        targetIndex: 2,
        topOffsetPx: 9975,
        turnCount: 108,
      })
      .mockReturnValue({
        status: 'ok',
        targetIndex: 2,
        topOffsetPx: 2527,
        turnCount: 108,
      });

    mocks.findRenderedPrompt.mockImplementation(() =>
      container.scrollTop === 2527 ? targetElement : null
    );

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-3', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 2,
      prompts: [
        { id: 'msg-1', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-2', text: '', canMatchByText: true, createTime: 0 },
        { id: 'msg-3', text: '', canMatchByText: true, createTime: 0 },
      ],
      container,
      jumpId: 'test-cold-refine',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    expect(container.scrollTo).toHaveBeenNthCalledWith(1, { top: 9975, behavior: 'auto' });

    // Advance past first 350ms refinement wait -> re-queries and scrolls to refined 2527 -> mounts!
    await vi.advanceTimersByTimeAsync(400);

    expect(container.scrollTo).toHaveBeenNthCalledWith(2, { top: 2527, behavior: 'auto' });
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }

    container.remove();
  });

  it('nudges toward mounted-window direction when direct jump lands nearby and topOffsetPx has not shifted yet', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 70000, configurable: true });
    document.body.appendChild(container);
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        container.scrollTop = opts.top;
      }
    });

    const targetElement = document.createElement('div');
    // Stays at 29419 even after first scroll; mounted prompts show #32 (> target #30 => direction -1)
    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 29,
      topOffsetPx: 29419,
      turnCount: 108,
    });
    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 31, unitKey: 'k-31' },
    ]);
    mocks.findRenderedPrompt.mockImplementation(() =>
      container.scrollTop < 29000 ? targetElement : null
    );

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-30', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 29,
      prompts: Array.from({ length: 35 }, (_, i) => ({
        id: `msg-${i + 1}`,
        text: '',
        canMatchByText: true,
        createTime: 0,
      })),
      container,
      jumpId: 'test-nudge',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(400);

    expect(container.scrollTop).toBeLessThan(29000);
    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    container.remove();
  });

  it('refines estimated topOffsetPx after older-history pagination discovers target (cold-start Item #3 regression)', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 53648, configurable: true });
    container.scrollTop = 17487;
    document.body.appendChild(container);
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        container.scrollTop = opts.top;
      }
    });

    const targetElement = document.createElement('div');
    mocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: document.createElement('div'), sidebarIdx: 58, unitKey: 'k-58' },
    ]);

    // Query 1: target-not-in-layout -> triggers pagination scroll to top: 0
    // Query 2 (after pagination settle): ok with stale cold-start estimate 9975
    // Query 3 (after scrolling to 9975 & refining): ok with measured offset 2527 -> mounts!
    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({ status: 'target-not-in-layout', turnCount: 50 })
      .mockReturnValueOnce({ status: 'ok', targetIndex: 2, topOffsetPx: 9975, turnCount: 108 })
      .mockReturnValue({ status: 'ok', targetIndex: 2, topOffsetPx: 2527, turnCount: 108 });

    mocks.findRenderedPrompt.mockImplementation(() =>
      container.scrollTop === 2527 ? targetElement : null
    );

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-3', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 2,
      prompts: Array.from({ length: 60 }, (_, i) => ({
        id: `msg-${i + 1}`,
        text: '',
        canMatchByText: true,
        createTime: 0,
      })),
      container,
      jumpId: 'test-paginated-refine',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    document.body.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(400);

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 9975, behavior: 'auto' });
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 2527, behavior: 'auto' });

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(targetElement);
    }

    container.remove();
  });

  it('detects cold-start host viewport drift (scrollTop 0 -> 4961 while topOffsetPx remains 0) and re-scrolls to mount Prompt #1', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 31798, configurable: true });
    container.scrollTop = 16331;
    document.body.appendChild(container);

    let scrollCount = 0;
    const prompt1 = document.createElement('div');
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        scrollCount += 1;
        container.scrollTop = opts.top;
        if (scrollCount === 1) {
          // Simulate ChatGPT native viewport compensation pushing scrollTop to 4961px at ~246ms
          setTimeout(() => {
            container.scrollTop = 4961;
          }, 200);
        } else if (scrollCount === 2 && opts.top === 0) {
          // Second scrollTo(0) lands cleanly and mounts Prompt #1
          container.appendChild(prompt1);
          mocks.findRenderedPrompt.mockReturnValue(prompt1);
        }
      }
    });

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 0,
      topOffsetPx: 0,
      turnCount: 33,
    });
    mocks.findRenderedPrompt.mockReturnValue(null);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-1', text: 'good to see you', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [
        { id: 'msg-1', text: 'good to see you', canMatchByText: true, createTime: 0 },
        { id: 'msg-2', text: 'What is react?', canMatchByText: true, createTime: 1 },
        { id: 'msg-3', text: 'Counter', canMatchByText: true, createTime: 2 },
      ],
      container,
      jumpId: 'test-cold-start-top-drift',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(450);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(prompt1);
    }
    expect(container.scrollTo).toHaveBeenCalledTimes(2);
    expect(container.scrollTo).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'auto' });
    expect(container.scrollTo).toHaveBeenNthCalledWith(2, { top: 0, behavior: 'auto' });
    expect(container.scrollTop).toBe(0);

    container.remove();
  });

  it('bounds repeated viewport drift retries without looping indefinitely', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 31798, configurable: true });
    container.scrollTop = 10000;
    document.body.appendChild(container);

    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        container.scrollTop = opts.top;
        setTimeout(() => {
          container.scrollTop = 4961;
        }, 100);
      }
    });

    mocks.queryVirtualJumpTarget.mockReturnValue({
      status: 'ok',
      targetIndex: 0,
      topOffsetPx: 0,
      turnCount: 33,
    });
    mocks.findRenderedPrompt.mockReturnValue(null);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-1', text: '', canMatchByText: true, createTime: 0 },
      targetIndex: 0,
      prompts: [{ id: 'msg-1', text: '', canMatchByText: true, createTime: 0 }],
      container,
      jumpId: 'test-bounded-drift',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(5000);

    const outcome = await attempt.promise;
    expect(outcome).toEqual({ status: 'exhausted', reason: 'target-mount-timeout' });
    // Bounded by 1 initial + 4 refinements = 5 scroll writes max
    expect(container.scrollTo).toHaveBeenCalledTimes(5);

    container.remove();
  });

  it('detects transient mount followed by immediate host-drift disconnection and refines to updated topOffsetPx', async () => {
    const container = document.createElement('div');
    container.className = 'thread-scroll-container';
    Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 120000, configurable: true });
    container.scrollTop = 0;
    document.body.appendChild(container);

    const transientEl = document.createElement('div');
    const stableEl = document.createElement('div');
    let scrollCount = 0;

    container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (typeof opts === 'object' && typeof opts?.top === 'number') {
        scrollCount += 1;
        container.scrollTop = opts.top;
        if (scrollCount === 1) {
          // Cold-start underestimate: host compensation asynchronously jumps
          // scrollTop to 17277, mounts #15 transiently, then unmounts it before
          // the next rendered frame.
          setTimeout(() => {
            container.scrollTop = 17277;
            container.appendChild(transientEl);
            mocks.findRenderedPrompt.mockReturnValueOnce(transientEl);
            setTimeout(() => {
              transientEl.remove();
              mocks.findRenderedPrompt.mockReturnValue(null);
            }, 10);
          }, 5);
        } else if (scrollCount === 2 && opts.top === 15604) {
          // Refined jump mounts #15 stably
          container.appendChild(stableEl);
          mocks.findRenderedPrompt.mockReturnValue(stableEl);
        }
      }
    });

    mocks.queryVirtualJumpTarget
      .mockReturnValueOnce({ status: 'ok', targetIndex: 14, topOffsetPx: 10027.5, turnCount: 123 })
      .mockReturnValue({ status: 'ok', targetIndex: 14, topOffsetPx: 15604, turnCount: 123 });
    mocks.findRenderedPrompt.mockReturnValue(null);

    const attempt = tryVirtualLayoutStrategy({
      targetMessage: { id: 'msg-15', text: '', canMatchByText: true, createTime: 14 },
      targetIndex: 14,
      prompts: Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i + 1}`,
        text: '',
        canMatchByText: true,
        createTime: i,
      })),
      container,
      jumpId: 'test-transient-mount-disconnect',
      isCancelled: () => false,
    });

    assertVirtual(attempt);
    await vi.advanceTimersByTimeAsync(200);

    const outcome = await attempt.promise;
    expect(outcome.status).toBe('mounted');
    if (outcome.status === 'mounted') {
      expect(outcome.element).toBe(stableEl);
      expect(outcome.topOffsetPx).toBe(15604);
    }
    expect(container.scrollTo).toHaveBeenCalledTimes(2);
    expect(container.scrollTo).toHaveBeenNthCalledWith(1, { top: 10027.5, behavior: 'auto' });
    expect(container.scrollTo).toHaveBeenNthCalledWith(2, { top: 15604, behavior: 'auto' });

    container.remove();
  });

  describe('Bounded Successor-Anchor Recovery', () => {
    const makePrompts = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `msg-${i + 1}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i,
      }));

    const makeContainer = (scrollHeight = 130000) => {
      const container = document.createElement('div');
      container.className = 'thread-scroll-container';
      Object.defineProperty(container, 'clientHeight', { value: 907, configurable: true });
      Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
      container.scrollTop = 0;
      document.body.appendChild(container);
      return container;
    };

    it('recovers via 1-hop successor anchor (#15 via #16) when direct jump is ejected downward at stagnant offset', async () => {
      const container = makeContainer();
      const el15 = document.createElement('div');
      const el16 = document.createElement('div');
      let mounted15 = false;
      let mounted16 = false;

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top === 11230.5) {
            // Direct jump to #15 gets ejected downward to 20555 while #15 unmounts
            setTimeout(() => {
              container.scrollTop = 20555;
            }, 10);
          } else if (opts.top === 11754) {
            // Anchor jump to #16 stably mounts #16 AND #15 above it
            setTimeout(() => {
              container.scrollTop = 22472;
              container.appendChild(el15);
              container.appendChild(el16);
              mounted15 = true;
              mounted16 = true;
            }, 10);
          }
        }
      });

      mocks.queryVirtualJumpTarget.mockImplementation((_c, id: string) => {
        if (id === 'msg-15') {
          return {
            status: 'ok',
            targetIndex: 14,
            topOffsetPx: mounted15 ? 13778 : 11230.5,
            turnCount: 125,
          };
        }
        if (id === 'msg-16') {
          return { status: 'ok', targetIndex: 15, topOffsetPx: 11754, turnCount: 125 };
        }
        return { status: 'unavailable' };
      });
      mocks.findRenderedPrompt.mockImplementation((id: string) => {
        if (id === 'msg-15' && mounted15) return el15;
        if (id === 'msg-16' && mounted16) return el16;
        return null;
      });

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-15', text: 'Prompt 15', canMatchByText: true, createTime: 14 },
        targetIndex: 14,
        prompts: makePrompts(20),
        container,
        jumpId: 'test-1hop-anchor',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(1000);

      const outcome = await attempt.promise;
      expect(outcome.status).toBe('mounted');
      if (outcome.status === 'mounted') {
        expect(outcome.element).toBe(el15);
        expect(outcome.topOffsetPx).toBe(13778);
      }
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 11230.5, behavior: 'auto' });
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 11754, behavior: 'auto' });
      container.remove();
    });

    it('recovers via 2-hop successor anchor (#14 via #16 -> #15) when immediate successor (#15) is also ejected', async () => {
      const container = makeContainer();
      const el14 = document.createElement('div');
      const el15 = document.createElement('div');
      const el16 = document.createElement('div');
      let mounted14 = false;
      let mounted15 = false;
      let mounted16 = false;

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top === 23792) {
            // Direct #14 jump ejected downward
            setTimeout(() => { container.scrollTop = 36000; }, 10);
          } else if (opts.top === 24462) {
            // Hop 1 (#15) is also ejected downward without mounting
            setTimeout(() => { container.scrollTop = 36469; }, 10);
          } else if (opts.top === 24848) {
            // Hop 2 (#16) mounts #16 + #15 above it (but #14 still one turn further up)
            setTimeout(() => {
              container.scrollTop = 34716;
              container.appendChild(el15);
              container.appendChild(el16);
              mounted15 = true;
              mounted16 = true;
            }, 10);
          } else if (opts.top === 26022) {
            // Step-back to measured #15 mounts #14 stably
            setTimeout(() => {
              container.scrollTop = 26022;
              container.appendChild(el14);
              mounted14 = true;
            }, 10);
          }
        }
      });

      mocks.queryVirtualJumpTarget.mockImplementation((_c, id: string) => {
        if (id === 'msg-14') {
          return { status: 'ok', targetIndex: 13, topOffsetPx: mounted14 ? 27774.5 : 23792, turnCount: 125 };
        }
        if (id === 'msg-15') {
          return { status: 'ok', targetIndex: 14, topOffsetPx: mounted15 ? 26022 : 24462, turnCount: 125 };
        }
        if (id === 'msg-16') {
          return { status: 'ok', targetIndex: 15, topOffsetPx: 24848, turnCount: 125 };
        }
        return { status: 'unavailable' };
      });
      mocks.findRenderedPrompt.mockImplementation((id: string) => {
        if (id === 'msg-14' && mounted14) return el14;
        if (id === 'msg-15' && mounted15) return el15;
        if (id === 'msg-16' && mounted16) return el16;
        return null;
      });

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-14', text: 'Prompt 14', canMatchByText: true, createTime: 13 },
        targetIndex: 13,
        prompts: makePrompts(20),
        container,
        jumpId: 'test-2hop-anchor',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(2000);

      const outcome = await attempt.promise;
      expect(outcome.status).toBe('mounted');
      if (outcome.status === 'mounted') {
        expect(outcome.element).toBe(el14);
        expect(outcome.topOffsetPx).toBe(27774.5);
      }
      container.remove();
    });

    it('rejects a target that mounts momentarily during anchor recovery and disconnects before stability verification', async () => {
      const container = makeContainer();
      const el15 = document.createElement('div');
      const el16 = document.createElement('div');
      let mounted15 = false;
      let mounted16 = false;

      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top === 11230.5) {
            setTimeout(() => { container.scrollTop = 20555; }, 10);
          } else if (opts.top === 11754) {
            setTimeout(() => {
              container.appendChild(el15);
              container.appendChild(el16);
              mounted15 = true;
              mounted16 = true;
              // Target #15 disconnects during the rendered-frame verification window!
              setTimeout(() => {
                el15.remove();
                mounted15 = false;
              }, 20);
            }, 10);
          }
        }
      });

      mocks.queryVirtualJumpTarget.mockImplementation((_c, id: string) => {
        if (id === 'msg-15') return { status: 'ok', targetIndex: 14, topOffsetPx: 11230.5, turnCount: 125 };
        if (id === 'msg-16') return { status: 'ok', targetIndex: 15, topOffsetPx: 11754, turnCount: 125 };
        return { status: 'unavailable' };
      });
      mocks.findRenderedPrompt.mockImplementation((id: string) => {
        if (id === 'msg-15' && mounted15) return el15;
        if (id === 'msg-16' && mounted16) return el16;
        return null;
      });

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-15', text: 'Prompt 15', canMatchByText: true, createTime: 14 },
        targetIndex: 14,
        prompts: makePrompts(16), // Only 1 successor (#16)
        container,
        jumpId: 'test-momentary-disconnect',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(2000);

      const outcome = await attempt.promise;
      expect(outcome).toEqual({ status: 'exhausted', reason: 'target-mount-timeout' });
      container.remove();
    });

    it('never activates successor anchor for the Last Prompt (no valid successor)', async () => {
      const container = makeContainer();
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const requestedTop = opts.top;
          container.scrollTop = requestedTop;
          setTimeout(() => { container.scrollTop = requestedTop + 3000; }, 10);
        }
      });

      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 19,
        topOffsetPx: 50000,
        turnCount: 20,
      });
      mocks.findRenderedPrompt.mockReturnValue(null);

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-20', text: 'Last', canMatchByText: true, createTime: 19 },
        targetIndex: 19,
        prompts: makePrompts(20),
        container,
        jumpId: 'test-last-no-successor',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(3500);

      const outcome = await attempt.promise;
      expect(outcome).toEqual({ status: 'exhausted', reason: 'target-mount-timeout' });
      // Every query was only for msg-20 (never queried a successor)
      for (const call of mocks.queryVirtualJumpTarget.mock.calls) {
        expect(call[1]).toBe('msg-20');
      }
      container.remove();
    });

    it('bypasses successor anchor for To Top (topOffsetPx === 0) and ordinary converging jumps', async () => {
      const container = makeContainer();
      const el60 = document.createElement('div');
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top === 61798) {
            container.appendChild(el60);
            mocks.findRenderedPrompt.mockReturnValue(el60);
          }
        }
      });

      mocks.queryVirtualJumpTarget.mockReturnValue({
        status: 'ok',
        targetIndex: 59,
        topOffsetPx: 61798,
        turnCount: 125,
      });
      mocks.findRenderedPrompt.mockReturnValue(null);

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-60', text: 'Prompt 60', canMatchByText: true, createTime: 59 },
        targetIndex: 59,
        prompts: makePrompts(65),
        container,
        jumpId: 'test-ordinary-bypass',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(100);

      const outcome = await attempt.promise;
      expect(outcome.status).toBe('mounted');
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledTimes(1);
      expect(mocks.queryVirtualJumpTarget).toHaveBeenCalledWith(container, 'msg-60');
      container.remove();
    });

    it('cancels immediately during successor-anchor recovery with zero further scroll writes', async () => {
      const container = makeContainer();
      let cancelled = false;
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          container.scrollTop = opts.top;
          if (opts.top === 11230.5) {
            setTimeout(() => { container.scrollTop = 20555; }, 10);
          } else if (opts.top === 11754) {
            // Cancel while awaiting Hop 1 anchor mount
            setTimeout(() => { cancelled = true; }, 50);
          }
        }
      });

      mocks.queryVirtualJumpTarget.mockImplementation((_c, id: string) => {
        if (id === 'msg-15') return { status: 'ok', targetIndex: 14, topOffsetPx: 11230.5, turnCount: 125 };
        if (id === 'msg-16') return { status: 'ok', targetIndex: 15, topOffsetPx: 11754, turnCount: 125 };
        if (id === 'msg-17') return { status: 'ok', targetIndex: 16, topOffsetPx: 12046, turnCount: 125 };
        return { status: 'unavailable' };
      });
      mocks.findRenderedPrompt.mockReturnValue(null);

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-15', text: 'Prompt 15', canMatchByText: true, createTime: 14 },
        targetIndex: 14,
        prompts: makePrompts(20),
        container,
        jumpId: 'test-anchor-cancel',
        isCancelled: () => cancelled,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(1200);

      const outcome = await attempt.promise;
      expect(outcome).toEqual({ status: 'cancelled' });
      // Must NOT proceed to Hop 2 (12046) after cancellation
      expect(container.scrollTo).not.toHaveBeenCalledWith({ top: 12046, behavior: 'auto' });
      container.remove();
    });

    it('exhausts cleanly without looping when both successor anchor hops fail', async () => {
      const container = makeContainer();
      container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
        if (typeof opts === 'object' && typeof opts?.top === 'number') {
          const requestedTop = opts.top;
          container.scrollTop = requestedTop;
          setTimeout(() => { container.scrollTop = requestedTop + 8000; }, 10);
        }
      });

      mocks.queryVirtualJumpTarget.mockImplementation((_c, id: string) => {
        if (id === 'msg-15') return { status: 'ok', targetIndex: 14, topOffsetPx: 11230.5, turnCount: 125 };
        if (id === 'msg-16') return { status: 'ok', targetIndex: 15, topOffsetPx: 11754, turnCount: 125 };
        if (id === 'msg-17') return { status: 'ok', targetIndex: 16, topOffsetPx: 12046, turnCount: 125 };
        return { status: 'unavailable' };
      });
      mocks.findRenderedPrompt.mockReturnValue(null);

      const attempt = tryVirtualLayoutStrategy({
        targetMessage: { id: 'msg-15', text: 'Prompt 15', canMatchByText: true, createTime: 14 },
        targetIndex: 14,
        prompts: makePrompts(20),
        container,
        jumpId: 'test-anchor-exhaust',
        isCancelled: () => false,
      });

      assertVirtual(attempt);
      await vi.advanceTimersByTimeAsync(3000);

      const outcome = await attempt.promise;
      expect(outcome).toEqual({ status: 'exhausted', reason: 'target-mount-timeout' });
      // Exactly 3 scrollTo writes: initial target (11230.5) + Hop 1 (11754) + Hop 2 (12046), no loop!
      expect(container.scrollTo).toHaveBeenCalledTimes(3);
      container.remove();
    });
  });
});
