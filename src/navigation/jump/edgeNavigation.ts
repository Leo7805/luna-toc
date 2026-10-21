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
let stopActiveScrollIntentTracking: (() => void) | null = null;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const EDGE_JUMP_HARD_CAP = 30;
const EDGE_JUMP_SETTLE_MS = 1500;
const EDGE_JUMP_HEIGHT_GROWTH_EPSILON = 50;
const EDGE_JUMP_BOTTOM_TOLERANCE_PX = 2;

/**
 * How close to the visible top of the scroll container the first prompt
 * must be before the loop considers the "found first prompt" condition met.
 * ChatGPT often mounts the very first prompt well before the user is
 * actually scrolled to it, so we require it to be in the visible band.
 */
const EDGE_JUMP_FIRST_PROMPT_VISIBLE_BAND_PX = 200;

/**
 * Cancels automatic edge correction when the user takes control of scrolling.
 * Listen for input intent, not scroll events: programmatic scrolling and
 * ChatGPT virtualizer updates also emit scroll events.
 */
function trackManualScrollIntent(
  container: HTMLElement,
  cancelJump: () => void
): () => void {
  const onWheel = (event: WheelEvent): void => {
    if (event.deltaY !== 0) cancelJump();
  };
  const onTouchMove = (): void => cancelJump();
  const onPointerDown = (): void => cancelJump();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      event.altKey || event.ctrlKey || event.metaKey ||
      !SCROLL_KEYS.has(event.key)
    ) return;

    const target = event.target;
    // Editable controls and the extension UI must not interrupt chat scrolling.
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], ' +
        '#luna-toc-sidebar, #luna-toc-toggle-btn, #luna-toc-react-host'
      )
    ) return;
    cancelJump();
  };

  container.addEventListener('wheel', onWheel, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: true });
  container.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('keydown', onKeyDown, true);

  return () => {
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

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
 * Iteratively re-asserts the edge scroll position while ChatGPT's mount
 * window keeps growing. Exits when the first prompt reaches the visible
 * top band, when cancelled, or once `EDGE_JUMP_HARD_CAP` retries have been exhausted.
 */
async function retryEdgeUntilSettled(
  container: HTMLElement,
  edge: 'top' | 'bottom',
  isReverse: boolean,
  jumpVersion: number,
  firstPromptId: string | null,
  isCancelled?: () => boolean,
  onFirstPromptVisible?: (element: HTMLElement) => void
): Promise<void> {
  const logEdgeSettle = (details: Record<string, unknown>): void => {
    if (platform().diagnostics.isJumpVizDebugEnabled?.()) {
      console.log('[LunaTOC edge-settle]', details);
    }
  };

  for (let attempt = 0; attempt < EDGE_JUMP_HARD_CAP; attempt++) {
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      isCancelled?.()
    ) {
      logEdgeSettle({ attempt, phase: 'cancelled' });
      return;
    }

    const beforeHeight = container.scrollHeight;
    const beforeScrollTop = container.scrollTop;
    const maxScrollTop = beforeHeight - container.clientHeight;
    const targetTop = edge === 'top'
      ? (isReverse ? -maxScrollTop : 0)
      : (isReverse ? 0 : maxScrollTop);

    container.scrollTop = targetTop;

    logEdgeSettle({
      attempt,
      edge,
      isReverse,
      maxScrollTop,
      targetTop,
      beforeScrollTop,
      beforeHeight,
    });

    await new Promise<void>(function (resolve) {
      setTimeout(resolve, EDGE_JUMP_SETTLE_MS);
    });
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      isCancelled?.()
    ) {
      logEdgeSettle({ attempt, phase: 'cancelled-after-sleep' });
      return;
    }

    // Convergence signal 1: the first prompt is mounted and visible
    // inside the top band of the scroll container.
    const firstPromptInView = firstPromptId
      ? findFirstPromptInTopBand(container, firstPromptId)
      : null;
    if (firstPromptInView) {
      onFirstPromptVisible?.(firstPromptInView);
      logEdgeSettle({ attempt, phase: 'first-prompt-visible' });
      return;
    }

    if (edge === 'bottom') {
      const currentBottomTarget = isReverse
        ? 0
        : Math.max(0, container.scrollHeight - container.clientHeight);
      const isAtBottom =
        Math.abs(container.scrollTop - currentBottomTarget) <=
        EDGE_JUMP_BOTTOM_TOLERANCE_PX;
      logEdgeSettle({
        attempt,
        phase: isAtBottom ? 'bottom-settled' : 'bottom-displaced',
        scrollTop: container.scrollTop,
        currentBottomTarget,
        isAtBottom,
      });
      if (isAtBottom) return;
      continue;
    }

    const afterHeight = container.scrollHeight;
    const grown = afterHeight > beforeHeight + EDGE_JUMP_HEIGHT_GROWTH_EPSILON;
    logEdgeSettle({
      attempt,
      phase: 'settled',
      afterScrollTop: container.scrollTop,
      afterHeight,
      grown,
    });
    // Convergence signal 2: scrollHeight stopped growing, meaning
    // ChatGPT's mount window has stabilised at whatever boundary it
    // is willing to expose.
    if (!grown) return;
  }
  logEdgeSettle({ phase: 'hard-cap-reached' });
}

/**
 * Initiates an absolute edge scroll loop to the top or bottom of the conversation feed.
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

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';
  // Replace any previous jump's event listeners before tracking this attempt.
  stopActiveScrollIntentTracking?.();
  const jumpVersion = ++activeEdgeJumpVersion;
  const stopListening = trackManualScrollIntent(container, () => {
    if (jumpVersion !== activeEdgeJumpVersion) return;
    // Invalidate the retry loop immediately, even while it is sleeping.
    activeEdgeJumpVersion += 1;
    stopListening();
    if (stopActiveScrollIntentTracking === stopListening) {
      stopActiveScrollIntentTracking = null;
    }
  });
  stopActiveScrollIntentTracking = stopListening;

  void retryEdgeUntilSettled(
    container,
    edge,
    isReverse,
    jumpVersion,
    options.firstPromptId ?? null,
    options.isCancelled,
    options.onFirstPromptVisible
  ).finally(() => {
    stopListening();
    if (stopActiveScrollIntentTracking === stopListening) {
      stopActiveScrollIntentTracking = null;
    }
  });
}
