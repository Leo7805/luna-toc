/**
 * Builds the LunaTOC sidebar shell and coordinates application-level features.
 */
import { myPrompts } from '../features/myPrompts/myPrompts';

(() => {
  const JUMP_CONTROLS_POSITION_STORAGE_KEY =
    'chatTocJumpControlsPosition';
  const NAVIGATOR_EMPTY_HINT_TEXT = 'Waiting for prompts...';

  let viewMode = 'toc';
  let searchQuery = '';
  let myPromptsRefreshQueued = false;

  /**
   * Resolves when document.body exists during document_start execution.
   * @returns {Promise<HTMLElement>}
   */
  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) {
        resolve(document.body);
        return;
      }

      const timer = setInterval(() => {
        if (!document.body) return;
        clearInterval(timer);
        resolve(document.body);
      }, 50);
    });
  }

  /**
   * Creates the sidebar DOM and registers application-level controls.
   * @returns {Promise<HTMLElement>}
   */
  async function createSidebar() {
    await waitForBody();

    const sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.className = 'luna-toc-navigator-initializing';
    sidebar.innerHTML = `
      <div id="navigator-resizer"></div>
      <div class="navigator-topbar">
        <div class="navigator-header">
          <button
            class="navigator-icon-btn navigator-header-icon-btn luna-toc-sidebar-pin-btn"
            id="luna-toc-sidebar-pin-btn"
            type="button"
            aria-label="Enable sidebar auto-hide"
            aria-pressed="true"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 17v5M7 3h10l-1 8 4 4v2H4v-2l4-4-1-8Z" />
            </svg>
          </button>
          <button id="navigator-title" type="button" aria-label="Reset TOC view">
            ${escapeHtml(getConversationTitle())}
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
        <p class="navigator-hint">${NAVIGATOR_EMPTY_HINT_TEXT}</p>
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
    bindSidebarControls();
    return sidebar;
  }

  /**
   * Registers controls that switch views or delegate navigation behavior.
   */
  function bindSidebarControls() {
    const searchInput = document.getElementById('navigator-search');

    document.getElementById('search-toggle-btn').addEventListener('click', () => {
      const isHidden = window.getComputedStyle(searchInput).display === 'none';
      searchInput.style.display = isHidden ? 'block' : 'none';

      if (isHidden) {
        searchInput.focus();
        return;
      }

      clearSearch();
      renderCurrentView();
    });
    document
      .getElementById('navigator-title')
      .addEventListener('click', handleTitleClick);
    document
      .getElementById('jump-chat-top-btn')
      .addEventListener('click', () => handleJumpControlClick('top'));
    document
      .getElementById('jump-chat-top-btn')
      .addEventListener('dblclick', () => handleJumpControlDoubleClick('top'));
    document
      .getElementById('jump-chat-bottom-btn')
      .addEventListener('click', () => handleJumpControlClick('bottom'));
    document
      .getElementById('jump-chat-bottom-btn')
      .addEventListener('dblclick', () => handleJumpControlDoubleClick('bottom'));
    document
      .getElementById('toggle-view-mode-btn')
      .addEventListener('click', toggleViewMode);
    searchInput.addEventListener('input', (event) => {
      searchQuery = event.target.value;
      renderCurrentView();
    });
  }

  function clearSearch() {
    searchQuery = '';
    const searchInput = document.getElementById('navigator-search');
    if (searchInput) searchInput.value = '';
    window.LunaTocNavigatorController.setSearchQuery('');
  }

  function renderCurrentView() {
    if (viewMode === 'myPrompts') {
      renderMyPrompts();
      return;
    }

    window.LunaTocNavigatorController.setSearchQuery(searchQuery);
  }

  function renderMyPrompts() {
    const list = document.getElementById('navigator-list');
    const hint = document.querySelector('.navigator-hint');
    if (!list) return;
    if (hint) hint.hidden = true;

    myPrompts.renderMyPrompts(list, searchQuery, () => {
      renderCurrentView();
    });
  }

  function handleTitleClick() {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge('top', 'smooth');
      return;
    }

    clearSearch();
    window.LunaTocNavigatorController.resetView();
  }

  function handleJumpControlClick(edge) {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge(edge, 'smooth');
      return;
    }
    window.LunaTocNavigatorController.jumpToEdge(edge);
  }

  function handleJumpControlDoubleClick(edge) {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge(edge, 'auto');
      return;
    }
    window.LunaTocNavigatorController.jumpToAbsoluteEdge(edge);
  }

  function scrollNavigatorListToEdge(edge, behavior = 'smooth') {
    const list = document.getElementById('navigator-list');
    if (!list) return;
    list.scrollTo({
      top: edge === 'top' ? 0 : list.scrollHeight,
      behavior,
    });
  }

  /**
   * Opens the saved-prompt dialog for a conversation TOC item.
   * @param {Object} message
   */
  function handleSavePrompt(message) {
    myPrompts.showDialog(
      {
        content: message.text,
        title: message.text.slice(0, 30),
      },
      () => {
        if (viewMode !== 'myPrompts') {
          toggleViewMode();
        } else {
          renderCurrentView();
        }
      }
    );
  }

  function toggleViewMode() {
    const button = document.getElementById('toggle-view-mode-btn');
    if (!button) return;

    window.ChatTocPreviewTooltip.hide();
    viewMode = viewMode === 'toc' ? 'myPrompts' : 'toc';
    const isMyPrompts = viewMode === 'myPrompts';

    button.classList.toggle('mode-myprompts-active', isMyPrompts);
    button.setAttribute(
      'aria-label',
      isMyPrompts ? 'Switch to Table of Contents' : 'Switch to My Prompts'
    );
    button.title = isMyPrompts
      ? 'Switch to Table of Contents'
      : 'Switch to My Prompts';

    if (!isMyPrompts) {
      const toolbar = document.getElementById('myprompts-toolbar-container');
      if (toolbar) toolbar.innerHTML = '';
    }

    clearSearch();
    setNavigatorTitle();
    renderCurrentView();
  }

  function getConversationTitle() {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    const conversationId = match?.[1];

    if (conversationId) {
      const conversationLink = document.querySelector(
        `a[href*="/c/${conversationId}"]`
      );
      const sidebarTitle = conversationLink?.innerText?.trim();
      if (sidebarTitle) return sidebarTitle;
    }

    return (
      document.title
        .replace(/\s*[-–]\s*ChatGPT$/i, '')
        .replace(/^ChatGPT\s*[-–]\s*/i, '')
        .trim() || 'ChatTOC'
    );
  }

  function setNavigatorTitle() {
    const title = document.getElementById('navigator-title');
    if (!title) return;
    title.textContent =
      viewMode === 'myPrompts' ? 'MY PROMPTS' : getConversationTitle();
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

  function initJumpControlsPositioning() {
    const jumpControls = document.querySelector('.navigator-jump-controls');
    if (!jumpControls) return;

    restoreJumpControlsPosition(jumpControls);
    window.addEventListener('resize', () => {
      keepJumpControlsInViewport(jumpControls);
    });
    jumpControls.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();

      const rect = jumpControls.getBoundingClientRect();
      const startY = event.clientY;
      const startTop = rect.top;
      let didDrag = false;

      jumpControls.setPointerCapture(event.pointerId);
      jumpControls.classList.add('navigator-jump-controls-dragging');

      function handlePointerMove(moveEvent) {
        const deltaY = moveEvent.clientY - startY;
        if (!didDrag && Math.abs(deltaY) < 4) return;
        didDrag = true;
        setJumpControlsPosition(
          jumpControls,
          clampJumpControlsTop(startTop + deltaY, rect.height)
        );
      }

      function handlePointerUp() {
        try {
          jumpControls.releasePointerCapture(event.pointerId);
        } catch {}

        jumpControls.classList.remove('navigator-jump-controls-dragging');
        jumpControls.removeEventListener('pointermove', handlePointerMove);
        jumpControls.removeEventListener('pointerup', handlePointerUp);
        jumpControls.removeEventListener('pointercancel', handlePointerUp);
        if (didDrag) saveJumpControlsPosition(jumpControls);
      }

      jumpControls.addEventListener('pointermove', handlePointerMove);
      jumpControls.addEventListener('pointerup', handlePointerUp);
      jumpControls.addEventListener('pointercancel', handlePointerUp);
    });
  }

  function saveJumpControlsPosition(jumpControls) {
    const rect = jumpControls.getBoundingClientRect();
    storageSet(JUMP_CONTROLS_POSITION_STORAGE_KEY, {
      topRatio: getJumpControlsTopRatio(rect.top, rect.height),
    });
  }

  function restoreJumpControlsPosition(jumpControls) {
    const savedPosition = storageGet(JUMP_CONTROLS_POSITION_STORAGE_KEY);
    const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls);
    if (nextTop != null) setJumpControlsPosition(jumpControls, nextTop);
  }

  function keepJumpControlsInViewport(jumpControls) {
    const rect = jumpControls.getBoundingClientRect();
    const savedPosition = storageGet(JUMP_CONTROLS_POSITION_STORAGE_KEY);
    const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls, rect);
    if (nextTop == null || Math.abs(nextTop - rect.top) < 1) return;
    setJumpControlsPosition(jumpControls, nextTop);
    saveJumpControlsPosition(jumpControls);
  }

  function setJumpControlsPosition(jumpControls, top) {
    jumpControls.style.top = `${top}px`;
  }

  function storageGet(key) {
    try {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function clampJumpControlsTop(top, height) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - height - 8);
    return Math.min(maxTop, Math.max(minTop, top));
  }

  function getJumpControlsTopRatio(top, height) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - height - 8);
    const range = maxTop - minTop;
    if (range <= 0) return 0;
    return (clampJumpControlsTop(top, height) - minTop) / range;
  }

  function getSavedJumpControlsTop(savedPosition, jumpControls, rect) {
    if (!savedPosition || typeof savedPosition !== 'object') return null;
    const panelRect = rect || jumpControls.getBoundingClientRect();

    if (Number.isFinite(savedPosition.topRatio)) {
      const minTop = 8;
      const maxTop = Math.max(
        minTop,
        window.innerHeight - panelRect.height - 8
      );
      return clampJumpControlsTop(
        minTop + savedPosition.topRatio * (maxTop - minTop),
        panelRect.height
      );
    }
    if (Number.isFinite(savedPosition.top)) {
      return clampJumpControlsTop(savedPosition.top, panelRect.height);
    }
    return null;
  }

  function initTheme() {
    const themeKey = 'chatToc:theme';
    chrome.storage.local.get(themeKey, (result) => {
      document.documentElement.setAttribute(
        'data-theme',
        result[themeKey] || 'dark'
      );
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[themeKey]) return;
      document.documentElement.setAttribute(
        'data-theme',
        changes[themeKey].newValue || 'dark'
      );
    });
  }

  /**
   * Starts the application after all feature and controller scripts load.
   */
  async function init() {
    initTheme();
    window.LunaTocNavigatorController.init({
      onRouteChanged() {
        clearSearch();
        setNavigatorTitle();
      },
      onSavePrompt: handleSavePrompt,
      onTitleChanged: setNavigatorTitle,
    });
    const sidebar = await createSidebar();
    initSidebarResize(sidebar);
    initJumpControlsPositioning();

    const toggleButton = window.ChatTocToggleButton.create();
    window.ChatTocSidebarVisibility.init(sidebar, toggleButton);
    window.ChatTocPreviewTooltip.init({ anchorSelector: '#navigator-list' });
    window.ChatTocButtonTooltip.init();
    myPrompts.initAutocomplete();
    window.LunaTocNavigatorController.attach();

    myPrompts.onPromptsChanged(() => {
      if (viewMode !== 'myPrompts' || myPromptsRefreshQueued) return;
      myPromptsRefreshQueued = true;
      queueMicrotask(() => {
        myPromptsRefreshQueued = false;
        if (viewMode === 'myPrompts') renderCurrentView();
      });
    });
  }

  window.LunaTocApplicationShell = { init };
})();
