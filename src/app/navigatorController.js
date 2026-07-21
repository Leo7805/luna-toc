/**
 * Coordinates conversation data, TOC rendering, prompt navigation, and active
 * prompt tracking for the LunaTOC sidebar.
 */
(() => {
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

  let conversationMessages = [];
  let searchQuery = '';
  let currentConversationKey = null;
  let pendingNewChatRouteKey = null;
  let pendingNewChatMessage = null;
  let activeNavigatorIndex = null;
  let navigatorItems = [];
  let activePromptObserver = null;
  let activePromptMutationObserver = null;
  let activePromptMutationTimer = null;
  let activeNativeTocObserver = null;
  let activeNativeTocTimer = null;
  let lockedNavigatorIndex = null;
  let lockedNavigatorTimer = null;
  let isInitialized = false;
  let isAttached = false;
  let onRouteChanged = () => {};
  let onSavePrompt = () => {};
  let onTitleChanged = () => {};

  /**
   * Initializes data and route listeners before the page hook starts emitting.
   * @param {Object} [options]
   * @param {Function} [options.onRouteChanged]
   * @param {Function} [options.onSavePrompt]
   * @param {Function} [options.onTitleChanged]
   */
  function init(options = {}) {
    if (isInitialized) return;

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
  function attach() {
    if (isAttached) return;

    window.ChatTocFollow.init({
      listSelector: '#navigator-list',
      ignoredScrollSelector:
        '#luna-toc-sidebar, #luna-toc-preview-tooltip, #luna-toc-button-tooltip',
      getNativeActiveIndex: findActiveNativePromptIndex,
      setActiveIndex: setActiveNavigatorItem,
    });

    window.ChatTocJump.init({
      getNativePromptButtons,
      normalizeText,
      findConversationIndexByElement,
      getConversationMessageCount: () => conversationMessages.length,
      lockActiveIndex: lockActiveNavigatorItem,
    });

    initActivePromptTracking();
    isAttached = true;
    render();
  }

  /**
   * Returns the route key shared with prompt marking and page-hook messages.
   * @returns {string}
   */
  function getCurrentConversationKey() {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    return match?.[1] || `new-chat:${location.pathname}`;
  }

  /**
   * Updates the TOC search query and rebuilds the list.
   * @param {string} query
   */
  function setSearchQuery(query) {
    searchQuery = query;
    render();
  }

  /**
   * Resets search and outline state without changing the chat scroll position.
   */
  function resetView() {
    searchQuery = '';
    window.ChatTocPreviewTooltip.hide();
    window.ChatTocOutline?.collapseAll?.();
    render({ refreshObservers: true });

    document.getElementById('navigator-list')?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  /**
   * Jumps to a conversation edge using the matching prompt when available.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToEdge(edge) {
    const index = edge === 'top' ? 0 : conversationMessages.length - 1;
    const message = conversationMessages[index];

    if (message) {
      window.ChatTocJump.jumpToMessage(message, index);
      return;
    }

    window.ChatTocJump.jumpToConversationEdge(edge);
  }

  /**
   * Jumps directly to the absolute chat edge.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToAbsoluteEdge(edge) {
    window.ChatTocJump.jumpToAbsoluteEdge(edge, 'auto');
  }

  /**
   * Builds the conversation TOC from normalized user messages.
   * @param {Object} [options]
   * @param {boolean} [options.refreshObservers=false]
   */
  function render({ refreshObservers = false } = {}) {
    const list = document.getElementById('navigator-list');
    const hint = document.querySelector('.navigator-hint');

    if (!list) return;

    list.innerHTML = '';
    navigatorItems = [];
    window.ChatTocOutline?.resetPromptItems?.();
    window.ChatTocOutline?.setPromptMessages?.(conversationMessages);

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
  function createNavigatorItem(message, index) {
    const item = document.createElement('div');
    const itemMain = document.createElement('div');
    const itemText = document.createElement('span');

    item.dataset.messageIndex = String(index);
    item.className = 'navigator-item';
    item.classList.toggle('navigator-item-active', index === activeNavigatorIndex);
    itemMain.className = 'navigator-item-main';
    itemText.className = 'navigator-item-text';
    itemText.textContent = `${index + 1}. ${message.text.replace(/\s+/g, ' ')}`;

    const markButton = window.ChatTocPromptMark.createButton({
      item,
      messageId: message.id,
    });
    const outlineControls = window.ChatTocOutline?.createPromptItem?.({
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
      if (isTextTruncated(itemText) && item.matches(':hover')) {
        window.ChatTocPreviewTooltip.show(message.text, event, itemMain);
      }
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onSavePrompt(message);
    });
    item.addEventListener('mouseenter', (event) => {
      if (isTextTruncated(itemText)) {
        window.ChatTocPreviewTooltip.show(message.text, event, itemMain);
      }
    });
    item.addEventListener('mouseleave', () => {
      window.ChatTocPreviewTooltip.hide();
    });

    return item;
  }

  /**
   * Navigates to a prompt and schedules its assistant-answer outline.
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

  function isTextTruncated(element) {
    return element.scrollWidth > element.clientWidth;
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

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

  function scrollNavigatorItemIntoView(item) {
    const scrollContainer = document.getElementById('navigator-list');
    if (!scrollContainer || !window.ChatTocFollow.isFollowing()) return;

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

    scrollContainer.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
  }

  function findConversationIndexByElement(element) {
    const visibleUserMessages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"]')
    );

    if (visibleUserMessages.length === conversationMessages.length) {
      return visibleUserMessages.indexOf(element);
    }

    const domText = normalizeText(element.innerText);
    for (let index = conversationMessages.length - 1; index >= 0; index--) {
      const message = conversationMessages[index];
      if (!message.canMatchByText) continue;

      const messageText = normalizeText(message.text);
      if (domText === messageText || domText.includes(messageText)) return index;
    }
    return -1;
  }

  function getNativePromptButtons() {
    const buttons = Array.from(
      document.querySelectorAll(NATIVE_PROMPT_BUTTON_SELECTOR)
    ).filter(isUsableNativePromptButton);
    const indexedButtons = [];

    buttons.forEach((button) => {
      const index = getNativePromptIndexFromButton(button);
      if (index === -1 || indexedButtons[index]) return;
      indexedButtons[index] = button;
    });
    return indexedButtons.length > 0 ? indexedButtons : buttons;
  }

  function isUsableNativePromptButton(button) {
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

  function getNativePromptIndexFromButton(button) {
    const label =
      button.getAttribute('aria-label') ||
      button.getAttribute('aria-description') ||
      '';
    const match = label.match(/^prompt\s+(\d+)$/i);
    return match ? Number(match[1]) - 1 : -1;
  }

  function findActiveNativePromptIndex() {
    const activeButton = document.querySelector(
      ACTIVE_NATIVE_PROMPT_BUTTON_SELECTOR
    );
    if (!activeButton) return -1;

    const labelIndex = getNativePromptIndexFromButton(activeButton);
    if (labelIndex !== -1) return labelIndex;
    return getNativePromptButtons().indexOf(activeButton);
  }

  function syncActiveNavigatorItemFromNativeToc() {
    const index = findActiveNativePromptIndex();
    if (index === -1) return false;
    setActiveNavigatorItem(index);
    return true;
  }

  function observeVisibleUserMessages() {
    activePromptObserver?.disconnect();
    activePromptObserver = new IntersectionObserver(
      (entries) => {
        const topEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!topEntry || syncActiveNavigatorItemFromNativeToc()) return;
        const index = findConversationIndexByElement(topEntry.target);
        if (index !== -1) setActiveNavigatorItem(index);
      },
      { threshold: [0.1, 0.25, 0.5, 0.75, 1] }
    );

    document
      .querySelectorAll('[data-message-author-role="user"]')
      .forEach((element) => activePromptObserver.observe(element));
  }

  function initNativeTocActiveTracking() {
    activeNativeTocObserver?.disconnect();
    activeNativeTocObserver = new MutationObserver(() => {
      clearTimeout(activeNativeTocTimer);
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

  function initActivePromptTracking() {
    activePromptMutationObserver?.disconnect();
    activePromptMutationObserver = new MutationObserver(() => {
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

  function isNewChatRouteKey(routeKey) {
    return routeKey.startsWith('new-chat:');
  }

  function clearPendingNewChat() {
    pendingNewChatRouteKey = null;
    pendingNewChatMessage = null;
  }

  function appendNavigatorMessage(newMessage) {
    if (conversationMessages.some((message) => message.id === newMessage.id)) {
      return false;
    }
    conversationMessages.push(
      window.ChatTocMessages.createNavigatorMessage(newMessage)
    );
    return true;
  }

  function flushPendingNewChatMessage() {
    if (!pendingNewChatMessage) return;
    const didAppend = appendNavigatorMessage(pendingNewChatMessage);
    clearPendingNewChat();
    if (didAppend) render({ refreshObservers: true });
  }

  function initMarkedPrompts() {
    window.ChatTocPromptMark.init({
      conversationKey: getCurrentConversationKey(),
    });
  }

  function resetStateForCurrentRoute() {
    conversationMessages = [];
    initMarkedPrompts();
    activeNavigatorIndex = null;
    window.ChatTocOutline?.reset?.();
    navigatorItems = [];
    searchQuery = '';
    window.ChatTocPreviewTooltip?.hide?.();
    onRouteChanged();
    render({ refreshObservers: true });
  }

  function syncRouteState() {
    const nextConversationKey = getCurrentConversationKey();
    if (currentConversationKey === null) {
      currentConversationKey = nextConversationKey;
      return;
    }
    if (nextConversationKey === currentConversationKey) return;

    const isNewChatCreationRoute =
      isNewChatRouteKey(currentConversationKey) &&
      !isNewChatRouteKey(nextConversationKey);

    if (isNewChatCreationRoute) {
      pendingNewChatRouteKey = currentConversationKey;
    } else {
      clearPendingNewChat();
    }

    currentConversationKey = nextConversationKey;
    resetStateForCurrentRoute();
    flushPendingNewChatMessage();
  }

  function listenForRouteChanges() {
    window.addEventListener('popstate', syncRouteState);
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type === 'CHATGPT_ROUTE_CHANGED') syncRouteState();
    });
  }

  function handleConversationData(data) {
    if (!data?.mapping) return;
    onTitleChanged();
    conversationMessages = window.ChatTocMessages.extractUserMessages(data);
    render({ refreshObservers: true });
  }

  function listenForConversationData() {
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

        if (didAppend) render({ refreshObservers: true });
      }
    });
  }

  window.LunaTocNavigatorController = {
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
