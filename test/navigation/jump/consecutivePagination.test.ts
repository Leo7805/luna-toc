/** @vitest-environment jsdom */
/**
 * Integration tests simulating multi-cycle consecutive history pagination in long conversations.
 * Verifies that when Cycle 2 settles at scrollTop = 0, Cycle 3 creates an observable
 * scroll transition across rendering frames to trigger host pagination.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryVirtualLayoutStrategy } from '@/navigation/jump/strategies/virtualLayoutStrategy';
import type { JumpStrategyContext } from '@/navigation/jump/strategies/types';

const platformMocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  findRenderedPrompt: vi.fn(),
  queryVirtualJumpTarget: vi.fn(),
  readMountedWithSidebarIdx: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    id: 'chatgpt',
    displayName: 'ChatGPT',
    navigation: platformMocks,
    diagnostics: { createJumpId: () => 'j-test', logEvent: () => {} },
  }),
}));

describe('Consecutive History Pagination Integration', () => {
  let container: HTMLElement;
  let originalRaf: typeof requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    originalRaf = window.requestAnimationFrame;
    document.body.innerHTML = '';
    container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 60000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
    document.body.appendChild(container);

    platformMocks.getScrollContainer.mockReturnValue(container);
    platformMocks.findRenderedPrompt.mockReturnValue(null);
    platformMocks.readMountedWithSidebarIdx.mockReturnValue([]);
    platformMocks.queryVirtualJumpTarget.mockReturnValue({ status: 'unavailable', reason: 'default' });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    document.body.innerHTML = '';
  });

  it('demonstrates boundary stall when navigation repeats scrollTo(0) without pulse at scrollTop = 0 (simulated baseline regression)', async () => {
    let currentScrollTop = 5000;
    let hostPhase = 1;
    let sawNonZeroFrame = false;

    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      return setTimeout(() => {
        if (hostPhase === 3 && currentScrollTop > 0) {
          sawNonZeroFrame = true;
        }
        cb(performance.now());
      }, 16) as unknown as number;
    }) as unknown as typeof requestAnimationFrame;

    function handleScroll(newTop: number) {
      const previous = currentScrollTop;
      currentScrollTop = newTop;

      if (hostPhase === 1 && previous > 0 && newTop === 0) {
        hostPhase = 2;
        currentScrollTop = 2000;
        container.appendChild(document.createElement('div'));
        return;
      }

      if (hostPhase === 2 && previous > 0 && newTop === 0) {
        hostPhase = 3;
        currentScrollTop = 0; // Settles at 0
        container.appendChild(document.createElement('div'));
        return;
      }
    }

    // Cycle 1: transition 5000 -> 0 triggers phase 2
    handleScroll(0);
    expect(hostPhase).toBe(2);
    expect(currentScrollTop).toBe(2000);

    // Cycle 2: transition 2000 -> 0 triggers phase 3, settles at 0
    handleScroll(0);
    expect(hostPhase).toBe(3);
    expect(currentScrollTop).toBe(0);

    // Baseline behaviour at cycle 3: re-asserts scrollTo(0) without pulse
    handleScroll(0);
    await vi.advanceTimersByTimeAsync(100);

    // Frame callback never saw non-zero scroll; hostPhase remains stalled at 3
    expect(sawNonZeroFrame).toBe(false);
    expect(hostPhase).toBe(3);
  });

  it('proves that an immediate synchronous 32 -> 0 write within the same frame does not trigger pagination', async () => {
    let currentScrollTop = 0;
    let hostPhase = 3;
    let sawNonZeroFrame = false;

    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      return setTimeout(() => {
        if (currentScrollTop > 0) {
          sawNonZeroFrame = true;
        }
        cb(performance.now());
      }, 16) as unknown as number;
    }) as unknown as typeof requestAnimationFrame;

    // Synchronous pulse without awaiting rendered frame
    currentScrollTop = 32;
    currentScrollTop = 0;

    // Let frame timer elapse
    await vi.advanceTimersByTimeAsync(32);

    // By the time compositor frame ran, currentScrollTop was already 0
    expect(sawNonZeroFrame).toBe(false);
    expect(hostPhase).toBe(3);
  });

  it('triggers third pagination and succeeds when cross-frame boundary pulse is executed (fixed virtual layout strategy)', async () => {
    let currentScrollTop = 5000;
    let hostPhase = 1;
    let sawNonZeroFrame = false;
    let crossFrameTransitionTriggered = false;

    // Frame callback simulates compositor paint time:
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      return setTimeout(() => {
        if (hostPhase === 3 && currentScrollTop > 0) {
          sawNonZeroFrame = true;
        }
        if (hostPhase === 3 && sawNonZeroFrame && currentScrollTop === 0) {
          crossFrameTransitionTriggered = true;
          hostPhase = 4;
          const targetEl = document.createElement('div');
          targetEl.setAttribute('data-chatgpt-search-message-ids', 'msg-1');
          targetEl.setAttribute('data-chatgpt-search-unit-key', 'msg-1:user');
          container.appendChild(targetEl);
        }
        cb(performance.now());
      }, 16) as unknown as number;
    }) as unknown as typeof requestAnimationFrame;

    function handleScroll(newTop: number) {
      const previous = currentScrollTop;
      currentScrollTop = newTop;

      if (hostPhase === 1 && previous > 0 && newTop === 0) {
        hostPhase = 2;
        currentScrollTop = 2000;
        container.appendChild(document.createElement('div'));
        return;
      }

      if (hostPhase === 2 && previous > 0 && newTop === 0) {
        hostPhase = 3;
        currentScrollTop = 0; // Settles at 0
        container.appendChild(document.createElement('div'));
        return;
      }
    }

    Object.defineProperty(container, 'scrollTop', {
      get: () => currentScrollTop,
      set: (val: number) => handleScroll(val),
      configurable: true,
    });
    container.scrollTo = vi.fn((opts?: ScrollToOptions | number, _y?: number) => {
      const top = typeof opts === 'number' ? opts : (opts?.top ?? 0);
      handleScroll(top);
    }) as unknown as HTMLElement['scrollTo'];

    const prompts = Array.from({ length: 427 }, (_, i) => ({
      id: `msg-${i + 1}`,
      text: `Prompt ${i + 1}`,
      canMatchByText: true,
      createTime: 0,
    }));

    // Mount initial prompt at bottom of conversation (#427) so direction resolves to -1 (upward)
    const initialEl = document.createElement('div');
    initialEl.setAttribute('data-chatgpt-search-message-ids', 'msg-427');
    initialEl.setAttribute('data-chatgpt-search-unit-key', 'msg-427:user');
    container.appendChild(initialEl);

    platformMocks.findRenderedPrompt.mockImplementation((id: string) =>
      container.querySelector(`[data-chatgpt-search-message-ids="${id}"]`)
    );
    platformMocks.readMountedWithSidebarIdx.mockReturnValue([
      { element: initialEl, sidebarIdx: 426, unitKey: 'msg-427:user' },
    ]);
    platformMocks.queryVirtualJumpTarget.mockImplementation(() => {
      if (hostPhase === 1) return { status: 'target-not-in-layout', turnCount: 50 };
      if (hostPhase === 2) return { status: 'target-not-in-layout', turnCount: 100 };
      if (hostPhase === 3) return { status: 'target-not-in-layout', turnCount: 150 };
      if (hostPhase === 4) return { status: 'ok', topOffsetPx: 120 };
      return { status: 'unavailable', reason: 'unknown' };
    });

    const context: JumpStrategyContext = {
      targetMessage: prompts[0],
      targetIndex: 0,
      prompts,
      container,
      jumpId: 'j-pulse',
      isCancelled: () => false,
    };

    const attempt = tryVirtualLayoutStrategy(context);
    expect(attempt.mode).toBe('virtual');

    // Advance across cycle 1, cycle 2, and double-rAF pulse in cycle 3
    await vi.advanceTimersByTimeAsync(350);

    expect(sawNonZeroFrame).toBe(true);
    expect(crossFrameTransitionTriggered).toBe(true);
    expect(hostPhase).toBe(4);

    // Allow target mount wait to resolve
    await vi.advanceTimersByTimeAsync(50);

    const outcome = await (attempt as Extract<typeof attempt, { mode: 'virtual' }>).promise;
    expect(outcome.status).toBe('mounted');
  });
});
