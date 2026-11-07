/**
 * Pure data and state store for conversation turns, route transitions,
 * pagination accumulation, and snapshot caching.
 */
import {
  createNavigatorMessage,
  extractCollapsedUserMessageMap,
  extractUserMessages,
  type ChatMessage,
  type ConversationData,
  type NavigatorMessage,
} from '@/features/conversationPrompts/message';
import { createNavigationSnapshotStore } from '@/navigation/jump/navigationSnapshotStore';

export interface ConversationStoreOptions {
  /**
   * Optional route key resolver. When omitted, defaults to extracting the
   * conversation key from `location.pathname` if available.
   */
  getCurrentRouteKey?: () => string;
}

export interface ConversationTransitionResult {
  isTransition: boolean;
  previousKey: string | null;
  nextKey: string;
  isNewChatRouteTransition: boolean;
  shouldPreserveMessages: boolean;
  cachedMessages: NavigatorMessage[];
  isComplete: boolean;
}

export interface NewUserMessageResult {
  accepted: boolean;
  didAppend: boolean;
  isMigrating: boolean;
  /** Accepted cache-only update for another stable conversation. */
  isBackground: boolean;
}

export interface ConversationStore {
  getCurrentConversationKey(): string;
  setCurrentConversationKey(key: string | null): void;
  isNewChatRouteKey(routeKey: string): boolean;
  getMessages(): NavigatorMessage[];
  setMessages(messages: NavigatorMessage[]): void;
  getCollapsedMessageMap(routeKey?: string): ReadonlyMap<string, string>;
  appendNavigatorMessage(newMessage: ChatMessage, routeKey?: string): boolean;
  handleConversationData(
    data: ConversationData,
    routeKey?: string
  ): NavigatorMessage[];
  handleNewUserMessage(
    newMessage: ChatMessage,
    routeKey?: string
  ): NewUserMessageResult;
  syncRouteState(nextRouteKey?: string): ConversationTransitionResult;
  flushPendingNewChatMessage(routeKey?: string): {
    didAppend: boolean;
    message: ChatMessage | null;
  };
  clearPendingNewChat(): void;
  getCachedConversationMessages(key: string): NavigatorMessage[];
  cacheConversationMessages(key: string): void;
  isConversationComplete(routeKey?: string): boolean;
  markConversationComplete(routeKey?: string): void;
  resetForCurrentRoute(options?: {
    preserveMessages?: boolean;
    nextMessages?: NavigatorMessage[];
  }): void;
  getPendingNewChatRouteKey(): string | null;
  getPendingNewChatMessage(): ChatMessage | null;
  reset(): void;
}

/**
 * Creates an isolated conversation state store.
 *
 * @param options Configuration options including route key resolver.
 * @returns An isolated ConversationStore instance.
 */
