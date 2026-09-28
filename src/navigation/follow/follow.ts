/**
 * Controls when LunaTOC's sidebar list is allowed to auto-scroll with the
 * active ChatGPT prompt.
 *
 * Active prompt highlighting belongs to the navigator controller. This module only decides
 * whether that active update may also move the sidebar scroll position.
 */
interface FollowOptions {
  listSelector: string;
  ignoredScrollSelector: string;
  setActiveIndex: (index: number) => void;
}
const SCROLL_SETTLE_DELAY_MS = 300;
const FOLLOW_AFTER_JUMP_MS = 1800;

let followUntil = 0;
let setActiveIndex: (index: number) => void = () => {};
let ignoredScrollSelector = '';

/**
 * Starts tracking chat scrolls and sidebar browsing.
 * @param {Object} options
 * @param {string} options.listSelector
 * @param {string} options.ignoredScrollSelector
 * @param {(index: number) => void} options.setActiveIndex
 */
export function initializeFollow(options: FollowOptions): void {
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
 * Opens a short follow window that lets the navigator controller update the
 * sidebar active row while the chat container is still scrolling.
 */
function handleChatScroll(): void {
  keepFollowing(SCROLL_SETTLE_DELAY_MS);
}