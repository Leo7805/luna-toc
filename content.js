/**
 * Main ChatTOC content script. It builds the sidebar UI, listens for captured
 * ChatGPT conversation data, and coordinates the helper modules loaded before
 * this file by manifest.json.
 */
let conversationMessages = [];
let navigatorSearchQuery = ''; // filter navigator items by this query, set by the search input in the sidebar
let currentConversationKey = null;
let pendingNewChatRouteKey = null;
let pendingNewChatMessage = null;
let activeNavigatorIndex = null;
let viewMode = 'toc'; // 'toc' or 'myPrompts'

/* Use to highlight current prompt*/
let navigatorItems = [];
let activePromptObserver = null;
let activePromptMutationObserver = null;
let activePromptMutationTimer = null;
let activeNativeTocObserver = null;
let activeNativeTocTimer = null;
let lockedNavigatorIndex = null;
let lockedNavigatorTimer = null;

const JUMP_CONTROLS_POSITION_STORAGE_KEY = 'chatTocJumpControlsPosition';

const NAVIGATOR_EMPTY_HINT_TEXT = 'Waiting for prompts...';
const NATIVE_PROMPT_BUTTON_SELECTORS = [
  'button[aria-label^="Prompt "]',
  'button[aria-label^="prompt "]',
  'button[aria-description^="Prompt "]',
  'button[aria-description^="prompt "]',
];
const NATIVE_PROMPT_BUTTON_SELECTOR = NATIVE_PROMPT_BUTTON_SELECTORS.join(',');
const ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR = NATIVE_PROMPT_BUTTON_SELECTORS.map(
  (selector) => `${selector}[data-toc-active]`
).join(',');

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