export function createConversationStore(
  options: ConversationStoreOptions = {}
): ConversationStore {
  const navigationSnapshotStore =
    createNavigationSnapshotStore<NavigatorMessage>();

  const EMPTY_COLLAPSED_MAP: ReadonlyMap<string, string> = new Map();
  let conversationMessages: NavigatorMessage[] = [];
  const accumulatedConversationMessages = new Map<
    string,
    Map<string, ChatMessage>
  >();
  // Live-only prompts cannot establish consecutive-user collapse boundaries.
  const unconfirmedPromptIds = new Map<string, Set<string>>();
  // GET presence establishes field authority, independently of prompt collapse.
  const confirmedMessageIds = new Map<string, Set<string>>();
  const accumulatedCollapsedMaps = new Map<string, Map<string, string>>();
  let currentConversationKey: string | null = null;
  let pendingNewChatRouteKey: string | null = null;
  let pendingNewChatMessage: ChatMessage | null = null;

  function defaultRouteResolver(): string {
    return 'new-chat:/';
  }

  function getCurrentConversationKey(): string {
    if (options.getCurrentRouteKey) {
      return options.getCurrentRouteKey();
    }
    return defaultRouteResolver();
  }

  function setCurrentConversationKey(key: string | null): void {
    currentConversationKey = key;
  }

  function isNewChatRouteKey(routeKey: string): boolean {
    return (
      routeKey.startsWith('new-chat:') ||
      routeKey.startsWith('WEB:') ||
      routeKey.startsWith('local-')
    );
  }

  function getMessages(): NavigatorMessage[] {
    return conversationMessages;
  }

  function setMessages(messages: NavigatorMessage[]): void {
    conversationMessages = messages;
    accumulatedCollapsedMaps.delete(getCurrentConversationKey());
  }

  function getCollapsedMessageMap(
    routeKey?: string
  ): ReadonlyMap<string, string> {
    const targetKey = routeKey || getCurrentConversationKey();
    return accumulatedCollapsedMaps.get(targetKey) || EMPTY_COLLAPSED_MAP;
  }

  function clearPendingNewChat(): void {
    pendingNewChatRouteKey = null;
    pendingNewChatMessage = null;
  }

  function cacheConversationMessages(conversationKey: string): void {
    if (!conversationKey) return;
    navigationSnapshotStore.replacePrompts(
      conversationKey,
      conversationMessages
    );
  }

  function isConversationComplete(routeKey?: string): boolean {
    const targetKey = routeKey || getCurrentConversationKey();
    return navigationSnapshotStore.isComplete(targetKey);
  }

  function markConversationComplete(routeKey?: string): void {
    const targetKey = routeKey || getCurrentConversationKey();
    navigationSnapshotStore.setComplete(targetKey, true);
  }

  function getCachedConversationMessages(
    conversationKey: string
  ): NavigatorMessage[] {
    return navigationSnapshotStore.getSnapshot(conversationKey)?.prompts || [];
  }

  /** Appends live-only prompts; GET-confirmed IDs keep their data and collapse status. */
  function appendNavigatorMessage(
    newMessage: ChatMessage,
    routeKey?: string
  ): boolean {
    const targetConversationKey = routeKey || getCurrentConversationKey();
    if (confirmedMessageIds.get(targetConversationKey)?.has(newMessage.id)) {
      return false;
    }
    const normalizedMessage: ChatMessage =
      newMessage?.author?.role === 'user'
        ? newMessage
        : {
            ...newMessage,
            author: {
              ...newMessage?.author,
              role: 'user',
            },
          };

    if (normalizedMessage?.id) {
      getAccumulatedMessageMap(targetConversationKey).set(
        normalizedMessage.id,
        normalizedMessage
      );
    }

    if (
      conversationMessages.some(
        (message) => message.id === normalizedMessage.id
      )
    ) {
      return false;
    }
    let pendingIds = unconfirmedPromptIds.get(targetConversationKey);
    if (!pendingIds) {
      pendingIds = new Set();
      unconfirmedPromptIds.set(targetConversationKey, pendingIds);
    }
    pendingIds.add(normalizedMessage.id);
    conversationMessages.push(createNavigatorMessage(normalizedMessage));
    cacheConversationMessages(targetConversationKey);
    return true;
  }

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

  function getMessageCreateTime(message: ChatMessage): number {
    return message.create_time ?? message.createTime ?? 0;
  }

  function buildMergedConversationData(
    conversationKey: string,
    currentNode?: string | null
  ): ConversationData {
    const messageMap = accumulatedConversationMessages.get(conversationKey);
    const messages = messageMap ? Array.from(messageMap.values()) : [];
    messages.sort((a, b) => getMessageCreateTime(a) - getMessageCreateTime(b));
    return { messages, current_node: currentNode };
  }

  /** Reconciles confirmed history with live-only prompts without inferring missing replies. */
  function handleConversationData(
    data: ConversationData,
    routeKey?: string
  ): NavigatorMessage[] {
    const incomingMessages = data?.messages;
    if (!Array.isArray(incomingMessages)) return conversationMessages;

    const conversationKey = routeKey || getCurrentConversationKey();
    const messageMap = getAccumulatedMessageMap(conversationKey);

    let confirmedIds = confirmedMessageIds.get(conversationKey);
    if (!confirmedIds) {
      confirmedIds = new Set();
      confirmedMessageIds.set(conversationKey, confirmedIds);
    }
    for (const message of incomingMessages) {
      if (message?.id) {
        messageMap.set(message.id, message);
        confirmedIds.add(message.id);
        unconfirmedPromptIds.get(conversationKey)?.delete(message.id);
      }
    }

    const mergedData = buildMergedConversationData(
      conversationKey,
      data.current_node
    );
    const pendingIds = unconfirmedPromptIds.get(conversationKey);
    const confirmedData = {
      ...mergedData,
      messages: mergedData.messages.filter((message) => !pendingIds?.has(message.id)),
    };
    // Apply the existing collapse rule only to server-confirmed history.
    const prompts = new Map(
      extractUserMessages(confirmedData).map((message) => [message.id, message])
    );
    for (const id of pendingIds || []) {
      const message = messageMap.get(id);
      if (message) prompts.set(id, createNavigatorMessage(message));
    }
    conversationMessages = Array.from(prompts.values()).sort(
      (a, b) => a.createTime - b.createTime
    );
    accumulatedCollapsedMaps.set(
      conversationKey,
      extractCollapsedUserMessageMap(confirmedData)
    );
    cacheConversationMessages(conversationKey);
    return conversationMessages;
  }

  /** Merges an explicitly owned late prompt without touching active UI state. */
  function cacheBackgroundUserMessage(
    message: ChatMessage,
    routeKey: string
  ): NewUserMessageResult {
    if (confirmedMessageIds.get(routeKey)?.has(message.id)) {
      return { accepted: false, didAppend: false, isMigrating: false, isBackground: true };
    }
    const normalized = { ...message, author: { ...message.author, role: 'user' } };
    const raw = getAccumulatedMessageMap(routeKey);
    raw.set(message.id, normalized);
    const prompts = new Map(
      getCachedConversationMessages(routeKey).map((prompt) => [prompt.id, prompt])
    );
    const didAppend = !prompts.has(message.id);
    let pendingIds = unconfirmedPromptIds.get(routeKey);
    if (!pendingIds) {
      pendingIds = new Set();
      unconfirmedPromptIds.set(routeKey, pendingIds);
    }
    pendingIds.add(message.id);
    prompts.set(message.id, createNavigatorMessage(normalized));
    navigationSnapshotStore.replacePrompts(
      routeKey,
      Array.from(prompts.values()).sort((a, b) => a.createTime - b.createTime)
    );
    return { accepted: true, didAppend, isMigrating: false, isBackground: true };
  }

  /** Routes live prompts to the active lifecycle or an explicitly owned stable cache. */
  function handleNewUserMessage(
    newMessage: ChatMessage,
    routeKey?: string
  ): NewUserMessageResult {
    const targetRouteKey = routeKey || getCurrentConversationKey();
    const activeRouteKey = getCurrentConversationKey();
    const isCurrentRoute = !routeKey || targetRouteKey === activeRouteKey;
    const isMigratingNewChatMessage = Boolean(
      routeKey && routeKey === pendingNewChatRouteKey
    );

    if (!isCurrentRoute && !isMigratingNewChatMessage) {
      if (!routeKey || isNewChatRouteKey(routeKey)) {
        return { accepted: false, didAppend: false, isMigrating: false, isBackground: false };
      }
      return cacheBackgroundUserMessage(newMessage, routeKey);
    }

    if (confirmedMessageIds.get(activeRouteKey)?.has(newMessage.id)) {
      return { accepted: false, didAppend: false, isMigrating: isMigratingNewChatMessage, isBackground: false };
    }
    const didAppend = appendNavigatorMessage(newMessage, activeRouteKey);

    if (isMigratingNewChatMessage) {
      clearPendingNewChat();
    } else if (routeKey && isNewChatRouteKey(routeKey)) {
      pendingNewChatMessage = newMessage;
    }

    return {
      accepted: true,
      didAppend,
      isMigrating: isMigratingNewChatMessage,
      isBackground: false,
    };
  }

  function flushPendingNewChatMessage(routeKey?: string): {
    didAppend: boolean;
    message: ChatMessage | null;
  } {
    if (!pendingNewChatMessage) {
      return { didAppend: false, message: null };
    }
    const message = pendingNewChatMessage;
    const didAppend = appendNavigatorMessage(
      message,
      routeKey || getCurrentConversationKey()
    );
    clearPendingNewChat();
    return { didAppend, message };
  }

  /** Restores snapshots and moves raw messages, pending IDs, and GET authority on promotion. */
  function syncRouteState(nextRouteKey?: string): ConversationTransitionResult {
    const nextConversationKey = nextRouteKey || getCurrentConversationKey();

    if (currentConversationKey === null) {
      currentConversationKey = nextConversationKey;
      return {
        isTransition: false,
        previousKey: null,
        nextKey: nextConversationKey,
        isNewChatRouteTransition: false,
        shouldPreserveMessages: false,
        cachedMessages: getCachedConversationMessages(nextConversationKey),
        isComplete: navigationSnapshotStore.isComplete(nextConversationKey),
      };
    }

    if (nextConversationKey === currentConversationKey) {
      return {
        isTransition: false,
        previousKey: currentConversationKey,
        nextKey: nextConversationKey,
        isNewChatRouteTransition: false,
        shouldPreserveMessages: false,
        cachedMessages: getCachedConversationMessages(nextConversationKey),
        isComplete: navigationSnapshotStore.isComplete(nextConversationKey),
      };
    }

    const previousConversationKey = currentConversationKey;
    const isNewChatRouteTransition = isNewChatRouteKey(previousConversationKey);
    const shouldPreserveMessages =
      isNewChatRouteTransition && conversationMessages.length > 0;

    if (shouldPreserveMessages) {
      const previousAccumulated =
        accumulatedConversationMessages.get(previousConversationKey);
      if (previousAccumulated && previousAccumulated.size > 0) {
        const nextAccumulated = getAccumulatedMessageMap(nextConversationKey);
        for (const [id, message] of previousAccumulated) {
          nextAccumulated.set(id, message);
        }
      }
      accumulatedConversationMessages.delete(previousConversationKey);
      const previousPending = unconfirmedPromptIds.get(previousConversationKey);
      if (previousPending) {
        const nextPending = unconfirmedPromptIds.get(nextConversationKey) || new Set<string>();
        for (const id of previousPending) nextPending.add(id);
        unconfirmedPromptIds.set(nextConversationKey, nextPending);
      }
      unconfirmedPromptIds.delete(previousConversationKey);
      const previousConfirmed = confirmedMessageIds.get(previousConversationKey);
      if (previousConfirmed) {
        const nextConfirmed = confirmedMessageIds.get(nextConversationKey) || new Set<string>();
        for (const id of previousConfirmed) nextConfirmed.add(id);
        confirmedMessageIds.set(nextConversationKey, nextConfirmed);
      }
      confirmedMessageIds.delete(previousConversationKey);
      for (const id of confirmedMessageIds.get(nextConversationKey) || []) {
        unconfirmedPromptIds.get(nextConversationKey)?.delete(id);
      }

      const previousCollapsed =
        accumulatedCollapsedMaps.get(previousConversationKey);
      if (previousCollapsed && previousCollapsed.size > 0) {
        accumulatedCollapsedMaps.set(
          nextConversationKey,
          new Map(previousCollapsed)
        );
      }
      accumulatedCollapsedMaps.delete(previousConversationKey);

      if (
        navigationSnapshotStore.copySnapshot(
          previousConversationKey,
          nextConversationKey
        ) === null
      ) {
        cacheConversationMessages(nextConversationKey);
      }
      navigationSnapshotStore.replacePrompts(previousConversationKey, []);
    }

    const cachedMessages = getCachedConversationMessages(nextConversationKey);
    if (isNewChatRouteTransition) {
      pendingNewChatRouteKey = previousConversationKey;
    } else {
      clearPendingNewChat();
    }

    currentConversationKey = nextConversationKey;

    return {
      isTransition: true,
      previousKey: previousConversationKey,
      nextKey: nextConversationKey,
      isNewChatRouteTransition,
      shouldPreserveMessages,
      cachedMessages,
      isComplete: navigationSnapshotStore.isComplete(nextConversationKey),
    };
  }

  /** Restores cached prompts with their collapse map, or explicitly clears the active view. */
  function resetForCurrentRoute(
    resetOptions: {
      preserveMessages?: boolean;
      nextMessages?: NavigatorMessage[];
    } = {}
  ): void {
    if (!resetOptions.preserveMessages) {
      conversationMessages = resetOptions.nextMessages || [];
      // A restored snapshot retains the server-derived collapse relationships.
      if (!resetOptions.nextMessages) {
        accumulatedCollapsedMaps.delete(getCurrentConversationKey());
      }
    }
  }

  function getPendingNewChatRouteKey(): string | null {
    return pendingNewChatRouteKey;
  }

  function getPendingNewChatMessage(): ChatMessage | null {
    return pendingNewChatMessage;
  }

  /** Clears active/raw state and both confirmation sets; existing snapshot lifetime is unchanged. */
  function reset(): void {
    conversationMessages = [];
    accumulatedConversationMessages.clear();
    unconfirmedPromptIds.clear();
    confirmedMessageIds.clear();
    accumulatedCollapsedMaps.clear();
    currentConversationKey = null;
    clearPendingNewChat();
  }

  return {
    getCurrentConversationKey,
    setCurrentConversationKey,
    isNewChatRouteKey,
    getMessages,
    setMessages,
    getCollapsedMessageMap,
    appendNavigatorMessage,
    handleConversationData,
    handleNewUserMessage,
    syncRouteState,
    flushPendingNewChatMessage,
    clearPendingNewChat,
    getCachedConversationMessages,
    cacheConversationMessages,
    isConversationComplete,
    markConversationComplete,
    resetForCurrentRoute,
    getPendingNewChatRouteKey,
    getPendingNewChatMessage,
    reset,
  };
}
