/** @vitest-environment jsdom */
/** Tests landing alignment execution, final top scroll, and displacement classification. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  findRenderedPrompt: vi.fn(),
  holdViewport: vi.fn(),
  isNavigationDebugEnabled: vi.fn(() => false),
  emitAlignmentMeasurement: vi.fn(),
  alignElementInContainer: vi.fn(),
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

vi.mock('@/navigation/jump/jumpDiagnostics', () => ({
  isNavigationDebugEnabled: mocks.isNavigationDebugEnabled,
  emitAlignmentMeasurement: mocks.emitAlignmentMeasurement,
}));

vi.mock('@/navigation/jump/promptAlignment', () => ({
  alignElementInContainer: mocks.alignElementInContainer,
  resolvePromptLandingOffset: mocks.resolvePromptLandingOffset,
}));

vi.mock('@/navigation/jump/promptHighlightOverlay', () => ({
  highlightPromptElement: mocks.highlightPromptElement,
}));

import {
  createPromptJumpSession,
  type PromptJumpSession,
} from '@/navigation/jump/prompt/promptJumpSession';
import {
  applyTargetLandingAlignment,
  classifyDisplacement,
  performFinalTopScroll,
} from '@/navigation/jump/prompt/promptLanding';

function makeContainer(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let top = scrollTop;
  Object.defineProperty(container, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
  Object.defineProperty(container, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
  container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
    if (typeof opts === 'object' && typeof opts.top === 'number') {
      top = opts.top;
    }
  }) as unknown as HTMLElement['scrollTo'];
  return container;
}

function makeSession(
  overrides: Partial<Parameters<typeof createPromptJumpSession>[0]> = {}
): PromptJumpSession {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return createPromptJumpSession({
    target,
    targetMessageId: 'msg-15',
    targetIndex: 14,
    jumpId: 'jump-15',
    mode: 'target-driven',
    initialStrategy: 'fast-path',
    isCancelled: () => false,
    ...overrides,
  });
}

describe('promptLanding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.isNavigationDebugEnabled.mockReturnValue(false);
    mocks.alignElementInContainer.mockReturnValue({
      expectedViewportTopPx: 190,
      clamped: false,
      method: 'container-scroll',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('classifyDisplacement', () => {
    it('returns user-scroll when userInterrupted is true without mutating session state', () => {
      const session = makeSession();
      session.lifecycle.userInterrupted = true;
      const container = makeContainer(500, 3000, 800);
      const snapshot = structuredClone(session.alignment);

      expect(classifyDisplacement(session, container, false)).toBe('user-scroll');
      expect(session.alignment).toEqual(snapshot);
    });

    it('classifies downward bottom-snap as external-scroll-suspected and shrink-clamp as layout-shift', () => {
      const session = makeSession();
      session.alignment.lastAppliedScrollTop = 1000;
      session.alignment.lastAppliedDistanceFromBottom = 500;

      // Downward bottom-snap: scrollTop jumped down past 1004 to bottom (dist <= 2)
      const snappedContainer = makeContainer(2200, 3000, 800);
      expect(classifyDisplacement(session, snappedContainer, true)).toBe(
        'external-scroll-suspected'
      );

      // Height shrink clamp: scrollTop clamped down (<= lastAppliedScrollTop) at bottom
      const shrunkContainer = makeContainer(900, 1700, 800);
      expect(classifyDisplacement(session, shrunkContainer, true)).toBe(
        'layout-shift'
      );
    });

    it('distinguishes non-height scrollTop drift above vs within the 4px threshold', () => {
      const session = makeSession();
      session.alignment.lastAppliedScrollTop = 1000;

      const smallDrift = makeContainer(1004, 3000, 800);
      expect(classifyDisplacement(session, smallDrift, false)).toBe('layout-shift');

      const largeDrift = makeContainer(1005, 3000, 800);
      expect(classifyDisplacement(session, largeDrift, false)).toBe(
        'external-scroll-suspected'
      );
    });
  });

  describe('applyTargetLandingAlignment', () => {
    it('returns null without aligning when session is cancelled or target is disconnected', () => {
      const container = makeContainer(0, 3000, 800);
      mocks.getScrollContainer.mockReturnValue(container);

      const detached = document.createElement('div');
      const s1 = makeSession();
      expect(applyTargetLandingAlignment(s1, detached, 'after-align')).toBeNull();

      const connected = document.createElement('div');
      document.body.appendChild(connected);
      const s2 = makeSession({ isCancelled: () => true });
      expect(applyTargetLandingAlignment(s2, connected, 'after-align')).toBeNull();

      expect(mocks.alignElementInContainer).not.toHaveBeenCalled();
      expect(mocks.highlightPromptElement).not.toHaveBeenCalled();
    });

    it('updates session.alignment, sets didScrollFar, respects holdViewport rules, and skips debug reads when disabled', () => {
      const container = makeContainer(100, 5000, 800);
      mocks.getScrollContainer.mockReturnValue(container);
      const rectSpy = vi.spyOn(container, 'getBoundingClientRect');

      mocks.alignElementInContainer.mockImplementation(() => {
        container.scrollTop = 1200; // delta = 1100 > clientHeight (800)
        return {
          expectedViewportTopPx: 190,
          clamped: true,
          method: 'container-scroll',
        };
      });

      const el = document.createElement('div');
      document.body.appendChild(el);
      const session = makeSession({
        initialStrategy: 'fast-path',
        initialScrollTopPx: 100,
      });

      const result = applyTargetLandingAlignment(session, el, 'after-align');
      expect(result).toEqual({
        expectedViewportTopPx: 190,
        clamped: true,
        method: 'container-scroll',
      });
      expect(mocks.holdViewport).not.toHaveBeenCalled(); // fast-path after-align
      expect(session.alignment).toEqual({
        lastAlignClamped: true,
        lastAppliedScrollTop: 1200,
        lastObservedScrollHeight: 5000,
        lastAppliedDistanceFromBottom: 3000,
        didScrollFar: true,
      });
      expect(mocks.highlightPromptElement).toHaveBeenCalledTimes(1);
      expect(mocks.emitAlignmentMeasurement).not.toHaveBeenCalled();
      expect(rectSpy).not.toHaveBeenCalled();

      // Realign re-arms holdViewport and does not re-trigger initial highlight
      applyTargetLandingAlignment(session, el, 'realign');
      expect(mocks.holdViewport).toHaveBeenCalledWith(container);
      expect(mocks.highlightPromptElement).toHaveBeenCalledTimes(1);
    });

    it('emits before-align, after-align, and next-frame debug diagnostics when debugging is enabled', () => {
      const container = makeContainer(200, 4000, 800);
      mocks.getScrollContainer.mockReturnValue(container);
      mocks.isNavigationDebugEnabled.mockReturnValue(true);

      const el = document.createElement('div');
      document.body.appendChild(el);
      mocks.findRenderedPrompt.mockReturnValue(el);

      const rafCallbacks: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

      const session = makeSession({ initialStrategy: 'virtual-layout' });
      applyTargetLandingAlignment(session, el, 'after-align');

      expect(mocks.holdViewport).toHaveBeenCalledWith(container); // virtual-layout after-align
      expect(mocks.emitAlignmentMeasurement).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ stage: 'before-align', strategy: 'virtual-layout' })
      );
      expect(mocks.emitAlignmentMeasurement).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ stage: 'after-align', strategy: 'virtual-layout' })
      );

      expect(rafCallbacks).toHaveLength(1);
      rafCallbacks[0](16);
      expect(mocks.emitAlignmentMeasurement).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ stage: 'next-frame', strategy: 'virtual-layout' })
      );
    });
  });

  describe('performFinalTopScroll', () => {
    it('is a no-op when alignToTopEdge is false or session is cancelled', () => {
      const container = makeContainer(400, 3000, 800);
      const el = document.createElement('div');
      document.body.appendChild(el);
      mocks.getScrollContainer.mockReturnValue(container);
      mocks.findRenderedPrompt.mockReturnValue(el);

      performFinalTopScroll(makeSession(), false, 50);
      performFinalTopScroll(makeSession({ isCancelled: () => true }), true, 50);

      expect(container.scrollTo).not.toHaveBeenCalled();
    });

    it('scrolls to top=0 and re-verifies on the scheduled frame unless cancelled', () => {
      const container = makeContainer(400, 3000, 800);
      const el = document.createElement('div');
      document.body.appendChild(el);
      mocks.getScrollContainer.mockReturnValue(container);
      mocks.findRenderedPrompt.mockReturnValue(el);

      let cancelled = false;
      const session = makeSession({ isCancelled: () => cancelled });

      performFinalTopScroll(session, true, 50);
      expect(container.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

      // Simulate drift before scheduled verification frame
      container.scrollTop = 25;
      vi.advanceTimersByTime(60);
      expect(container.scrollTo).toHaveBeenCalledTimes(2);
      expect(mocks.highlightPromptElement).toHaveBeenCalledTimes(1);

      // Cancelled before verification frame prevents stale scroll/highlight
      vi.clearAllMocks();
      container.scrollTop = 400;
      performFinalTopScroll(session, true, 50);
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      cancelled = true;
      vi.advanceTimersByTime(60);
      expect(container.scrollTo).toHaveBeenCalledTimes(1);
      expect(mocks.highlightPromptElement).not.toHaveBeenCalled();
    });
  });
});
