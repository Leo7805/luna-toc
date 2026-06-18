console.log('ChatGPT Conversation Navigator loaded');

// const collectedMessages = new Map();
let conversationMessages = [];
let pinnedPromptIds = new Set();
let tooltipHideTimer = null; // Hide tooltip with a delay to allow mouseenter on the tooltip itself when moving from the item to the tooltip
let tooltipShowTimer = null; // show tooltip with a delay to avoid flickering when quickly moving mouse in and out of the item
let navigatorSearchQuery = ''; // filter navigator items by this query, set by the search input in the sidebar
let currentConversationKey = null;

/* Use to highlight current prompt*/
let navigatorItems = [];
let activePromptObserver = null;
let activePromptMutationObserver = null;
let activePromptMutationTimer = null;
let activeNativeTocObserver = null;
let activeNativeTocTimer = null;
let lockedNavigatorIndex = null;
let lockedNavigatorTimer = null;
let lastNonTextHighlightIndex = null;
let lastNonTextHighlightElement = null;

const NAVIGATOR_EMPTY_HINT_TEXT = 'Waiting for prompts...';
const TOOLTIP_SHOW_DELAY_MS = 500;
const TOOLTIP_HIDE_DELAY_MS = 200;
const WIDTH_SPOOF_MESSAGE_TYPE = 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF';
const PINNED_PROMPTS_STORAGE_PREFIX = 'chatToc:pinned:';
const NATIVE_PROMPT_BUTTON_SELECTORS = [
  'button[aria-label^="Prompt "]',
  'button[aria-label^="prompt "]',
  'button[aria-description^="Prompt "]',
  'button[aria-description^="prompt "]',
];
const NATIVE_PROMPT_BUTTON_SELECTOR = NATIVE_PROMPT_BUTTON_SELECTORS.join(',');
const ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR = NATIVE_PROMPT_BUTTON_SELECTORS
  .map((selector) => `${selector}[data-toc-active]`)
  .join(',');

/**
 * Injects pageHook.js into the real page context.
 * Content scripts run in an isolated world, so we need this injected script
 * to hook the page's own fetch calls.
 */
function injectFetchHook() {
  const script = document.createElement('script');

  script.src = chrome.runtime.getURL('pageHook.js');

  script.onload = () => {
    script.remove(); // Clean up after execution
  };

  document.documentElement.appendChild(script);
}

function waitForBody() {
  return new Promise((resolve) => {
    if (document.body) {
      resolve(document.body);
      return;
    }

    const timer = setInterval(() => {
      if (document.body) {
        clearInterval(timer);
        resolve(document.body);
      }
    }, 50);
  });
}

/**
 * Creates the floating sidebar.
 */
async function createSidebar() {
  await waitForBody();

  const sidebar = document.createElement('div');
  const conversationTitle = escapeHtml(getConversationTitle());

  sidebar.id = 'conversation-navigator-sidebar';

  sidebar.innerHTML = `
    <div id="navigator-resizer"></div>
    <div class="navigator-topbar">
      <div class="navigator-header">
        <h2 id="navigator-title">${conversationTitle}</h2>
        <button class="navigator-icon-btn" id="refresh-toc-btn" type="button" aria-label="Refresh TOC">
          <span aria-hidden="true">⟳</span>
        </button>
      </div>

      <p class="navigator-hint">
        ${NAVIGATOR_EMPTY_HINT_TEXT}
      </p>

      <input
        id="navigator-search"
        type="search"
        placeholder="Search prompts..."
        autocomplete="off"
      />
    </div>

    <div class="navigator-action-rail">
      <button class="navigator-icon-btn" id="jump-chat-top-btn" type="button" aria-label="Jump to top">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 5h12M12 19V9M7 14l5-5 5 5" />
        </svg>
      </button>
      <button class="navigator-icon-btn" id="jump-chat-bottom-btn" type="button" aria-label="Jump to bottom">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 19h12M12 5v10M7 10l5 5 5-5" />
        </svg>
      </button>
    </div>

    <div id="navigator-list"></div>
	`;

  document.body.appendChild(sidebar);
  document
    .getElementById('refresh-toc-btn')
    .addEventListener('click', reloadCurrentPageData);
  document
    .getElementById('jump-chat-top-btn')
    .addEventListener('click', () => jumpToConversationEdge('top'));
  document
    .getElementById('jump-chat-bottom-btn')
    .addEventListener('click', () => jumpToConversationEdge('bottom'));

  document
    .getElementById('navigator-search')
    .addEventListener('input', (event) => {
      navigatorSearchQuery = event.target.value;
      buildNavigator();
    });

  return sidebar;
}

