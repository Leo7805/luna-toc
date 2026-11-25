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
}
const SCROLL_SETTLE_DELAY_MS = 300;
const FOLLOW_AFTER_JUMP_MS = 1800;
const NAVIGATOR_BROWSE_EVENTS = [
  'wheel',
  'pointerdown',
  'touchstart',
  'keydown',
] as const;

let followUntil = 0;
let activeFollowCleanup: (() => void) | null = null;

/**
 * Starts tracking chat scrolls and sidebar browsing.
 * Idempotent: cleans up any previous Follow listeners before registering new
 * ones, and returns an identity-safe, idempotent disposer for this registration.
 *
 * @param {Object} options
 * @param {string} options.listSelector
 * @param {string} options.ignoredScrollSelector
 * @returns {() => void} Disposer that removes the listeners created by this call.
 * @example
 * const disposeFollow = initializeFollow({
 *   listSelector: '#navigator-list',
 *   ignoredScrollSelector: '#luna-toc-sidebar',
 * });
 * disposeFollow();
 */
export function initializeFollow(options: FollowOptions): () => void {
  activeFollowCleanup?.();

  const ignoredScrollSelector = options.ignoredScrollSelector;
  const handleDocumentScroll = (event: Event): void => {
    if (isIgnoredScrollEvent(event, ignoredScrollSelector)) return;
    handleChatScroll();
  };

  document.addEventListener('scroll', handleDocumentScroll, {
    capture: true,
    passive: true,
  });

  const list = document.querySelector(options.listSelector);
  if (list) {
    NAVIGATOR_BROWSE_EVENTS.forEach((eventName) => {
      list.addEventListener(eventName, stopFollowing, {
        passive: true,
      });
    });
  }

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    document.removeEventListener('scroll', handleDocumentScroll, {
      capture: true,
    });
    if (list) {
      NAVIGATOR_BROWSE_EVENTS.forEach((eventName) => {
        list.removeEventListener(eventName, stopFollowing);
      });
    }
    if (activeFollowCleanup === dispose) {
      activeFollowCleanup = null;
    }
  };

  activeFollowCleanup = dispose;
  return dispose;
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
 * Returns true for scroll events from ChatTOC UI instead of the chat page.
 * @param {Event} event
 * @param {string} ignoredSelector
 * @returns {boolean}
 */
function isIgnoredScrollEvent(event: Event, ignoredSelector: string): boolean {
  const target = event.target;

  return (
    target instanceof Element && Boolean(target.closest(ignoredSelector))
  );
}

/**
 * Opens a short follow window that lets the navigator controller update the
 * sidebar active row while the chat container is still scrolling.
 */
function handleChatScroll(): void {
  keepFollowing(SCROLL_SETTLE_DELAY_MS);
}