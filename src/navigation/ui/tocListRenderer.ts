/**
 * Renders the Table of Contents list, search filtering, active row highlighting,
 * and status band state for the LunaTOC sidebar.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { isPromptMarked, togglePromptMark } from '@/features/conversationPrompts/promptMark';
import { copyPromptText } from '@/features/conversationPrompts/copyPrompt';
import { findAddedPrompt } from '@/features/conversationPrompts/addedPrompt';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import { isElementTextTruncated, previewTooltip } from '@/features/tooltip';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import {
  collapseAll,
  createPromptItem,
  resetPromptItems,
  setPromptMessages,
  syncActivePrompt,
} from '@/navigation/jump/outline';
import {
  setSidebarStatus,
  type SidebarStatusState,
} from './sidebarStatus';
import { isFollowing, stopFollowing } from '@/navigation/follow/follow';
import {
  clearSettleTimer,
  isLoading as isLoadingPrompts,
  setLoading,
  startSettleTimer,
} from '@/navigation/loading/promptLoadingState';
import { getJumpProgress as readJumpProgress } from '@/navigation/loading/jumpProgressState';

export interface RenderOptions {
  refreshObservers?: boolean;
  completed?: boolean | null;
}

export interface TocListRendererOptions {
  getMessages: () => NavigatorMessage[];
  getActiveIndex: () => number | null;
  onItemClick: (message: NavigatorMessage, index: number) => void;
  onSavePrompt?: (message: NavigatorMessage) => void;
  getSavedPrompts?: () => Promise<SavedPrompt[]>;
  onRemoveSavedPrompt?: (savedPromptId: string) => Promise<void>;
  onPromptCountReported?: (count: number) => void;
  onRefreshObservers?: () => void;
  getJumpProgress?: () => ReturnType<typeof readJumpProgress>;
  isFollowingMode?: () => boolean;
}

export interface TocListRenderer {
  render(options?: RenderOptions): void;
  setSearchQuery(query: string): void;
  getSearchQuery(): string;
  resetView(): void;
  resetList(): void;
  getNavigatorItems(): HTMLElement[];
  updateActiveItemUI(index: number, changed: boolean): void;
  scrollNavigatorItemIntoView(
    item: HTMLElement,
    options?: { force?: boolean; behavior?: ScrollBehavior }
  ): boolean;
  ensureActiveItemVisible(): boolean;
  pickStatusBandState(completed: boolean | null): SidebarStatusState;
  createNavigatorItem(message: NavigatorMessage, index: number): HTMLElement;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Creates an instance-scoped renderer for the TOC sidebar list.
 *
 * @param options Configuration callbacks and data accessors.
 * @returns An isolated TocListRenderer instance.
 */
