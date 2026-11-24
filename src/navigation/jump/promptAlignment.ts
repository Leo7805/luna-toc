/**
 * Pure prompt landing-offset geometry, container alignment execution,
 * alignment error measurement, and alignment evaluation helpers.
 */
import { getActivePlatform } from '@/platforms';

/**
 * Pixel tolerance used for subpixel alignment checks and scroll-edge clamping.
 */
export const SUBPIXEL_TOLERANCE_PX = 2;

const DEFAULT_MIN_CONTAINER_OFFSET_PX = 16;
const MAX_LANDING_CONTAINER_HEIGHT_RATIO = 0.3;

/**
 * Input geometry and configuration for computing a prompt's landing offset.
 */
export interface PromptLandingOffsetInput {
  desiredViewportTopPx?: number;
  minContainerOffsetPx: number;
  containerTopPx: number;
  containerClientHeightPx: number;
  scrollPaddingTopPx: number;
}

/**
 * Computed temporary `scrollMarginTop` and expected container-relative offset.
 */
export interface PromptLandingOffsetResult {
  scrollMarginTopPx: number;
  expectedContainerOffsetPx: number;
}

/**
 * Outcome of aligning a rendered prompt element inside its scroll container.
 */
export interface AlignElementResult {
  method: 'container-scroll' | 'scroll-into-view' | 'already-aligned' | 'none';
  scrolled: boolean;
  clamped: boolean;
  expectedViewportTopPx: number;
  expectedContainerOffsetPx: number;
  targetScrollTopPx: number | null;
}

/**
 * Classification of a rendered prompt element's current alignment state.
 */
export type AlignmentEvaluation =
  | 'aligned'
  | 'bounded'
  | 'correctable'
  | 'disconnected';

function sanitizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function readContainerScrollPaddingTopPx(
  container: HTMLElement | null
): number {
  if (
    !container ||
    typeof window === 'undefined' ||
    typeof window.getComputedStyle !== 'function'
  ) {
    return 0;
  }
  try {
    const raw = window.getComputedStyle(container).scrollPaddingTop;
    const parsed = parseFloat(raw || '0');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Computes the temporary `scrollMarginTop` and expected container-relative
 * landing offset for prompt navigation.
 *
 * Converts a viewport-relative target (`desiredViewportTopPx`) into a
 * scroll-container-relative offset, clamps it to 30% of container height on
 * short viewports, and subtracts the container's existing `scrollPaddingTop`
 * so offsets are not double-counted.
 *
 * Exception to the 30% clamp: if the host's own `scrollPaddingTop` already
 * exceeds the clamped target offset, `scrollMarginTopPx` is clamped to `0`
 * (never negative) and `expectedContainerOffsetPx` preserves the host's
 * `scrollPaddingTop`.
 *
 * @param input Geometry and configuration values for the active scroll container.
 * @returns Non-negative `scrollMarginTopPx` and matching `expectedContainerOffsetPx`.
 *
 * @example
 * const { scrollMarginTopPx, expectedContainerOffsetPx } =
 *   computePromptLandingOffset({
 *     desiredViewportTopPx: 190,
 *     minContainerOffsetPx: 16,
 *     containerTopPx: 0,
 *     containerClientHeightPx: 900,
 *     scrollPaddingTopPx: 0,
 *   });
 */
export function computePromptLandingOffset(
  input: PromptLandingOffsetInput
): PromptLandingOffsetResult {
  const minContainerOffset = sanitizeNonNegativeNumber(
    input.minContainerOffsetPx,
    DEFAULT_MIN_CONTAINER_OFFSET_PX
  );
  const scrollPaddingTop = sanitizeNonNegativeNumber(
    input.scrollPaddingTopPx,
    0
  );
  const hasDesiredViewportTop =
    typeof input.desiredViewportTopPx === 'number' &&
    Number.isFinite(input.desiredViewportTopPx) &&
    input.desiredViewportTopPx >= 0;

  if (!hasDesiredViewportTop) {
    return {
      scrollMarginTopPx: minContainerOffset,
      expectedContainerOffsetPx: scrollPaddingTop + minContainerOffset,
    };
  }

  const containerTop = sanitizeFiniteNumber(input.containerTopPx, 0);
  const containerClientHeight = sanitizeNonNegativeNumber(
    input.containerClientHeightPx,
    0
  );

  const rawContainerOffset = input.desiredViewportTopPx! - containerTop;
  const maxContainerOffset =
    containerClientHeight > 0
      ? Math.max(
          minContainerOffset,
          Math.floor(containerClientHeight * MAX_LANDING_CONTAINER_HEIGHT_RATIO)
        )
      : Infinity;

  const targetContainerOffset = Math.min(
    Math.max(minContainerOffset, rawContainerOffset),
    maxContainerOffset
  );

  const scrollMarginTopPx = Math.max(
    0,
    targetContainerOffset - scrollPaddingTop
  );

  return {
    scrollMarginTopPx,
    expectedContainerOffsetPx: scrollPaddingTop + scrollMarginTopPx,
  };
}

/**
 * Resolves the active platform's landing offset for `container` using its live
 * bounding rect, client height, and computed `scrollPaddingTop`.
 *
 * @param container Active scroll container element, or null if unavailable.
 * @returns Computed `scrollMarginTopPx` and `expectedContainerOffsetPx`.
 *
 * @example
 * const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
 */
export function resolvePromptLandingOffset(
  container: HTMLElement | null
): PromptLandingOffsetResult {
  const nav = getActivePlatform().navigation;
  const containerTopPx = container ? container.getBoundingClientRect().top : 0;
  const containerClientHeightPx = container ? container.clientHeight : 0;
  const scrollPaddingTopPx = readContainerScrollPaddingTopPx(container);

  return computePromptLandingOffset({
    desiredViewportTopPx: nav.promptLandingViewportTopPx,
    minContainerOffsetPx: nav.promptTopOffsetPx,
    containerTopPx,
    containerClientHeightPx,
    scrollPaddingTopPx,
  });
}

/**
 * Aligns `el` inside `container` so its top edge lands at
 * `containerTop + expectedContainerOffsetPx` (190px from viewport top on
 * ChatGPT, respecting short-viewport clamping and existing `scrollPaddingTop`
 * without double-counting).
 *
 * Uses direct `container.scrollTo({ top, behavior: 'auto' })` when the scroll
 * container has measurable layout geometry so outer/nested scroll containers
 * are never moved and ChatGPT element styles are not mutated. Falls back to
 * temporary `scrollMarginTop` + `el.scrollIntoView()` only when container
 * layout geometry is unavailable (e.g. headless jsdom or missing container).
 *
 * @param el Connected target prompt element to align.
 * @param container Resolved active scroll container (`.thread-scroll-container`).
 * @returns Alignment method, clamp state, and expected coordinates.
 *
 * @example
 * const result = alignElementInContainer(targetEl, scrollContainer);
 */
export function alignElementInContainer(
  el: HTMLElement,
  container: HTMLElement | null
): AlignElementResult {
  if (!el.isConnected) {
    return {
      method: 'none',
      scrolled: false,
      clamped: false,
      expectedViewportTopPx: 0,
      expectedContainerOffsetPx: 0,
      targetScrollTopPx: null,
    };
  }

  const landing = resolvePromptLandingOffset(container);
  const elRect = el.getBoundingClientRect();
  const containerRect = container ? container.getBoundingClientRect() : null;
  const containerTop = containerRect ? containerRect.top : 0;
  const expectedViewportTopPx = containerTop + landing.expectedContainerOffsetPx;

  const hasElementLayout = !(
    elRect.width === 0 &&
    elRect.height === 0 &&
    elRect.top === 0 &&
    elRect.bottom === 0
  );
  const canUseDirectContainerScroll = Boolean(
    container &&
      container.isConnected &&
      hasElementLayout &&
      container.clientHeight > 0
  );

  if (canUseDirectContainerScroll && container) {
    const currentOffset = elRect.top - containerTop;
    const delta = currentOffset - landing.expectedContainerOffsetPx;

    if (Math.abs(delta) <= SUBPIXEL_TOLERANCE_PX) {
      return {
        method: 'already-aligned',
        scrolled: false,
        clamped: false,
        expectedViewportTopPx,
        expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
        targetScrollTopPx: container.scrollTop,
      };
    }

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight
    );
    const isReverse =
      typeof window !== 'undefined' &&
      typeof window.getComputedStyle === 'function' &&
      window.getComputedStyle(container).flexDirection === 'column-reverse';

    const desiredScrollTop = container.scrollTop + delta;
    const clampedScrollTop = isReverse
      ? Math.max(-maxScrollTop, Math.min(0, desiredScrollTop))
      : Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
    const clamped = Math.abs(clampedScrollTop - desiredScrollTop) > 0.5;

    if (Math.abs(clampedScrollTop - container.scrollTop) > 0.5) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: clampedScrollTop, behavior: 'auto' });
      } else {
        container.scrollTop = clampedScrollTop;
      }
      return {
        method: 'container-scroll',
        scrolled: true,
        clamped,
        expectedViewportTopPx,
        expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
        targetScrollTopPx: clampedScrollTop,
      };
    }

    return {
      method: 'container-scroll',
      scrolled: false,
      clamped: true,
      expectedViewportTopPx,
      expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
      targetScrollTopPx: clampedScrollTop,
    };
  }

  // Fallback when container geometry is unavailable (e.g. headless test DOM).
  const previousScrollMarginTop = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${landing.scrollMarginTopPx}px`;
  el.scrollIntoView({ behavior: 'auto', block: 'start' });
  el.style.scrollMarginTop = previousScrollMarginTop;

  return {
    method: 'scroll-into-view',
    scrolled: true,
    clamped: false,
    expectedViewportTopPx,
    expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
    targetScrollTopPx: container ? container.scrollTop : null,
  };
}

/**
 * Measures the signed vertical alignment error (`rect.top - expectedViewportTopPx`)
 * rounded to `0.1px`, returning `null` if the element is missing or disconnected
 * and `0` in headless test environments with zero-sized bounding rects.
 *
 * @param el Target prompt element, or null.
 * @param container Active scroll container, or null.
 * @returns Signed alignment error in pixels, or null if disconnected.
 *
 * @example
 * const errorPx = measureAlignmentErrorPx(targetEl, scrollContainer);
 */
export function measureAlignmentErrorPx(
  el: HTMLElement | null,
  container: HTMLElement | null
): number | null {
  if (!el || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.bottom === 0) {
    return 0;
  }
  const containerTop = container ? container.getBoundingClientRect().top : 0;
  const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
  const expectedViewportTopPx = containerTop + expectedContainerOffsetPx;
  return Math.round((rect.top - expectedViewportTopPx) * 10) / 10;
}

/**
 * Evaluates whether `el` is currently aligned, bounded at a scroll edge,
 * correctably displaced, or disconnected from the DOM.
 *
 * Preserves compatibility with headless test environments lacking layout
 * engines (zero-sized bounding rects evaluate as `'aligned'`). When `container`
 * is omitted, resolves the active scroll container via `getActivePlatform()`.
 *
 * @param el Rendered prompt element to evaluate.
 * @param container Optional scroll container; defaults to active platform container.
 * @returns Alignment classification for stabilization decisions.
 *
 * @example
 * const status = evaluateElementAlignment(targetEl);
 */
export function evaluateElementAlignment(
  el: HTMLElement,
  container: HTMLElement | null = getActivePlatform().navigation.getScrollContainer()
): AlignmentEvaluation {
  if (!el.isConnected) return 'disconnected';

  const containerRect = container ? container.getBoundingClientRect() : null;
  const containerTop = containerRect ? containerRect.top : 0;
  const containerHeight = container
    ? container.clientHeight || (containerRect ? containerRect.height : 0)
    : 0;
  const rect = el.getBoundingClientRect();

  // Preserve compatibility with headless test environments lacking layout engines
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.bottom === 0) {
    return 'aligned';
  }

  const currentOffset = rect.top - containerTop;
  const { expectedContainerOffsetPx: expectedOffset } =
    resolvePromptLandingOffset(container);
  const diff = currentOffset - expectedOffset;

  if (Math.abs(diff) <= SUBPIXEL_TOLERANCE_PX) {
    return 'aligned';
  }

  if (container) {
    const scrollTop = container.scrollTop;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const isVisibleInContainer =
      currentOffset >= -SUBPIXEL_TOLERANCE_PX &&
      (containerHeight <= 0 || currentOffset < containerHeight - SUBPIXEL_TOLERANCE_PX);

    // Target is above expected offset but container is clamped at minimum scroll boundary.
    // Guard against false positive: element must still be visible inside the container.
    if (
      diff < -SUBPIXEL_TOLERANCE_PX &&
      isVisibleInContainer &&
      scrollTop <= SUBPIXEL_TOLERANCE_PX
    ) {
      return 'bounded';
    }

    // Target is below expected offset but container is clamped at maximum scroll ceiling.
    // Guard against false positive: element must still be visible inside the container.
    if (
      maxScrollTop > 0 &&
      diff > SUBPIXEL_TOLERANCE_PX &&
      isVisibleInContainer &&
      scrollTop >= maxScrollTop - SUBPIXEL_TOLERANCE_PX
    ) {
      return 'bounded';
    }
  }

  return 'correctable';
}
