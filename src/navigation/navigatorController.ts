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
import { getActiveConversationOwner } from './lifecycle/conversationOwner';
import { tocAliasStore } from '@/features/conversationPrompts/tocAliasStore';
import { isPermanentConversationId } from './lifecycle/protocol';
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
  cancelPromptNavigation,
} from './jump/promptNavigation';
import {
  handlePromptNavigation,
  resetOutline,
  scheduleBuild,
} from './jump/outline';
import { cancelOutlineNavigation } from './jump/outlineNavigation';
import { setSidebarStatus } from './ui/sidebarStatus';
import { previewTooltip } from '@/features/tooltip';
import {
  TOC_REFRESH_CANCEL,
  TOC_REFRESH_REQUEST,
  TOC_REFRESH_RESULT,
  TOC_REFRESH_TIMEOUT_MS,
  TOC_EDIT_SUBMISSION,
} from './refresh/refreshProtocol';
import type { ConversationSnapshot } from './state/activeBranch';

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

interface PendingSubmissionInfo {
  routeKey: string;
  parentMessageId: string;
  existedBefore: boolean;
}

interface PendingEditRefresh {
  routeKey: string;
  messageId: string;
  generationFinished: boolean;
  retryUsed: boolean;
  snapshotChecked: boolean;
  snapshotContainsMessage: boolean;
}

