/**
 * Handles jumping from ChatTOC items to ChatGPT prompt positions.
 */
(function () {
  let lastNonTextHighlightIndex = null;
  let lastNonTextHighlightElement = null;
  let getNativePromptButtons = () => [];
  let normalizeText = (text) => text;
  let findConversationIndexByElement = () => -1;
  let getConversationMessageCount = () => 0;
  let lockActiveIndex = () => {};
  let virtualScanToken = 0;
  const debugStorageKey = 'chatTocDebugJump';

  /**
   * Connects jump behavior to content.js state and native TOC helpers.
   * @param {Object} options
   * @param {() => HTMLElement[]} options.getNativePromptButtons
   * @param {(text: string) => string} options.normalizeText
   * @param {(element: HTMLElement) => number} options.findConversationIndexByElement
   * @param {() => number} options.getConversationMessageCount
   * @param {(index: number, duration?: number) => void} options.lockActiveIndex
   */
  function init(options) {
    getNativePromptButtons = options.getNativePromptButtons;
    normalizeText = options.normalizeText;
    findConversationIndexByElement = options.findConversationIndexByElement;
    getConversationMessageCount = options.getConversationMessageCount;
    lockActiveIndex = options.lockActiveIndex;
  }

  /**
   * Jumps to the first or last prompt using ChatGPT's native TOC when available.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToConversationEdge(edge) {
    const buttons = getNativePromptButtons();
    const button = edge === 'top' ? buttons[0] : buttons.at(-1);

    window.ChatTocFollow.keepFollowing();

    if (button) {
      button.click();
      return;
    }

    jumpToAbsoluteEdge(edge, 'smooth');
  }

  /**
   * Applies a temporary highlight effect to a rendered prompt element.
   * @param {HTMLElement} element
   */
  function highlightMatchedElement(element) {
    element.style.outline = '2px solid #60a5fa';
    element.style.borderRadius = '8px';

    setTimeout(() => {
      element.style.outline = '';
      element.style.borderRadius = '';
    }, 1200);
  }

  /**
   * Highlights an element after it enters the viewport, with a timeout fallback.
   * @param {HTMLElement} element
   */
  function highlightWhenVisible(element) {
    let didHighlight = false;
    let observer = null;

    const finish = () => {
      if (didHighlight) return;

      didHighlight = true;
      observer?.disconnect();
      highlightMatchedElement(element);
    };

    const fallbackTimer = setTimeout(finish, 900);

    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.2) return;

        clearTimeout(fallbackTimer);
        finish();
      },
      {
        threshold: [0.2],
      }
    );

    observer.observe(element);
  }

  /**
   * Scrolls to the given element and applies a temporary highlight effect.
   * @param {HTMLElement} element
   * @param {ScrollBehavior} [behavior='smooth']
   * @param {ScrollLogicalPosition} [block='center']
   */
  function scrollToMatchedElement(element, behavior = 'smooth', block = 'center') {
    window.ChatTocFollow.keepFollowing();

    element.scrollIntoView({
      behavior,
      block,
    });

    highlightWhenVisible(element);
  }

  /**
   * Jumps to a prompt. Prefer ChatGPT's built-in prompt navigator because it can
   * scroll virtualized conversations; DOM text/index fallbacks only work for
   * messages currently rendered in the page.
   * @param {Object} message
   * @param {number} index
   */
  function jumpToMessage(message, index) {
    lockActiveIndex(index, message.canMatchByText ? 1800 : 4000);

    if (jumpToPromptByIndex(index)) {
      retryHighlightJumpTarget(
        message,
        index,
        getNonTextJumpStartElement(message)
      );

      return;
    }

    if (message.canMatchByText && jumpToUserMessageByText(message.text)) return;

    if (
      message.canMatchByText &&
      jumpToUserMessageByVirtualScan(message, index)
    ) {
      return;
    }

    jumpToVisibleUserMessageByIndex(index);
  }

  /**
   * Clicks ChatGPT's built-in prompt navigator item.
   * @param {number} index
   * @returns {boolean} true if jump succeeded, false otherwise.
   */
  function jumpToPromptByIndex(index) {
    const buttons = getNativePromptButtons();
    const button = buttons[index];

    if (!button) {
      return false;
    }

    button.click();
    return true;
  }

  /**
   * Jumps to a prompt by index and locks ChatTOC's active row while ChatGPT
   * scrolls virtualized content into place.
   * @param {number} index
   * @param {number} duration
   * @returns {boolean}
   */
  function jumpToPromptIndex(index, duration = 4000) {
    lockActiveIndex(index, duration);
    window.ChatTocFollow.keepFollowing(duration);

    return jumpToPromptByIndex(index);
  }

  /**
   * Locks ChatTOC's active row without asking ChatGPT to navigate again.
   * @param {number} index
   * @param {number} duration
   */
  function lockPromptIndex(index, duration = 1800) {
    lockActiveIndex(index, duration);
    window.ChatTocFollow.keepFollowing(duration);
  }

  /**
   * Logs jump fallback diagnostics when explicitly enabled in localStorage.
   * @param {string} eventName
   * @param {Object} details
   */
  function debugJump(eventName, details = {}) {
    try {
      if (window.localStorage.getItem(debugStorageKey) !== '1') return;
      console.debug('[LunaTOC jump]', eventName, details);
    } catch (e) {
      // Ignore debug logging failures.
    }
  }

  /**
   * Fallback for already-rendered messages: find a user message whose DOM text
   * matches the captured prompt text.
   * @param {string} text
   * @param {Object} [options]
   * @param {ScrollBehavior} [options.behavior='smooth']
   * @param {ScrollLogicalPosition} [options.block='center']
   * @returns {boolean} true if jump succeeded, false otherwise.
   */
  function jumpToUserMessageByText(text, options = {}) {
    const { behavior = 'smooth', block = 'center' } = options;
    const matchedElement = findUserMessageByText(text);

    if (!matchedElement) {
      return false;
    }

    scrollToMatchedElement(matchedElement, behavior, block);
    return true;
  }

  /**
   * Highlights a rendered user message by text without changing scroll position.
   * @param {string} text
   * @returns {boolean} true if a visible rendered target was highlighted.
   */
  function highlightVisibleUserMessageByText(text) {
    const matchedElement = findUserMessageByText(text, {
      requireVisible: true,
    });

    if (!matchedElement) {
      return false;
    }

    highlightMatchedElement(matchedElement);
    return true;
  }

  /**
   * Finds a rendered user message whose DOM text matches the captured prompt.
   * @param {string} text
   * @param {Object} [options]
   * @param {boolean} [options.requireVisible=false]
   * @returns {HTMLElement | null}
   */
  function findUserMessageByText(text, options = {}) {
    const { requireVisible = false } = options;
    const targetText = normalizeTextForMatch(text);

    return Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    ).find((element) => {
      if (requireVisible && !isElementVisibleInViewport(element)) {
        return false;
      }

      const domText = normalizeTextForMatch(element.innerText);
      return isTextMatch(domText, targetText);
    }) || null;
  }

  /**
   * Returns whether an element is visibly inside the viewport.
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  function isElementVisibleInViewport(element) {
    const rect = element.getBoundingClientRect();

    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  /**
   * Normalizes rendered/user text for DOM matching without changing display text.
   * @param {string} text
   * @returns {string}
   */
  function normalizeTextForMatch(text) {
    return normalizeText(text)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Returns whether rendered DOM text matches the captured prompt text.
   * @param {string} domText
   * @param {string} targetText
   * @returns {boolean}
   */
  function isTextMatch(domText, targetText) {
    if (!domText || !targetText) return false;
    if (domText === targetText || domText.includes(targetText)) return true;

    const prefix = targetText.slice(0, 40).trim();
    const suffix = targetText.slice(-30).trim();

    return (
      prefix.length >= 16 &&
      suffix.length >= 12 &&
      domText.includes(prefix) &&
      domText.includes(suffix)
    );
  }

  /**
   * Last-resort fallback for non-virtualized pages where all user messages are
   * present in the DOM.
   * @param {number} index
   * @returns {boolean} true if jump succeeded, false otherwise.
   */
  function jumpToVisibleUserMessageByIndex(index) {
    const messages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    if (messages.length !== getConversationMessageCount()) {
      return false;
    }

    const message = messages[index];

    if (!message) {
      return false;
    }

    scrollToMatchedElement(message);
    return true;
  }

  /**
   * Searches virtualized conversations by scrolling until the target text is
   * rendered, then uses the regular DOM text match.
   * @param {Object} message
   * @param {number} index
   * @returns {boolean} true when a scan was started or the target was found.
   */
  function jumpToUserMessageByVirtualScan(message, index) {
    const container = getChatScrollContainer();
    const messageCount = getConversationMessageCount();

    if (!container) {
      debugJump('virtual-scan:no-container', { index });
      return false;
    }

    const edge = getTargetEdge(index, messageCount);
    if (edge) {
      jumpToVirtualScanEdge(message.text, container, edge);
      return true;
    }

    const edgeScan = getAdjacentEdgeScan(container, index, messageCount);
    const direction = edgeScan?.direction || getVirtualScanDirection(index);
    const token = ++virtualScanToken;
    const step = Math.max(window.innerHeight * 0.85, 1200);
    const maxAttempts = 24;
    const initialTop =
      edgeScan?.initialTop ?? getEstimatedScrollTop(container, index, messageCount);

    window.ChatTocFollow.keepFollowing(4500);

    if (initialTop !== null) {
      container.scrollTo({
        top: initialTop,
        behavior: 'auto',
      });
    }

    debugJump('virtual-scan:start', {
      index,
      direction,
      step,
      attempts: maxAttempts,
      initialTop,
      edgeScan: edgeScan?.edge || null,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      container: getDebugElementLabel(container),
    });

    scanForRenderedMessage(message.text, {
      container,
      direction,
      step,
      attempts: maxAttempts,
      token,
    });

    return true;
  }

  /**
   * Returns the absolute edge for first/last prompt targets.
   * @param {number} index
   * @param {number} messageCount
   * @returns {'top' | 'bottom' | null}
   */
  function getTargetEdge(index, messageCount) {
    if (index === 0) return 'top';
    if (messageCount > 0 && index === messageCount - 1) return 'bottom';

    return null;
  }

  /**
   * Handles first/last prompt targets with an absolute edge jump, then retries
   * text matching after ChatGPT has mounted the edge content.
   * @param {string} text
   * @param {HTMLElement} container
   * @param {'top' | 'bottom'} edge
   */
  function jumpToVirtualScanEdge(text, container, edge) {
    const token = ++virtualScanToken;
    const targetTop = edge === 'top' ? 0 : container.scrollHeight;

    window.ChatTocFollow.keepFollowing(2500);
    container.scrollTo({
      top: targetTop,
      behavior: 'auto',
    });

    debugJump('virtual-scan:edge-jump', {
      edge,
      targetTop,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      container: getDebugElementLabel(container),
    });

    retryFindRenderedMessage(text, {
      container,
      token,
      attempts: 10,
      delay: 120,
    });
  }

  /**
   * Estimates a useful starting scrollTop for middle prompt scan fallback.
   * @param {HTMLElement} container
   * @param {number} index
   * @param {number} messageCount
   * @returns {number | null}
   */
  function getEstimatedScrollTop(container, index, messageCount) {
    if (messageCount <= 1) return null;

    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const ratio = index / (messageCount - 1);

    return Math.max(0, Math.min(maxTop, maxTop * ratio));
  }

  /**
   * Starts near-edge prompt scans from the nearest absolute edge instead of a
   * proportional estimate, which is unstable for very long messages.
   * @param {HTMLElement} container
   * @param {number} index
   * @param {number} messageCount
   * @returns {{edge: string, initialTop: number, direction: 1 | -1} | null}
   */
  function getAdjacentEdgeScan(container, index, messageCount) {
    if (index === 1) {
      return {
        edge: 'top-adjacent',
        initialTop: 0,
        direction: 1,
      };
    }

    if (messageCount > 2 && index === messageCount - 2) {
      return {
        edge: 'bottom-adjacent',
        initialTop: container.scrollHeight,
        direction: -1,
      };
    }

    return null;
  }

  /**
   * Chooses the scan direction by comparing the target index with the currently
   * centered rendered prompt index.
   * @param {number} targetIndex
   * @returns {1 | -1}
   */
  function getVirtualScanDirection(targetIndex) {
    const centeredIndex = getCenteredVisibleConversationIndex();

    if (centeredIndex !== -1 && targetIndex < centeredIndex) {
      return -1;
    }

    return 1;
  }

  /**
   * Returns the mapped conversation index closest to the viewport center.
   * @returns {number}
   */
  function getCenteredVisibleConversationIndex() {
    const messages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    if (messages.length === 0) return -1;

    const viewportCenter = window.innerHeight / 2;
    const indexedMessages = messages
      .map((element) => {
        const index = findConversationIndexByElement(element);
        const rect = element.getBoundingClientRect();
        const center = rect.top + rect.height / 2;

        return {
          index,
          distance: Math.abs(center - viewportCenter),
        };
      })
      .filter((item) => item.index !== -1)
      .sort((a, b) => a.distance - b.distance);

    return indexedMessages[0]?.index ?? -1;
  }

  /**
   * Repeatedly advances the scroll container until the target prompt is rendered.
   * @param {string} text
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {1 | -1} options.direction
   * @param {number} options.step
   * @param {number} options.attempts
   * @param {number} options.token
   */
  function scanForRenderedMessage(text, options) {
    if (options.token !== virtualScanToken) {
      debugJump('virtual-scan:stale-token', {
        token: options.token,
        activeToken: virtualScanToken,
      });
      return;
    }

    if (
      jumpToUserMessageByText(text, {
        behavior: 'auto',
        block: 'center',
      })
    ) {
      debugJump('virtual-scan:target-found', {
        attemptsRemaining: options.attempts,
        scrollTop: options.container.scrollTop,
      });
      return;
    }

    if (options.attempts <= 0) {
      debugJump('virtual-scan:max-attempts', {
        scrollTop: options.container.scrollTop,
      });
      return;
    }

    const currentTop = options.container.scrollTop;
    const maxTop = Math.max(
      0,
      options.container.scrollHeight - options.container.clientHeight
    );
    const nextTop =
      options.direction === 1
        ? Math.min(currentTop + options.step, maxTop)
        : Math.max(currentTop - options.step, 0);

    debugJump('virtual-scan:step', {
      attemptsRemaining: options.attempts,
      direction: options.direction,
      currentTop,
      nextTop,
      maxTop,
      scrollHeight: options.container.scrollHeight,
      clientHeight: options.container.clientHeight,
    });

    if (Math.abs(nextTop - currentTop) < 1) {
      debugJump('virtual-scan:edge-reached', {
        currentTop,
        nextTop,
        maxTop,
        direction: options.direction,
      });
      return;
    }

    options.container.scrollTo({
      top: nextTop,
      behavior: 'auto',
    });

    setTimeout(() => {
      scanForRenderedMessage(text, {
        ...options,
        attempts: options.attempts - 1,
      });
    }, 90);
  }

  /**
   * Retries matching rendered text after a direct edge or estimated jump.
   * @param {string} text
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {number} options.token
   * @param {number} options.attempts
   * @param {number} options.delay
   */
  function retryFindRenderedMessage(text, options) {
    if (options.token !== virtualScanToken) return;

    if (
      jumpToUserMessageByText(text, {
        behavior: 'auto',
        block: 'center',
      })
    ) {
      debugJump('virtual-scan:target-found-after-jump', {
        attemptsRemaining: options.attempts,
        scrollTop: options.container.scrollTop,
      });
      return;
    }

    if (options.attempts <= 0) {
      debugJump('virtual-scan:retry-miss', {
        scrollTop: options.container.scrollTop,
      });
      return;
    }

    setTimeout(() => {
      retryFindRenderedMessage(text, {
        ...options,
        attempts: options.attempts - 1,
      });
    }, options.delay);
  }

  /**
   * Returns a compact element label for debug output.
   * @param {HTMLElement} element
   * @returns {string}
   */
  function getDebugElementLabel(element) {
    const id = element.id ? `#${element.id}` : '';
    const className =
      typeof element.className === 'string'
        ? `.${element.className.trim().replace(/\s+/g, '.')}`
        : '';

    return `${element.tagName.toLowerCase()}${id}${className}`;
  }

  /**
   * Retries highlighting after ChatGPT's built-in prompt navigator scrolls.
   * Pure text prompts can be matched by DOM text; prompts with files/images fall
   * back to the user message closest to the viewport center after the scroll.
   * @param {Object} message
   * @param {number} index
   * @param {HTMLElement | null} startElement
   * @param {number} attempts
   */
  function retryHighlightJumpTarget(
    message,
    index,
    startElement = null,
    attempts = message.canMatchByText ? 28 : 14
  ) {
    if (
      message.canMatchByText &&
      highlightVisibleUserMessageByText(message.text)
    ) {
      return;
    }

    if (
      !message.canMatchByText &&
      highlightNonTextJumpTarget(index, startElement, attempts)
    ) {
      return;
    }

    if (attempts <= 1) return;

    setTimeout(() => {
      retryHighlightJumpTarget(message, index, startElement, attempts - 1);
    }, message.canMatchByText ? 150 : 250);
  }

  /**
   * Captures the current center message before a non-text prompt jump starts so
   * retry logic can avoid highlighting the old scroll position.
   * @param {Object} message
   * @returns {HTMLElement | null}
   */
  function getNonTextJumpStartElement(message) {
    return message.canMatchByText ? null : getCenteredVisibleUserMessage();
  }

  /**
   * Highlights the non-text jump target without scrolling. ChatGPT's built-in
   * prompt navigator owns the actual scroll for file/image prompts.
   * @param {number} index
   * @param {HTMLElement | null} startElement
   * @param {number} attempts
   * @returns {boolean}
   */
  function highlightNonTextJumpTarget(index, startElement, attempts) {
    const message = getCenteredVisibleUserMessage();

    if (!message) return false;

    const isRepeatClick =
      index === lastNonTextHighlightIndex &&
      message === lastNonTextHighlightElement;
    const shouldWaitForScroll = attempts > 1 && !isRepeatClick;

    if (shouldWaitForScroll && message === startElement) {
      return false;
    }

    highlightMatchedElement(message);
    lastNonTextHighlightIndex = index;
    lastNonTextHighlightElement = message;
    return true;
  }

  /**
   * Returns the visible user message whose center is closest to the viewport
   * center, or null if no user message is currently rendered.
   * @returns {HTMLElement | null}
   */
  function getCenteredVisibleUserMessage() {
    const messages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    if (messages.length === 0) return null;

    const viewportCenter = window.innerHeight / 2;
    return messages
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const center = rect.top + rect.height / 2;

        return {
          element,
          distance: Math.abs(center - viewportCenter),
        };
      })
      .sort((a, b) => a.distance - b.distance)[0]?.element;
  }

  /**
   * Scroll the ChatGPT chat feed to the absolute top or bottom.
   * @param {'top' | 'bottom'} edge
   * @param {'smooth' | 'auto'} [behavior='auto']
   */
  function jumpToAbsoluteEdge(edge, behavior = 'auto') {
    window.ChatTocFollow.keepFollowing();

    const container = getChatScrollContainer();
    if (container) {
      const targetTop = edge === 'top' ? 0 : container.scrollHeight;
      container.scrollTo({
        top: targetTop,
        behavior,
      });

      // Override any pending smooth scrolls from click events
      if (behavior === 'auto') {
        setTimeout(() => {
          container.scrollTo({ top: targetTop, behavior: 'auto' });
        }, 50);
        setTimeout(() => {
          container.scrollTo({ top: targetTop, behavior: 'auto' });
        }, 100);
      }
    }
  }

  /**
   * Finds the scrollable container of ChatGPT's main message feed.
   * @returns {HTMLElement|null}
   */
  function getChatScrollContainer() {
    // 1. Try to find a message element and traverse up to its scrollable parent
    const sampleMessage = document.querySelector('[data-message-author-role="user"]') || 
                          document.querySelector('[data-message-author-role="assistant"]');
    if (sampleMessage) {
      let parent = sampleMessage.parentElement;
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    // 2. Fallback to selectors
    const reactScrollDiv = document.querySelector('main div.overflow-y-auto') || 
                           document.querySelector('[class*="react-scroll-to-bottom"]') ||
                           document.querySelector('main [class*="react-scroll-to-bottom"]');
    if (reactScrollDiv) return reactScrollDiv;

    // 3. Fallback to searching main divs
    const main = document.querySelector('main');
    if (main) {
      const divs = Array.from(main.querySelectorAll('div'));
      for (const div of divs) {
        const style = window.getComputedStyle(div);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return div;
        }
      }
    }

    return null;
  }

  window.ChatTocJump = {
    init,
    jumpToConversationEdge,
    jumpToAbsoluteEdge,
    lockPromptIndex,
    jumpToPromptIndex,
    jumpToMessage,
  };
})();
