/**
 * Coordinates conversation data, TOC rendering, prompt navigation, and active
 * prompt tracking for the LunaTOC sidebar.
 */
import { createConversationStore } from './state/conversationStore';
import { createActivePromptTracker } from './tracking/activePromptTracker';
import {
  createTocListRenderer,
  type RenderOptions,
} from './ui/tocListRenderer';
import { getActivePlatform } from '@/platforms';
import type {
  ChatMessage,
  ConversationData,
  NavigatorMessage,
} from '@/features/conversationPrompts/message';
import { initializePromptMark } from '@/features/conversationPrompts/promptMark';
import { initializeFollow } from './follow/follow';
import {
  isLoading as isLoadingPrompts,
  setLoading,
  setOnSettleTimeout,
  startSettleTimer,
  clearSettleTimer,
} from './loading/promptLoadingState';
import {
  getJumpProgress as readJumpProgress,
  setOnRender,
  setJumpProgress as writeJumpProgress,
  clearJumpProgress as resetJumpProgress,
} from './loading/jumpProgressState';
import {
  initializePromptNavigation,
  jumpToAbsoluteEdge as jumpToPageEdge,
  jumpToMessage,
} from './jump/promptNavigation';
import {
  handlePromptNavigation,
  resetOutline,
  scheduleBuild,
  syncMarkState,
} from './jump/outline';
import { setSidebarStatus } from './ui/sidebarStatus';
import { previewTooltip } from '@/features/tooltip';

export type { RenderOptions };

interface NavigatorControllerOptions {
  onPromptCountChanged?: (count: number) => void;
  onPromptAdded?: () => void;
  onRouteChanged?: () => void;
  onSavePrompt?: (message: NavigatorMessage) => void;
  onTitleChanged?: () => void;
}

interface ResetRouteOptions {
  preserveMessages?: boolean;
  nextMessages?: NavigatorMessage[];
}