export const navigatorController = (() => {
  let isInitialized = false;
  let isAttached = false;
  let refreshSequence = 0;
  let refreshPending = false;
  let refreshRouteKey: string | null = null;
  let refreshTimeoutId: number | null = null;
  let refreshFailed = false;
  let lastRefreshRequestedAt = 0;
  let pendingEditRefresh: PendingEditRefresh | null = null;
  const pendingSubmissionInfo = new Map<string, PendingSubmissionInfo>();
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
    return getActivePlatform().routing.getCurrentRouteKey();
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
    getDisplayText: (message) =>
      tocAliasStore.get(getCurrentConversationKey(), message.id) ?? message.text,
    isRenamed: (message) => tocAliasStore.get(getCurrentConversationKey(), message.id) !== null,
    canRename: () => isPermanentConversationId(getCurrentConversationKey()),
    onRenamePrompt: async (message, title) => {
      const routeKey = getCurrentConversationKey();
      if (!isPermanentConversationId(routeKey) ||
          !conversationStore.getMessages().some((item) => item.id === message.id)) {
        throw new Error('Conversation changed while editing title');
      }
      await tocAliasStore.update(routeKey, message.id,
        title === message.text ? null : title, getActiveConversationOwner());
    },
    onRestorePrompt: async (message) => {
      const routeKey = getCurrentConversationKey();
      if (!isPermanentConversationId(routeKey) ||
          !conversationStore.getMessages().some((item) => item.id === message.id)) {
        throw new Error('Conversation changed while restoring title');
      }
      await tocAliasStore.update(routeKey, message.id,
        null, getActiveConversationOwner());
    },
    onPromptCountReported: (count) => {
      if (count === reportedPromptCount) return;
      reportedPromptCount = count;
      onPromptCountChanged(count);
    },
    onRefreshObservers: () => {
      if (isAttached && shouldTrackActivePrompt()) {
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

  /** Cancels the exact outstanding page-hook request, including on route changes. */
  function cancelPendingRefresh(): void {
    if (!refreshPending || refreshRouteKey === null) return;
    window.postMessage({
      type: TOC_REFRESH_CANCEL,
      routeKey: refreshRouteKey,
      requestId: refreshSequence,
    }, location.origin);
    refreshPending = false;
    refreshRouteKey = null;
    if (refreshTimeoutId !== null) window.clearTimeout(refreshTimeoutId);
    refreshTimeoutId = null;
  }

  function recordPendingEditSnapshot(snapshotComplete: boolean): void {
    const pending = pendingEditRefresh;
    if (!pending || pending.routeKey !== getCurrentConversationKey()) return;
    pending.snapshotChecked = true;
    pending.snapshotContainsMessage = snapshotComplete &&
      conversationStore.getMessages().some((message) => message.id === pending.messageId);
    if (pending.snapshotContainsMessage) {
      pendingEditRefresh = null;
      return;
    }
    maybeRetryPendingEditRefresh();
  }

  function maybeRetryPendingEditRefresh(): void {
    const pending = pendingEditRefresh;
    if (!pending || !pending.generationFinished || refreshPending || !pending.snapshotChecked) return;
    if (pending.snapshotContainsMessage || pending.retryUsed) {
      pendingEditRefresh = null;
      return;
    }

    // A snapshot can race the server's branch switch. Retry once after the
    // generation stream ends, but never poll or loop on an unavailable API.
    pending.retryUsed = true;
    pending.snapshotChecked = false;
    pending.snapshotContainsMessage = false;
    queueMicrotask(() => {
      if (pendingEditRefresh !== pending ||
          pending.routeKey !== getCurrentConversationKey()) return;
      refreshCurrentConversation({ force: true });
    });
  }

  function clearPendingEditRefresh(): void {
    pendingEditRefresh = null;
    pendingSubmissionInfo.clear();
  }

  /**
   * Initializes data and route listeners before the page hook starts emitting.
   * @param {Object} [options]
   */
  /** Refreshes the current active branch when the user opens the sidebar. */
  function refreshCurrentConversation(options: { force?: boolean } = {}): void {
    if (!isInitialized || !isAttached || getActivePlatform().id !== 'chatgpt') return;
    syncRouteState();
    const routeKey = getCurrentConversationKey();
    if (conversationStore.isNewChatRouteKey(routeKey)) return;
    const force = options.force === true;
    if (force && refreshPending) {
      cancelPendingRefresh();
      // Invalidate the cancelled request before issuing the edit-triggered one.
      refreshSequence += 1;
    }
    const now = Date.now();
    // Coalesce ordinary triggers; explicit edit refreshes supersede stale work.
    if (refreshPending || (!force && now - lastRefreshRequestedAt < 500)) return;
    refreshPending = true;
    refreshRouteKey = routeKey;
    lastRefreshRequestedAt = now;
    const requestId = ++refreshSequence;
    window.postMessage({ type: TOC_REFRESH_REQUEST, routeKey, requestId }, location.origin);
    refreshTimeoutId = window.setTimeout(() => {
      if (refreshSequence === requestId && refreshPending) {
        cancelPendingRefresh();
        // Invalidate even an already-queued response that arrives after timeout.
        refreshSequence += 1;
        conversationStore.markConversationIncomplete(routeKey);
        refreshFailed = true;
        render();
        recordPendingEditSnapshot(false);
        console.warn('[LunaTOC] Conversation TOC refresh timed out');
      }
    }, TOC_REFRESH_TIMEOUT_MS);
  }

  function init(options: NavigatorControllerOptions = {}): void {
    if (isInitialized) return;

    onPromptCountChanged =
      options.onPromptCountChanged || onPromptCountChanged;
    onPromptAdded = options.onPromptAdded || onPromptAdded;
    onRouteChanged = options.onRouteChanged || onRouteChanged;
    onSavePrompt = options.onSavePrompt || onSavePrompt;
    onTitleChanged = options.onTitleChanged || onTitleChanged;
    conversationStore.setCurrentConversationKey(getCurrentConversationKey());
    tocAliasStore.subscribe((routeKey) => {
      if (routeKey === getCurrentConversationKey()) render();
    });
    void tocAliasStore.load(getCurrentConversationKey()).catch(() => undefined);
    listenForConversationData();
    listenForRouteChanges();
    isInitialized = true;
  }

  /**
   * Connects navigation helpers and observers after the sidebar DOM exists.
   */
  function attach(): void {
    if (isAttached) return;

    setOnRender(() => {
      const jump = readJumpProgress();
      const promptCount = conversationStore.getMessages().length;
      const loading = isLoadingPrompts();

      if (jump?.active) {
        setSidebarStatus({
          state: 'jumping',
          jump,
          promptCount,
        });
      } else if (loading) {
        setSidebarStatus({
          state: 'loading',
          promptCount,
        });
      } else if (promptCount === 0) {
        setSidebarStatus({
          state: 'empty',
          promptCount: 0,
        });
      } else if (refreshFailed) {
        setSidebarStatus({ state: 'stale', promptCount });
      } else {
        setSidebarStatus({ state: 'complete', promptCount });
      }
    });
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
    // Restored pin state may open the sidebar before attach() has completed.
    if (isSidebarVisible()) queueMicrotask(refreshCurrentConversation);
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
    // A new edge target supersedes any delayed heading retry or frame correction.
    cancelOutlineNavigation();
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
    // Keep double-click edge navigation under the same scroll-intent arbitration.
    cancelOutlineNavigation();
    jumpToPageEdge(edge, 'auto');
  }

  /**
   * Builds the conversation TOC from normalized user messages.
   * @param {Object} [options]
   */
  function render(options: RenderOptions = {}): void {
    tocListRenderer.render(options);
    if (refreshFailed) setSidebarStatus({ state: 'stale' });
  }

  /**
   * Navigates to a prompt and toggles its answer outline on repeated clicks.
   * @param {NavigatorMessage} message Target prompt.
   * @param {number} index Target prompt index.
   */
  function handleNavigatorItemClick(
    message: NavigatorMessage,
    index: number
  ): void {
    previewTooltip.hide();
    const action = handlePromptNavigation(
      index,
      activePromptTracker.getActiveIndex()
    );
    jumpToMessage(message, index);
    if (action.shouldBuild) scheduleBuild(index);
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

  // The tracker is only useful while the TOC is visible. With no sidebar
  // (unit-test and early-boot contexts), retain the previous tracking behavior.
  function shouldTrackActivePrompt(): boolean {
    const sidebar = document.getElementById('luna-toc-sidebar');
    return !sidebar || sidebar.getAttribute('aria-hidden') !== 'true';
  }

  function initActivePromptTracking(): void {
    if (shouldTrackActivePrompt()) activePromptTracker.initTracking();
  }

  function pauseActivePromptTracking(): void {
    activePromptTracker.disconnect();
  }

  function resumeActivePromptTracking(): void {
    if (isAttached) initActivePromptTracking();
  }

  function flushPendingNewChatMessage(): void {
    const flushed = conversationStore.flushPendingNewChatMessage();
    if (flushed.didAppend) {
      onPromptAdded();
      render({ refreshObservers: true });
    }
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
    cancelPromptNavigation();
    conversationStore.resetForCurrentRoute({
      preserveMessages,
      nextMessages,
    });

    activePromptTracker.reset();
    resetOutline();
    tocListRenderer.resetList();
    void tocAliasStore.load(getCurrentConversationKey()).catch(() => undefined);
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
    cancelPendingRefresh();
    refreshSequence += 1;
    refreshFailed = false;
    clearPendingEditRefresh();

    const isEnteringNewChat =
      conversationStore.isNewChatRouteKey(nextConversationKey) &&
      !transition.shouldPreserveMessages &&
      transition.cachedMessages.length === 0 &&
      !conversationStore.getPendingNewChatMessage();

    const isCompleteCachedConversation =
      !isEnteringNewChat &&
      !transition.shouldPreserveMessages &&
      conversationStore.isConversationComplete(nextConversationKey);

    if (isEnteringNewChat || isCompleteCachedConversation) {
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
    // Route switches with a pinned sidebar do not trigger onOpened again.
    if (isAttached && isSidebarVisible()) {
      queueMicrotask(refreshCurrentConversation);
    }
  }

  /** Clears navigation and UI state only after confirmed conversation deletion. */
  function handleConversationDeleted(routeKey: string): void {
    conversationStore.deleteConversation(routeKey);
    if (routeKey !== getCurrentConversationKey()) return;
    cancelPendingRefresh();
    refreshSequence += 1;
    refreshFailed = false;
    if (pendingEditRefresh?.routeKey === routeKey) pendingEditRefresh = null;
    pendingSubmissionInfo.delete(routeKey);
    setLoading(false);
    clearSettleTimer();
    resetStateForCurrentRoute();
  }

  function isSidebarVisible(): boolean {
    return document.getElementById('luna-toc-sidebar')?.getAttribute('aria-hidden') === 'false';
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

  function handleConversationData(data: ConversationData, requestStartedAt?: number): void {
    const incomingMessages = data?.messages;
    if (!Array.isArray(incomingMessages)) return;

    onTitleChanged();

    // Incoming paginated data is not an authoritative complete snapshot.
    // It may predate the last verified branch; never clear its failure state.
    conversationStore.handleConversationData(
      data,
      getCurrentConversationKey(),
      requestStartedAt
    );
    render({ refreshObservers: true });
  }

  function listenForConversationData(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      syncRouteState();

      if (event.data?.type === TOC_REFRESH_RESULT) {
        if (event.origin !== location.origin) return;
        const { requestId, routeKey, payload } = event.data;
        if (!refreshPending || requestId !== refreshSequence ||
            routeKey !== getCurrentConversationKey()) return;
        refreshPending = false;
        refreshRouteKey = null;
        if (refreshTimeoutId !== null) window.clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;
        if (!payload || !Array.isArray((payload as ConversationSnapshot).messages)) {
          conversationStore.markConversationIncomplete(routeKey);
          refreshFailed = true;
          setSidebarStatus({ state: 'stale' });
          recordPendingEditSnapshot(false);
          console.warn('[LunaTOC] Conversation TOC refresh returned no complete snapshot');
          return;
        }
        const changed = conversationStore.replaceWithFreshSnapshot(payload, routeKey);
        if (!conversationStore.isConversationComplete(routeKey)) {
          refreshFailed = true;
          setSidebarStatus({ state: 'stale' });
          recordPendingEditSnapshot(false);
          return;
        }
        refreshFailed = false;
        recordPendingEditSnapshot(true);
        if (changed) {
          cancelPromptNavigation();
          resetOutline();
          render({ refreshObservers: true });
        } else {
          setSidebarStatus({
            state: 'complete',
            promptCount: conversationStore.getMessages().length,
          });
        }
        return;
      }

      if (event.data?.type === TOC_EDIT_SUBMISSION) {
        if (event.origin !== location.origin) return;
        const { stage, routeKey, messageId, parentMessageId } = event.data;
        if (typeof routeKey !== 'string' ||
            routeKey !== getCurrentConversationKey() ||
            typeof messageId !== 'string' || !messageId) return;

        if (stage === 'accepted') {
          const submission = pendingSubmissionInfo.get(messageId);
          pendingSubmissionInfo.delete(messageId);
          if (submission && submission.routeKey !== routeKey) return;
          const parentId = submission?.parentMessageId ??
            (typeof parentMessageId === 'string' ? parentMessageId : '');
          if (!parentId) return;

          const currentPrompts = conversationStore.getMessages();
          const promptsBeforeSubmission = submission?.existedBefore
            ? currentPrompts
            : currentPrompts.filter((message) => message.id !== messageId);
          const lastPrompt = promptsBeforeSubmission[promptsBeforeSubmission.length - 1];

          // A normal new prompt points at the latest prompt/answer. A different
          // parent means the user submitted from an earlier branch in history.
          if (!lastPrompt || parentId === lastPrompt.id || parentId === lastPrompt.answerId) return;

          pendingEditRefresh = {
            routeKey,
            messageId,
            generationFinished: false,
            retryUsed: false,
            snapshotChecked: false,
            snapshotContainsMessage: false,
          };
          refreshCurrentConversation({ force: true });
          return;
        }

        if (stage === 'finished') {
          const pending = pendingEditRefresh;
          if (pending && pending.routeKey === routeKey && pending.messageId === messageId) {
            pending.generationFinished = true;
            maybeRetryPendingEditRefresh();
          }
        }
        return;
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.conversationData
      ) {
        const routeKey = event.data.routeKey;
        if (routeKey && routeKey !== getCurrentConversationKey()) return;
        conversationStore.clearPendingNewChat();
        handleConversationData(event.data.payload, event.data.requestStartedAt);
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.conversationEnded
      ) {
        const routeKey = event.data.routeKey;
        if (!routeKey || routeKey !== getCurrentConversationKey()) return;
        if (event.data.complete === true) {
          conversationStore.markConversationComplete(routeKey);
        }
        markLoadingComplete();
      }

      if (
        event.data?.type ===
        getActivePlatform().pageHook.messages.newUserMessage
      ) {
        const newMessage = event.data.payload as ChatMessage & { parentMessageId?: unknown };
        if (!newMessage?.id) return;

        const routeKey = event.data.routeKey;
        const existedBefore = conversationStore.getMessages().some((message) => message.id === newMessage.id);
        const result = conversationStore.handleNewUserMessage(
          newMessage,
          routeKey
        );

        if (!result.accepted) return;

        if (typeof newMessage.parentMessageId === 'string' && newMessage.parentMessageId) {
          const submissionRouteKey = typeof routeKey === 'string'
            ? routeKey
            : getCurrentConversationKey();
          pendingSubmissionInfo.delete(newMessage.id);
          pendingSubmissionInfo.set(newMessage.id, {
            routeKey: submissionRouteKey,
            parentMessageId: newMessage.parentMessageId,
            existedBefore,
          });
          while (pendingSubmissionInfo.size > 8) {
            const oldest = pendingSubmissionInfo.keys().next().value;
            if (!oldest) break;
            pendingSubmissionInfo.delete(oldest);
          }
        }

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
    handleConversationDeleted,
    jumpToAbsoluteEdge,
    jumpToEdge,
    jumpToLastPrompt,
    render,
    refreshCurrentConversation,
    pauseActivePromptTracking,
    resumeActivePromptTracking,
    resetView,
    setJumpProgress,
    setSearchQuery,
  };
})();