function initSidebarResize(sidebar) {
  const resizer = document.getElementById('navigator-resizer');

  if (!resizer) return;

  resizer.addEventListener('mousedown', (event) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    function handleMouseMove(moveEvent) {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(520, Math.max(240, startWidth + delta));

      sidebar.style.setProperty('--navigator-width', `${nextWidth}px`);
    }

    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });
}

/**
 * Derives the visible conversation title from ChatGPT's sidebar when possible,
 * then falls back to the document title.
 */
function getConversationTitle() {
  const match = location.pathname.match(/\/c\/([^/]+)/);
  const conversationId = match?.[1];

  if (conversationId) {
    const conversationLink = document.querySelector(
      `a[href*="/c/${conversationId}"]`
    );

    const sidebarTitle = conversationLink?.innerText?.trim();

    if (sidebarTitle) {
      return sidebarTitle;
    }
  }

  return (
    document.title
      .replace(/\s*[-–]\s*ChatGPT$/i, '')
      .replace(/^ChatGPT\s*[-–]\s*/i, '')
      .trim() || 'ChatTOC'
  );
}

/**
 * Returns the route key used to reset local state when ChatGPT SPA navigation
 * switches between conversations without reloading the content script.
 */
function getCurrentConversationKey() {
  const match = location.pathname.match(/\/c\/([^/]+)/);

  return match?.[1] || `new-chat:${location.pathname}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[char];
  });
}

function reloadCurrentPageData() {
  location.reload();
}

function getPinnedPromptsStorageKey() {
  return `${PINNED_PROMPTS_STORAGE_PREFIX}${getCurrentConversationKey()}`;
}

function loadPinnedPromptIds() {
  try {
    const rawValue = localStorage.getItem(getPinnedPromptsStorageKey());
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];

    return new Set(Array.isArray(parsedValue) ? parsedValue : []);
  } catch {
    return new Set();
  }
}

function savePinnedPromptIds() {
  try {
    localStorage.setItem(
      getPinnedPromptsStorageKey(),
      JSON.stringify([...pinnedPromptIds])
    );
  } catch {}
}

function togglePinnedPrompt(messageId) {
  if (!messageId) return false;

  if (pinnedPromptIds.has(messageId)) {
    pinnedPromptIds.delete(messageId);
  } else {
    pinnedPromptIds.add(messageId);
  }

  savePinnedPromptIds();
  return pinnedPromptIds.has(messageId);
}

/**
 * Jumps to the first or last prompt using ChatGPT's native TOC when available.
 * @param {'top' | 'bottom'} edge
 */
function jumpToConversationEdge(edge) {
  const buttons = getNativePromptButtons();
  const button = edge === 'top' ? buttons[0] : buttons.at(-1);

  if (button) {
    button.click();
    return;
  }

  window.scrollTo({
    top: edge === 'top' ? 0 : document.documentElement.scrollHeight,
    behavior: 'smooth',
  });
}

/**
 * Enables the page-context width spoof only while the ChatTOC sidebar is open.
 */
function setWideViewportSpoofEnabled(enabled) {
  window.postMessage(
    {
      type: WIDTH_SPOOF_MESSAGE_TYPE,
      enabled,
    },
    '*'
  );
}

/**
 * Clears all per-conversation UI state after an in-page route change.
 */
function resetNavigatorStateForCurrentRoute() {
  // ChatGPT is a SPA, so switching chats can keep this content script alive.
  // Clear per-conversation state when the route changes.
  conversationMessages = [];
  pinnedPromptIds = loadPinnedPromptIds();
  navigatorItems = [];
  navigatorSearchQuery = '';

  const search = document.getElementById('navigator-search');
  const title = document.getElementById('navigator-title');

  if (search) {
    search.value = '';
  }

  if (title) {
    title.textContent = getConversationTitle();
  }

  hideTooltip();
  buildNavigator();
}

/**
 * Detects ChatGPT route changes and resets the navigator when the active
 * conversation changes.
 */
function syncNavigatorRouteState() {
  const nextConversationKey = getCurrentConversationKey();

  if (currentConversationKey === null) {
    currentConversationKey = nextConversationKey;
    return;
  }

  if (nextConversationKey === currentConversationKey) {
    return;
  }

  currentConversationKey = nextConversationKey;
  resetNavigatorStateForCurrentRoute();
}

/**
 * Polls for SPA route changes because ChatGPT does not always trigger a full
 * page load or a reliable browser navigation event.
 */
function listenForRouteChanges() {
  currentConversationKey = getCurrentConversationKey();
  pinnedPromptIds = loadPinnedPromptIds();

  // ChatGPT route changes do not always trigger a full page load.
  setInterval(syncNavigatorRouteState, 250);
}

function createTooltip() {
  if (document.getElementById('navigator-tooltip')) return;

  const tooltip = document.createElement('div');

  tooltip.id = 'navigator-tooltip';
  document.body.appendChild(tooltip);
}

/**
 * Creates the floating toggle button.
 */
function createToggleButton(sidebar) {
  const toggleBtn = document.createElement('button');

  toggleBtn.id = 'toggle-sidebar-btn';
  toggleBtn.className = 'sidebar-visible';
  toggleBtn.innerHTML = '☰';

  toggleBtn.addEventListener('click', () => {
    const isHidden = sidebar.classList.toggle('navigator-hidden');

    toggleBtn.classList.toggle('sidebar-hidden', isHidden);
    toggleBtn.classList.toggle('sidebar-visible', !isHidden);
    setWideViewportSpoofEnabled(!isHidden);
  });

  document.body.appendChild(toggleBtn);
}

/**
 * Converts ChatGPT message content and attachments into simple TOC text labels.
 * Non-text parts are kept as readable placeholders so image/file prompts still
 * appear in the navigator.
 */
function getMessageDisplayText(message) {
  const parts = message.content?.parts || [];
  const attachments = message.metadata?.attachments || [];
  const hasImageAttachment = attachments.some(isImageAttachment);
  const attachmentParts = attachments.map(getAttachmentDisplayText);
  const textParts = parts
    .map((part) => getContentPartDisplayText(part, hasImageAttachment))
    .filter(Boolean);

  return [...attachmentParts, ...textParts].join('\n').trim();
}

function getAttachmentDisplayText(file) {
  const label = isImageAttachment(file) ? 'Image' : 'File';

  return `[${label}] ${file.name || 'Uploaded file'}`;
}

function getContentPartDisplayText(part, hasImageAttachment) {
  if (typeof part === 'string') {
    return part.trim();
  }

  if (part?.content_type === 'image_asset_pointer') {
    return hasImageAttachment ? '' : '[Image]';
  }

  if (part?.content_type) {
    return `[${part.content_type}]`;
  }

  return '[Attachment]';
}

function isImageAttachment(file) {
  const mimeType = file.mime_type || file.mimeType || '';
  const name = file.name || '';

  return (
    mimeType.startsWith('image/') ||
    /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(name)
  );
}

function getMessageTextParts(message) {
  return (message.content?.parts || [])
    .filter((part) => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasRenderableMessageText(message) {
  return getMessageTextParts(message).length > 0;
}

function hasNonTextMessageContent(message) {
  const parts = message.content?.parts || [];
  const attachments = message.metadata?.attachments || [];

  return (
    attachments.length > 0 ||
    parts.some((part) => typeof part !== 'string')
  );
}

function isTextMatchableMessage(message) {
  return (
    hasRenderableMessageText(message) &&
    !hasNonTextMessageContent(message)
  );
}

function createNavigatorMessage(message) {
  const text = getMessageDisplayText(message);

  return {
    id: message.id,
    text,
    canMatchByText: isTextMatchableMessage(message),
    createTime: message.create_time ?? message.createTime ?? 0,
  };
}

/**
 * Walks the current conversation branch from current_node back to the root.
 * ChatGPT's mapping can contain alternate branches, so this avoids listing
 * prompts outside the active branch.
 */
function getOrderedConversationNodes(data) {
  const mapping = data.mapping;
  const orderedNodes = [];

  let currentNodeId = data.current_node;

  while (currentNodeId) {
    const node = mapping[currentNodeId];

    if (!node) break;

    orderedNodes.push(node);

    currentNodeId = node.parent;
  }

  return orderedNodes.reverse();
}

/**
 * Extracts user prompts from ChatGPT's conversation payload in display order.
 */
function extractUserMessages(data) {
  if (!data || !data.mapping) {
    console.warn('Invalid conversation data received');
    return [];
  }

  const orderedNodes = getOrderedConversationNodes(data);

  return orderedNodes
    .filter((node) => node.message?.author?.role === 'user')
    .map((node) => {
      return createNavigatorMessage(node.message);
    })
    .filter((message) => message.text.length > 0);
}

/**
 * Builds the sidebar list from conversationMessages.
 */
function buildNavigator() {
  const list = document.getElementById('navigator-list');
  const hint = document.querySelector('.navigator-hint');

  if (!list) return;

  list.innerHTML = '';
  navigatorItems = []; // Reset navigator items for new build

  // Filter messages by search query
  const normalizedQuery = normalizeText(navigatorSearchQuery).toLowerCase();

  const visibleMessages = conversationMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => {
      if (!normalizedQuery) return true;

      return normalizeText(message.text)
        .toLowerCase()
        .includes(normalizedQuery);
    });

  if (hint) {
    const hasMessages = conversationMessages.length > 0;
    const hasQuery = normalizedQuery.length > 0;

    hint.hidden = hasMessages && (!hasQuery || visibleMessages.length > 0);

    hint.textContent = hasQuery
      ? 'No matching prompts.'
      : NAVIGATOR_EMPTY_HINT_TEXT;
  }

  // Build navigator items for visible messages
  visibleMessages.forEach(({ message, index }) => {
    const fullText = message.text.replace(/\s+/g, ' ');

    const item = document.createElement('div');
    const itemText = document.createElement('span');
    const pinButton = document.createElement('button');

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';

    itemText.className = 'navigator-item-text';
    itemText.textContent = `${index + 1}. ${fullText}`;

    pinButton.className = 'navigator-pin-btn';
    pinButton.type = 'button';
    pinButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <g transform="rotate(45 12 12)">
          <path d="M8 4h8l-1 7 3 3v2H6v-2l3-3-1-7Z" />
          <path d="M12 16v5" />
        </g>
      </svg>
    `;

    setPinnedNavigatorItemState(
      item,
      pinButton,
      pinnedPromptIds.has(message.id)
    );

    navigatorItems[index] = item;

    item.addEventListener('click', () => {
      hideTooltip();
      jumpToMessage(message, index);
    });

    pinButton.addEventListener('click', (event) => {
      event.stopPropagation();

      const isPinned = togglePinnedPrompt(message.id);

      setPinnedNavigatorItemState(item, pinButton, isPinned);
      pinButton.blur();
    });

    item.append(itemText, pinButton);
    list.appendChild(item);

    if (isTextTruncated(itemText)) {
      item.addEventListener('mouseenter', (event) => {
        showTooltip(message.text, event);
      });

      item.addEventListener('mouseleave', () => {
        hideTooltip();
      });
    }
  });

  observeVisibleUserMessages(); // Re-observe messages after rebuilding the navigator
}

