/**
 * Handles jumping from ChatTOC items to ChatGPT prompt positions.
 */
(function () {
  let lastNonTextHighlightIndex = null;
  let lastNonTextHighlightElement = null;
  let getNativePromptButtons = () => [];
  let normalizeText = (text) => text;
  let lockActiveIndex = () => {};

  /**
   * Connects jump behavior to content.js state and native TOC helpers.
   * @param {Object} options
   * @param {() => HTMLElement[]} options.getNativePromptButtons
   * @param {(text: string) => string} options.normalizeText
   * @param {(index: number, duration?: number) => void} options.lockActiveIndex
   */
  function init(options) {
    getNativePromptButtons = options.getNativePromptButtons;
    normalizeText = options.normalizeText;
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

    const messages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    if (messages.length > 0) {
      const targetElement = edge === 'top' ? messages[0] : messages.at(-1);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
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
   * Scrolls to the given element and applies a temporary highlight effect.
   * @param {HTMLElement} element
   */
  function scrollToMatchedElement(element) {
    window.ChatTocFollow.keepFollowing();

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    highlightMatchedElement(element);
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
   * Fallback for already-rendered messages: find a user message whose DOM text
   * matches the captured prompt text.
   * @param {string} text
   * @returns {boolean} true if jump succeeded, false otherwise.
   */
  function jumpToUserMessageByText(text) {
    const targetText = normalizeText(text);

    const userMessageElements = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    const matchedElement = userMessageElements.find((element) => {
      const domText = normalizeText(element.innerText);
      return domText === targetText || domText.includes(targetText);
    });

    if (!matchedElement) {
      return false;
    }

    scrollToMatchedElement(matchedElement);
    return true;
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

    const message = messages[index];

    if (!message) {
      return false;
    }

    scrollToMatchedElement(message);
    return true;
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
    attempts = 14
  ) {
    if (message.canMatchByText && jumpToUserMessageByText(message.text)) return;

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
