/**
 * Coordinates conversation data, TOC rendering, prompt navigation, and active
 * prompt tracking for the LunaTOC sidebar.
 */
import {
  createNavigatorMessage,
  extractUserMessages,
} from '../features/conversationPrompts/message';
import { createNavigationSnapshotStore } from '@/navigation/jump/navigationSnapshotStore';
import { buildFingerprintIndex } from '@/navigation/fingerprint/index';
import { buildDerivedSegmentIndex } from '@/navigation/fingerprint/segments';
import { createChatGptNavigationTurns } from '@/platforms/chatgpt/navigationAdapter';
import { createRenderedFingerprintCollector } from '@/platforms/chatgpt/renderedFingerprintCollector';
import type { NavigationTurn } from '@/navigation/navigationData';
import type {
  ChatMessage,
  ConversationData,
  NavigatorMessage,
} from '../features/conversationPrompts/message';
import {
  createPromptMarkButton,
  initializePromptMark,
} from '../features/conversationPrompts/promptMark';
import {
  initializeFollow,
  isFollowing,
  keepFollowing,
  stopFollowing,
} from '../navigation/follow/follow';
import {
  initializePromptNavigation,
  jumpToAbsoluteEdge as jumpToPageEdge,
  jumpToConversationEdge,
  jumpToMessage,
} from '../navigation/jump/promptNavigation';
import {
  collapseAll,
  createPromptItem,
  handlePromptNavigation,
  resetOutline,
  resetPromptItems,
  scheduleBuild,
  setPromptMessages,
  setSidebarStatus,
  syncActivePrompt,
  syncMarkState,
} from '../navigation/jump/outline';
import {
  isElementTextTruncated,
  previewTooltip,
} from '@/features/tooltip';
import { APP_CONFIG } from '@/config/config';

interface NavigatorControllerOptions {
  onPromptCountChanged?: (count: number) => void;
  onPromptAdded?: () => void;
  onRouteChanged?: () => void;
  onSavePrompt?: (message: NavigatorMessage) => void;
  onTitleChanged?: () => void;
}

interface RenderOptions {
  refreshObservers?: boolean;
  /**
   * Caller-declared completion status for this render pass.
   *   - `null`  (default): preserve `isLoadingPrompts` as-is — used by
   *     callers that don't know whether more data is on the way
   *     (e.g. the initial render at `attach()`).
   *   - `true`: the data backing this render is final. Clear the
   *     settle timer, flip the loading flag to false, and (if the
   *     user hasn't already moved the cursor and isn't mid-scroll)
   *     snap the TOC cursor + scroll position to the last prompt.
   *   - `false`: more data is expected. Flip the loading flag to
   *     true and arm the fallback settle timer so cached /
   *     localStorage scenarios that go silent still resolve.
   */
  completed?: boolean | null;
}

interface ResetRouteOptions {
  preserveMessages?: boolean;
  nextMessages?: NavigatorMessage[];
}

