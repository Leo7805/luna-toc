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
  for (let attempt = 0; attempt < EDGE_JUMP_HARD_CAP; attempt++) {
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      isCancelled?.()
    ) {
      return;
    }

    const beforeHeight = container.scrollHeight;
    const maxScrollTop = beforeHeight - container.clientHeight;
    const targetTop = edge === 'top'
      ? (isReverse ? -maxScrollTop : 0)
      : (isReverse ? 0 : maxScrollTop);

    container.scrollTop = targetTop;

    await new Promise<void>(function (resolve) {
      setTimeout(resolve, EDGE_JUMP_SETTLE_MS);
    });
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      isCancelled?.()
    ) {
      return;
    }

    // Convergence signal 1: the first prompt is mounted and visible
    // inside the top band of the scroll container.
    const firstPromptInView = firstPromptId
      ? findFirstPromptInTopBand(container, firstPromptId)
      : null;
    if (firstPromptInView) {
      onFirstPromptVisible?.(firstPromptInView);
      return;
    }

    if (edge === 'bottom') {
      const currentBottomTarget = isReverse
        ? 0
        : Math.max(0, container.scrollHeight - container.clientHeight);
      const isAtBottom =
        Math.abs(container.scrollTop - currentBottomTarget) <=
        EDGE_JUMP_BOTTOM_TOLERANCE_PX;
      if (isAtBottom) return;
      continue;
    }

    const afterHeight = container.scrollHeight;
    const grown = afterHeight > beforeHeight + EDGE_JUMP_HEIGHT_GROWTH_EPSILON;
    // Convergence signal 2: scrollHeight stopped growing, meaning
    // ChatGPT's mount window has stabilised at whatever boundary it
    // is willing to expose.
    if (!grown) return;
  }
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
  const jumpVersion = ++activeEdgeJumpVersion;

  void retryEdgeUntilSettled(
    container,
    edge,
    isReverse,
    jumpVersion,
    options.firstPromptId ?? null,
    options.isCancelled,
    options.onFirstPromptVisible
  );
}