function setPinnedNavigatorItemState(item, pinButton, isPinned) {
  item.classList.toggle('navigator-item-pinned', isPinned);
  pinButton.classList.toggle('navigator-pin-btn-active', isPinned);
  pinButton.setAttribute('aria-pressed', String(isPinned));
  pinButton.setAttribute(
    'aria-label',
    isPinned ? 'Unpin prompt' : 'Pin prompt'
  );
}

function isTextTruncated(element) {
  return element.scrollWidth > element.clientWidth;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Applies active styling immediately, ignoring any temporary navigation lock.
 * @param {number} index
 */
function forceActiveNavigatorItem(index) {
  navigatorItems.forEach((item) => {
    item.classList.remove('navigator-item-active');
  });

  const item = navigatorItems[index];

  if (!item) return;

  item.classList.add('navigator-item-active');

  scrollNavigatorItemIntoView(item);
}

/**
 * Sets the active navigator item unless a click-triggered navigation lock is
 * temporarily preserving another item.
 * @param {number} index
 */
function setActiveNavigatorItem(index) {
  if (
    lockedNavigatorIndex !== null &&
    index !== lockedNavigatorIndex &&
    lockedNavigatorTimer
  ) {
    return;
  }

  forceActiveNavigatorItem(index);
}

/**
 * Keeps a clicked navigator item highlighted while ChatGPT performs its own
 * virtualized scroll.
 * @param {number} index
 * @param {number} duration
 */
function lockActiveNavigatorItem(index, duration = 1800) {
  clearTimeout(lockedNavigatorTimer);

  lockedNavigatorIndex = index;
  forceActiveNavigatorItem(index);

  lockedNavigatorTimer = setTimeout(() => {
    lockedNavigatorIndex = null;
    lockedNavigatorTimer = null;
  }, duration);
}

/**
 * Scroll the given navigator item into view if it's not fully visible in the sidebar.
 * @param {HTMLElement} item
 */
function scrollNavigatorItemIntoView(item) {
  const scrollContainer = document.getElementById('navigator-list');

  if (!scrollContainer) return;
  if (scrollContainer.matches(':hover')) return;

  const itemRect = item.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();

  const topPadding = 56;
  const bottomPadding = 80;

  const isAbove = itemRect.top < containerRect.top + topPadding;
  const isBelow = itemRect.bottom > containerRect.bottom - bottomPadding;

  if (!isAbove && !isBelow) return;

  const nextScrollTop = isAbove
    ? scrollContainer.scrollTop + itemRect.top - containerRect.top - topPadding
    : scrollContainer.scrollTop +
      itemRect.bottom -
      containerRect.bottom +
      bottomPadding;

  scrollContainer.scrollTo({
    top: nextScrollTop,
    behavior: 'smooth',
  });
}

/**
 * Find the index of the conversation message that matches the given DOM element, by comparing their text content.
 * @param {HTMLElement} element
 * @returns {number} The index of the conversation message that matches the given element, or -1 if not found.
 */
function findConversationIndexByElement(element) {
  const domText = normalizeText(element.innerText);

  const textMatchedIndex = conversationMessages.findIndex((message) => {
    if (!message.canMatchByText) return false;

    const messageText = normalizeText(message.text);

    return domText === messageText || domText.includes(messageText);
  });

  if (textMatchedIndex !== -1) {
    return textMatchedIndex;
  }

  const visibleUserMessages = Array.from(
    document.querySelectorAll('[data-message-author-role="user"]')
  );

  if (visibleUserMessages.length === conversationMessages.length) {
    return visibleUserMessages.indexOf(element);
  }

  return -1;
}

/**
 * Returns ChatGPT's built-in prompt navigator buttons in display order.
 * This native TOC is the reliable index source for virtualized file/image
 * prompts because ChatGPT owns that state.
 * @returns {HTMLElement[]}
 */
function getNativePromptButtons() {
  return Array.from(document.querySelectorAll(NATIVE_PROMPT_BUTTON_SELECTOR));
}

/**
 * Parses ChatGPT's native one-based prompt label into ChatTOC's zero-based index.
 * @param {HTMLElement} button
 * @returns {number}
 */
function getNativePromptIndexFromButton(button) {
  const label =
    button.getAttribute('aria-label') ||
    button.getAttribute('aria-description') ||
    '';
  const match = label.match(/^prompt\s+(\d+)$/i);

  return match ? Number(match[1]) - 1 : -1;
}

/**
 * Reads the active prompt index from ChatGPT's built-in TOC.
 * @returns {number} The active prompt index, or -1 if no native active item exists.
 */
function findActiveNativePromptIndex() {
  const activeButton = document.querySelector(
    ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR
  );

  if (!activeButton) return -1;

  const labelIndex = getNativePromptIndexFromButton(activeButton);

  if (labelIndex !== -1) return labelIndex;

  const buttons = getNativePromptButtons();

  return activeButton ? buttons.indexOf(activeButton) : -1;
}

/**
 * Syncs ChatTOC's active item from ChatGPT's native TOC when available.
 * @returns {boolean} true when native TOC provided an active index.
 */
function syncActiveNavigatorItemFromNativeToc() {
  const index = findActiveNativePromptIndex();

  if (index === -1) return false;

  setActiveNavigatorItem(index);
  return true;
}

/**
 * Observes user message elements in the page and updates the active navigator item based on which message is most visible in the viewport.
 * Uses IntersectionObserver to efficiently track visibility changes.
 */
function observeVisibleUserMessages() {
  if (activePromptObserver) {
    activePromptObserver.disconnect();
  }

  activePromptObserver = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      const topEntry = visibleEntries[0];

      if (!topEntry) return;

      if (syncActiveNavigatorItemFromNativeToc()) return;

      const index = findConversationIndexByElement(topEntry.target);

      if (index === -1) return;

      setActiveNavigatorItem(index);
    },
    {
      threshold: [0.1, 0.25, 0.5, 0.75, 1],
    }
  );

  document
    .querySelectorAll('[data-message-author-role="user"]')
    .forEach((element) => {
      activePromptObserver.observe(element);
    });
}

