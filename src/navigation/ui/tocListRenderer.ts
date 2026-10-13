/**
 * Renders the Table of Contents list, search filtering, active row highlighting,
 * and status band state for the LunaTOC sidebar.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { createPromptMarkButton } from '@/features/conversationPrompts/promptMark';
import { isElementTextTruncated, previewTooltip } from '@/features/tooltip';
import { getCustomTitle } from '@/features/customTocTitles/customTocTitleStore';
import { openCustomTocTitleDialog } from '@/components/custom-toc-titles/CustomTocTitleDialog';
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
  onPromptCountReported?: (count: number) => void;
  onForceActiveIndex?: (index: number) => void;
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
  jumpToLastIfIdle(): void;
  scrollNavigatorItemIntoView(item: HTMLElement): void;
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
  const EMPTY_HINT_TEXT = 'Waiting for prompts...';
  let searchQuery = '';
  let navigatorItems: HTMLElement[] = [];

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
    navigatorItems = [];
    searchQuery = '';
  }

  function resetView(): void {
    searchQuery = '';
    previewTooltip.hide();
    stopFollowing();
    collapseAll();
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
    return isLoadingPrompts() ? 'loading' : promptCount === 0 ? 'idle' : 'idle';
  }

  function scrollNavigatorItemIntoView(item: HTMLElement): void {
    const scrollContainer = document.getElementById('navigator-list');
    const following = options.isFollowingMode ? options.isFollowingMode() : isFollowing();
    if (!scrollContainer || !following) return;

    const itemRect = item.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const topPadding = 56;
    const bottomPadding = 80;
    const isAbove = itemRect.top < containerRect.top + topPadding;
    const isBelow = itemRect.bottom > containerRect.bottom - bottomPadding;

    if (!isAbove && !isBelow) return;

    const nextScrollTop = isAbove
      ? scrollContainer.scrollTop +
        itemRect.top -
        containerRect.top -
        topPadding
      : scrollContainer.scrollTop +
        itemRect.bottom -
        containerRect.bottom +
        bottomPadding;

    if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    }
  }

  function updateActiveItemUI(index: number, changed: boolean): void {
    navigatorItems.forEach((item) => {
      item?.classList.remove('navigator-item-active');
    });

    const item = navigatorItems[index];
    if (!item) return;

    item.classList.add('navigator-item-active');
    if (changed) {
      syncActivePrompt(index);
    }
    scrollNavigatorItemIntoView(item);
  }

  function jumpToLastIfIdle(): void {
    const following = options.isFollowingMode ? options.isFollowingMode() : isFollowing();
    if (following) return;

    const conversationMessages = options.getMessages();
    if (conversationMessages.length === 0) return;

    const lastIndex = conversationMessages.length - 1;
    options.onForceActiveIndex?.(lastIndex);

    const lastItem = navigatorItems[lastIndex];
    if (lastItem && typeof lastItem.scrollIntoView === 'function') {
      lastItem.scrollIntoView({ block: 'end' });
    }
  }

  function createNavigatorItem(
    message: NavigatorMessage,
    index: number
  ): HTMLElement {
    const item = document.createElement('div');
    const itemMain = document.createElement('div');
    const itemText = document.createElement('span');

    const customTitle = getCustomTitle(message.id);
    const hasCustomTitle = Boolean(customTitle);
    const titleText = hasCustomTitle ? customTitle! : message.text;

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';
    item.classList.toggle(
      'navigator-item-active',
      index === options.getActiveIndex()
    );
    if (hasCustomTitle) {
      item.classList.add('navigator-item-custom-title');
    }
    itemMain.className = 'navigator-item-main';
    itemText.className = 'navigator-item-text';
    itemText.textContent = `${index + 1}. ${titleText.replace(/\s+/g, ' ')}`;

    const markButton = createPromptMarkButton({
      item,
      messageId: message.id,
    });
    const outlineControls = createPromptItem({
      item,
      index,
      messageId: message.id,
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

    const showTooltip = (event: MouseEvent): void => {
      if (hasCustomTitle) {
        previewTooltip.show(
          { originalPrompt: message.text, customTitle },
          event,
          itemMain
        );
      } else if (isElementTextTruncated(itemText)) {
        previewTooltip.show(message.text, event, itemMain);
      }
    };

    item.addEventListener('click', (event) => {
      options.onItemClick(message, index);
      if (item.matches(':hover')) showTooltip(event);
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      previewTooltip.hide();
      promptContextMenuController.show(
        { left: event.clientX, top: event.clientY },
        [
          { id: 'save-prompt', label: 'Add to My Prompts' },
          { id: 'rename-toc', label: 'Rename TOC Item…' },
        ],
        (itemId) => {
          if (itemId === 'save-prompt') {
            options.onSavePrompt?.(message);
          } else if (itemId === 'rename-toc') {
            openCustomTocTitleDialog({
              messageId: message.id,
              originalPrompt: message.text,
              onUpdated: render,
            });
          }
        }
      );
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
      hint.textContent = hasQuery ? 'No matching prompts.' : EMPTY_HINT_TEXT;
    }

    visibleMessages.forEach(({ message, index }) => {
      const item = createNavigatorItem(message, index);
      navigatorItems[index] = item;
      list.appendChild(item);
    });

    if (completed === true) {
      setLoading(false);
      clearSettleTimer();
    } else if (completed === false) {
      setLoading(true);
      startSettleTimer();
    }

    setSidebarStatus({
      state: pickStatusBandState(completed),
      jump: options.getJumpProgress ? options.getJumpProgress() : readJumpProgress(),
      promptCount: conversationMessages.length,
    });

    if (completed === true) {
      jumpToLastIfIdle();
    }

    if (refreshObservers) {
      options.onRefreshObservers?.();
    }
  }

  return {
    render,
    setSearchQuery,
    getSearchQuery,
    resetView,
    resetList,
    getNavigatorItems,
    updateActiveItemUI,
    jumpToLastIfIdle,
    scrollNavigatorItemIntoView,
    pickStatusBandState,
    createNavigatorItem,
  };
}
