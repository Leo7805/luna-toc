/**
 * Owns the LunaTOC sidebar's view-mode, search, and title state, plus all
 * sidebar-level event bindings. Exposes a closure-based controller so the
 * orchestrator can drive it from `initializeApplication` without touching
 * internal mutable state directly.
 */
import { navigatorController } from '@/navigation/navigatorController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import { previewTooltip } from '@/features/tooltip';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

type ConversationEdge = 'top' | 'bottom';
type ViewMode = 'toc' | 'myPrompts';

export const sidebarController = (() => {
  let viewMode: ViewMode = 'toc';
  let searchQuery = '';
  let myPromptsRefreshQueued = false;
  let tocPromptCount = 0;
  let myPromptsCount = 0;

  /**
   * Initializes the sidebar after the DOM is in place. Sets the initial
   * title and binds every sidebar control to the closures above.
   */
  function init(): void {
    setNavigatorTitle();
    bindSidebarControls();
  }

  /**
   * Switches the sidebar view and synchronizes its controls with the rendered panel.
   */
  function setViewMode(nextViewMode: ViewMode): void {
    const button = document.getElementById(
      'toggle-view-mode-btn'
    ) as HTMLButtonElement | null;
    if (!button) return;

    previewTooltip.hide();
    viewMode = nextViewMode;
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
      const list = document.getElementById('navigator-list');
      if (list) list.oncontextmenu = null;
      promptContextMenuController.close();
    }

    clearSearch();
    setNavigatorTitle();
    renderCurrentView();
  }

  function toggleViewMode(): void {
    setViewMode(viewMode === 'toc' ? 'myPrompts' : 'toc');
  }

  function clearSearch(syncController = true): void {
    searchQuery = '';
    const searchInput = document.getElementById(
      'navigator-search'
    ) as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    if (syncController) navigatorController.setSearchQuery('');
  }

  function setPromptCount(count: number): void {
    tocPromptCount = count;
    updateSearchAvailability();
  }

  function setMyPromptsCount(count: number): void {
    myPromptsCount = count;
    updateSearchAvailability();
  }

  /**
   * Re-renders the My Prompts panel when it is active, with a microtask debounce.
   */
  function refreshMyPromptsIfActive(): void {
    if (viewMode !== 'myPrompts' || myPromptsRefreshQueued) return;
    myPromptsRefreshQueued = true;
    queueMicrotask(() => {
      myPromptsRefreshQueued = false;
      if (viewMode === 'myPrompts') renderCurrentView();
    });
  }

  /**
   * Opens the saved-prompt dialog for a conversation TOC item.
   * @param {Object} message
   */
  function handleSavePrompt(message: NavigatorMessage): void {
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

  function setNavigatorTitle(): void {
    const title = document.getElementById('navigator-title');
    if (!title) return;
    const titleText =
      viewMode === 'myPrompts' ? 'MY PROMPTS' : getConversationTitle();

    title.textContent = titleText;
    title.dataset.tooltip = titleText;
  }

  function renderCurrentView(): void {
    updateSearchAvailability();

    if (viewMode === 'myPrompts') {
      renderMyPrompts();
      return;
    }

    navigatorController.setSearchQuery(searchQuery);
  }

  function renderMyPrompts(): void {
    const list = document.getElementById('navigator-list');
    if (!list) return;

    myPrompts.renderMyPrompts(list, searchQuery, () => {
      renderCurrentView();
    });
  }

  function handleTitleClick(): void {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge('top', 'smooth');
      return;
    }

    clearSearch(false);
    navigatorController.resetView();
  }

  function handleJumpControlClick(edge: ConversationEdge): void {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge(edge, 'smooth');
      return;
    }
    navigatorController.jumpToEdge(edge);
  }

  function handleJumpControlDoubleClick(edge: ConversationEdge): void {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge(edge, 'auto');
      return;
    }
    navigatorController.jumpToAbsoluteEdge(edge);
  }

  function scrollNavigatorListToEdge(
    edge: ConversationEdge,
    behavior: ScrollBehavior = 'smooth'
  ): void {
    const list = document.getElementById('navigator-list');
    if (!list) return;
    list.scrollTo({
      top: edge === 'top' ? 0 : list.scrollHeight,
      behavior,
    });
  }

  /**
   * Registers controls that switch views or delegate navigation behavior.
   */
  function bindSidebarControls(): void {
    const searchInput = getRequiredElement<HTMLInputElement>('navigator-search');

    getRequiredElement<HTMLButtonElement>('search-toggle-btn').addEventListener(
      'click',
      () => {
        const isHidden =
          window.getComputedStyle(searchInput).display === 'none';
        searchInput.style.display = isHidden ? 'block' : 'none';

        if (isHidden) {
          searchInput.focus();
          return;
        }

        clearSearch();
        renderCurrentView();
      }
    );
    getRequiredElement<HTMLButtonElement>('navigator-title').addEventListener(
      'click',
      handleTitleClick
    );
    getRequiredElement<HTMLButtonElement>('jump-chat-top-btn').addEventListener(
      'click',
      () => handleJumpControlClick('top')
    );
    getRequiredElement<HTMLButtonElement>('jump-chat-top-btn').addEventListener(
      'dblclick',
      () => handleJumpControlDoubleClick('top')
    );
    getRequiredElement<HTMLButtonElement>(
      'jump-chat-bottom-btn'
    ).addEventListener('click', () => handleJumpControlClick('bottom'));
    getRequiredElement<HTMLButtonElement>(
      'jump-chat-bottom-btn'
    ).addEventListener('dblclick', () => handleJumpControlDoubleClick('bottom'));
    getRequiredElement<HTMLButtonElement>(
      'toggle-view-mode-btn'
    ).addEventListener('click', toggleViewMode);
    searchInput.addEventListener('input', (event) => {
      searchQuery = (event.currentTarget as HTMLInputElement).value;
      renderCurrentView();
    });
  }

  function getConversationTitle(): string {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    const conversationId = match?.[1];

    if (conversationId) {
      const conversationLink = document.querySelector<HTMLElement>(
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

  function updateSearchAvailability(): void {
    const searchButton =
      document.getElementById('search-toggle-btn') as HTMLButtonElement | null;
    const searchInput =
      document.getElementById('navigator-search') as HTMLInputElement | null;
    if (!searchButton || !searchInput) return;

    const hasSearchableItems =
      viewMode === 'myPrompts' ? myPromptsCount > 0 : tocPromptCount > 0;
    searchButton.disabled = !hasSearchableItems;
    searchButton.setAttribute('aria-disabled', String(!hasSearchableItems));

    if (hasSearchableItems) return;

    const shouldResetTocQuery = viewMode === 'toc' && searchQuery.length > 0;
    searchQuery = '';
    searchInput.value = '';
    searchInput.style.display = 'none';

    if (shouldResetTocQuery) {
      queueMicrotask(() => navigatorController.setSearchQuery(''));
    }
  }

  function getRequiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Required application element not found: #${id}`);
    }
    return element as T;
  }

  return {
    init,
    setViewMode,
    toggleViewMode,
    clearSearch,
    setPromptCount,
    setMyPromptsCount,
    refreshMyPromptsIfActive,
    handleSavePrompt,
    setNavigatorTitle,
  };
})();