/**
 * Observes ChatGPT's built-in TOC active marker and mirrors it to ChatTOC.
 * This is the primary active-state source for image/file prompts.
 */
function initNativeTocActiveTracking() {
  if (activeNativeTocObserver) {
    activeNativeTocObserver.disconnect();
  }

  activeNativeTocObserver = new MutationObserver(() => {
    clearTimeout(activeNativeTocTimer);

    activeNativeTocTimer = setTimeout(() => {
      syncActiveNavigatorItemFromNativeToc();
    }, 100);
  });

  activeNativeTocObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-toc-active'],
    childList: true,
    subtree: true,
  });

  syncActiveNavigatorItemFromNativeToc();
}

/**
 * Init tracking of the active prompt in the viewport, and highlight the corresponding navigator item.
 */
function initActivePromptTracking() {
  if (activePromptMutationObserver) {
    activePromptMutationObserver.disconnect();
  }

  activePromptMutationObserver = new MutationObserver(() => {
    clearTimeout(activePromptMutationTimer);

    activePromptMutationTimer = setTimeout(() => {
      observeVisibleUserMessages();
    }, 200);
  });

  activePromptMutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  observeVisibleUserMessages();
  initNativeTocActiveTracking();
}

/**
 * Shows a tooltip with the full message text when hovering over a truncated item.
 * @param {string} text
 * @param {MouseEvent} event
 */
