/**
 * Controls when ChatTOC's sidebar list is allowed to auto-scroll with the
 * active ChatGPT prompt.
 *
 * Active prompt highlighting belongs to content.js. This module only decides
 * whether that active update may also move the sidebar scroll position.
 */
(function () {
  const SCROLL_SETTLE_DELAY_MS = 300;
  const ACTIVE_SETTLE_RETRY_MS = 300;
  const ACTIVE_SETTLE_ATTEMPTS = 6;
  const FOLLOW_AFTER_JUMP_MS = 1800;

  let followUntil = 0;
  let activeSettleTimer = null;
  let nativeActiveIndexBeforeChatScroll = -1;
  let getNativeActiveIndex = () => -1;
  let setActiveIndex = () => {};
  let ignoredScrollSelector = '';

  /**
   * Starts tracking chat scrolls and sidebar browsing.
   * @param {Object} options
   * @param {string} options.listSelector
   * @param {string} options.ignoredScrollSelector
   * @param {() => number} options.getNativeActiveIndex
   * @param {(index: number) => void} options.setActiveIndex
   */
  function init(options) {
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
  function isFollowing() {
    return Date.now() <= followUntil;
  }

  /**
   * Allows the sidebar list to follow active prompt changes for a short period.
   * @param {number} duration
   */
  function keepFollowing(duration = FOLLOW_AFTER_JUMP_MS) {
    followUntil = Math.max(followUntil, Date.now() + duration);
  }

  /**
   * Cancels automatic sidebar follow when the user starts browsing ChatTOC
   * directly.
   */
  function stopFollowing() {
    followUntil = 0;
    nativeActiveIndexBeforeChatScroll = -1;
    clearTimeout(activeSettleTimer);
    activeSettleTimer = null;
  }

  /**
   * Stops following when the user directly scrolls or interacts with the TOC.
   * @param {string} listSelector
   */
  function initNavigatorBrowseTracking(listSelector) {
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
  function isIgnoredScrollEvent(event) {
    const target = event.target;

    return (
      target instanceof Element &&
      Boolean(target.closest(ignoredScrollSelector))
    );
  }

  /**
   * Opens a short follow window and schedules native active settling after
   * chat/page scrolling becomes idle.
   */
  function handleChatScroll() {
    if (!isFollowing()) {
      nativeActiveIndexBeforeChatScroll = getNativeActiveIndex();
    }

    keepFollowing(SCROLL_SETTLE_DELAY_MS);
    scheduleActiveSettle();
  }

  /**
   * Debounces native active settling until scrolling has paused briefly.
   */
  function scheduleActiveSettle() {
    clearTimeout(activeSettleTimer);

    activeSettleTimer = setTimeout(() => {
      settleActiveFromNative(ACTIVE_SETTLE_ATTEMPTS);
    }, SCROLL_SETTLE_DELAY_MS);
  }

  /**
   * Retries native active reads until ChatGPT reports a changed active prompt
   * or the attempt budget is exhausted.
   * @param {number} attempts
   */
  function settleActiveFromNative(attempts) {
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
  function finishActiveSettle() {
    followUntil = 0;
    nativeActiveIndexBeforeChatScroll = -1;
    activeSettleTimer = null;
  }

  window.ChatTocFollow = {
    init,
    isFollowing,
    keepFollowing,
    stopFollowing,
  };
})();
