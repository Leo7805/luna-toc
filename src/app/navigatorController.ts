/**
 * Coordinates conversation data, TOC rendering, prompt navigation, and active
 * prompt tracking for the LunaTOC sidebar.
 */
import {
  createNavigatorMessage,
  extractUserMessages,
} from '../features/conversationPrompts/message';
import { createNavigationSnapshotStore } from '@/features/navigation/navigationSnapshotStore';
import { buildFingerprintIndex } from '@/features/navigation/fingerprint/index';
import { buildDerivedSegmentIndex } from '@/features/navigation/fingerprint/segments';
import { createChatGptNavigationTurns } from '@/platforms/chatgpt/navigationAdapter';
import { createRenderedFingerprintCollector } from '@/platforms/chatgpt/renderedFingerprintCollector';
import type { NavigationTurn } from '@/features/navigation/navigationData';
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
} from '../features/navigation/follow';
import {
  initializePromptNavigation,
  jumpToAbsoluteEdge as jumpToPageEdge,
  jumpToConversationEdge,
  jumpToMessage,
} from '../features/navigation/promptNavigation';
import {
  collapseAll,
  createPromptItem,
  handlePromptNavigation,
  resetOutline,
  resetPromptItems,
  scheduleBuild,
  setPromptMessages,
  syncActivePrompt,
  syncMarkState,
} from '../features/navigation/outline';
import {
  isElementTextTruncated,
  previewTooltip,
} from '@/features/tooltip';

interface NavigatorControllerOptions {
  onPromptCountChanged?: (count: number) => void;
  onPromptAdded?: () => void;
  onRouteChanged?: () => void;
  onSavePrompt?: (message: NavigatorMessage) => void;
  onTitleChanged?: () => void;
}

interface RenderOptions {
  refreshObservers?: boolean;
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
    });

    initActivePromptTracking();
    renderedFingerprintCollector.observe(document.body);
    isAttached = true;
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
   */
  function render({ refreshObservers = false }: RenderOptions = {}): void {
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

    if (refreshObservers && isAttached) {
      observeVisibleUserMessages();
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
          render({ refreshObservers: true });
        }
      }
    });
  }

  return {
    attach,
    getCurrentConversationKey,
    init,
    jumpToAbsoluteEdge,
    jumpToEdge,
    render,
    resetView,
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