function showTooltip(text, event) {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  clearTimeout(tooltipHideTimer);
  clearTimeout(tooltipShowTimer);

  tooltipHideTimer = null;
  tooltipShowTimer = null;
  tooltip.classList.remove('visible');

  const clientX = event.clientX;
  const clientY = event.clientY;

  tooltipShowTimer = setTimeout(() => {
    tooltip.textContent = text;
    tooltip.classList.add('visible');

    const gap = 8;
    const margin = 16;
    const scrollContainer = document.getElementById('navigator-list');
    const containerRect = scrollContainer?.getBoundingClientRect();

    let y = clientY + 15;

    const rect = tooltip.getBoundingClientRect();
    const x = containerRect
      ? Math.max(margin, containerRect.left - rect.width - gap)
      : Math.max(margin, clientX - rect.width - gap);

    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - margin;
    }

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }, TOOLTIP_SHOW_DELAY_MS);
}

function hideTooltip() {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  clearTimeout(tooltipHideTimer);
  clearTimeout(tooltipShowTimer);

  tooltipShowTimer = null;

  tooltipHideTimer = setTimeout(() => {
    tooltip.classList.remove('visible');
    tooltipHideTimer = null;
  }, TOOLTIP_HIDE_DELAY_MS);
}

function initTooltip() {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  tooltip.addEventListener('mouseenter', () => {
    clearTimeout(tooltipHideTimer);
  });

  tooltip.addEventListener('mouseleave', () => {
    hideTooltip();
  });
}

