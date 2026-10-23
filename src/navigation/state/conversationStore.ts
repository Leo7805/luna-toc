/**
 * Pure data and state store for conversation turns, route transitions,
 * pagination accumulation, and snapshot caching.
 */
import {
  createNavigatorMessage,
  extractUserMessages,
  type ChatMessage,
  type ConversationData,
  type NavigatorMessage,
} from '@/features/conversationPrompts/message';
import { createNavigationSnapshotStore } from '@/navigation/jump/navigationSnapshotStore';
import { extractActiveBranchMessages, type ConversationSnapshot } from './activeBranch';

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
}

export interface ConversationStore {
  getCurrentConversationKey(): string;
  setCurrentConversationKey(key: string | null): void;
  isNewChatRouteKey(routeKey: string): boolean;
  getMessages(): NavigatorMessage[];
  setMessages(messages: NavigatorMessage[]): void;
  replaceWithFreshSnapshot(data: ConversationSnapshot, routeKey: string): boolean;
  appendNavigatorMessage(newMessage: ChatMessage, routeKey?: string): boolean;
  handleConversationData(
    data: ConversationData,
    routeKey?: string,
    requestStartedAt?: number
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
  markConversationIncomplete(routeKey?: string): void;
  deleteConversation(routeKey: string): void;
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

  let conversationMessages: NavigatorMessage[] = [];
  const accumulatedConversationMessages = new Map<
    string,
    Map<string, ChatMessage>
  >();
  let currentConversationKey: string | null = null;
  let pendingNewChatRouteKey: string | null = null;
  let pendingNewChatMessage: ChatMessage | null = null;
  const freshSnapshotAppliedAt = new Map<string, number>();

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


  /** Removes all cached state for a confirmed-deleted conversation. */
  function deleteConversation(routeKey: string): void {
    accumulatedConversationMessages.delete(routeKey);
    freshSnapshotAppliedAt.delete(routeKey);
    navigationSnapshotStore.deleteConversation(routeKey);
    if (currentConversationKey === routeKey) {
      conversationMessages = [];
      clearPendingNewChat();
    }
  }

  /** A failed refresh invalidates completeness without deleting user data. */
  function markConversationIncomplete(routeKey?: string): void {
    navigationSnapshotStore.setComplete(routeKey || getCurrentConversationKey(), false);
  }

  function getCachedConversationMessages(
    conversationKey: string
  ): NavigatorMessage[] {
    return navigationSnapshotStore.getSnapshot(conversationKey)?.prompts || [];
  }

  function appendNavigatorMessage(
    newMessage: ChatMessage,
    routeKey?: string
  ): boolean {
    const targetConversationKey = routeKey || getCurrentConversationKey();
    if (newMessage?.id) {
      getAccumulatedMessageMap(targetConversationKey).set(
        newMessage.id,
        newMessage
      );
    }

    if (conversationMessages.some((message) => message.id === newMessage.id)) {
      return false;
    }
    conversationMessages.push(createNavigatorMessage(newMessage));
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

  function handleConversationData(
    data: ConversationData,
    routeKey?: string,
    requestStartedAt?: number
  ): NavigatorMessage[] {
    const incomingMessages = data?.messages;
    if (!Array.isArray(incomingMessages)) return conversationMessages;

    const conversationKey = routeKey || getCurrentConversationKey();
    const verifiedAt = freshSnapshotAppliedAt.get(conversationKey);
    if (verifiedAt !== undefined) {
      // Normal paginated responses cannot prove the selected edit branch.
      // Never union abandoned message IDs into a branch already verified by
      // refresh, even if the host begins another request after that refresh.
      if (typeof requestStartedAt !== 'number' || requestStartedAt <= verifiedAt) {
        return conversationMessages;
      }
      const selected = getAccumulatedMessageMap(conversationKey);
      for (const message of incomingMessages) {
        if (message?.id && selected.has(message.id)) selected.set(message.id, message);
      }
      // The selected map stays in verified branch order (not timestamp order).
      conversationMessages = extractUserMessages({ messages: [...selected.values()] });
      cacheConversationMessages(conversationKey);
      return conversationMessages;
    }

    const messageMap = getAccumulatedMessageMap(conversationKey);
    for (const message of incomingMessages) {
      if (message?.id) messageMap.set(message.id, message);
    }

    const mergedData = buildMergedConversationData(conversationKey, data.current_node);
    conversationMessages = extractUserMessages(mergedData);
    cacheConversationMessages(conversationKey);
    return conversationMessages;
  }

  /** Replaces the selected branch, rather than unioning abandoned branches. */
  function replaceWithFreshSnapshot(data: ConversationSnapshot, routeKey: string): boolean {
    if (routeKey !== getCurrentConversationKey()) return false;
    const branch = extractActiveBranchMessages(data);
    if (branch === null) {
      markConversationIncomplete(routeKey);
      return false;
    }
    // Requests begun before this authoritative snapshot must not reintroduce
    // superseded branches when their paginated responses arrive late.
    freshSnapshotAppliedAt.delete(routeKey);
    freshSnapshotAppliedAt.set(routeKey, Date.now());
    if (freshSnapshotAppliedAt.size > 8) {
      const oldest = freshSnapshotAppliedAt.keys().next().value;
      if (oldest) freshSnapshotAppliedAt.delete(oldest);
    }
    const next = extractUserMessages({ messages: branch });
    const previous = conversationMessages;
    const changed = previous.length !== next.length || previous.some((m, i) =>
      m.id !== next[i]?.id || m.text !== next[i]?.text ||
      m.createTime !== next[i]?.createTime || m.canMatchByText !== next[i]?.canMatchByText ||
      m.answerId !== next[i]?.answerId
    );
    const map = new Map<string, ChatMessage>();
    for (const message of branch) if (message.id) map.set(message.id, message);
    accumulatedConversationMessages.set(routeKey, map);
    conversationMessages = next;
    navigationSnapshotStore.replacePrompts(routeKey, next, true);
    return changed;
  }

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
      return { accepted: false, didAppend: false, isMigrating: false };
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
        cachedMessages: [],
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
        // No route transition consumes a snapshot; avoid deep-cloning it.
        cachedMessages: [],
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

      if (
        navigationSnapshotStore.copySnapshot(
          previousConversationKey,
          nextConversationKey
        ) === null
      ) {
        cacheConversationMessages(nextConversationKey);
      }
      navigationSnapshotStore.deleteConversation(previousConversationKey);
      freshSnapshotAppliedAt.delete(previousConversationKey);
    }

    if (!shouldPreserveMessages) accumulatedConversationMessages.delete(previousConversationKey);
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

  function resetForCurrentRoute(
    resetOptions: {
      preserveMessages?: boolean;
      nextMessages?: NavigatorMessage[];
    } = {}
  ): void {
    if (!resetOptions.preserveMessages) {
      conversationMessages = resetOptions.nextMessages || [];
    }
  }

  function getPendingNewChatRouteKey(): string | null {
    return pendingNewChatRouteKey;
  }

  function getPendingNewChatMessage(): ChatMessage | null {
    return pendingNewChatMessage;
  }

  function reset(): void {
    conversationMessages = [];
    accumulatedConversationMessages.clear();
    freshSnapshotAppliedAt.clear();
    navigationSnapshotStore.clear();
    currentConversationKey = null;
    clearPendingNewChat();
  }

  return {
    getCurrentConversationKey,
    setCurrentConversationKey,
    isNewChatRouteKey,
    getMessages,
    setMessages,
    replaceWithFreshSnapshot,
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
    markConversationIncomplete,
    deleteConversation,
    resetForCurrentRoute,
    getPendingNewChatRouteKey,
    getPendingNewChatMessage,
    reset,
  };
}
