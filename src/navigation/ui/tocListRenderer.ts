/**
 * Renders the Table of Contents list, search filtering, active row highlighting,
 * and status band state for the LunaTOC sidebar.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { copyPromptText } from '@/features/conversationPrompts/copyPrompt';
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
  onJumpToPromptBoundary?: (
    message: NavigatorMessage,
    index: number,
    edge: 'top' | 'bottom'
  ) => void;
  onSavePrompt?: (message: NavigatorMessage) => void;
  getDisplayText?: (message: NavigatorMessage) => string;
  onRenamePrompt?: (message: NavigatorMessage, label: string) => Promise<void>;
  onRestorePrompt?: (message: NavigatorMessage) => void;
  isRenamed?: (message: NavigatorMessage) => boolean;
  canRename?: () => boolean;
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
  interface InlineEditState {
    messageId: string;
    value: string;
    saving: boolean;
    error: string;
  }
  let editing: InlineEditState | null = null;

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
    editing = null;
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

  /**
   * Replaces the selected title directly in its sidebar row with a single-line
   * editor. Its state survives re-renders triggered by streaming messages.
   */
  function mountInlineEditor(
    item: HTMLElement,
    itemMain: HTMLElement,
    itemText: HTMLElement,
    message: NavigatorMessage,
    state: InlineEditState
  ): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'navigator-item-inline-input';
    input.setAttribute('aria-label', '修改目录文字');
    input.maxLength = 240;
    input.value = state.value;
    input.disabled = state.saving;
    item.classList.add('navigator-item-editing');
    itemMain.replaceChild(input, itemText);

    const errorElement = document.createElement('div');
    errorElement.className = 'navigator-item-inline-error';
    errorElement.setAttribute('role', 'alert');
    if (state.error) {
      errorElement.textContent = state.error;
      input.setAttribute('aria-invalid', 'true');
      item.insertBefore(errorElement, itemMain.nextSibling);
    }

    const cancel = (): void => {
      if (editing !== state || state.saving) return;
      editing = null;
      render();
    };

    const save = (): void => {
      if (editing !== state || state.saving) return;
      const title = input.value.trim();
      if (!title) {
        state.error = '目录文字不能为空';
        input.setAttribute('aria-invalid', 'true');
        errorElement.textContent = state.error;
        if (!errorElement.isConnected) item.insertBefore(errorElement, itemMain.nextSibling);
        return;
      }
      if (title === (options.getDisplayText?.(message) ?? message.text)) {
        cancel();
        return;
      }
      state.saving = true;
      input.disabled = true;
      void Promise.resolve(options.onRenamePrompt?.(message, title)).then(() => {
        if (editing !== state) return;
        editing = null;
        render();
      }).catch(() => {
        if (editing !== state) return;
        state.saving = false;
        state.error = '保存失败，请重试';
        render();
      });
    };

    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('contextmenu', (event) => event.stopPropagation());
    input.addEventListener('input', () => {
      state.value = input.value;
      state.error = '';
      errorElement.remove();
      input.removeAttribute('aria-invalid');
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        save();
      }
    });
    input.addEventListener('blur', () => {
      if (!input.isConnected || editing !== state || state.saving) return;
      if (!input.value.trim()) {
        cancel();
      } else {
        save();
      }
    });

    queueMicrotask(() => {
      if (editing !== state || !input.isConnected || state.saving) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
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
    const displayText = options.getDisplayText?.(message) ?? message.text;
    itemText.textContent = displayText.replace(/\s+/g, ' ');

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

    if (editing?.messageId === message.id) {
      mountInlineEditor(item, itemMain, itemText, message, editing);
    }

    const showTooltip = (event: MouseEvent): void => {
      if (editing?.messageId === message.id) return;
      if (isElementTextTruncated(itemText)) {
        previewTooltip.show(displayText, event, itemMain);
      }
    };

    item.addEventListener('click', (event) => {
      if (editing?.messageId === message.id) return;
      options.onItemClick(message, index);
      if (item.matches(':hover')) showTooltip(event);
    });
    /**
     * Opens prompt actions exclusively from the native right-click gesture.
     * Long titles use CSS text-overflow ellipsis instead of an action button.
     */
    const showItemMenu = (left: number, top: number): void => {
      previewTooltip.hide();
      promptContextMenuController.show(
        { left, top },
        [
          { id: 'copy-prompt', label: '复制文字', icon: 'copy' },
          { id: 'save-prompt', label: '添加tips', icon: 'bookmark-plus' },
          ...(options.onRenamePrompt && (options.canRename?.() ?? true)
            ? [{ id: 'rename-toc', label: '修改文字', icon: 'pencil-line' as const }]
            : []),
          { id: 'return-to-top', label: '回到顶部', icon: 'arrow-up' },
          { id: 'return-to-bottom', label: '回到底部', icon: 'arrow-down' },
          ...(options.onRestorePrompt && options.isRenamed?.(message)
            ? [{ id: 'restore-toc', label: '恢复原文', icon: 'pencil-line' as const }]
            : []),
        ],
        (itemId) => {
          if (itemId === 'return-to-top' || itemId === 'return-to-bottom') {
            options.onJumpToPromptBoundary?.(
              message, index, itemId === 'return-to-top' ? 'top' : 'bottom'
            );
          } else if (itemId === 'copy-prompt') {
            void copyPromptText(message.text).catch((error: unknown) => {
              console.warn('[LunaTOC] Failed to copy prompt text', error);
            });
          } else if (itemId === 'save-prompt') {
            options.onSavePrompt?.(message);
          } else if (itemId === 'rename-toc') {
            editing = {
              messageId: message.id,
              value: options.getDisplayText?.(message) ?? message.text,
              saving: false,
              error: '',
            };
            previewTooltip.hide();
            render();
          } else if (itemId === 'restore-toc') {
            options.onRestorePrompt?.(message);
          }
        }
      );
    };

    item.addEventListener('contextmenu', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      event.stopPropagation();
      showItemMenu(event.clientX, event.clientY);
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
        return [message.text, options.getDisplayText?.(message) ?? message.text]
          .some((text) => normalizeText(text).toLowerCase().includes(normalizedQuery));
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