/**
 * Resolves once document.body exists. The content script runs at
 * document_start, so body may not be available immediately.
 * @returns {Promise<HTMLElement>}
 */
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
  sidebar.className = 'navigator-initializing';

  sidebar.innerHTML = `
    <div id="navigator-resizer"></div>
    <div class="navigator-topbar">
      <div class="navigator-header">
        <button
          class="navigator-icon-btn navigator-header-icon-btn sidebar-pin-btn"
          id="sidebar-pin-btn"
          type="button"
          aria-label="Enable sidebar auto-hide"
          aria-pressed="true"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
          </svg>
        </button>
        <button
          id="navigator-title"
          type="button"
          aria-label="Reset TOC view"
        >
          ${conversationTitle}
        </button>
        <button
          class="navigator-icon-btn navigator-header-icon-btn"
          id="search-toggle-btn"
          type="button"
          aria-label="Toggle search"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
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
      <div id="myprompts-toolbar-container"></div>
    </div>

    <div class="navigator-jump-controls">
      <button class="navigator-icon-btn" id="jump-chat-top-btn" type="button" aria-label="Jump to top">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 5h12M12 19V9M7 14l5-5 5 5" />
        </svg>
      </button>
      <button class="navigator-icon-btn" id="toggle-view-mode-btn" type="button" aria-label="Switch to My Prompts" title="Switch to My Prompts">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="15 2 6 13 11 13 9 22 18 11 13 11 15 2"></polygon>
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
  initNavigatorFollow();
  initNavigatorJump();

  document
    .getElementById('search-toggle-btn')
    .addEventListener('click', () => {
      const searchInput = document.getElementById('navigator-search');
      if (!searchInput) return;
      const isHidden = window.getComputedStyle(searchInput).display === 'none';
      searchInput.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        navigatorSearchQuery = '';
        buildNavigator();
      }
    });
  document
    .getElementById('navigator-title')
    .addEventListener('click', handleTitleClick);
  document
    .getElementById('jump-chat-top-btn')
    .addEventListener('click', () =>
      window.ChatTocJump.jumpToConversationEdge('top')
    );
  document
    .getElementById('jump-chat-top-btn')
    .addEventListener('dblclick', () =>
      window.ChatTocJump.jumpToAbsoluteEdge('top', 'auto')
    );
  document
    .getElementById('jump-chat-bottom-btn')
    .addEventListener('click', () =>
      window.ChatTocJump.jumpToConversationEdge('bottom')
    );
  document
    .getElementById('jump-chat-bottom-btn')
    .addEventListener('dblclick', () =>
      window.ChatTocJump.jumpToAbsoluteEdge('bottom', 'auto')
    );
  document
    .getElementById('toggle-view-mode-btn')
    .addEventListener('click', toggleViewMode);

  document
    .getElementById('navigator-search')
    .addEventListener('input', (event) => {
      navigatorSearchQuery = event.target.value;
      buildNavigator();
    });

  return sidebar;
}

/**
 * Wires the sidebar-follow state machine to native ChatGPT active prompt APIs.
 */
function initNavigatorFollow() {
  window.ChatTocFollow.init({
    listSelector: '#navigator-list',
    ignoredScrollSelector:
      '#conversation-navigator-sidebar, #navigator-tooltip',
    getNativeActiveIndex: findActiveNativePromptIndex,
    setActiveIndex: setActiveNavigatorItem,
  });
}

/**
 * Wires prompt jump behavior to native ChatGPT prompt buttons and active locks.
 */
function initNavigatorJump() {
  window.ChatTocJump.init({
    getNativePromptButtons,
    normalizeText,
    lockActiveIndex: lockActiveNavigatorItem,
  });
}

/**
 * Enables vertical dragging for the jump-controls panel and restores its
 * relative session position.
 */
function initJumpControlsPositioning() {
  const jumpControls = document.querySelector('.navigator-jump-controls');

  if (!jumpControls) return;

  restoreJumpControlsPosition(jumpControls);

  window.addEventListener('resize', () => {
    keepJumpControlsInViewport(jumpControls);
  });

  jumpControls.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button')) return;

    event.preventDefault();

    const rect = jumpControls.getBoundingClientRect();
    const startY = event.clientY;
    const startTop = rect.top;
    let didDrag = false;

    jumpControls.setPointerCapture(event.pointerId);
    jumpControls.classList.add('navigator-jump-controls-dragging');

    function handlePointerMove(moveEvent) {
      const deltaY = moveEvent.clientY - startY;

      if (!didDrag && Math.abs(deltaY) < 4) {
        return;
      }

      didDrag = true;

      const nextTop = clampJumpControlsTop(
        startTop + deltaY,
        rect.height
      );

      setJumpControlsPosition(jumpControls, nextTop);
    }

    function handlePointerUp() {
      try {
        jumpControls.releasePointerCapture(event.pointerId);
      } catch {}

      jumpControls.classList.remove('navigator-jump-controls-dragging');
      jumpControls.removeEventListener('pointermove', handlePointerMove);
      jumpControls.removeEventListener('pointerup', handlePointerUp);
      jumpControls.removeEventListener('pointercancel', handlePointerUp);

      if (!didDrag) return;

      saveJumpControlsPosition(jumpControls);
    }

    jumpControls.addEventListener('pointermove', handlePointerMove);
    jumpControls.addEventListener('pointerup', handlePointerUp);
    jumpControls.addEventListener('pointercancel', handlePointerUp);
  });
}

/**
 * Stores the jump-controls panel at the current viewport height using a
 * relative top ratio so it reflows with different window sizes.
 * @param {HTMLElement} jumpControls
 */
function saveJumpControlsPosition(jumpControls) {
  const rect = jumpControls.getBoundingClientRect();
  const topRatio = getJumpControlsTopRatio(rect.top, rect.height);

  storageSet(JUMP_CONTROLS_POSITION_STORAGE_KEY, {
    topRatio,
  });
}

/**
 * Restores the jump-controls panel from sessionStorage.
 * @param {HTMLElement} jumpControls
 */
function restoreJumpControlsPosition(jumpControls) {
  const savedPosition = storageGet(JUMP_CONTROLS_POSITION_STORAGE_KEY);

  if (!savedPosition || typeof savedPosition !== 'object') return;

  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls);

  if (nextTop == null) return;

  setJumpControlsPosition(jumpControls, nextTop);
}

/**
 * Keeps the panel inside the viewport after resize or zoom changes.
 * @param {HTMLElement} jumpControls
 */
function keepJumpControlsInViewport(jumpControls) {
  const rect = jumpControls.getBoundingClientRect();
  const savedPosition = storageGet(JUMP_CONTROLS_POSITION_STORAGE_KEY);
  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls, rect);

  if (nextTop == null) return;

  if (Math.abs(nextTop - rect.top) < 1) {
    return;
  }

  setJumpControlsPosition(jumpControls, nextTop);
  saveJumpControlsPosition(jumpControls);
}

/**
 * Applies a fixed vertical position to the jump-controls panel.
 * @param {HTMLElement} jumpControls
 * @param {number} top
 */
function setJumpControlsPosition(jumpControls, top) {
  jumpControls.style.top = `${top}px`;
}

/**
 * Reads a JSON value from sessionStorage.
 * @param {string} key
 * @returns {unknown}
 */
function storageGet(key) {
  try {
    const rawValue = sessionStorage.getItem(key);

    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

/**
 * Writes a JSON value to sessionStorage.
 * @param {string} key
 * @param {unknown} value
 */
function storageSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * Returns a clamped top coordinate for the jump-controls panel.
 * @param {number} top
 * @param {number} height
 * @returns {number}
 */
function clampJumpControlsTop(top, height) {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);

  return Math.min(maxTop, Math.max(minTop, top));
}

/**
 * Converts a top coordinate to a relative ratio for storage.
 * @param {number} top
 * @param {number} height
 * @returns {number}
 */
function getJumpControlsTopRatio(top, height) {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  const range = maxTop - minTop;

  if (range <= 0) return 0;

  return (clampJumpControlsTop(top, height) - minTop) / range;
}

/**
 * Resolves the saved top coordinate for the jump-controls panel.
 * @param {unknown} savedPosition
 * @param {HTMLElement} jumpControls
 * @param {DOMRect} [rect]
 * @returns {number | null}
 */
function getSavedJumpControlsTop(savedPosition, jumpControls, rect) {
  if (!savedPosition || typeof savedPosition !== 'object') return null;

  const panelRect = rect || jumpControls.getBoundingClientRect();

  if (Number.isFinite(savedPosition.topRatio)) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - panelRect.height - 8);
    const range = maxTop - minTop;

    return clampJumpControlsTop(
      minTop + savedPosition.topRatio * range,
      panelRect.height
    );
  }

  if (Number.isFinite(savedPosition.top)) {
    return clampJumpControlsTop(savedPosition.top, panelRect.height);
  }

  return null;
}

/**
 * Loads marked prompt state for the current ChatGPT route.
 */
function initMarkedPrompts() {
  window.ChatTocPromptMark.init({
    conversationKey: getCurrentConversationKey(),
  });
}

/**
 * Enables drag resizing for the sidebar.
 * @param {HTMLElement} sidebar
 */
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

/**
 * Returns whether a route key belongs to ChatGPT's pre-conversation new-chat
 * route.
 * @param {string} routeKey
 * @returns {boolean}
 */
function isNewChatRouteKey(routeKey) {
  return routeKey.startsWith('new-chat:');
}

/**
 * Clears new-chat creation state once a real conversation payload arrives or
 * the user navigates somewhere unrelated.
 */
function clearPendingNewChat() {
  pendingNewChatRouteKey = null;
  pendingNewChatMessage = null;
}

/**
 * Appends one streamed user message if it is not already represented.
 * @param {Object} newMessage
 * @returns {boolean} Whether the message was added.
 */
function appendNavigatorMessage(newMessage) {
  const exists = conversationMessages.some(
    (message) => message.id === newMessage.id
  );

  if (exists) return false;

  const normalizedMessage =
    window.ChatTocMessages.createNavigatorMessage(newMessage);

  conversationMessages.push(normalizedMessage);
  return true;
}

/**
 * Moves a new-chat message captured before route creation into the new
 * conversation after ChatGPT navigates to /c/<id>.
 */
function flushPendingNewChatMessage() {
  if (!pendingNewChatMessage) return;

  const didAppend = appendNavigatorMessage(pendingNewChatMessage);
  clearPendingNewChat();

  if (didAppend) {
    buildNavigator({
      refreshObservers: true,
    });
  }
}

/**
 * Escapes text inserted into sidebar HTML templates.
 * @param {string} text
 * @returns {string}
 */
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

/**
 * Updates the sidebar title text and its hover tooltip together.
 */
function setNavigatorTitle() {
  const title = document.getElementById('navigator-title');

  if (!title) return;

  const nextTitle = viewMode === 'myPrompts' ? 'MY PROMPTS' : getConversationTitle();

  title.textContent = nextTitle;
}

/**
 * Reloads the page so ChatGPT and ChatTOC both rebuild from fresh state.
 */
function reloadCurrentPageData() {
  location.reload();
}


/**
 * Restores the sidebar list to its default browsing state without changing the
 * active ChatGPT scroll position.
 */
function resetNavigatorView() {
  navigatorSearchQuery = '';
  window.ChatTocPreviewTooltip.hide();
  window.ChatTocOutline?.collapseAll?.();

  const search = document.getElementById('navigator-search');
  const list = document.getElementById('navigator-list');

  if (search) {
    search.value = '';
  }

  buildNavigator({
    refreshObservers: true,
  });

  list?.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}

/**
 * Click handler for the navigator title.
 * - In My Prompts view: scrolls the list to the top.
 * - In TOC view: resets and refreshes the list.
 */
function handleTitleClick() {
  if (viewMode === 'myPrompts') {
    const list = document.getElementById('navigator-list');
    list?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  } else {
    resetNavigatorView();
  }
}

/**
 * Clears all per-conversation UI state after an in-page route change.
 */
function resetNavigatorStateForCurrentRoute() {
  // ChatGPT is a SPA, so switching chats can keep this content script alive.
  // Clear per-conversation state when the route changes.
  conversationMessages = [];
  initMarkedPrompts();
  window.ChatTocSidebarVisibility?.syncPageState?.();
  activeNavigatorIndex = null;
  window.ChatTocOutline?.reset?.();
  navigatorItems = [];
  navigatorSearchQuery = '';

  const search = document.getElementById('navigator-search');

  if (search) {
    search.value = '';
  }

  setNavigatorTitle();

  window.ChatTocPreviewTooltip.hide();
  buildNavigator({
    refreshObservers: true,
  });
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

  const isNewChatCreationRoute =
    isNewChatRouteKey(currentConversationKey) &&
    !isNewChatRouteKey(nextConversationKey);

  if (isNewChatCreationRoute) {
    pendingNewChatRouteKey = currentConversationKey;
  } else {
    clearPendingNewChat();
  }

  currentConversationKey = nextConversationKey;
  resetNavigatorStateForCurrentRoute();
  flushPendingNewChatMessage();
}

/**
 * Polls for SPA route changes because ChatGPT does not always trigger a full
 * page load or a reliable browser navigation event.
 */
function listenForRouteChanges() {
  currentConversationKey = getCurrentConversationKey();
  initMarkedPrompts();

  // Listen to browser backward/forward navigation
  window.addEventListener('popstate', syncNavigatorRouteState);

  // Listen to programmatic pushState/replaceState route transitions
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CHATGPT_ROUTE_CHANGED') {
      syncNavigatorRouteState();
    }
  });
}

/**
 * Builds the sidebar list from conversationMessages.
 * @param {Object} [options]
 * @param {boolean} [options.refreshObservers=false] Whether to re-observe page messages after rebuilding.
 */
function buildNavigator({ refreshObservers = false } = {}) {
  const list = document.getElementById('navigator-list');
  const hint = document.querySelector('.navigator-hint');

  if (!list) return;

  if (viewMode === 'myPrompts') {
    if (hint) hint.hidden = true;
    window.ChatTocMyPrompts.renderMyPrompts(list, navigatorSearchQuery, () => {
      buildNavigator();
    });
    return;
  }

  list.innerHTML = '';
  navigatorItems = []; // Reset navigator items for new build
  window.ChatTocOutline?.resetPromptItems?.();
  window.ChatTocOutline?.setPromptMessages?.(conversationMessages);

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
    const itemMain = document.createElement('div');
    const itemText = document.createElement('span');

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';

    if (index === activeNavigatorIndex) {
      item.classList.add('navigator-item-active');
    }

    const markButton = window.ChatTocPromptMark.createButton({
      item,
      messageId: message.id,
    });

    itemMain.className = 'navigator-item-main';

    itemText.className = 'navigator-item-text';
    itemText.textContent = `${index + 1}. ${fullText}`;

    const outlineControls = window.ChatTocOutline?.createPromptItem?.({
      item,
      index,
      messageId: message.id,
    });

    navigatorItems[index] = item;

    item.addEventListener('click', (event) => {
      handleNavigatorItemClick(message, index);

      if (isTextTruncated(itemText) && item.matches(':hover')) {
        window.ChatTocPreviewTooltip.show(message.text, event, itemMain);
      }
    });

    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.ChatTocMyPrompts.showDialog({
        content: message.text,
        title: message.text.slice(0, 30)
      }, () => {
        if (viewMode !== 'myPrompts') {
          toggleViewMode();
        } else {
          buildNavigator();
        }
      });
    });

    itemMain.append(
      itemText,
      outlineControls?.outlineIndicator || document.createElement('span'),
      markButton
    );
    item.append(itemMain);

    if (outlineControls?.outlineList) {
      item.appendChild(outlineControls.outlineList);
    }

    list.appendChild(item);

    item.addEventListener('mouseenter', (event) => {
      if (isTextTruncated(itemText)) {
        window.ChatTocPreviewTooltip.show(message.text, event, itemMain);
      }
    });

    item.addEventListener('mouseleave', () => {
      window.ChatTocPreviewTooltip.hide();
    });
  });

  if (refreshObservers) {
    observeVisibleUserMessages();
  }
}

/**
 * Handles prompt row clicks, including outline toggling and chat navigation.
 * @param {Object} message
 * @param {number} index
 */
function handleNavigatorItemClick(message, index) {
  window.ChatTocPreviewTooltip.hide();

  const outlineAction = window.ChatTocOutline?.handlePromptNavigation?.(
    index,
    activeNavigatorIndex
  );

  window.ChatTocJump.jumpToMessage(message, index);

  if (outlineAction?.shouldBuild) {
    window.ChatTocOutline?.scheduleBuild?.(index);
  }
}

/**
 * Returns whether an element's text overflows its visible width.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isTextTruncated(element) {
  return element.scrollWidth > element.clientWidth;
}

/**
 * Normalizes whitespace for prompt text comparisons and search.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Applies active styling immediately, ignoring any temporary navigation lock.
 * @param {number} index
 */
function forceActiveNavigatorItem(index) {
  const activeIndexChanged = index !== activeNavigatorIndex;

  activeNavigatorIndex = index;

  navigatorItems.forEach((item) => {
    item.classList.remove('navigator-item-active');
  });

  const item = navigatorItems[index];

  if (!item) return;

  item.classList.add('navigator-item-active');

  if (activeIndexChanged) {
    window.ChatTocOutline?.syncActivePrompt?.(index);
  }

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

  window.ChatTocFollow.keepFollowing(duration);
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
  if (!window.ChatTocFollow.isFollowing()) return;

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
 * Handles the full conversation payload captured by pageHook.js and rebuilds
 * the navigator from the active conversation branch.
 */
function handleConversationData(data) {
  if (!data || !data.mapping) {
    return;
  }

  setNavigatorTitle();

  conversationMessages = window.ChatTocMessages.extractUserMessages(data);

  buildNavigator({
    refreshObservers: true,
  });
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
      const routeKey = event.data.routeKey;

      if (routeKey && routeKey !== getCurrentConversationKey()) return;

      clearPendingNewChat();
      handleConversationData(event.data.payload);
    }

    if (event.data?.type === 'CHATGPT_NEW_USER_MESSAGE') {
      const routeKey = event.data.routeKey;
      const isCurrentRoute =
        !routeKey || routeKey === getCurrentConversationKey();
      const isMigratingNewChatMessage =
        routeKey && routeKey === pendingNewChatRouteKey;

      if (!isCurrentRoute && !isMigratingNewChatMessage) return;

      const newMessage = event.data.payload;
      const didAppend = appendNavigatorMessage(newMessage);

      if (isMigratingNewChatMessage) {
        clearPendingNewChat();
      } else if (routeKey && isNewChatRouteKey(routeKey)) {
        pendingNewChatMessage = newMessage;
      }

      if (didAppend) {
        buildNavigator({
          refreshObservers: true,
        });
      }
    }
  });
}

/**
 * Reads the saved theme from storage and applies data-theme to <html>.
 * Falls back to 'dark' if no preference is stored.
 */
function initTheme() {
  const THEME_KEY = 'chatToc:theme';
  chrome.storage.local.get(THEME_KEY, (result) => {
    const theme = result[THEME_KEY] || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  });

  // React instantly when the user changes theme in the popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[THEME_KEY]) return;
    const theme = changes[THEME_KEY].newValue || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  });
}

/**
 * Starts ChatTOC after all helper modules have been loaded by manifest.json.
 */
async function main() {
  initTheme();
  injectFetchHook(); // Start intercepting conversation data
  initMarkedPrompts();

  listenForConversationData(); // Listen for data sent from the fetch hook

  const sidebar = await createSidebar();

  initSidebarResize(sidebar);
  initJumpControlsPositioning();
  listenForRouteChanges();
  initActivePromptTracking();
  const toggleBtn = window.ChatTocToggleButton.create();
  window.ChatTocSidebarVisibility.init(sidebar, toggleBtn, {
    getPageKey: getCurrentConversationKey,
  });

  window.ChatTocPreviewTooltip.init({
    anchorSelector: '#navigator-list',
  });
  window.ChatTocButtonTooltip.init();

  window.ChatTocMyPrompts.initAutocomplete();
}

/**
 * Toggles the display mode between Conversation TOC and My Prompts list.
 */
function toggleViewMode() {
  const btn = document.getElementById('toggle-view-mode-btn');
  if (!btn) return;

  window.ChatTocPreviewTooltip.hide();

  if (viewMode === 'toc') {
    viewMode = 'myPrompts';
    btn.classList.add('mode-myprompts-active');
    btn.setAttribute('aria-label', 'Switch to Table of Contents');
    btn.title = 'Switch to Table of Contents';
  } else {
    viewMode = 'toc';
    btn.classList.remove('mode-myprompts-active');
    btn.setAttribute('aria-label', 'Switch to My Prompts');
    btn.title = 'Switch to My Prompts';
    
    const toolbarContainer = document.getElementById('myprompts-toolbar-container');
    if (toolbarContainer) {
      toolbarContainer.innerHTML = '';
    }
  }

  const searchInput = document.getElementById('navigator-search');
  if (searchInput) {
    searchInput.value = '';
    navigatorSearchQuery = '';
  }

  setNavigatorTitle();
  buildNavigator();
}

main();
