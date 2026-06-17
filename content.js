console.log('ChatGPT Conversation Navigator loaded');

// const collectedMessages = new Map();
let conversationMessages = [];
let tooltipHideTimer = null; // Hide tooltip with a delay to allow mouseenter on the tooltip itself when moving from the item to the tooltip
let tooltipShowTimer = null; // show tooltip with a delay to avoid flickering when quickly moving mouse in and out of the item
let navigatorSearchQuery = ''; // filter navigator items by this query, set by the search input in the sidebar
let currentConversationKey = null;

/* Use to highlight current prompt*/
let navigatorItems = [];
let activePromptObserver = null;
let activePromptMutationObserver = null;
let activePromptMutationTimer = null;

const NAVIGATOR_EMPTY_HINT_TEXT = 'Waiting for prompts...';
const TOOLTIP_SHOW_DELAY_MS = 500;
const TOOLTIP_HIDE_DELAY_MS = 200;

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
        <button id="refresh-toc-btn" type="button" aria-label="Refresh TOC">
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

    <div id="navigator-list"></div>
	`;

  document.body.appendChild(sidebar);
  document
    .getElementById('refresh-toc-btn')
    .addEventListener('click', reloadCurrentPageData);

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

function resetNavigatorStateForCurrentRoute() {
  // ChatGPT is a SPA, so switching chats can keep this content script alive.
  // Clear per-conversation state when the route changes.
  conversationMessages = [];
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

function listenForRouteChanges() {
  currentConversationKey = getCurrentConversationKey();

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
  });

  document.body.appendChild(toggleBtn);
}

/**
 * Converts mixed message parts into simple TOC text labels.
 */
function getMessageDisplayText(message) {
  const content = message.content;
  const parts = content?.parts || [];
  const attachments = message.metadata?.attachments || [];

  const textParts = parts
    .map((part) => {
      if (typeof part === 'string') {
        return part.trim();
      }

      if (part?.content_type === 'image_asset_pointer') {
        return '[Image]';
      }

      if (part?.content_type) {
        return `[${part.content_type}]`;
      }

      return '[Attachment]';
    })
    .filter(Boolean);

  const attachmentParts = attachments.map((file) => {
    return `[File] ${file.name || 'Uploaded file'}`;
  });

  return [...attachmentParts, ...textParts].join('\n').trim();
}

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

function extractUserMessages(data) {
  if (!data || !data.mapping) {
    console.warn('Invalid conversation data received');
    return [];
  }

  const orderedNodes = getOrderedConversationNodes(data);

  return orderedNodes
    .filter((node) => node.message?.author?.role === 'user')
    .map((node) => {
      const message = node.message;
      const text = getMessageDisplayText(message);

      return {
        id: message.id,
        text,
        createTime: message.create_time ?? 0,
      };
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

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';
    item.textContent = `${index + 1}. ${fullText}`;

    navigatorItems[index] = item;

    item.addEventListener('click', () => {
      hideTooltip();
      jumpToMessage(message, index);
    });

    list.appendChild(item);

    if (isTextTruncated(item)) {
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

function isTextTruncated(element) {
  return element.scrollWidth > element.clientWidth;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Set the navigator item at the given index as active, and remove active state from others.
 * @param {number} index
 */
function setActiveNavigatorItem(index) {
  navigatorItems.forEach((item) => {
    item.classList.remove('navigator-item-active');
  });

  const item = navigatorItems[index];

  if (!item) return;

  item.classList.add('navigator-item-active');

  scrollNavigatorItemIntoView(item);
}

/**
 * Scroll the given navigator item into view if it's not fully visible in the sidebar.
 * @param {HTMLElement} item
 */
function scrollNavigatorItemIntoView(item) {
  const scrollContainer = document.getElementById('navigator-list');

  if (!scrollContainer) return;

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

  return conversationMessages.findIndex((message) => {
    const messageText = normalizeText(message.text);

    return domText === messageText || domText.includes(messageText);
  });
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
 * Handles conversation data sent from pageHook.js.
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
 * Listens for messages sent from pageHook.js.
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
        const rawText = getMessageDisplayText(newMessage);

        const normalizedMessage = {
          id: newMessage.id,
          text: rawText.trim(),
          createTime: newMessage.createTime ?? Date.now(),
        };

        conversationMessages.push(normalizedMessage);
        buildNavigator();

        console.log('❤️[Navigator] after:', conversationMessages.length);
      } else {
        console.log('❤️[Navigator] duplicate message ignored');
      }
    }
  });
}

/** Scrolls to the given element and applies a temporary highlight effect.
 * @param {HTMLElement} element
 */
function scrollToMatchedElement(element) {
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });

  element.style.outline = '2px solid #60a5fa';
  element.style.borderRadius = '8px';

  setTimeout(() => {
    element.style.outline = '';
    element.style.borderRadius = '';
  }, 1200);
}

/**
 * Jump to the user message element by matching its text content.
 * @param {Object} message
 * @param {number} index
 */
function jumpToMessage(message, index) {
  if (jumpToPromptByIndex(index)) {
    retryJumpToUserMessageByText(message.text);
    return;
  }

  if (jumpToUserMessageByText(message.text)) return;

  jumpToVisibleUserMessageByIndex(index);
}

/**
 * Jumps to a prompt button by its index.
 * @param {number} index
 * @returns true if jump succeeded, false otherwise
 */
function jumpToPromptByIndex(index) {
  const buttons = Array.from(
    document.querySelectorAll('[aria-label^="Prompt"]')
  );

  const button = buttons[index];

  if (!button) {
    return false;
  }

  button.click();
  return true;
}

/**
 * Jumps to a user message by its text content.
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
 * Jumps to a visible user message by its index.
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
 * Retries jumping to a user message by text content, with a limited number of attempts.
 * @param {string} text
 * @param {number} attempts
 */
function retryJumpToUserMessageByText(text, attempts = 8) {
  if (jumpToUserMessageByText(text)) return;

  if (attempts <= 1) return;

  setTimeout(() => {
    retryJumpToUserMessageByText(text, attempts - 1);
  }, 150);
}

async function main() {
  injectFetchHook(); // Start intercepting conversation data

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