export const navigatorController = (() => {
  let isInitialized = false;
  let isAttached = false;
  let reportedPromptCount = -1;
  let onPromptCountChanged = (_count: number) => {};
  let onPromptAdded = () => {};
  let onRouteChanged = () => {};
  let onSavePrompt: (message: NavigatorMessage) => void = () => {};
  let onTitleChanged = () => {};

  /**
   * Returns the route key shared with prompt marking and page-hook messages.
   * @returns {string}
   */
  function getCurrentConversationKey(): string {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    return match?.[1] || `new-chat:${location.pathname}`;
  }

  const conversationStore = createConversationStore({
    getCurrentRouteKey: () => getCurrentConversationKey(),
  });

  const activePromptTracker = createActivePromptTracker({
    getMessages: () => conversationStore.getMessages(),
    onActiveIndexChange: (index, changed) => {
      tocListRenderer.updateActiveItemUI(index, changed);
    },
  });

  const tocListRenderer = createTocListRenderer({
    getMessages: () => conversationStore.getMessages(),
    getActiveIndex: () => activePromptTracker.getActiveIndex(),
    onItemClick: (message, index) => {
      handleNavigatorItemClick(message, index);
    },
    onSavePrompt: (message) => {
      onSavePrompt(message);
    },
    onPromptCountReported: (count) => {
      if (count === reportedPromptCount) return;
      reportedPromptCount = count;
      onPromptCountChanged(count);
    },
    onRefreshObservers: () => {
      if (isAttached) {
        activePromptTracker.checkActivePrompt();
      }
    },
    getJumpProgress: () => readJumpProgress(),
  });

  /**
   * Marks prompts loading as finished for the active conversation and re-renders
   * the sidebar so the status band leaves `loading` mode.
   */
  function markLoadingComplete(): void {
    if (!isLoadingPrompts()) return;
    setLoading(false);
    clearSettleTimer();
    render({ completed: true });
  }

  /**
   * Initializes data and route listeners before the page hook starts emitting.
   * @param {Object} [options]
   */
  function init(options: NavigatorControllerOptions = {}): void {
    if (isInitialized) return;

    onPromptCountChanged =
      options.onPromptCountChanged || onPromptCountChanged;
    onPromptAdded = options.onPromptAdded || onPromptAdded;
    onRouteChanged = options.onRouteChanged || onRouteChanged;
    onSavePrompt = options.onSavePrompt || onSavePrompt;
    onTitleChanged = options.onTitleChanged || onTitleChanged;
    conversationStore.setCurrentConversationKey(getCurrentConversationKey());
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

    setOnRender(() => render());
    setOnSettleTimeout(() => markLoadingComplete());

    initializeFollow({
      listSelector: '#navigator-list',
      ignoredScrollSelector:
        '#luna-toc-sidebar, #luna-toc-preview-tooltip, #luna-toc-button-tooltip',
    });

    initializePromptNavigation({
      getVirtualSearchContext: () => ({
        conversationKey: getCurrentConversationKey(),
        prompts: conversationStore.getMessages(),
      }),
      setJumpProgress,
      clearJumpProgress,
      notifyJumpFailed: () => {
        setSidebarStatus({
          state: 'failed',
          promptCount: conversationStore.getMessages().length,
        });
      },
    });

    initActivePromptTracking();
    isAttached = true;
    const currentRouteKey = getCurrentConversationKey();
    const isInitialNewChat =
      conversationStore.isNewChatRouteKey(currentRouteKey) &&
      conversationStore.getMessages().length === 0 &&
      !conversationStore.getPendingNewChatMessage();

    if (isInitialNewChat) {
      markLoadingComplete();
    } else {
      startSettleTimer();
      render();
    }
  }

  /**
   * Updates the TOC search query and rebuilds the list.
   * @param {string} query
   */
  function setSearchQuery(query: string): void {
    tocListRenderer.setSearchQuery(query);
  }

  /**
   * Resets search and outline state without changing the chat scroll position.
   */
  function resetView(): void {
    tocListRenderer.resetView();
  }

  /**
   * Jumps to a conversation edge using the matching prompt when available.
   * @param {'top' | 'bottom'} edge
   */
  function jumpToEdge(edge: 'top' | 'bottom'): void {
    jumpToPageEdge(edge, 'auto');
  }

  /**
   * Navigates to the last user prompt in the active conversation.
   * Does nothing safely if no prompts exist.
   */
  function jumpToLastPrompt(): void {
    const messages = conversationStore.getMessages();
    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];

    if (lastMessage) {
      handleNavigatorItemClick(lastMessage, lastIndex);
    }
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
   */
  function render(options: RenderOptions = {}): void {
    tocListRenderer.render(options);
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
    const outlineAction = handlePromptNavigation(
      index,
      activePromptTracker.getActiveIndex()
    );

    jumpToMessage(message, index);
    if (outlineAction?.shouldBuild) {
      scheduleBuild(index);
    }
  }

  /**
   * Returns the current jump progress snapshot, or null when no jump is
   * active. Consumed by the sidebar status element.
   */
  function getJumpProgress(): ReturnType<typeof readJumpProgress> {
    return readJumpProgress();
  }

  /**
   * Marks a jump as active and records the target index plus the remaining
   * slide-loop step budget.
   */
  function setJumpProgress(
    next: NonNullable<ReturnType<typeof readJumpProgress>>
  ): void {
    writeJumpProgress(next);
  }

  /**
   * Clears any active jump progress.
   */
  function clearJumpProgress(): void {
    resetJumpProgress();
  }

  function initActivePromptTracking(): void {
    activePromptTracker.initTracking();
  }

  function flushPendingNewChatMessage(): void {
    const flushed = conversationStore.flushPendingNewChatMessage();
    if (flushed.didAppend) {
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
   */
  function resetStateForCurrentRoute({
    preserveMessages = false,
    nextMessages = [],
  }: ResetRouteOptions = {}): void {
    conversationStore.resetForCurrentRoute({
      preserveMessages,
      nextMessages,
    });

    initMarkedPrompts();
    activePromptTracker.reset();
    resetOutline();
    tocListRenderer.resetList();
    previewTooltip.hide();
    onRouteChanged();
    if (isAttached) {
      initActivePromptTracking();
    }
    render({ refreshObservers: true });
  }

  function syncRouteState(): void {
    const nextConversationKey = getCurrentConversationKey();
    const transition = conversationStore.syncRouteState(nextConversationKey);
    if (!transition.isTransition) return;

    const isEnteringNewChat =
      conversationStore.isNewChatRouteKey(nextConversationKey) &&
      !transition.shouldPreserveMessages &&
      transition.cachedMessages.length === 0 &&
      !conversationStore.getPendingNewChatMessage();

    if (isEnteringNewChat) {
      setLoading(false);
      clearSettleTimer();
    } else if (!transition.shouldPreserveMessages) {
      setLoading(true);
      startSettleTimer();
    }
    resetStateForCurrentRoute({
      nextMessages: transition.cachedMessages,
      preserveMessages: transition.shouldPreserveMessages,
    });

    flushPendingNewChatMessage();
  }

  function listenForRouteChanges(): void {
    window.addEventListener('popstate', syncRouteState);
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.routeChanged
      ) {
        syncRouteState();
      }
    });
  }

  function handleConversationData(data: ConversationData): void {
    const incomingMessages = data?.messages;
    if (!Array.isArray(incomingMessages)) return;

    onTitleChanged();

    conversationStore.handleConversationData(
      data,
      getCurrentConversationKey()
    );
    render({ refreshObservers: true });
  }

  function listenForConversationData(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      syncRouteState();

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.conversationData
      ) {
        const routeKey = event.data.routeKey;
        if (routeKey && routeKey !== getCurrentConversationKey()) return;
        conversationStore.clearPendingNewChat();
        handleConversationData(event.data.payload);
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.conversationEnded
      ) {
        const routeKey = event.data.routeKey;
        if (!routeKey || routeKey !== getCurrentConversationKey()) return;
        markLoadingComplete();
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.newUserMessage
      ) {
        const newMessage = event.data.payload as ChatMessage;
        if (!newMessage?.id) return;

        const routeKey = event.data.routeKey;
        const result = conversationStore.handleNewUserMessage(
          newMessage,
          routeKey
        );

        if (!result.accepted) return;

        if (result.didAppend) {
          onPromptAdded();
        }

        if (isLoadingPrompts()) markLoadingComplete();
        render({ refreshObservers: true });
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.titleChanged
      ) {
        onTitleChanged();
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
    jumpToLastPrompt,
    render,
    resetView,
    setJumpProgress,
    setSearchQuery,
  };
})();
