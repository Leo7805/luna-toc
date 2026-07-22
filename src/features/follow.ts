/**
 * Controls when ChatTOC's sidebar list is allowed to auto-scroll with the
 * active ChatGPT prompt.
 *
 * Active prompt highlighting belongs to content.js. This module only decides
 * whether that active update may also move the sidebar scroll position.
 */
interface FollowOptions {
  listSelector: string;
  ignoredScrollSelector: string;
  getNativeActiveIndex: () => number;
  setActiveIndex: (index: number) => void;
}
const SCROLL_SETTLE_DELAY_MS = 300;
const ACTIVE_SETTLE_RETRY_MS = 300;
const ACTIVE_SETTLE_ATTEMPTS = 6;
const FOLLOW_AFTER_JUMP_MS = 1800;

let followUntil = 0;
let activeSettleTimer: ReturnType<typeof setTimeout> | null = null;
let nativeActiveIndexBeforeChatScroll = -1;
let getNativeActiveIndex: () => number = () => -1;
let setActiveIndex: (index: number) => void = () => {};
let ignoredScrollSelector = '';

/**
 * Starts tracking chat scrolls and sidebar browsing.
 * @param {Object} options
 * @param {string} options.listSelector
 * @param {string} options.ignoredScrollSelector
 * @param {() => number} options.getNativeActiveIndex
 * @param {(index: number) => void} options.setActiveIndex
 */
export function initializeFollow(options: FollowOptions): void {
  getNativeActiveIndex = options.getNativeActiveIndex;
  setActiveIndex = options.setActiveIndex;
  ignoredScrollSelector = options.ignoredScrollSelector;

  document.addEventListener(
    'scroll',
    (event) => {
      if (isIgnoredScrollEvent(event)) return;

      handleChatScroll();
    },
    {
      capture: true,
      passive: true,
    }
  );

  initNavigatorBrowseTracking(options.listSelector);
}

/**
 * Returns whether active prompt updates may currently move the sidebar list.
 * @returns {boolean}
 */
export function isFollowing(): boolean {
  return Date.now() <= followUntil;
}

/**
 * Allows the sidebar list to follow active prompt changes for a short period.
 * @param {number} duration
 */
export function keepFollowing(duration = FOLLOW_AFTER_JUMP_MS): void {
  followUntil = Math.max(followUntil, Date.now() + duration);
}

/**
 * Cancels automatic sidebar follow when the user starts browsing ChatTOC
 * directly.
 */
export function stopFollowing(): void {
  followUntil = 0;
  nativeActiveIndexBeforeChatScroll = -1;
  if (activeSettleTimer !== null) clearTimeout(activeSettleTimer);
  activeSettleTimer = null;
}

/**
 * Stops following when the user directly scrolls or interacts with the TOC.
 * @param {string} listSelector
 */
function initNavigatorBrowseTracking(listSelector: string): void {
  const list = document.querySelector(listSelector);

  if (!list) return;

  ['wheel', 'pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
    list.addEventListener(eventName, stopFollowing, {
      passive: true,
    });
  });
}

/**
 * Returns true for scroll events from ChatTOC UI instead of the chat page.
 * @param {Event} event
 * @returns {boolean}
 */
function isIgnoredScrollEvent(event: Event): boolean {
  const target = event.target;

  return (
    target instanceof Element && Boolean(target.closest(ignoredScrollSelector))
  );
}

/**
 * Opens a short follow window and schedules native active settling after
 * chat/page scrolling becomes idle.
 */
function handleChatScroll(): void {
  if (!isFollowing()) {
    nativeActiveIndexBeforeChatScroll = getNativeActiveIndex();
  }

  keepFollowing(SCROLL_SETTLE_DELAY_MS);
  scheduleActiveSettle();
}

/**
 * Debounces native active settling until scrolling has paused briefly.
 */
function scheduleActiveSettle(): void {
  if (activeSettleTimer !== null) clearTimeout(activeSettleTimer);

  activeSettleTimer = setTimeout(() => {
    settleActiveFromNative(ACTIVE_SETTLE_ATTEMPTS);
  }, SCROLL_SETTLE_DELAY_MS);
}

/**
 * Retries native active reads until ChatGPT reports a changed active prompt
 * or the attempt budget is exhausted.
 * @param {number} attempts
 */
function settleActiveFromNative(attempts: number): void {
  keepFollowing(ACTIVE_SETTLE_RETRY_MS);

  const nativeIndex = getNativeActiveIndex();
  const hasNativeActive = nativeIndex !== -1;
  const nativeActiveChanged =
    hasNativeActive && nativeIndex !== nativeActiveIndexBeforeChatScroll;

  if (hasNativeActive) {
    setActiveIndex(nativeIndex);
  }

  if (nativeActiveChanged || attempts <= 1) {
    finishActiveSettle();
    return;
  }

  activeSettleTimer = setTimeout(() => {
    settleActiveFromNative(attempts - 1);
  }, ACTIVE_SETTLE_RETRY_MS);
}

/**
 * Ends the settle cycle and closes the sidebar follow window.
 */
function finishActiveSettle(): void {
  followUntil = 0;
  nativeActiveIndexBeforeChatScroll = -1;
  activeSettleTimer = null;
}
