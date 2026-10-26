/**
 * Renders the Table of Contents list, search filtering, active row highlighting,
 * and status band state for the LunaTOC sidebar.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { copyPromptText } from '@/features/conversationPrompts/copyPrompt';
import { parseUnrenderedBoldMarkdown } from '@/platforms/chatgpt/markdownBoldRepair';
import { isElementTextTruncated, previewTooltip } from '@/features/tooltip';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import {
  collapseAll,
  collapsePromptOutline,
  createPromptItem,
  registerPromptItem,
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
  getDisplayText?: (message: NavigatorMessage) => string;
  onRenamePrompt?: (message: NavigatorMessage, label: string) => Promise<void>;
  onRestorePrompt?: (message: NavigatorMessage) => Promise<void> | void;
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
  // Only one mounted row can be highlighted; avoid scanning the full list on scroll.
  let highlightedItem: HTMLElement | null = null;
  // Retain unchanged rows and their answer-heading DOM between renders.
  let renderedRows = new Map<string, { element: HTMLElement; signature: string }>();
  let hasScrolledInitialActive = false;
  interface InlineEditState {
    messageId: string;
    initialText: string;
    value: string;
    saving: boolean;
    error: string;
  }
  let editing: InlineEditState | null = null;
  let editorResizeObserver: ResizeObserver | null = null;

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
    editorResizeObserver?.disconnect();
    editorResizeObserver = null;
    editing = null;
    highlightedItem?.classList.remove('navigator-item-active');
    highlightedItem = null;
    navigatorItems = [];
    renderedRows.clear();
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
    const item = navigatorItems[index];
    if (highlightedItem !== item) {
      highlightedItem?.classList.remove('navigator-item-active');
      highlightedItem = null;
    }
    if (!item?.isConnected) return;

    if (highlightedItem !== item) {
      item.classList.add('navigator-item-active');
      highlightedItem = item;
    }
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
   * Expands a multi-line editor inside the current directory row, preserving
   * the entire title and draft across ordinary streaming re-renders.
   */
  function mountInlineEditor(
    item: HTMLElement,
    itemMain: HTMLElement,
    itemText: HTMLElement,
    message: NavigatorMessage,
    state: InlineEditState
  ): void {
    const input = document.createElement('textarea');
    input.className = 'navigator-item-inline-input';
    input.setAttribute('aria-label', '编辑目录文字');
    input.setAttribute('aria-multiline', 'true');
    input.rows = 1;
    input.maxLength = 240;
    input.value = state.value;
    input.disabled = state.saving;

    /** Recalculate height after wrapping, typing and sidebar width changes. */
    const fitContent = (): void => {
      input.style.height = 'auto';
      // Allow full text to wrap; the sidebar list itself can scroll for long titles.
      input.style.height = `${Math.max(28, input.scrollHeight + 2)}px`;
    };
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
      if (title === state.initialText) {
        cancel();
        return;
      }
      state.saving = true;
      input.disabled = true;
      void Promise.resolve(options.onRenamePrompt?.(message, title)).then(() => {
        if (editing !== state) return;
        editing = null;
        render();
      }).catch((error: unknown) => {
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
      fitContent();
      state.error = '';
      errorElement.remove();
      input.removeAttribute('aria-invalid');
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && !event.isComposing && !event.shiftKey) {
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

    // Do not focus again during a pending write; fit after DOM insertion.
    queueMicrotask(() => {
      if (editing !== state || !input.isConnected) return;
      fitContent();
      if (typeof ResizeObserver !== 'undefined') {
        let previousWidth = input.clientWidth;
        editorResizeObserver?.disconnect();
        editorResizeObserver = new ResizeObserver(() => {
          if (editing !== state || !input.isConnected) return;
          const width = input.clientWidth;
          if (width === previousWidth) return;
          previousWidth = width;
          fitContent();
        });
        editorResizeObserver.observe(itemMain);
      }
      if (state.saving) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  /**
   * Returns true if the open question and its answer headings extend outside
   * the sidebar's unobscured viewport. Zero-sized layout (e.g. before a browser
   * layout pass) remains eligible so actions are not prematurely hidden.
   */
  function isExpandedOutlineObscured(
    row: HTMLElement,
    outline: HTMLElement
  ): boolean {
    if (row.getAttribute('aria-expanded') !== 'true' || outline.hidden ||
        !outline.querySelector('.navigator-outline-item')) return false;
    const list = document.getElementById('navigator-list');
    if (!list) return false;
    const viewport = list.getBoundingClientRect();
    const topBar = list.parentElement?.querySelector<HTMLElement>('.navigator-topbar');
    const visibleTop = Math.max(viewport.top, topBar?.getBoundingClientRect().bottom ?? viewport.top);
    if (viewport.bottom <= visibleTop) return true;
    const question = row.querySelector<HTMLElement>('.navigator-item-main');
    const questionTop = (question ?? row).getBoundingClientRect().top;
    const outlineBottom = outline.getBoundingClientRect().bottom;
    if (questionTop === 0 && outlineBottom === 0) return true;
    return questionTop < visibleTop || outlineBottom > viewport.bottom;
  }

  /**
   * Aligns the expanded prompt row below the visible top bar, or reveals the
   * entire next directory row at the bottom. If no next row exists, aligns
   * the final answer heading instead. Never scrolls the ChatGPT conversation.
   */
  function scrollExpandedOutlineBoundary(
    message: NavigatorMessage,
    index: number,
    edge: 'top' | 'bottom'
  ): void {
    if (options.getMessages()[index]?.id !== message.id) return;
    const row = navigatorItems[index];
    const list = document.getElementById('navigator-list');
    if (!row?.isConnected || !list || row.getAttribute('aria-expanded') !== 'true') return;
    const outline = row.querySelector<HTMLElement>('.navigator-outline-list');
    if (!outline || !isExpandedOutlineObscured(row, outline)) return;
    const headings = outline.querySelectorAll<HTMLElement>('.navigator-outline-item');
    if (!headings.length || typeof list.scrollTo !== 'function') return;

    const boundary = list.getBoundingClientRect();
    const topBar = list.parentElement?.querySelector<HTMLElement>('.navigator-topbar');
    const visibleTop = Math.max(boundary.top, topBar?.getBoundingClientRect().bottom ?? boundary.top);
    const padding = 8;
    let delta: number;
    if (edge === 'top') {
      // The prompt itself must remain fully visible under the frosted top bar.
      delta = row.getBoundingClientRect().top - visibleTop - padding;
    } else {
      // navigatorItems uses original indices; find the next *visible* row.
      const nextRow = navigatorItems.slice(index + 1).find((candidate) => candidate?.isConnected);
      const anchor = nextRow ?? headings[headings.length - 1];
      delta = anchor.getBoundingClientRect().bottom - boundary.bottom + padding;
    }
    list.scrollTo({ top: Math.max(0, list.scrollTop + delta), behavior: 'auto' });
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
    const rawDisplayText = options.getDisplayText?.(message) ?? message.text;
    const displayText = parseUnrenderedBoldMarkdown(rawDisplayText)
      ?.map((segment) => segment.text).join('') ?? rawDisplayText;
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
      const isExpanded = item.getAttribute('aria-expanded') === 'true' &&
        !outlineControls.outlineList.hidden &&
        !!outlineControls.outlineList.querySelector('.navigator-outline-item');
      const expandedOutline = isExpanded &&
        isExpandedOutlineObscured(item, outlineControls.outlineList);
      promptContextMenuController.show(
        { left, top },
        [
          ...(isExpanded
            ? [{ id: 'collapse-outline', label: '收起目录', icon: 'list-collapse' as const }]
            : []),
          { id: 'copy-prompt', label: '复制文字', icon: 'copy' },
          { id: 'save-prompt', label: '添加Tips', icon: 'bookmark-plus' },
          ...(options.onRenamePrompt && (options.canRename?.() ?? true)
            ? [{ id: 'rename-toc', label: '编辑文字', icon: 'pencil-line' as const }]
            : []),
          ...(expandedOutline
            ? [{ id: 'return-to-top', label: '回到顶部', icon: 'arrow-up' as const }]
            : []),
          ...(expandedOutline
            ? [{ id: 'return-to-bottom', label: '回到底部', icon: 'arrow-down' as const }]
            : []),
          ...(options.onRestorePrompt && options.isRenamed?.(message)
            ? [{ id: 'restore-toc', label: '恢复原文', icon: 'pencil-line' as const }]
            : []),
        ],
        (itemId) => {
          if (itemId === 'return-to-top' || itemId === 'return-to-bottom') {
            scrollExpandedOutlineBoundary(
              message, index, itemId === 'return-to-top' ? 'top' : 'bottom'
            );
          } else if (itemId === 'collapse-outline') {
            // Ignore an old menu after a route change or row replacement.
            if (options.getMessages()[index]?.id === message.id &&
                navigatorItems[index] === item && item.isConnected &&
                item.getAttribute('aria-expanded') === 'true' &&
                !outlineControls.outlineList.hidden) {
              const list = document.getElementById('navigator-list');
              const listTop = list?.getBoundingClientRect().top;
              const topBarBottom = list?.parentElement
                ?.querySelector<HTMLElement>('.navigator-topbar')
                ?.getBoundingClientRect().bottom;
              const visibleTop = listTop === undefined
                ? null : Math.max(listTop, topBarBottom ?? listTop);
              const question = item.querySelector<HTMLElement>('.navigator-item-main') ?? item;
              const hiddenAbove = visibleTop !== null &&
                question.getBoundingClientRect().top < visibleTop;

              collapsePromptOutline(index);

              if (hiddenAbove && list && visibleTop !== null &&
                  typeof list.scrollTo === 'function') {
                // Re-measure after collapsing because removing headings can shift the viewport.
                const delta = item.getBoundingClientRect().top - visibleTop - 8;
                list.scrollTo({
                  top: Math.max(0, list.scrollTop + delta),
                  behavior: 'auto',
                });
              }
            }
          } else if (itemId === 'copy-prompt') {
            void copyPromptText(message.text).catch((error: unknown) => {
              console.warn('[LunaTOC] Failed to copy prompt text', error);
            });
          } else if (itemId === 'save-prompt') {
            options.onSavePrompt?.(message);
          } else if (itemId === 'rename-toc') {
            editing = {
              messageId: message.id,
              initialText: options.getDisplayText?.(message) ?? message.text,

              value: options.getDisplayText?.(message) ?? message.text,
              saving: false,
              error: '',
            };
            previewTooltip.hide();
            render();
          } else if (itemId === 'restore-toc') {
            void Promise.resolve(options.onRestorePrompt?.(message)).catch((error: unknown) => {
              // Do not attach errors to a row that is no longer visible.
              const currentRow = navigatorItems[index];
              if (options.getMessages()[index]?.id !== message.id ||
                  !currentRow?.isConnected) return;
              let alert = currentRow.querySelector<HTMLElement>('.navigator-item-restore-error');
              if (!alert) {
                alert = document.createElement('div');
                alert.className = 'navigator-item-inline-error navigator-item-restore-error';
                alert.setAttribute('role', 'alert');
                currentRow.appendChild(alert);
              }
              alert.textContent = '恢复原文失败，请重试';
            });
          }
        }
      );
    };

    item.addEventListener('contextmenu', (event) => {
      if (event.target instanceof HTMLTextAreaElement) return;
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

    editorResizeObserver?.disconnect();
    editorResizeObserver = null;
    const previousRows = renderedRows;
    const nextRows = new Map<string, { element: HTMLElement; signature: string }>();
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

    visibleMessages.forEach(({ message, index }, position) => {
      const key = `${index}:${message.id}`;
      const displayText = options.getDisplayText?.(message) ?? message.text;
      const signature = JSON.stringify([
        message.id, message.text, message.createTime, message.canMatchByText,
        message.answerId, displayText,
        editing?.messageId === message.id ? 'editing' : 'display',
      ]);
      const prior = previousRows.get(key);
      const oldOutline = prior?.element.parentElement === list &&
          prior.signature === signature && editing?.messageId !== message.id
        ? prior.element.querySelector<HTMLDivElement>('.navigator-outline-list')
        : null;
      const item = oldOutline && prior
        ? prior.element : createNavigatorItem(message, index);
      if (oldOutline) registerPromptItem(index, item, oldOutline, false);
      navigatorItems[index] = item;
      nextRows.set(key, { element: item, signature });
      if (list.children[position] !== item) {
        list.insertBefore(item, list.children[position] ?? null);
      }
    });
    while (list.children.length > visibleMessages.length) {
      list.lastElementChild?.remove();
    }
    renderedRows = nextRows;

    // Reconcile reused, replaced and search-filtered rows with the tracker state.
    const activeIndex = options.getActiveIndex();
    const activeItem = activeIndex === null ? null : navigatorItems[activeIndex] ?? null;
    if (highlightedItem !== activeItem) {
      highlightedItem?.classList.remove('navigator-item-active');
      highlightedItem = activeItem;
      highlightedItem?.classList.add('navigator-item-active');
    }

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