/**
 * Handles the full conversation payload captured by pageHook.js and rebuilds
 * the navigator from the active conversation branch.
 */
function handleConversationData(data) {
  if (!data || !data.mapping) {
    return;
  }

  const title = document.getElementById('navigator-title');

  if (title) {
    title.textContent = getConversationTitle();
  }

  conversationMessages = extractUserMessages(data);

  console.log('✅ [Navigator] update navigator', conversationMessages.length);

  buildNavigator();
}

/**
 * Listens for pageHook.js messages from the page context. Full conversation
 * payloads rebuild the TOC; streamed input_message events append the latest
 * prompt before ChatGPT performs a full conversation refetch.
 */
function listenForConversationData() {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    syncNavigatorRouteState();

    if (event.data?.type === 'CHATGPT_CONVERSATION_DATA') {
      handleConversationData(event.data.payload);
    }

    if (event.data?.type === 'CHATGPT_NEW_USER_MESSAGE') {
      const newMessage = event.data.payload;

      console.log(
        '[Navigator] Captured input message:',
        getMessageDisplayText(newMessage)
      );
      console.log('[Navigator] New user message:', newMessage);
      console.log('[Navigator] before:', conversationMessages.length);

      const exists = conversationMessages.some(
        (message) => message.id === newMessage.id
      );

      if (!exists) {
        const normalizedMessage = createNavigatorMessage(newMessage);

        conversationMessages.push(normalizedMessage);
        buildNavigator();

        console.log('❤️[Navigator] after:', conversationMessages.length);
      } else {
        console.log('❤️[Navigator] duplicate message ignored');
      }
    }
  });
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

