/**
 * Handles page-edge navigation (To Top / To Bottom) with column-reverse scroll mathematics and settle verification.
 */
import { getActivePlatform } from '@/platforms';

function platform() {
  return getActivePlatform();
}

/**
 * Tracks the active edge-jump retry loop so a second click cancels the
 * previous loop instead of stacking on top of it.
 */
let activeEdgeJumpVersion = 0;
const EDGE_JUMP_HEIGHT_GROWTH_EPSILON = 50;
const EDGE_JUMP_BOTTOM_TOLERANCE_PX = 2;
const TOP_EDGE_MAX_ATTEMPTS = 15;
const TOP_EDGE_STEP_MS = 200;
const TOP_EDGE_REQUIRED_QUIET_CHECKS = 2;
const BOTTOM_FALLBACK_MAX_ATTEMPTS = 12;
const BOTTOM_FALLBACK_STEP_MS = 200;
const BOTTOM_FALLBACK_REQUIRED_QUIET_CHECKS = 2;

/**
 * Cancels any in-flight absolute edge navigation loop.
 */
export function cancelActiveEdgeJump(): void {
  activeEdgeJumpVersion += 1;
}

/**
 * How close to the visible top of the scroll container the first prompt
 * must be before the loop considers the "found first prompt" condition met.
 * ChatGPT often mounts the very first prompt well before the user is
 * actually scrolled to it, so we require it to be in the visible band.
 */
const EDGE_JUMP_FIRST_PROMPT_VISIBLE_BAND_PX = 200;

interface ExecuteAbsoluteEdgeJumpOptions {
  container?: HTMLElement | null;
  firstPromptId?: string | null;
  isCancelled?: () => boolean;
  onFirstPromptVisible?: (element: HTMLElement) => void;
}

/**
 * Returns the first-prompt element when it is mounted in the DOM and
 * its visible top sits inside the top band of the scroll container.
 * This is the user-facing "you're at the very start of the conversation"
 * check, distinct from `findRenderedPrompt`, which would also
 * succeed when the prompt is mounted far below the visible area.
 *
 * @param container Live scroll container element.
 * @param firstPromptId Stable ID of the first prompt.
 * @returns The first prompt element if visible in top band, otherwise null.
 */
function findFirstPromptInTopBand(
  container: HTMLElement,
  firstPromptId: string
): HTMLElement | null {
  const firstPrompt = platform().navigation.findRenderedPrompt(firstPromptId);
  if (!firstPrompt) return null;

  const promptRect = firstPrompt.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const visibleTop = promptRect.top - containerRect.top;
  if (visibleTop >= 0 && visibleTop <= EDGE_JUMP_FIRST_PROMPT_VISIBLE_BAND_PX) {
    return firstPrompt;
  }
  return null;
}

/**
 * Iteratively re-asserts the true top scroll position using bounded,
 * layout-aware checks while ChatGPT's virtual list mounts and measures older
 * turns. Cancels promptly on genuine user scroll input or a superseding
 * navigation, and only signals completion once `scrollTop` stays at the top
 * edge with stable `scrollHeight` (and the first prompt visible when known).
 */
async function retryTopEdgeUntilSettled(
  container: HTMLElement,
  isReverse: boolean,
  jumpVersion: number,
  firstPromptId: string | null,
  isCancelled?: () => boolean,
  onFirstPromptVisible?: (element: HTMLElement) => void
): Promise<void> {
  let userInterrupted = false;
  const markInterrupted = (): void => {
    userInterrupted = true;
  };
  const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
  container.addEventListener('wheel', markInterrupted, passiveOpts);
  container.addEventListener('touchstart', markInterrupted, passiveOpts);
  container.addEventListener('pointerdown', markInterrupted, passiveOpts);

  let quietTopChecks = 0;
  try {
    for (let attempt = 0; attempt < TOP_EDGE_MAX_ATTEMPTS; attempt++) {
      if (
        userInterrupted ||
        jumpVersion !== activeEdgeJumpVersion ||
        isCancelled?.() ||
        !container.isConnected
      ) {
        return;
      }

      const beforeHeight = container.scrollHeight;
      const maxScrollTop = Math.max(0, beforeHeight - container.clientHeight);
      const expectedTop = isReverse ? -maxScrollTop : 0;

      try {
        platform().navigation.holdViewport?.(container);
      } catch {
        // Fail closed if holdViewport is unavailable
      }
      container.scrollTop = expectedTop;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, TOP_EDGE_STEP_MS);
      });

      if (
        userInterrupted ||
        jumpVersion !== activeEdgeJumpVersion ||
        isCancelled?.() ||
        !container.isConnected
      ) {
        return;
      }

      const afterHeight = container.scrollHeight;
      const afterMaxScrollTop = Math.max(0, afterHeight - container.clientHeight);
      const afterExpectedTop = isReverse ? -afterMaxScrollTop : 0;
      const atTrueTop =
        Math.abs(container.scrollTop - afterExpectedTop) <=
        EDGE_JUMP_BOTTOM_TOLERANCE_PX;
      const heightStable =
        Math.abs(afterHeight - beforeHeight) <= EDGE_JUMP_HEIGHT_GROWTH_EPSILON;

      if (!atTrueTop || !heightStable) {
        quietTopChecks = 0;
        continue;
      }

      // When firstPromptId is known, require the actual first prompt to be
      // mounted and visible in the top band before declaring completion.
      if (firstPromptId) {
        const firstPromptInView = findFirstPromptInTopBand(
          container,
          firstPromptId
        );
        if (firstPromptInView) {
          onFirstPromptVisible?.(firstPromptInView);
          return;
        }
      }

      quietTopChecks += 1;
      if (quietTopChecks >= TOP_EDGE_REQUIRED_QUIET_CHECKS) {
        return;
      }
    }
  } finally {
    container.removeEventListener('wheel', markInterrupted, passiveOpts);
    container.removeEventListener('touchstart', markInterrupted, passiveOpts);
    container.removeEventListener('pointerdown', markInterrupted, passiveOpts);
  }
}

