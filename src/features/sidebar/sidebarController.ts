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
import { scrollNavigatorListToEdge } from '@/features/sidebar/jumpToEdgeControls';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

type ViewMode = 'toc' | 'myPrompts';

export interface SidebarViewSnapshot {
  viewMode: ViewMode;
  searchQuery: string;
}

export interface SidebarHeaderSnapshot {
  viewMode: ViewMode;
  title: string;
  searchQuery: string;
  isSearchOpen: boolean;
  isSearchDisabled: boolean;
}

export const sidebarController = (() => {
  let viewMode: ViewMode = 'toc';
  let searchQuery = '';
  let isSearchOpen = false;
  let myPromptsRefreshQueued = false;
  let tocPromptCount = 0;
  let myPromptsCount = 0;
  let tocScrollTop = 0;
  let myPromptsScrollTop = 0;

  let viewSnapshot: SidebarViewSnapshot = {
    viewMode: 'toc',
    searchQuery: '',
  };
  const viewListeners = new Set<() => void>();

  let headerSnapshot: SidebarHeaderSnapshot = {
    viewMode: 'toc',
    title: 'ChatTOC',
    searchQuery: '',
    isSearchOpen: false,
    isSearchDisabled: true,
  };
  const headerListeners = new Set<() => void>();

  let isReady = false;
  const readyListeners = new Set<() => void>();

  function updateViewSnapshot(): void {
    if (
      viewSnapshot.viewMode === viewMode &&
      viewSnapshot.searchQuery === searchQuery
    ) {
      return;
    }
    viewSnapshot = { viewMode, searchQuery };
    viewListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('Error in sidebar view listener:', error);
      }
    });
  }

  function subscribeView(listener: () => void): () => void {
    viewListeners.add(listener);
    return () => {
      viewListeners.delete(listener);
    };
  }

  function getViewSnapshot(): SidebarViewSnapshot {
    return viewSnapshot;
  }

  function updateHeaderSnapshot(): void {
    const currentTitle =
      viewMode === 'myPrompts' ? 'My Prompts' : getConversationTitle();
    const currentDisabled =
      viewMode === 'myPrompts' ? myPromptsCount === 0 : tocPromptCount === 0;

    if (
      headerSnapshot.viewMode === viewMode &&
      headerSnapshot.title === currentTitle &&
      headerSnapshot.searchQuery === searchQuery &&
      headerSnapshot.isSearchOpen === isSearchOpen &&
      headerSnapshot.isSearchDisabled === currentDisabled
    ) {
      return;
    }

    headerSnapshot = {
      viewMode,
      title: currentTitle,
      searchQuery,
      isSearchOpen,
      isSearchDisabled: currentDisabled,
    };

    headerListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('Error in sidebar header listener:', error);
      }
    });
  }

  function subscribeHeader(listener: () => void): () => void {
    headerListeners.add(listener);
    return () => {
      headerListeners.delete(listener);
    };
  }

  function getHeaderSnapshot(): SidebarHeaderSnapshot {
    return headerSnapshot;
  }

  /**
   * Subscribes to sidebar DOM and controller readiness.
   *
   * @param {() => void} listener
   * @returns {() => void} Unsubscribe callback.
   */
  function subscribeReady(listener: () => void): () => void {
    readyListeners.add(listener);
    return () => {
      readyListeners.delete(listener);
    };
  }

  /**
   * Returns whether the sidebar DOM and controller are fully initialized.
   *
   * @returns {boolean}
   */
  function getReadySnapshot(): boolean {
    return isReady;
  }

  /**
   * Initializes the sidebar after the DOM is in place. Sets the initial
   * title and binds every sidebar control to the closures above.
   */
  function init(): void {
    setNavigatorTitle();
    renderCurrentView();

    if (!isReady) {
      isReady = true;
      readyListeners.forEach((listener) => {
        try {
          listener();
        } catch (error) {
          console.error('Error in sidebar ready listener:', error);
        }
      });
    }
  }

  /**
   * Switches the sidebar view and synchronizes its controls with the rendered panel.
   */
  function setViewMode(nextViewMode: ViewMode): void {
    const viewChanged = viewMode !== nextViewMode;

    previewTooltip.hide();
    viewMode = nextViewMode;
    const isMyPrompts = viewMode === 'myPrompts';

    if (!isMyPrompts) {
      promptContextMenuController.close();
    }

    closeSearch(false);
    setNavigatorTitle();
    updateViewSnapshot();

    if (viewChanged) {
      renderCurrentView();
    }
  }

  function toggleViewMode(): void {
    setViewMode(viewMode === 'toc' ? 'myPrompts' : 'toc');
  }

  function openSearch(): void {
    const hasSearchableItems =
      viewMode === 'myPrompts' ? myPromptsCount > 0 : tocPromptCount > 0;
    if (!hasSearchableItems) return;

    isSearchOpen = true;
    updateHeaderSnapshot();
  }

  function toggleSearch(): void {
    if (isSearchOpen) {
      closeSearch(true);
    } else {
      openSearch();
    }
  }

  function closeSearch(syncController = true): void {
    isSearchOpen = false;
    searchQuery = '';
    updateViewSnapshot();
    updateHeaderSnapshot();
    if (syncController && viewMode === 'toc') {
      navigatorController.setSearchQuery('');
    }
  }

  function clearSearch(syncController = true): void {
    searchQuery = '';
    updateViewSnapshot();
    updateHeaderSnapshot();
    if (syncController && viewMode === 'toc') {
      navigatorController.setSearchQuery('');
    }
  }

  function setSearchQuery(query: string): void {
    if (searchQuery === query) return;
    searchQuery = query;
    updateViewSnapshot();
    updateHeaderSnapshot();
    renderCurrentView();
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
      if (viewMode === 'myPrompts') updateViewSnapshot();
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
    updateHeaderSnapshot();
  }

  function renderCurrentView(): void {
    updateSearchAvailability();

    const sidebar = document.getElementById('luna-toc-sidebar');
    if (sidebar) {
      sidebar.dataset.viewMode = viewMode;
    }

    const tocList = document.getElementById('navigator-list');
    const myPromptsList = document.getElementById('myprompts-list');
    const toolbarContainer = document.getElementById(
      'myprompts-toolbar-container'
    );

    if (viewMode === 'myPrompts') {
      if (tocList) {
        tocScrollTop = tocList.scrollTop;
        tocList.style.display = 'none';
      }
      if (myPromptsList) {
        myPromptsList.style.display = '';
        myPromptsList.scrollTop = myPromptsScrollTop;
      }
      if (toolbarContainer) {
        toolbarContainer.style.display = '';
      }
      return;
    }

    if (myPromptsList) {
      myPromptsScrollTop = myPromptsList.scrollTop;
      myPromptsList.style.display = 'none';
    }
    if (toolbarContainer) {
      toolbarContainer.style.display = 'none';
    }
    if (tocList) {
      tocList.style.display = '';
      tocList.scrollTop = tocScrollTop;
    }

    navigatorController.setSearchQuery(searchQuery);
  }

  function handleTitleClick(): void {
    if (viewMode === 'myPrompts') {
      scrollNavigatorListToEdge('top', 'smooth');
      return;
    }

    clearSearch(false);
    navigatorController.resetView();
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
    const hasSearchableItems =
      viewMode === 'myPrompts' ? myPromptsCount > 0 : tocPromptCount > 0;

    if (!hasSearchableItems && isSearchOpen) {
      closeSearch(viewMode === 'toc');
    }

    updateHeaderSnapshot();
  }

  return {
    init,
    setViewMode,
    toggleViewMode,
    openSearch,
    closeSearch,
    clearSearch,
    toggleSearch,
    setSearchQuery,
    isSearchOpen: () => isSearchOpen,
    setPromptCount,
    setMyPromptsCount,
    refreshMyPromptsIfActive,
    handleSavePrompt,
    handleTitleClick,
    isMyPromptsView: () => viewMode === 'myPrompts',
    setNavigatorTitle,
    subscribeView,
    getViewSnapshot,
    subscribeHeader,
    getHeaderSnapshot,
    subscribeReady,
    getReadySnapshot,
    resetReadyForTesting: () => {
      isReady = false;
    },
    getViewMode: () => viewMode,
    getSearchQuery: () => searchQuery,
  };
})();