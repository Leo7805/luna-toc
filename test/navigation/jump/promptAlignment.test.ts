/** @vitest-environment jsdom */
/**
 * Unit tests for prompt landing-offset geometry, alignment execution,
 * alignment error measurement, and alignment evaluation helpers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({
  promptLandingViewportTopPx: 190 as number | undefined,
  promptTopOffsetPx: 16,
  scrollContainer: null as HTMLElement | null,
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    navigation: {
      promptLandingViewportTopPx: platformMock.promptLandingViewportTopPx,
      promptTopOffsetPx: platformMock.promptTopOffsetPx,
      getScrollContainer: () => platformMock.scrollContainer,
    },
  }),
}));

import {
  alignElementInContainer,
  computePromptLandingOffset,
  evaluateElementAlignment,
  measureAlignmentErrorPx,
  resolvePromptLandingOffset,
  SUBPIXEL_TOLERANCE_PX,
} from '@/navigation/jump/promptAlignment';
import {
  alignElementInContainer as reExportedAlignElementInContainer,
  computePromptLandingOffset as reExportedComputePromptLandingOffset,
} from '@/navigation/jump/promptNavigation';

function makeRect(top: number, height = 80, width = 800): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createContainer(options: {
  top?: number;
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
} = {}): HTMLDivElement {
  const {
    top = 0,
    clientHeight = 900,
    scrollHeight = 10000,
    scrollTop = 2000,
  } = options;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', {
    value: clientHeight,
    configurable: true,
  });
  Object.defineProperty(container, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
  });
  container.scrollTop = scrollTop;
  container.getBoundingClientRect = () => makeRect(top, clientHeight);
  container.scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
    if (typeof opts === 'object' && typeof opts?.top === 'number') {
      container.scrollTop = opts.top;
    }
  });
  document.body.appendChild(container);
  platformMock.scrollContainer = container;
  return container;
}

describe('promptAlignment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    platformMock.promptLandingViewportTopPx = 190;
    platformMock.promptTopOffsetPx = 16;
    platformMock.scrollContainer = null;
  });

  it('preserves public API compatibility via promptNavigation re-exports', () => {
    expect(reExportedComputePromptLandingOffset).toBe(computePromptLandingOffset);
    expect(reExportedAlignElementInContainer).toBe(alignElementInContainer);
    expect(SUBPIXEL_TOLERANCE_PX).toBe(2);
  });

  it('aligns a connected element to 190px via direct container scroll', () => {
    const container = createContainer({ scrollTop: 2000 });
    const el = document.createElement('div');
    el.getBoundingClientRect = () => makeRect(500);
    container.appendChild(el);

    const result = alignElementInContainer(el, container);

    expect(result).toEqual({
      method: 'container-scroll',
      scrolled: true,
      clamped: false,
      expectedViewportTopPx: 190,
      expectedContainerOffsetPx: 190,
      targetScrollTopPx: 2310,
    });
    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 2310,
      behavior: 'auto',
    });
  });

  it('treats alignment within the 2px subpixel tolerance as already-aligned', () => {
    const container = createContainer({ scrollTop: 2000 });
    const el = document.createElement('div');
    el.getBoundingClientRect = () => makeRect(192);
    container.appendChild(el);

    const alignResult = alignElementInContainer(el, container);
    expect(alignResult.method).toBe('already-aligned');
    expect(alignResult.scrolled).toBe(false);
    expect(container.scrollTo).not.toHaveBeenCalled();

    expect(evaluateElementAlignment(el)).toBe('aligned');
    expect(measureAlignmentErrorPx(el, container)).toBe(2);
  });

  it('clamps to top and bottom scroll boundaries and evaluates visible edge targets as bounded', () => {
    // Top boundary clamp (scrollTop = 0, target sits above 190px at 80px)
    const topContainer = createContainer({ scrollTop: 0, scrollHeight: 10000 });
    const topEl = document.createElement('div');
    topEl.getBoundingClientRect = () => makeRect(80);
    topContainer.appendChild(topEl);

    const topAlign = alignElementInContainer(topEl, topContainer);
    expect(topAlign.clamped).toBe(true);
    expect(topAlign.scrolled).toBe(false);
    expect(evaluateElementAlignment(topEl)).toBe('bounded');

    // Bottom boundary clamp (scrollTop = maxScrollTop = 9100, target sits below 190px at 500px)
    const bottomContainer = createContainer({
      scrollTop: 9100,
      clientHeight: 900,
      scrollHeight: 10000,
    });
    const bottomEl = document.createElement('div');
    bottomEl.getBoundingClientRect = () => makeRect(500);
    bottomContainer.appendChild(bottomEl);

    const bottomAlign = alignElementInContainer(bottomEl, bottomContainer);
    expect(bottomAlign.clamped).toBe(true);
    expect(bottomAlign.scrolled).toBe(false);
    expect(evaluateElementAlignment(bottomEl)).toBe('bounded');
  });

  it('rejects offscreen targets at scroll boundaries instead of falsely classifying them as bounded', () => {
    // Clamped at top (scrollTop = 0), but element is offscreen above (-500px)
    const topContainer = createContainer({ scrollTop: 0 });
    const offscreenAbove = document.createElement('div');
    offscreenAbove.getBoundingClientRect = () => makeRect(-500);
    topContainer.appendChild(offscreenAbove);
    expect(evaluateElementAlignment(offscreenAbove)).toBe('correctable');

    // Clamped at bottom (scrollTop = maxScrollTop), but element is offscreen below (1200px)
    const bottomContainer = createContainer({
      scrollTop: 9100,
      clientHeight: 900,
      scrollHeight: 10000,
    });
    const offscreenBelow = document.createElement('div');
    offscreenBelow.getBoundingClientRect = () => makeRect(1200);
    bottomContainer.appendChild(offscreenBelow);
    expect(evaluateElementAlignment(offscreenBelow)).toBe('correctable');
  });

  it('evaluates mid-feed displacement outside 2px tolerance as correctable and reports signed error', () => {
    const container = createContainer({ scrollTop: 2000 });
    const el = document.createElement('div');
    el.getBoundingClientRect = () => makeRect(250.4);
    container.appendChild(el);

    expect(evaluateElementAlignment(el)).toBe('correctable');
    expect(measureAlignmentErrorPx(el, container)).toBe(60.4);
  });

  it('handles disconnected elements cleanly across alignment, measurement, and evaluation', () => {
    const container = createContainer({ scrollTop: 2000 });
    const detached = document.createElement('div');

    expect(alignElementInContainer(detached, container)).toEqual({
      method: 'none',
      scrolled: false,
      clamped: false,
      expectedViewportTopPx: 0,
      expectedContainerOffsetPx: 0,
      targetScrollTopPx: null,
    });
    expect(measureAlignmentErrorPx(detached, container)).toBeNull();
    expect(evaluateElementAlignment(detached)).toBe('disconnected');
  });

  it('handles zero-sized headless geometry and invalid offset inputs safely', () => {
    const container = createContainer({ scrollTop: 2000 });
    const zeroRectEl = document.createElement('div');
    zeroRectEl.scrollIntoView = vi.fn();
    zeroRectEl.getBoundingClientRect = () => makeRect(0, 0, 0);
    container.appendChild(zeroRectEl);

    expect(evaluateElementAlignment(zeroRectEl)).toBe('aligned');
    expect(measureAlignmentErrorPx(zeroRectEl, container)).toBe(0);

    const fallbackAlign = alignElementInContainer(zeroRectEl, container);
    expect(fallbackAlign.method).toBe('scroll-into-view');
    expect(zeroRectEl.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });

    const sanitized = computePromptLandingOffset({
      desiredViewportTopPx: Number.NaN,
      minContainerOffsetPx: -5,
      containerTopPx: Number.POSITIVE_INFINITY,
      containerClientHeightPx: -100,
      scrollPaddingTopPx: Number.NaN,
    });
    expect(sanitized).toEqual({
      scrollMarginTopPx: 16,
      expectedContainerOffsetPx: 16,
    });

    expect(resolvePromptLandingOffset(null)).toEqual({
      scrollMarginTopPx: 190,
      expectedContainerOffsetPx: 190,
    });
  });
});