/** Scrolls to the given element and applies a temporary highlight effect.
 * @param {HTMLElement} element
 */
function scrollToMatchedElement(element) {
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
  lockActiveNavigatorItem(index, message.canMatchByText ? 1800 : 4000);

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
 * Clicks ChatGPT's built-in prompt navigator item. This depends on ChatGPT's
 * current aria-label convention and is why pageHook.js keeps that navigator
 * mounted in split-view layouts.
 * @param {number} index
 * @returns true if jump succeeded, false otherwise
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
 * Fallback for already-rendered messages: find a user message whose DOM text
 * matches the captured prompt text.
 * @param {string} text
 * @returns {boolean} true if jump succeeded, false otherwise
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
 * @returns true if jump succeeded, false otherwise
 */
function jumpToVisibleUserMessageByIndex(index) {
  const messages = Array.from(
    document.querySelectorAll('[data-message-author-role="user"]')
  );

  const message = messages[index];

  if (!message) {
    console.log('[Navigator] Visible user message not found:', index + 1);
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

async function main() {
  injectFetchHook(); // Start intercepting conversation data
  pinnedPromptIds = loadPinnedPromptIds();

  listenForConversationData(); // Listen for data sent from the fetch hook

  const sidebar = await createSidebar();

  initSidebarResize(sidebar);
  listenForRouteChanges();
  initActivePromptTracking();
  createToggleButton(sidebar);

  createTooltip();
  initTooltip();
}

main();