export const navigatorController = (() => {
  const EMPTY_HINT_TEXT = 'Waiting for prompts...';
  const NATIVE_PROMPT_BUTTON_SELECTORS = [
    'button[aria-label^="Prompt "]',
    'button[aria-label^="prompt "]',
    'button[aria-description^="Prompt "]',
    'button[aria-description^="prompt "]',
  ];
  const NATIVE_PROMPT_BUTTON_SELECTOR =
    NATIVE_PROMPT_BUTTON_SELECTORS.join(',');
  const ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR =
    NATIVE_PROMPT_BUTTON_SELECTORS.map(
      (selector) => `${selector}[data-toc-active]`
    ).join(',');
  const navigationSnapshotStore =
    createNavigationSnapshotStore<NavigatorMessage>();
  const renderedFingerprintCollector = createRenderedFingerprintCollector({
    onFingerprintRecord: (context, record) => {
      navigationSnapshotStore.upsertFingerprintRecord(
        context.conversationKey,
        context.revision,
        record
      );
    },
  });

  let conversationMessages: NavigatorMessage[] = [];
  const accumulatedConversationMessages = new Map<string, Map<string, ChatMessage>>();
  let searchQuery = '';
  let currentConversationKey: string | null = null;
  let pendingNewChatRouteKey: string | null = null;
  let pendingNewChatMessage: ChatMessage | null = null;
  let activeNavigatorIndex: number | null = null;
  let navigatorItems: HTMLElement[] = [];
  let activePromptObserver: IntersectionObserver | null = null;
  let activePromptMutationObserver: MutationObserver | null = null;
  let activePromptMutationTimer: ReturnType<typeof setTimeout> | null = null;
  let activeNativeTocObserver: MutationObserver | null = null;
  /** True while prompts are still arriving (backfill / pagination in flight). */
  let isLoadingPrompts = true;
  /**
   * Tracks whether the auto-jump-to-last has fired for the current load
   * cycle. Currently unused — `jumpToLastIfIdle`'s `activeNavigatorIndex
   * !== null` gate plus `resetStateForCurrentRoute`'s index reset on
   * route switch already gate re-firing correctly.
   */
  let autoJumpedForCurrentLoad = false;
  /**
   * Fallback timer for cases where neither `CHATGPT_CONVERSATION_DATA`,
   * `CHATGPT_CONVERSATION_ENDED`, nor the DOM observer provides a
   * "loaded" signal. ChatGPT can hydrate a conversation entirely from
   * its own client-side cache (or test setups can mock one from
   * `localStorage`), in which case no page-hook event ever fires and
   * ChatGPT's rendered DOM may even lack `[data-message-author-role]`
   * user-message elements. The DOM observer handles the common
   * cache-rendered case, this timer handles everything else. Configured
   * via `APP_CONFIG.ui.sidebar.loadingSettleMs`. Cancelled automatically
   * whenever the loading flag drops, so it never fires after a normal
   * load or after the user starts typing.
   */
  let loadingSettleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Marks prompts loading as finished for the active conversation and re-renders
   * the sidebar so the status band leaves `loading` mode. Replaces the prior
   * `page_info.has_previous_page !== false` heuristic, which stranded the UI
   * whenever the page hook omitted `page_info` on its final response or its
   * backfill hit `BACKFILL_MAX_PAGES` before the true last page. Called when
   * the page hook posts `CHATGPT_CONVERSATION_ENDED`, when the DOM observer
   * detects settled user-message elements, and by the fallback settle timer.
   */
  function markLoadingComplete(): void {
    if (!isLoadingPrompts) return;
    isLoadingPrompts = false;
    if (loadingSettleTimer !== null) {
      clearTimeout(loadingSettleTimer);
      loadingSettleTimer = null;
    }
    render({ completed: true });
  }

  /**
   * (Re)arms the fallback settle timer. Safe to call repeatedly —
   * previous timers are cleared first. The timer fires once and only
   * acts if `isLoadingPrompts` is still true at that point, so a
   * normal `CHATGPT_CONVERSATION_ENDED` (which clears loading earlier)
   * makes this a no-op.
   */
  function startLoadingSettleTimer(): void {
    if (loadingSettleTimer !== null) {
      clearTimeout(loadingSettleTimer);
    }
    loadingSettleTimer = window.setTimeout(() => {
      loadingSettleTimer = null;
      if (isLoadingPrompts) markLoadingComplete();
    }, APP_CONFIG.ui.sidebar.loadingSettleMs);
  }
  /** Active jump navigation progress, or null when idle. */
  let jumpProgress: {
    active: boolean;
    targetIndex: number;
    remainingSteps: number;
  } | null = null;
  let activeNativeTocTimer: ReturnType<typeof setTimeout> | null = null;
  let lockedNavigatorIndex: number | null = null;
  let lockedNavigatorTimer: ReturnType<typeof setTimeout> | null = null;
  let isInitialized = false;
  let isAttached = false;
  let reportedPromptCount = -1;
  let onPromptCountChanged = (_count: number) => {};
  let onPromptAdded = () => {};
  let onRouteChanged = () => {};
  let onSavePrompt: (message: NavigatorMessage) => void = () => {};
  let onTitleChanged = () => {};

  /**
   * Initializes data and route listeners before the page hook starts emitting.
   * @param {Object} [options]
   * @param {Function} [options.onPromptCountChanged]
   * @param {Function} [options.onRouteChanged]
   * @param {Function} [options.onSavePrompt]
   * @param {Function} [options.onTitleChanged]
   */
  function init(options: NavigatorControllerOptions = {}): void {
    if (isInitialized) return;

    onPromptCountChanged =
      options.onPromptCountChanged || onPromptCountChanged;
    onPromptAdded = options.onPromptAdded || onPromptAdded;
    onRouteChanged = options.onRouteChanged || onRouteChanged;
    onSavePrompt = options.onSavePrompt || onSavePrompt;
    onTitleChanged = options.onTitleChanged || onTitleChanged;
    currentConversationKey = getCurrentConversationKey();
    initMarkedPrompts();
    listenForConversationData();
    listenForRouteChanges();
    isInitialized = true;
  }

  /**
   * Connects navigation helpers and observers after the sidebar DOM exists.
   */
  function attach(): void {
    if (isAttached) return;

    initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector:
        '#luna-toc-sidebar, #luna-toc-preview-tooltip, #luna-toc-button-tooltip',
      getNativeActiveIndex: findActiveNativePromptIndex,
      setActiveIndex: setActiveNavigatorItem,
    });

    initializePromptNavigation({
      getNativePromptButtons,
      normalizeText,
      findConversationIndexByElement,
      getConversationMessageCount: () => conversationMessages.length,
      getVirtualSearchContext: () => {
        const conversationKey = getCurrentConversationKey();
        const snapshot = navigationSnapshotStore.getSnapshot(conversationKey);

        return {
          conversationKey,
          prompts: conversationMessages,
          fingerprintIndex: snapshot?.fingerprintIndex || [],
          segmentIndex: snapshot?.segmentIndex || [],
        };
      },
      lockActiveIndex: lockActiveNavigatorItem,
      setJumpProgress,
      clearJumpProgress,
    });

    initActivePromptTracking();
    renderedFingerprintCollector.observe(document.body);
    isAttached = true;
    startLoadingSettleTimer();
    render();
  }

  /**
   * Returns the route key shared with prompt marking and page-hook messages.
   * @returns {string}
   */
  function getCurrentConversationKey(): string {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    return match?.[1] || `new-chat:${location.pathname}`;
  }

  /**
   * Updates the TOC search query and rebuilds the list.
   * @param {string} query
   */
  function setSearchQuery(query: string): void {
    searchQuery = query;
    render();
  }

  /**
   * Resets search and outline state without changing the chat scroll position.
   */
  function resetView(): void {
    searchQuery = '';
    previewTooltip.hide();
    stopFollowing();
    collapseAll();
    render();

    document.getElementById('navigator-list')?.scrollTo({
      top: 0,
      behavior: 'auto',
    });
  }

  /**
   * Jumps to a conversation edge using the matching prompt when available.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToEdge(edge: 'top' | 'bottom'): void {
    const index = edge === 'top' ? 0 : conversationMessages.length - 1;
    const message = conversationMessages[index];

    if (message) {
      jumpToMessage(message, index);
      return;
    }

    jumpToConversationEdge(edge);
  }

  /**
   * Jumps directly to the absolute chat edge.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToAbsoluteEdge(edge: 'top' | 'bottom'): void {
    jumpToPageEdge(edge, 'auto');
  }

  /**
   * Builds the conversation TOC from normalized user messages.
   * @param {Object} [options]
   * @param {boolean} [options.refreshObservers=false]
   * @param {boolean | null} [options.completed=null]  Caller-declared
   *   completion status. `null` preserves `isLoadingPrompts`; `true`
   *   declares the data final; `false` arms the fallback timer.
   */
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
    setPromptMessages(conversationMessages);
    reportPromptCount();

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

    // Translate the caller's `completed` flag into the loading flag +
    // status band state. The status band is a stateless renderer: the
    // caller picks the visible state.
    if (completed === true) {
      isLoadingPrompts = false;
      if (loadingSettleTimer !== null) {
        clearTimeout(loadingSettleTimer);
        loadingSettleTimer = null;
      }
      autoJumpedForCurrentLoad = false;
    } else if (completed === false) {
      isLoadingPrompts = true;
      autoJumpedForCurrentLoad = false;
      startLoadingSettleTimer();
    }
    // null → leave isLoadingPrompts alone

    setSidebarStatus({
      state: pickStatusBandState(completed),
      jump: getJumpProgress(),
      promptCount: conversationMessages.length,
    });

    if (completed === true) {
      jumpToLastIfIdle();
    }

    if (refreshObservers && isAttached) {
      observeVisibleUserMessages();
    }
  }

  /**
   * Chooses the visible state for the status band based on the caller's
   * completion flag and the current prompt count.
   * @param {boolean | null} completed
   * @returns {import('../navigation/jump/outline').SidebarStatusState}
   */
  function pickStatusBandState(
    completed: boolean | null
  ): import('../navigation/jump/outline').SidebarStatusState {
    const jump = getJumpProgress();
    if (jump && jump.active) return 'jumping';
    if (completed === true) {
      return conversationMessages.length === 0 ? 'empty' : 'complete';
    }
    if (completed === false) return 'loading';
    // null: preserve previous band state via the caller's intent.
    return isLoadingPrompts
      ? 'loading'
      : conversationMessages.length === 0
        ? 'idle'
        : 'idle';
  }

  /**
   * Snaps the TOC cursor to the last prompt and scrolls the sidebar so
   * the row sits flush at the bottom. Called exactly once when loading
   * completes (gated above). Skipped when the user is mid-scroll or
   * has already moved the active cursor.
   */
  function jumpToLastIfIdle(): void {
    if (isFollowing()) return;
    if (conversationMessages.length === 0) return;
    const lastIndex = conversationMessages.length - 1;
    // The earlier `activeNavigatorIndex !== null` guard has been
    // removed. It bailed in exactly the case it was meant to enable:
    // when ChatGPT's own auto-scroll-to-bottom on load fires our
    // `follow.ts` settle first, it sets the cursor to the last prompt
    // before our `completed: true` render runs, so the guard skipped
    // the scroll-into-view even though `innerHTML = ''` had just
    // reset the sidebar's scrollTop to 0. The remaining `isFollowing`
    // gate is sufficient: while the user is mid-scroll they want to
    // see what `follow.ts` shows them; after load settles we are free
    // to anchor the cursor + scroll position to the last prompt.
    forceActiveNavigatorItem(lastIndex);
    const lastItem = navigatorItems[lastIndex];
    if (lastItem) {
      lastItem.scrollIntoView({ block: 'end' });
    }
  }

  /**
   * Creates one TOC row and its outline, mark, tooltip, and save behaviors.
   * @param {Object} message
   * @param {number} index
   * @returns {HTMLElement}
   */
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
      index === activeNavigatorIndex
    );
    itemMain.className = 'navigator-item-main';
    itemText.className = 'navigator-item-text';
    itemText.textContent = `${index + 1}. ${message.text.replace(/\s+/g, ' ')}`;

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

    item.addEventListener('click', (event) => {
      handleNavigatorItemClick(message, index);
      if (isElementTextTruncated(itemText) && item.matches(':hover')) {
        previewTooltip.show(message.text, event, itemMain);
      }
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onSavePrompt(message);
    });
    item.addEventListener('mouseenter', (event) => {
      if (isElementTextTruncated(itemText)) {
        previewTooltip.show(message.text, event, itemMain);
      }
    });
    item.addEventListener('mouseleave', () => {
      previewTooltip.hide();
    });

    return item;
  }

  /**
   * Navigates to a prompt and schedules its assistant-answer outline.
   * @param {Object} message
   * @param {number} index
   */
  function handleNavigatorItemClick(
    message: NavigatorMessage,
    index: number
  ): void {
    previewTooltip.hide();
    const outlineAction = handlePromptNavigation(index, activeNavigatorIndex);

    jumpToMessage(message, index);
    if (outlineAction?.shouldBuild) {
      scheduleBuild(index);
    }
  }

  function reportPromptCount(): void {
    const promptCount = conversationMessages.length;
    if (promptCount === reportedPromptCount) return;

    reportedPromptCount = promptCount;
    onPromptCountChanged(promptCount);
  }

  /**
   * Returns the current jump progress snapshot, or null when no jump is
   * active. Consumed by the sidebar status element.
   */
  function getJumpProgress(): typeof jumpProgress {
    return jumpProgress;
  }

  /**
   * Marks a jump as active and records the target index plus the remaining
   * slide-loop step budget. Re-renders so the sidebar status picks up the
   * change on the next animation frame.
   */
  function setJumpProgress(
    next: NonNullable<typeof jumpProgress>
  ): void {
    jumpProgress = next;
    render();
  }

  /**
   * Clears any active jump progress. Called by the navigation layer when a
   * jump resolves or aborts so the sidebar status returns to the idle
   * prompt-count display.
   */
  function clearJumpProgress(): void {
    if (jumpProgress === null) return;
    jumpProgress = null;
    render();
  }

  function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  function forceActiveNavigatorItem(index: number): void {
    const activeIndexChanged = index !== activeNavigatorIndex;
    activeNavigatorIndex = index;
    navigatorItems.forEach((item) => {
      item.classList.remove('navigator-item-active');
    });

    const item = navigatorItems[index];
    if (!item) return;

    item.classList.add('navigator-item-active');
    if (activeIndexChanged) {
      syncActivePrompt(index);
    }
    scrollNavigatorItemIntoView(item);
  }

  function setActiveNavigatorItem(index: number): void {
    if (
      lockedNavigatorIndex !== null &&
      index !== lockedNavigatorIndex &&
      lockedNavigatorTimer
    ) {
      return;
    }
    forceActiveNavigatorItem(index);
  }

  function lockActiveNavigatorItem(index: number, duration = 1800): void {
    if (lockedNavigatorTimer !== null) clearTimeout(lockedNavigatorTimer);
    keepFollowing(duration);
    lockedNavigatorIndex = index;
    forceActiveNavigatorItem(index);
    lockedNavigatorTimer = setTimeout(() => {
      lockedNavigatorIndex = null;
      lockedNavigatorTimer = null;
    }, duration);
  }

  function scrollNavigatorItemIntoView(item: HTMLElement): void {
    const scrollContainer = document.getElementById('navigator-list');
    if (!scrollContainer || !isFollowing()) return;

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

    scrollContainer.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
  }

  function findConversationIndexByElement(element: HTMLElement): number {
    const visibleUserMessages = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-message-author-role="user"]'
      )
    );

    if (visibleUserMessages.length === conversationMessages.length) {
      return visibleUserMessages.indexOf(element);
    }

    const domText = normalizeText(element.innerText);
    for (let index = conversationMessages.length - 1; index >= 0; index--) {
      const message = conversationMessages[index];
      if (!message.canMatchByText) continue;

      const messageText = normalizeText(message.text);
      if (domText === messageText || domText.includes(messageText))
        return index;
    }
    return -1;
  }

  function getNativePromptButtons(): HTMLButtonElement[] {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        NATIVE_PROMPT_BUTTON_SELECTOR
      )
    ).filter(isUsableNativePromptButton);
    const indexedButtons: HTMLButtonElement[] = [];

    buttons.forEach((button) => {
      const index = getNativePromptIndexFromButton(button);
      if (index === -1 || indexedButtons[index]) return;
      indexedButtons[index] = button;
    });
    return indexedButtons.length > 0 ? indexedButtons : buttons;
  }

  function isUsableNativePromptButton(button: HTMLButtonElement): boolean {
    if (!button.isConnected || button.disabled) return false;
    if (button.closest('[aria-hidden="true"], [inert]')) return false;
    if (button.getClientRects().length === 0) return false;

    const style = window.getComputedStyle(button);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none'
    );
  }

  function getNativePromptIndexFromButton(button: HTMLButtonElement): number {
    const label =
      button.getAttribute('aria-label') ||
      button.getAttribute('aria-description') ||
      '';
    const match = label.match(/^prompt\s+(\d+)$/i);
    return match ? Number(match[1]) - 1 : -1;
  }

  function findActiveNativePromptIndex(): number {
    const activeButton = document.querySelector<HTMLButtonElement>(
      ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR
    );
    if (!activeButton) return -1;

    const labelIndex = getNativePromptIndexFromButton(activeButton);
    if (labelIndex !== -1) return labelIndex;
    return getNativePromptButtons().indexOf(activeButton);
  }

  function syncActiveNavigatorItemFromNativeToc(): boolean {
    const index = findActiveNativePromptIndex();
    if (index === -1) return false;
    setActiveNavigatorItem(index);
    return true;
  }

  function observeVisibleUserMessages(): void {
    activePromptObserver?.disconnect();
    activePromptObserver = new IntersectionObserver(
      (entries) => {
        const topEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!topEntry || syncActiveNavigatorItemFromNativeToc()) return;
        if (!(topEntry.target instanceof HTMLElement)) return;
        const index = findConversationIndexByElement(topEntry.target);
        if (index !== -1) setActiveNavigatorItem(index);
      },
      { threshold: [0.1, 0.25, 0.5, 0.75, 1] }
    );

    document
      .querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
      .forEach((element) => activePromptObserver?.observe(element));
  }

  function initNativeTocActiveTracking(): void {
    activeNativeTocObserver?.disconnect();
    activeNativeTocObserver = new MutationObserver(() => {
      if (activeNativeTocTimer !== null) clearTimeout(activeNativeTocTimer);
      activeNativeTocTimer = setTimeout(
        syncActiveNavigatorItemFromNativeToc,
        100
      );
    });
    activeNativeTocObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-toc-active'],
      childList: true,
      subtree: true,
    });
    syncActiveNavigatorItemFromNativeToc();
  }

  function initActivePromptTracking(): void {
    activePromptMutationObserver?.disconnect();
    activePromptMutationObserver = new MutationObserver(() => {
      if (activePromptMutationTimer !== null)
        clearTimeout(activePromptMutationTimer);
      activePromptMutationTimer = setTimeout(observeVisibleUserMessages, 200);
    });
    activePromptMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    observeVisibleUserMessages();
    initNativeTocActiveTracking();
  }

  function isNewChatRouteKey(routeKey: string): boolean {
    return routeKey.startsWith('new-chat:') || routeKey.startsWith('WEB:');
  }

  function clearPendingNewChat(): void {
    pendingNewChatRouteKey = null;
    pendingNewChatMessage = null;
  }

  function appendNavigatorMessage(newMessage: ChatMessage): boolean {
    if (conversationMessages.some((message) => message.id === newMessage.id)) {
      return false;
    }
    conversationMessages.push(createNavigatorMessage(newMessage));
    cacheConversationMessages(getCurrentConversationKey());
    return true;
  }

  /**
   * Stores a snapshot of the current normalized prompts for one conversation.
   * The cache is memory-only and lasts for this content script's lifetime.
   * @param {string} conversationKey
   */
  function cacheConversationMessages(conversationKey: string): void {
    if (!conversationKey) return;

    const revision = navigationSnapshotStore.replacePrompts(
      conversationKey,
      conversationMessages
    );
    syncRenderedFingerprintContext(conversationKey, revision);
  }

  /**
   * Returns a cached prompt snapshot for a conversation.
   * @param {string} conversationKey
   * @returns {Object[]}
   */
  function getCachedConversationMessages(
    conversationKey: string
  ): NavigatorMessage[] {
    return navigationSnapshotStore.getSnapshot(conversationKey)?.prompts || [];
  }

  /**
   * Builds fingerprints in the background and stores only the current revision.
   */
  function cacheConversationNavigationData(
    conversationKey: string,
    data: ConversationData
  ): void {
    const revision = navigationSnapshotStore.replacePrompts(
      conversationKey,
      conversationMessages
    );
    const turns = createChatGptNavigationTurns(data);
    syncRenderedFingerprintContext(conversationKey, revision, turns);

    void buildFingerprintIndex(turns, 'derived')
      .then((fingerprintIndex) => {
        navigationSnapshotStore.completeFingerprintIndex(
          conversationKey,
          revision,
          fingerprintIndex
        );
      })
      .catch((error: unknown) => {
        console.warn(
          '[LunaTOC] Failed to build navigation fingerprints.',
          error
        );
      });

    void buildDerivedSegmentIndex(turns)
      .then((segmentIndex) => {
        navigationSnapshotStore.completeSegmentIndex(
          conversationKey,
          revision,
          segmentIndex
        );
      })
      .catch((error: unknown) => {
        console.warn(
          '[LunaTOC] Failed to build derived navigation segments.',
          error
        );
      });
  }

  /**
   * Updates DOM fingerprint collection with the current response-to-prompt map.
   */
  function syncRenderedFingerprintContext(
    conversationKey: string,
    revision: number,
    turns?: NavigationTurn[]
  ): void {
    const responsePromptIndexes = turns
      ? createResponsePromptIndexMap(turns)
      : new Map(
          (
            navigationSnapshotStore.getSnapshot(conversationKey)
              ?.fingerprintIndex || []
          ).map(({ responseId, promptIndex }) => [responseId, promptIndex])
        );

    renderedFingerprintCollector.setContext({
      conversationKey,
      revision,
      responsePromptIndexes,
    });
  }

  function flushPendingNewChatMessage(): void {
    if (!pendingNewChatMessage) return;
    const didAppend = appendNavigatorMessage(pendingNewChatMessage);
    clearPendingNewChat();
    if (didAppend) {
      onPromptAdded();
      render({ refreshObservers: true });
    }
  }

  function initMarkedPrompts(): void {
    initializePromptMark({
      conversationKey: getCurrentConversationKey(),
      onMarkChanged: syncMarkState,
    });
  }

  /**
   * Resets route-scoped navigation state while optionally preserving prompts
   * captured before a new chat receives its permanent conversation URL.
   * @param {Object} [options]
   * @param {boolean} [options.preserveMessages=false]
   * @param {Object[]} [options.nextMessages=[]]
   */
  function resetStateForCurrentRoute({
    preserveMessages = false,
    nextMessages = [],
  }: ResetRouteOptions = {}): void {
    if (!preserveMessages) {
      conversationMessages = nextMessages;
    }

    initMarkedPrompts();
    activeNavigatorIndex = null;
    resetOutline();
    navigatorItems = [];
    searchQuery = '';
    previewTooltip.hide();
    // `isLoadingPrompts` is intentionally NOT reset here. It used to be
    // set to `true` on every call, but that misfires for the
    // "new-chat auto-rename" transition (ChatGPT assigning a permanent
    // `/c/...` URL to a freshly opened empty chat): from the user's
    // perspective they are still in the same chat — the URL just got
    // upgraded from a placeholder. Resetting `isLoadingPrompts` to `true`
    // there re-parked the sidebar at "Loading... (1 so far)" right after
    // the user typed their first prompt, because the page hook never
    // fires `CHATGPT_CONVERSATION_DATA` or `CHATGPT_CONVERSATION_ENDED`
    // for a fresh chat, so there was no signal that would clear it
    // again. The caller (`syncRouteState`) now owns the reset and only
    // applies it for genuine conversation switches.
    onRouteChanged();
    render({ refreshObservers: true });
  }

  function syncRouteState(): void {
    const nextConversationKey = getCurrentConversationKey();
    if (currentConversationKey === null) {
      currentConversationKey = nextConversationKey;
      return;
    }
    if (nextConversationKey === currentConversationKey) return;

    const previousConversationKey = currentConversationKey;
    const isNewChatRouteTransition = isNewChatRouteKey(previousConversationKey);
    const shouldPreserveMessages =
      isNewChatRouteTransition && conversationMessages.length > 0;

    if (
      shouldPreserveMessages &&
      navigationSnapshotStore.copySnapshot(
        previousConversationKey,
        nextConversationKey
      ) === null
    ) {
      cacheConversationMessages(nextConversationKey);
    }

    const cachedMessages = getCachedConversationMessages(nextConversationKey);
    if (isNewChatRouteTransition) {
      pendingNewChatRouteKey = previousConversationKey;
    } else {
      clearPendingNewChat();
    }

    currentConversationKey = nextConversationKey;
    const nextSnapshot =
      navigationSnapshotStore.getSnapshot(nextConversationKey);
    if (nextSnapshot) {
      syncRenderedFingerprintContext(
        nextConversationKey,
        nextSnapshot.revision
      );
    } else {
      renderedFingerprintCollector.setContext(null);
    }
    // Reset the loading flag for genuine conversation switches (e.g. user
    // navigates from chat A to chat B). Skip it for the new-chat
    // auto-rename — that is not a navigation from the user's perspective,
    // and resetting there re-parked the sidebar at "Loading... (1 so
    // far)" right after the user typed their first prompt because no
    // ENDED signal ever fires for a fresh chat.
    if (!isNewChatRouteTransition) {
      isLoadingPrompts = true;
      startLoadingSettleTimer();
    }
    resetStateForCurrentRoute({
      nextMessages: cachedMessages,
      preserveMessages: shouldPreserveMessages,
    });

    flushPendingNewChatMessage();
  }

  function listenForRouteChanges(): void {
    window.addEventListener('popstate', syncRouteState);
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type === 'CHATGPT_ROUTE_CHANGED') syncRouteState();
    });
  }

  function handleConversationData(data: ConversationData): void {
    const incomingMessages = data?.messages;
    if (!Array.isArray(incomingMessages)) return;

    onTitleChanged();

    const conversationKey = getCurrentConversationKey();
    const messageMap = getAccumulatedMessageMap(conversationKey);

    for (const message of incomingMessages) {
      if (message?.id) messageMap.set(message.id, message);
    }

    const mergedData = buildMergedConversationData(
      conversationKey,
      data.current_node
    );
    conversationMessages = extractUserMessages(mergedData);
    cacheConversationNavigationData(conversationKey, mergedData);
    // `isLoadingPrompts` is intentionally NOT updated here. It used to be
    // (re)derived from `data.page_info.has_previous_page`, but that turns
    // every subsequent conversation GET — including the ones ChatGPT's
    // frontend fires after the user types a message to fold the assistant
    // reply into the cached payload — into a fresh loading state. With the
    // page hook's `CHATGPT_CONVERSATION_ENDED` signal in place, the load
    // lifecycle is now driven by signals, not by data-shape inference:
    //   - true: initial value, and reset by `resetStateForCurrentRoute`
    //   - false: `CHATGPT_CONVERSATION_ENDED` listener, and the
    //            `NEW_USER_MESSAGE` handler after a user-typed prompt.
    render({ refreshObservers: true });
  }

  /**
   * Returns the per-conversation raw message accumulator used to merge pages.
   * @param {string} conversationKey
   * @returns {Map<string, ChatMessage>}
   */
  function getAccumulatedMessageMap(
    conversationKey: string
  ): Map<string, ChatMessage> {
    let messageMap = accumulatedConversationMessages.get(conversationKey);

    if (!messageMap) {
      messageMap = new Map();
      accumulatedConversationMessages.set(conversationKey, messageMap);
    }

    return messageMap;
  }

  /**
   * Builds a merged conversation payload from accumulated pages, ordered oldest
   * first so downstream turns and prompts keep a stable chronological order.
   * @param {string} conversationKey
   * @param {string | null} [current_node]
   * @returns {ConversationData}
   */
  function buildMergedConversationData(
    conversationKey: string,
    current_node?: string | null
  ): ConversationData {
    const messageMap = accumulatedConversationMessages.get(conversationKey);
    const messages = messageMap ? Array.from(messageMap.values()) : [];

    messages.sort((a, b) => getMessageCreateTime(a) - getMessageCreateTime(b));

    return { messages, current_node };
  }

  /**
   * Returns a message's creation timestamp, tolerating both API field names.
   * @param {ChatMessage} message
   * @returns {number}
   */
  function getMessageCreateTime(message: ChatMessage): number {
    return message.create_time ?? message.createTime ?? 0;
  }

  function listenForConversationData(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      syncRouteState();

      if (event.data?.type === 'CHATGPT_CONVERSATION_DATA') {
        const routeKey = event.data.routeKey;
        if (routeKey && routeKey !== getCurrentConversationKey()) return;
        clearPendingNewChat();
        handleConversationData(event.data.payload);
      }

      if (event.data?.type === 'CHATGPT_CONVERSATION_ENDED') {
        // Only honor an ENDED signal aimed at the conversation we are
        // actually rendering. A late signal aimed at a previously visited
        // route must not flip state for the new one.
        const routeKey = event.data.routeKey;
        if (!routeKey || routeKey !== getCurrentConversationKey()) return;
        markLoadingComplete();
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
          onPromptAdded();
        }
        // The user just interacted with the chat, so the "initial page
        // load / backfill" loading band is no longer the relevant status.
        // Without this flip, sending the first prompt of an empty chat
        // parks the sidebar at "Loading... (1 so far)" forever: empty
        // chats don't trigger a conversation GET, so the page hook's
        // `CHATGPT_CONVERSATION_ENDED` signal never fires.
        //
        // We have to do this regardless of `didAppend`: ChatGPT's frontend
        // sometimes prefetches the conversation data (firing
        // `CHATGPT_CONVERSATION_DATA` with the user message included)
        // before the SSE `input_message` event lands, which makes
        // `appendNavigatorMessage` return false on a duplicate ID. In that
        // ordering, the message was already added to `conversationMessages`
        // by `handleConversationData`, but the controller's render still
        // sees `loading=true && count>0`, parking the band on
        // "Loading... (1 so far)" until something else fires. Calling
        // `markLoadingComplete` here covers both orderings. It is itself
        // a no-op when `isLoadingPrompts` is already false.
        if (isLoadingPrompts) markLoadingComplete();
        render({ refreshObservers: true });
      }
    });
  }

  return {
    attach,
    clearJumpProgress,
    getCurrentConversationKey,
    getJumpProgress,
    init,
    jumpToAbsoluteEdge,
    jumpToEdge,
    render,
    resetView,
    setJumpProgress,
    setSearchQuery,
  };
})();

/**
 * Maps every platform response ID to the prompt index that owns it.
 */
function createResponsePromptIndexMap(
  turns: NavigationTurn[]
): Map<string, number> {
  return new Map(
    turns.flatMap((turn) =>
      turn.responses.map((response) => [response.id, turn.promptIndex] as const)
    )
  );
}