/**
 * Bounded fallback bottom-scroll loop used only when the host's native
 * scroll-to-bottom capability is unavailable. Re-asserts the physical bottom
 * across dynamic `scrollHeight` changes and cancels immediately on user
 * interaction or a superseding navigation.
 */
async function retryBottomFallbackUntilSettled(
  container: HTMLElement,
  isReverse: boolean,
  jumpVersion: number,
  isCancelled?: () => boolean
): Promise<void> {
  let userInterrupted = false;
  const markInterrupted = (): void => {
    userInterrupted = true;
  };
  const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
  container.addEventListener('wheel', markInterrupted, passiveOpts);
  container.addEventListener('touchstart', markInterrupted, passiveOpts);
  container.addEventListener('pointerdown', markInterrupted, passiveOpts);

  let quietBottomChecks = 0;
  try {
    for (let attempt = 0; attempt < BOTTOM_FALLBACK_MAX_ATTEMPTS; attempt++) {
      if (
        userInterrupted ||
        jumpVersion !== activeEdgeJumpVersion ||
        isCancelled?.() ||
        !container.isConnected
      ) {
        return;
      }

      const beforeHeight = container.scrollHeight;
      const maxScrollTop = Math.max(0, beforeHeight - container.clientHeight);
      container.scrollTop = isReverse ? 0 : maxScrollTop;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, BOTTOM_FALLBACK_STEP_MS);
      });

      if (
        userInterrupted ||
        jumpVersion !== activeEdgeJumpVersion ||
        isCancelled?.() ||
        !container.isConnected
      ) {
        return;
      }

      const afterHeight = container.scrollHeight;
      const heightStable =
        Math.abs(afterHeight - beforeHeight) <= EDGE_JUMP_HEIGHT_GROWTH_EPSILON;
      const atBottom = isPageAtBottom(container, EDGE_JUMP_BOTTOM_TOLERANCE_PX);

      if (atBottom && heightStable) {
        quietBottomChecks += 1;
        if (quietBottomChecks >= BOTTOM_FALLBACK_REQUIRED_QUIET_CHECKS) {
          return;
        }
      } else {
        quietBottomChecks = 0;
      }
    }
  } finally {
    container.removeEventListener('wheel', markInterrupted, passiveOpts);
    container.removeEventListener('touchstart', markInterrupted, passiveOpts);
    container.removeEventListener('pointerdown', markInterrupted, passiveOpts);
  }
}

/**
 * Initiates an absolute edge scroll to the top or bottom of the conversation feed.
 *
 * For `'bottom'`, delegates first to `platform().navigation.scrollToBottom()`
 * (native scroll controller, then unambiguous native bottom button) and only
 * runs the bounded fallback loop when native bottom navigation is unavailable.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 * @param options Execution configuration options including container and cancellation hook.
 *
 * @example
 * ```ts
 * executeAbsoluteEdgeJump('top', {
 *   firstPromptId: 'msg-0',
 *   isCancelled: () => isCancelled,
 *   onFirstPromptVisible: (el) => highlight(el),
 * });
 * ```
 */
export function executeAbsoluteEdgeJump(
  edge: 'top' | 'bottom',
  options: ExecuteAbsoluteEdgeJumpOptions = {}
): void {
  const threadContainer =
    platform().navigation.getThreadScrollContainer?.() ?? null;
  const scrollContainer = platform().navigation.getScrollContainer();
  const container = options.container ?? (threadContainer ?? scrollContainer);
  if (!container) return;

  const jumpVersion = ++activeEdgeJumpVersion;

  if (edge === 'bottom') {
    const nativeResult = platform().navigation.scrollToBottom?.(container);
    if (nativeResult?.status === 'ok') {
      return;
    }

    const isReverse =
      window.getComputedStyle(container).flexDirection === 'column-reverse';
    void retryBottomFallbackUntilSettled(
      container,
      isReverse,
      jumpVersion,
      options.isCancelled
    );
    return;
  }

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';

  void retryTopEdgeUntilSettled(
    container,
    isReverse,
    jumpVersion,
    options.firstPromptId ?? null,
    options.isCancelled,
    options.onFirstPromptVisible
  );
}

/**
 * Checks whether the chat scroll container is currently scrolled to the bottom.
 *
 * @param targetContainer Optional scroll container override.
 * @param tolerancePx Tolerance in pixels for fractional zoom or subpixel scrolling.
 * @returns True if the container is at or within tolerance of the bottom edge.
 */
export function isPageAtBottom(
  targetContainer?: HTMLElement | null,
  tolerancePx: number = EDGE_JUMP_BOTTOM_TOLERANCE_PX
): boolean {
  const threadContainer =
    platform().navigation.getThreadScrollContainer?.() ?? null;
  const scrollContainer = platform().navigation.getScrollContainer();
  const container = targetContainer ?? (threadContainer ?? scrollContainer);
  if (!container) return false;

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';
  const currentBottomTarget = isReverse
    ? 0
    : Math.max(0, container.scrollHeight - container.clientHeight);

  return (
    Math.abs(container.scrollTop - currentBottomTarget) <= tolerancePx
  );
}
