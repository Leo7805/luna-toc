/**
 * Manages marked ChatTOC prompts, including per-conversation persistence and
 * mark button UI state.
 */
(function () {
  const STORAGE_PREFIX = 'chatToc:marks:';

  let conversationKey = null;
  let markedPromptIds = new Set();

  /**
   * Loads marked prompts for the active conversation.
   * @param {Object} options
   * @param {string} options.conversationKey
   */
  function init(options) {
    conversationKey = options.conversationKey;
    markedPromptIds = load();
  }

  /**
   * Returns whether a message is currently marked.
   * @param {string} messageId
   * @returns {boolean}
   */
  function isMarked(messageId) {
    return markedPromptIds.has(messageId);
  }

  /**
   * Creates the mark button for one navigator row and wires its click handler.
   * @param {Object} params
   * @param {HTMLElement} params.item Navigator row element.
   * @param {string} params.messageId ChatGPT message ID.
   * @returns {HTMLButtonElement}
   */
  function createButton({ item, messageId }) {
    const markButton = document.createElement('button');

    markButton.className = 'navigator-mark-btn';
    markButton.type = 'button';
    markButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    `;

    applyState(item, markButton, isMarked(messageId));

    markButton.addEventListener('click', (event) => {
      event.stopPropagation();

      const nextMarked = toggle(messageId);

      applyState(item, markButton, nextMarked);
      window.ChatTocOutline?.syncMarkState?.();
      markButton.blur();
    });

    return markButton;
  }

  /**
   * Toggles one prompt's mark state.
   * @param {string} messageId
   * @returns {boolean} true when the prompt is marked after toggling.
   */
  function toggle(messageId) {
    if (!messageId) return false;

    if (markedPromptIds.has(messageId)) {
      markedPromptIds.delete(messageId);
    } else {
      markedPromptIds.add(messageId);
    }

    save();
    return markedPromptIds.has(messageId);
  }

  /**
   * Applies mark state to a navigator row and its mark button.
   * @param {HTMLElement} item
   * @param {HTMLButtonElement} markButton
   * @param {boolean} isMarked
   */
  function applyState(item, markButton, isMarked) {
    item.classList.toggle('navigator-item-marked', isMarked);
    markButton.classList.toggle('navigator-mark-btn-active', isMarked);
    markButton.setAttribute('aria-pressed', String(isMarked));
    markButton.setAttribute(
      'aria-label',
      isMarked ? 'Unmark prompt' : 'Mark prompt'
    );
  }

  /**
   * Loads marked prompt IDs from sessionStorage.
   * @returns {Set<string>}
   */
  function load() {
    try {
      const rawValue = sessionStorage.getItem(getStorageKey());
      const parsedValue = rawValue ? JSON.parse(rawValue) : [];

      return new Set(Array.isArray(parsedValue) ? parsedValue : []);
    } catch {
      return new Set();
    }
  }

  /**
   * Persists marked prompt IDs to sessionStorage.
   */
  function save() {
    try {
      sessionStorage.setItem(
        getStorageKey(),
        JSON.stringify([...markedPromptIds])
      );
    } catch {}
  }

  /**
   * Returns the sessionStorage key for the active conversation.
   * @returns {string}
   */
  function getStorageKey() {
    return `${STORAGE_PREFIX}${conversationKey}`;
  }

  window.ChatTocPromptMark = {
    createButton,
    init,
    isMarked,
  };
})();