export function createTocListRenderer(
  options: TocListRendererOptions
): TocListRenderer {
  const EMPTY_HINT_TEXT = '等待提示词...';
  let searchQuery = '';
  let navigatorItems: HTMLElement[] = [];
  let hasScrolledInitialActive = false;
  let contextMenuSequence = 0;

  function getSearchQuery(): string {
    return searchQuery;
  }

  function setSearchQuery(query: string): void {
    searchQuery = query;
    render();
  }

  function getNavigatorItems(): HTMLElement[] {
    return navigatorItems;
  }

  function resetList(): void {
    contextMenuSequence++;
    navigatorItems = [];
    searchQuery = '';
    hasScrolledInitialActive = false;
  }

  function resetView(): void {
    searchQuery = '';
    previewTooltip.hide();
    stopFollowing();
    collapseAll();
    hasScrolledInitialActive = true;
    render();

    const scrollTarget = document.getElementById('navigator-list');
    if (scrollTarget && typeof scrollTarget.scrollTo === 'function') {
      scrollTarget.scrollTo({
        top: 0,
        behavior: 'auto',
      });
    }
  }

  function pickStatusBandState(completed: boolean | null): SidebarStatusState {
    const jump = options.getJumpProgress ? options.getJumpProgress() : readJumpProgress();
    if (jump && jump.active) return 'jumping';
    const promptCount = options.getMessages().length;
    if (completed === true) {
      return promptCount === 0 ? 'empty' : 'complete';
    }
    if (completed === false) return 'loading';
    return isLoadingPrompts() ? 'loading' : promptCount === 0 ? 'empty' : 'idle';
  }

  /**
   * Scrolls a navigator item into view if outside the visible padding area.
   *
   * @param item The DOM item to scroll into view.
   * @param scrollOptions Optional override options (force following bypass, behavior).
   * @returns True if visibility was successfully handled (already in bounds or scrolled); false otherwise.
   */
  function scrollNavigatorItemIntoView(
    item: HTMLElement,
    scrollOptions?: { force?: boolean; behavior?: ScrollBehavior }
  ): boolean {
    const scrollContainer = document.getElementById('navigator-list');
    const following = options.isFollowingMode ? options.isFollowingMode() : isFollowing();
    if (!scrollContainer || (!following && !scrollOptions?.force)) return false;

    const itemRect = item.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    if (containerRect.height === 0 || itemRect.height === 0) return false;

    const topPadding = 56;
    const bottomPadding = 80;
    const isAbove = itemRect.top < containerRect.top + topPadding;
    const isBelow = itemRect.bottom > containerRect.bottom - bottomPadding;

    if (!isAbove && !isBelow) return true;
    if (typeof scrollContainer.scrollTo !== 'function') return false;

    const nextScrollTop = isAbove
      ? scrollContainer.scrollTop + itemRect.top - containerRect.top - topPadding
      : scrollContainer.scrollTop + itemRect.bottom - containerRect.bottom + bottomPadding;

    scrollContainer.scrollTo({
      top: nextScrollTop,
      behavior: scrollOptions?.behavior ?? 'smooth',
    });
    return true;
  }

  /**
   * Ensures the active TOC item is visible on initial load.
   */
  function ensureActiveItemVisible(): boolean {
    if (hasScrolledInitialActive) return true;
    if (isLoadingPrompts()) return false;

    const activeIndex = options.getActiveIndex();
    const item = activeIndex !== null ? navigatorItems[activeIndex] : null;
    if (!item?.isConnected) return false;

    const handled = scrollNavigatorItemIntoView(item, {
      force: true,
      behavior: 'auto',
    });
    if (handled) hasScrolledInitialActive = true;
    return handled;
  }

  function updateActiveItemUI(index: number, changed: boolean): void {
    navigatorItems.forEach((item) => {
      item?.classList.remove('navigator-item-active');
    });

    const item = navigatorItems[index];
    if (!item?.isConnected) return;

    item.classList.add('navigator-item-active');
    if (changed) {
      syncActivePrompt(index);
    }

    if (!hasScrolledInitialActive) {
      ensureActiveItemVisible();
    } else {
      scrollNavigatorItemIntoView(item);
    }
  }

  function createNavigatorItem(
    message: NavigatorMessage,
    index: number
  ): HTMLElement {
    const item = document.createElement('div');
    const itemMain = document.createElement('div');
    const itemText = document.createElement('span');

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';
    item.classList.toggle(
      'navigator-item-active',
      index === options.getActiveIndex()
    );
    itemMain.className = 'navigator-item-main';
    const itemIndex = document.createElement('span');
    itemIndex.className = 'navigator-item-index';
    itemIndex.textContent = `${index + 1}.`;
    itemText.className = 'navigator-item-text';
    itemText.textContent = message.text.replace(/\s+/g, ' ');

    item.classList.toggle('navigator-item-marked', isPromptMarked(message.id));
    const outlineControls = createPromptItem({
      item,
      index,
      messageId: message.id,
    });

    itemMain.append(itemIndex, itemText);
    item.append(itemMain);

    if (outlineControls?.outlineList) {
      item.appendChild(outlineControls.outlineList);
    }

    const showTooltip = (event: MouseEvent): void => {
      if (isElementTextTruncated(itemText)) {
        previewTooltip.show(message.text, event, itemMain);
      }
    };

    item.addEventListener('click', (event) => {
      options.onItemClick(message, index);
      if (item.matches(':hover')) showTooltip(event);
    });
    /**
     * Opens prompt actions exclusively from the native right-click gesture.
     * Long titles use CSS text-overflow ellipsis instead of an action button.
     */
    const showItemMenu = async (left: number, top: number): Promise<void> => {
      const menuSequence = ++contextMenuSequence;
      previewTooltip.hide();
      let savedPrompts: SavedPrompt[];
      try {
        savedPrompts = await (options.getSavedPrompts?.() ?? Promise.resolve([]));
      } catch (error) {
        console.warn('[LunaTOC] Failed to read saved prompts for menu', error);
        return;
      }
      // Prevent a delayed storage read from reopening a menu for an old route.
      if (menuSequence !== contextMenuSequence || !item.isConnected ||
          document.getElementById('luna-toc-sidebar')?.getAttribute('aria-hidden') === 'true') {
        return;
      }
      const added = findAddedPrompt(message, options.getMessages(), savedPrompts);
      promptContextMenuController.show(
        { left, top },
        [
          { id: 'copy-prompt', label: '复制', icon: 'copy' },
          {
            id: 'mark-prompt',
            label: isPromptMarked(message.id) ? '取消收藏' : '收藏',
            icon: 'bookmark-plus',
          },
          {
            id: 'save-prompt',
            label: added ? '取消添加' : '添加',
            icon: 'bookmark-plus',
          },
        ],
        (itemId) => {
          if (itemId === 'copy-prompt') {
            void copyPromptText(message.text).catch((error: unknown) => {
              console.warn('[LunaTOC] Failed to copy prompt text', error);
            });
          } else if (itemId === 'mark-prompt') {
            togglePromptMark(item, message.id);
          } else if (itemId === 'save-prompt') {
            if (added) {
              void options.onRemoveSavedPrompt?.(added.id).catch((error: unknown) => {
                console.warn('[LunaTOC] Failed to remove saved prompt', error);
              });
            } else {
              options.onSavePrompt?.(message);
            }
          }
        }
      );
    };

    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void showItemMenu(event.clientX, event.clientY);
    });

    item.addEventListener('mouseenter', showTooltip);
    item.addEventListener('mouseleave', () => {
      previewTooltip.hide();
    });

    return item;
  }

  function render({
    refreshObservers = false,
    completed = null,
  }: RenderOptions = {}): void {
    const list = document.getElementById('navigator-list');
    const hint = document.querySelector<HTMLElement>('.navigator-hint');

    if (!list) return;

    if (completed === true) {
      setLoading(false);
      clearSettleTimer();
    } else if (completed === false) {
      setLoading(true);
      startSettleTimer();
    }

    list.innerHTML = '';
    navigatorItems = [];
    resetPromptItems();
    const conversationMessages = options.getMessages();
    setPromptMessages(conversationMessages);
    options.onPromptCountReported?.(conversationMessages.length);

    const normalizedQuery = normalizeText(searchQuery).toLowerCase();
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
      hint.textContent = hasQuery ? '没有匹配的提示词。' : EMPTY_HINT_TEXT;
    }

    visibleMessages.forEach(({ message, index }) => {
      const item = createNavigatorItem(message, index);
      navigatorItems[index] = item;
      list.appendChild(item);
    });

    if (refreshObservers || completed === true) {
      options.onRefreshObservers?.();
    }

    ensureActiveItemVisible();

    setSidebarStatus({
      state: pickStatusBandState(completed),
      jump: options.getJumpProgress ? options.getJumpProgress() : readJumpProgress(),
      promptCount: conversationMessages.length,
    });
  }

  return {
    render,
    setSearchQuery,
    getSearchQuery,
    resetView,
    resetList,
    getNavigatorItems,
    updateActiveItemUI,
    scrollNavigatorItemIntoView,
    ensureActiveItemVisible,
    pickStatusBandState,
    createNavigatorItem,
  };
}
