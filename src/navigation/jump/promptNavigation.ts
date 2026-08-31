/**
 * Handles main prompt navigation from LunaTOC to ChatGPT positions.
 */
import { APP_CONFIG } from '@/config/config';
import { getChatGptNavigationAlgorithm } from '../navigationSettings';
import type { NavigationFingerprintIndex } from '../fingerprint/index';
import type { NavigationSegmentIndex } from '../fingerprint/segments';
import {
  createNavigationAnchorStore,
  type NavigationAnchorStore,
} from './navigationAnchorStore';
import { searchVirtualPrompt } from './virtualSearchController';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import {
  createChatGptElementNavigationAnchor as _createChatGptElementNavigationAnchor,
  findRenderedChatGptPrompt as _findRenderedChatGptPrompt,
  getChatGptPromptMountDiagnostic as _getChatGptPromptMountDiagnostic,
  getChatGptScrollContainer as _getChatGptScrollContainer,
  getChatGptScrollMetrics as _getChatGptScrollMetrics,
  isChatGptElementVisible as _isChatGptElementVisible,
  observeChatGptVirtualPosition as _observeChatGptVirtualPosition,
} from '@/platforms/chatgpt/virtualSearchAdapter';
import {
  createChatGptNavigationJumpId as _createChatGptNavigationJumpId,
  getChatGptNavigationTestConfig as _getChatGptNavigationTestConfig,
  logChatGptNavigationEvent as _logChatGptNavigationEvent,
} from '@/platforms/chatgpt/navigationDiagnostics';
import type { ChatGptNavigationTestConfig } from '@/platforms/chatgpt/navigationDiagnostics';

function platform() {
  return getActivePlatform();
}

const createChatGptElementNavigationAnchor = (opts: Parameters<typeof _createChatGptElementNavigationAnchor>[0]) =>
  platform().navigation.createElementNavigationAnchor(opts);
const findRenderedChatGptPrompt = (promptId: string, root?: ParentNode) =>
  platform().navigation.findRenderedPrompt(promptId, root);
const getChatGptPromptMountDiagnostic = (
  opts: Parameters<typeof _getChatGptPromptMountDiagnostic>[0]
) => platform().navigation.getPromptMountDiagnostic(opts) as unknown as ReturnType<typeof _getChatGptPromptMountDiagnostic>;
const getChatGptScrollContainer = (root?: ParentNode) =>
  platform().navigation.getScrollContainer(root);
const getChatGptScrollMetrics = (container: HTMLElement) =>
  platform().navigation.getScrollMetrics(container) ?? {
    scrollTop: 0,
    scrollHeight: 0,
    viewportHeight: 0,
    viewportWidth: 0,
  };
const isChatGptElementVisible = (element: HTMLElement, container: HTMLElement) =>
  platform().navigation.isElementVisible(element, container);
const observeChatGptVirtualPosition = (opts: Parameters<typeof _observeChatGptVirtualPosition>[0]) =>
  platform().navigation.observeVirtualPosition(opts) as ReturnType<typeof _observeChatGptVirtualPosition>;
const createChatGptNavigationJumpId = () => platform().diagnostics.createJumpId();
const getChatGptNavigationTestConfig = (): ChatGptNavigationTestConfig => {
  const raw = platform().diagnostics.getTestConfig() ?? {};
  return {
    settleWaitMs: raw.settleWaitMs ?? 0,
    settleAttempts: raw.settleAttempts ?? 0,
    maxSearchAttempts: raw.maxSearchAttempts ?? 0,
    maxUnproductiveSearchAttempts: raw.maxUnproductiveSearchAttempts ?? 0,
    maxSearchDurationMs: raw.maxSearchDurationMs ?? 0,
    useConfirmedAnchors: raw.useConfirmedAnchors ?? false,
    useObservedAnchors: raw.useObservedAnchors ?? false,
  };
};
const logChatGptNavigationEvent = (
  jumpId: string,
  eventName: string,
  details?: Record<string, unknown>,
  storage?: Storage
) => platform().diagnostics.logEvent(jumpId, eventName, details, storage);

interface VirtualSearchContext {
  conversationKey: string;
  prompts: NavigatorMessage[];
  fingerprintIndex: NavigationFingerprintIndex;
  segmentIndex: NavigationSegmentIndex;
}

interface PromptNavigationOptions {
  getNativePromptButtons: () => HTMLElement[];
  normalizeText: (text: string) => string;
  findConversationIndexByElement: (element: HTMLElement) => number;
  getConversationMessageCount: () => number;
  getVirtualSearchContext: () => VirtualSearchContext;
  lockActiveIndex: (index: number, duration?: number) => void;
  setJumpProgress: (progress: {
    active: boolean;
    targetIndex: number;
    remainingSteps: number;
  }) => void;
  clearJumpProgress: () => void;
}

interface ScrollToMessageOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
}

interface MessageMatchOptions {
  requireVisible?: boolean;
}

interface VirtualScanOptions {
  container: HTMLElement;
  direction: 1 | -1;
  step: number;
  attempts: number;
  token: number;
}

interface RetryFindOptions {
  container: HTMLElement;
  token: number;
  attempts: number;
  delay: number;
}

interface AdjacentEdgeScan {
  edge: 'top-adjacent' | 'bottom-adjacent';
  initialTop: number;
  direction: 1 | -1;
}

let lastNonTextHighlightIndex: number | null = null;
let lastNonTextHighlightElement: HTMLElement | null = null;
let getNativePromptButtons: () => HTMLElement[] = () => [];
let normalizeText: (text: string) => string = (text) => text;
let findConversationIndexByElement: (element: HTMLElement) => number = () => -1;
let getConversationMessageCount: () => number = () => 0;
let getVirtualSearchContext: () => VirtualSearchContext = () => ({
  conversationKey: '',
  prompts: [],
  fingerprintIndex: [],
  segmentIndex: [],
});
let lockActiveIndex: (index: number, duration?: number) => void = () => {};
let setJumpProgress: (progress: {
  active: boolean;
  targetIndex: number;
  remainingSteps: number;
}) => void = () => {};
let clearJumpProgress: () => void = () => {};
let virtualScanToken = 0;
let navigationAnchorStore: NavigationAnchorStore | null = null;
let activeIndependentSearch: AbortController | null = null;
let navigationJumpVersion = 0;
const debugStorageKey = 'chatTocDebugJump';

/**
 * Connects jump behavior to navigator state and native TOC helpers.
 * @param {Object} options
 * @param {() => HTMLElement[]} options.getNativePromptButtons
 * @param {(text: string) => string} options.normalizeText
 * @param {(element: HTMLElement) => number} options.findConversationIndexByElement
 * @param {() => number} options.getConversationMessageCount
 * @param {(index: number, duration?: number) => void} options.lockActiveIndex
 * @param {(progress: object) => void} options.setJumpProgress
 * @param {() => void} options.clearJumpProgress
 */
export function initializePromptNavigation(
  options: PromptNavigationOptions
): void {
  getNativePromptButtons = options.getNativePromptButtons;
  normalizeText = options.normalizeText;
  findConversationIndexByElement = options.findConversationIndexByElement;
  getConversationMessageCount = options.getConversationMessageCount;
  getVirtualSearchContext = options.getVirtualSearchContext;
  lockActiveIndex = options.lockActiveIndex;
  setJumpProgress = options.setJumpProgress;
  clearJumpProgress = options.clearJumpProgress;
}

/**
 * Jumps to the first or last prompt using ChatGPT's native TOC when available.
 * @param {'top' | 'bottom'} edge
 */
export function jumpToConversationEdge(edge: 'top' | 'bottom'): void {
  if (usesIndependentVirtualNavigation()) {
    cancelActiveNavigationSearch();
    jumpToAbsoluteEdge(edge, 'auto');
    return;
  }

  const buttons = getNativePromptButtons();
  const button = edge === 'top' ? buttons[0] : buttons.at(-1);

  keepFollowing();

  if (button) {
    button.click();
    return;
  }

  jumpToAbsoluteEdge(edge, 'smooth');
}

/**
 * Applies a temporary highlight effect to a rendered prompt element.
 * @param {HTMLElement} element
 */
function highlightMatchedElement(element: HTMLElement): void {
  element.style.outline = '2px solid #60a5fa';
  element.style.borderRadius = '8px';

  setTimeout(() => {
    element.style.outline = '';
    element.style.borderRadius = '';
  }, 1200);
}

/**
 * Highlights an element after it enters the viewport, with a timeout fallback.
 * @param {HTMLElement} element
 */
function highlightWhenVisible(element: HTMLElement): void {
  let didHighlight = false;
  let observer: IntersectionObserver | null = null;

  const finish = () => {
    if (didHighlight) return;

    didHighlight = true;
    observer?.disconnect();
    highlightMatchedElement(element);
  };

  const fallbackTimer = setTimeout(finish, 900);

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || entry.intersectionRatio < 0.2) return;

      clearTimeout(fallbackTimer);
      finish();
    },
    {
      threshold: [0.2],
    }
  );

  observer.observe(element);
}

/**
 * Scrolls to the given element and applies a temporary highlight effect.
 * @param {HTMLElement} element
 * @param {ScrollBehavior} [behavior='smooth']
 * @param {ScrollLogicalPosition} [block='center']
 */
function scrollToMatchedElement(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
  block: ScrollLogicalPosition = 'center'
): void {
  keepFollowing();

  element.scrollIntoView({
    behavior,
    block,
  });

  highlightWhenVisible(element);
}

/**
 * Jumps to a prompt. Prefer ChatGPT's built-in prompt navigator because it can
 * scroll virtualized conversations; DOM text/index fallbacks only work for
 * messages currently rendered in the page.
 * @param {Object} message
 * @param {number} index
 */
export function jumpToMessage(message: NavigatorMessage, index: number): void {
  cancelActiveNavigationSearch();

  if (usesIndependentVirtualNavigation()) {
    jumpWithIndependentVirtualNavigation(message, index);
    return;
  }

  jumpWithLegacyNativeNavigation(message, index);
}

/**
 * Uses ChatGPT's native prompt navigator and legacy DOM scanning fallbacks.
 */
function jumpWithLegacyNativeNavigation(
  message: NavigatorMessage,
  index: number
): void {
  lockActiveIndex(index, message.canMatchByText ? 1800 : 4000);

  if (jumpToPromptByIndex(index)) {
    retryHighlightJumpTarget(
      message,
      index,
      getNonTextJumpStartElement(message)
    );

    return;
  }

  if (message.canMatchByText && jumpToUserMessageByText(message.text)) return;

  if (
    message.canMatchByText &&
    jumpToUserMessageByVirtualScan(message, index)
  ) {
    return;
  }

  jumpToVisibleUserMessageByIndex(index);
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number
): void {
  const jumpId = createChatGptNavigationJumpId();
  const testConfig = getChatGptNavigationTestConfig();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  logChatGptNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
    fingerprintRecordCount: context.fingerprintIndex.length,
    derivedSegmentCount: context.segmentIndex.length,
    testConfig,
  });
  // Far jumps slide the virtual render window over several seconds. Hold the
  // active-row lock for the whole slide so scroll-follow cannot snap the
  // highlight to intermediate prompts mid-jump.
  lockActiveIndex(index, 15_000);
  keepFollowing(15_000);

  if (!container || !context.conversationKey) {
    debugJump('independent-search:missing-context', {
      hasContainer: Boolean(container),
      conversationKey: context.conversationKey,
      index,
    });
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  const renderedTarget = findRenderedChatGptPrompt(message.id);
  if (renderedTarget && isChatGptElementVisible(renderedTarget, container)) {
    finishIndependentVirtualJump(
      renderedTarget,
      message,
      index,
      context.conversationKey,
      container,
      jumpId,
      testConfig as unknown as ChatGptNavigationTestConfig
    );
    return;
  }

  const controller = new AbortController();
  activeIndependentSearch = controller;
  const anchorStore = getNavigationAnchorStore();

  setJumpProgress({
    active: true,
    targetIndex: index,
    remainingSteps: testConfig.maxSearchAttempts,
  });

  void searchVirtualPrompt({
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
    getConfirmedAnchors: async () => {
      if (!testConfig.useConfirmedAnchors) return [];

      const anchors = await anchorStore.getConfirmedAnchors(
        context.conversationKey
      );

      return anchors.filter(
        ({ promptId, promptIndex }) =>
          context.prompts[promptIndex]?.id === promptId
      );
    },
    invalidateConfirmedAnchor: async (promptId) => {
      await anchorStore.removeConfirmed(
        context.conversationKey,
        promptId
      );
    },
    getObservedAnchors: () =>
      testConfig.useObservedAnchors
        ? anchorStore.getObservedAnchors(context.conversationKey)
        : [],
    recordObservation: (anchor) => {
      if (testConfig.useObservedAnchors) {
        anchorStore.recordObservation(anchor);
      }
    },
    getScrollMetrics: () => getChatGptScrollMetrics(container),
    observePosition: () =>
      observeChatGptVirtualPosition({
        conversationKey: context.conversationKey,
        prompts: context.prompts,
        fingerprintIndex: context.fingerprintIndex,
        segmentIndex: context.segmentIndex,
        scrollContainer: container,
      }),
    isTargetRendered: () => {
      const target = findRenderedChatGptPrompt(message.id);
      return Boolean(target && isChatGptElementVisible(target, container));
    },
    scrollTo: (scrollTop) => {
      container.scrollTo({ top: scrollTop, behavior: 'auto' });
    },
    waitForRender: () =>
      new Promise((resolve) => {
        setTimeout(resolve, testConfig.settleWaitMs);
      }),
    signal: controller.signal,
    maxAttempts: testConfig.maxSearchAttempts,
    onProgress: ({ remaining }) => {
      setJumpProgress({
        active: true,
        targetIndex: index,
        remainingSteps: remaining,
      });
    },
    maxUnproductiveAttempts:
      testConfig.maxUnproductiveSearchAttempts,
    maxDurationMs: testConfig.maxSearchDurationMs,
    targetDomRecoveryDirection: -1,
    onDiagnosticEvent: ({ eventName, details }) => {
      const diagnosticDetails =
        eventName === 'PROMPT_MOUNT_EXHAUSTED'
          ? {
              ...details,
              chatGptDom: getChatGptPromptMountDiagnostic({
                promptId: message.id,
                matchedBlockIds: getLastMatchedBlockIds(details),
                scrollContainer: container,
                getNavigatorIndex: findConversationIndexByElement,
                matchesTargetPromptText: (element) =>
                  doesElementMatchPromptText(element, message),
              }),
            }
          : details;
      logChatGptNavigationEvent(
        jumpId,
        eventName,
        diagnosticDetails
      );
    },
  })
    .then((result) => {
      if (activeIndependentSearch === controller) {
        activeIndependentSearch = null;
      }
      if (result.status !== 'found') {
        debugJump('independent-search:stopped', {
          index,
          status: result.status,
          attempts: result.attempts,
        });
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: result.status,
          attempts: result.attempts,
        });
        return;
      }

      const target = findRenderedChatGptPrompt(message.id);
      if (!target || !isChatGptElementVisible(target, container)) {
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: target
            ? 'target-not-visible-after-search'
            : 'target-disappeared-after-search',
        });
        return;
      }

      finishIndependentVirtualJump(
        target,
        message,
        index,
        context.conversationKey,
        container,
        jumpId,
        testConfig
      );
    })
    .catch((error: unknown) => {
      if (activeIndependentSearch === controller) {
        activeIndependentSearch = null;
      }
      logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'error',
      });
      console.warn('[LunaTOC] Independent navigation failed.', error);
    })
    .finally(() => {
      clearJumpProgress();
    });
}

/**
 * Reads the final matched Assistant IDs from a generic mount diagnostic event.
 */
function getLastMatchedBlockIds(
  details: Record<string, unknown>
): string[] {
  const lastPosition = details.lastPosition;
  if (!isRecord(lastPosition)) return [];

  const matchedBlocks = lastPosition.matchedBlocks;
  if (!Array.isArray(matchedBlocks)) return [];

  return matchedBlocks.flatMap((block) => {
    if (!isRecord(block) || typeof block.blockId !== 'string') {
      return [];
    }
    return [block.blockId];
  });
}

/**
 * Checks target Prompt text without exposing either value to diagnostics.
 */
function doesElementMatchPromptText(
  element: HTMLElement,
  message: NavigatorMessage
): boolean {
  if (!message.canMatchByText) return false;

  const domText = normalizeText(
    element.innerText || element.textContent || ''
  );
  const promptText = normalizeText(message.text);

  return domText === promptText || domText.includes(promptText);
}

/**
 * Returns whether an unknown value can be inspected as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Clicks ChatGPT's built-in prompt navigator item.
 * @param {number} index
 * @returns {boolean} true if jump succeeded, false otherwise.
 */
function jumpToPromptByIndex(index: number): boolean {
  const buttons = getNativePromptButtons();
  const button = buttons[index];

  if (!button) {
    return false;
  }

  button.click();
  return true;
}

/**
 * Jumps to a prompt by index and locks ChatTOC's active row while ChatGPT
 * scrolls virtualized content into place.
 * @param {number} index
 * @param {number} duration
 * @returns {boolean}
 */
export function jumpToPromptIndex(index: number, duration = 4000): boolean {
  if (usesIndependentVirtualNavigation()) {
    const message = getVirtualSearchContext().prompts[index];
    if (!message) return false;

    cancelActiveNavigationSearch();
    jumpWithIndependentVirtualNavigation(message, index);
    return true;
  }

  lockActiveIndex(index, duration);
  keepFollowing(duration);

  return jumpToPromptByIndex(index);
}

/**
 * Locks ChatTOC's active row without asking ChatGPT to navigate again.
 * @param {number} index
 * @param {number} duration
 */
export function lockPromptIndex(index: number, duration = 1800): void {
  lockActiveIndex(index, duration);
  keepFollowing(duration);
}

/**
 * Completes an independent jump and persists its verified prompt anchor.
 */
function finishIndependentVirtualJump(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number,
  conversationKey: string,
  container: HTMLElement,
  jumpId: string,
  testConfig: ChatGptNavigationTestConfig
): void {
  const jumpVersion = navigationJumpVersion;

  // Re-assert the target row and shorten the lock so scroll-follow resumes
  // shortly after the jump settles instead of waiting out the full slide lock.
  lockActiveIndex(index, 1800);

  logChatGptNavigationEvent(jumpId, 'TARGET_FOUND', {
    promptId: message.id,
    promptIndex: index,
    geometry: getPromptGeometry(target, container),
  });
  alignIndependentPromptToTop(target, container, jumpId, 'initial');
  settleIndependentVirtualJump({
    previousTarget: target,
    message,
    index,
    conversationKey,
    container,
    jumpId,
    testConfig,
    jumpVersion,
    attempts: testConfig.settleAttempts,
  });
}

/**
 * Aligns a mounted prompt with the scroll container's start edge.
 */
function alignIndependentPromptToTop(
  target: HTMLElement,
  container: HTMLElement,
  jumpId: string,
  phase: 'initial' | 'settled'
): void {
  const before = getPromptGeometry(target, container);
  const previousScrollMarginTop = target.style.scrollMarginTop;
  target.style.scrollMarginTop = `${APP_CONFIG.platforms.chatgpt.promptTopOffsetPx}px`;
  target.scrollIntoView({
    behavior: 'auto',
    block: 'start',
  });
  target.style.scrollMarginTop = previousScrollMarginTop;
  logChatGptNavigationEvent(jumpId, 'ALIGNMENT_APPLIED', {
    phase,
    before,
    after: getPromptGeometry(target, container),
  });
}

/**
 * Re-resolves the target after virtual rendering, then highlights and caches
 * only the final mounted prompt element.
 */
function settleIndependentVirtualJump({
  previousTarget,
  message,
  index,
  conversationKey,
  container,
  jumpId,
  testConfig,
  jumpVersion,
  attempts,
}: {
  previousTarget: HTMLElement;
  message: NavigatorMessage;
  index: number;
  conversationKey: string;
  container: HTMLElement;
  jumpId: string;
  testConfig: ChatGptNavigationTestConfig;
  jumpVersion: number;
  attempts: number;
}): void {
  setTimeout(() => {
    if (jumpVersion !== navigationJumpVersion) {
      logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'cancelled-during-settle',
      });
      return;
    }

    const latestTarget = findRenderedChatGptPrompt(message.id);
    const latestTargetVisible = Boolean(
      latestTarget && isChatGptElementVisible(latestTarget, container)
    );
    logChatGptNavigationEvent(jumpId, 'SETTLE_CHECK', {
      attemptsRemaining: attempts,
      targetFound: Boolean(latestTarget),
      targetVisible: latestTargetVisible,
      domReplaced: Boolean(latestTarget && latestTarget !== previousTarget),
      geometry: latestTarget
        ? getPromptGeometry(latestTarget, container)
        : null,
    });
    if (!latestTarget) {
      if (attempts > 1) {
        settleIndependentVirtualJump({
          previousTarget,
          message,
          index,
          conversationKey,
          container,
          jumpId,
          testConfig,
          jumpVersion,
          attempts: attempts - 1,
        });
      } else {
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'target-missing-during-settle',
        });
      }
      return;
    }

    alignIndependentPromptToTop(latestTarget, container, jumpId, 'settled');
    requestAnimationFrame(() => {
      if (jumpVersion !== navigationJumpVersion) return;

      const finalTarget = findRenderedChatGptPrompt(message.id) || latestTarget;
      if (
        !finalTarget.isConnected ||
        !isChatGptElementVisible(finalTarget, container)
      ) {
        if (attempts > 1) {
          settleIndependentVirtualJump({
            previousTarget: latestTarget,
            message,
            index,
            conversationKey,
            container,
            jumpId,
            testConfig,
            jumpVersion,
            attempts: attempts - 1,
          });
        } else {
          logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
            status: finalTarget.isConnected
              ? 'target-not-visible-during-settle'
              : 'target-disconnected-during-settle',
          });
        }
        return;
      }

      highlightWhenVisible(finalTarget);
      logChatGptNavigationEvent(jumpId, 'HIGHLIGHT_STARTED', {
        geometry: getPromptGeometry(finalTarget, container),
      });
      persistConfirmedPromptAnchor(
        finalTarget,
        message,
        index,
        conversationKey,
        container,
        jumpId
      );
    });
  }, testConfig.settleWaitMs);
}

/**
 * Persists the prompt position only after final DOM alignment succeeds.
 */
function persistConfirmedPromptAnchor(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number,
  conversationKey: string,
  container: HTMLElement,
  jumpId: string
): void {
  const anchor = createChatGptElementNavigationAnchor({
    conversationKey,
    promptId: message.id,
    promptIndex: index,
    element: target,
    scrollContainer: container,
  });

  void getNavigationAnchorStore()
    .recordConfirmed(anchor)
    .then(() => {
      logChatGptNavigationEvent(jumpId, 'ANCHOR_PERSISTED', {
        promptId: message.id,
        promptIndex: index,
        scrollTop: anchor.scrollTop,
        scrollProgress: anchor.scrollProgress,
      });
      logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'found',
      });
    })
    .catch((error: unknown) => {
      logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'anchor-persistence-failed',
      });
      console.warn('[LunaTOC] Failed to persist navigation anchor.', error);
    });
}

/**
 * Returns compact prompt and container geometry for console diagnostics.
 */
function getPromptGeometry(
  target: HTMLElement,
  container: HTMLElement
): Record<string, number | boolean> {
  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    targetConnected: target.isConnected,
    targetTop: targetRect.top,
    targetBottom: targetRect.bottom,
    containerTop: containerRect.top,
    containerBottom: containerRect.bottom,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };
}

/**
 * Returns the shared anchor store, creating its Chrome adapter lazily.
 */
function getNavigationAnchorStore(): NavigationAnchorStore {
  navigationAnchorStore ||= createNavigationAnchorStore();
  return navigationAnchorStore;
}

/**
 * Cancels active independent and legacy virtual scans before a new jump.
 */
function cancelActiveNavigationSearch(): void {
  activeIndependentSearch?.abort();
  activeIndependentSearch = null;
  virtualScanToken += 1;
  navigationJumpVersion += 1;
}

/**
 * Returns whether ChatGPT navigation must avoid all native TOC behavior.
 */
function usesIndependentVirtualNavigation(): boolean {
  return getChatGptNavigationAlgorithm() === 'independent-virtual';
}

/**
 * Logs jump fallback diagnostics when explicitly enabled in localStorage.
 * @param {string} eventName
 * @param {Object} details
 */
function debugJump(
  eventName: string,
  details: Record<string, unknown> = {}
): void {
  try {
    if (window.localStorage.getItem(debugStorageKey) !== '1') return;
    console.debug('[LunaTOC jump]', eventName, details);
  } catch (e) {
    // Ignore debug logging failures.
  }
}

/**
 * Fallback for already-rendered messages: find a user message whose DOM text
 * matches the captured prompt text.
 * @param {string} text
 * @param {Object} [options]
 * @param {ScrollBehavior} [options.behavior='smooth']
 * @param {ScrollLogicalPosition} [options.block='center']
 * @returns {boolean} true if jump succeeded, false otherwise.
 */
function jumpToUserMessageByText(
  text: string,
  options: ScrollToMessageOptions = {}
): boolean {
  const { behavior = 'smooth', block = 'center' } = options;
  const matchedElement = findUserMessageByText(text);

  if (!matchedElement) {
    return false;
  }

  scrollToMatchedElement(matchedElement, behavior, block);
  return true;
}

/**
 * Highlights a rendered user message by text without changing scroll position.
 * @param {string} text
 * @returns {boolean} true if a visible rendered target was highlighted.
 */
function highlightVisibleUserMessageByText(text: string): boolean {
  const matchedElement = findUserMessageByText(text, {
    requireVisible: true,
  });

  if (!matchedElement) {
    return false;
  }

  highlightMatchedElement(matchedElement);
  return true;
}

/**
 * Finds a rendered user message whose DOM text matches the captured prompt.
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.requireVisible=false]
 * @returns {HTMLElement | null}
 */
function findUserMessageByText(
  text: string,
  options: MessageMatchOptions = {}
): HTMLElement | null {
  const { requireVisible = false } = options;
  const targetText = normalizeTextForMatch(text);

  return (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-message-author-role="user"]'
      )
    ).find((element) => {
      if (requireVisible && !isElementVisibleInViewport(element)) {
        return false;
      }

      const domText = normalizeTextForMatch(element.innerText);
      return isTextMatch(domText, targetText);
    }) || null
  );
}

/**
 * Returns whether an element is visibly inside the viewport.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isElementVisibleInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();

  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * Normalizes rendered/user text for DOM matching without changing display text.
 * @param {string} text
 * @returns {string}
 */
function normalizeTextForMatch(text: string): string {
  return normalizeText(text)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Returns whether rendered DOM text matches the captured prompt text.
 * @param {string} domText
 * @param {string} targetText
 * @returns {boolean}
 */
function isTextMatch(domText: string, targetText: string): boolean {
  if (!domText || !targetText) return false;
  if (domText === targetText || domText.includes(targetText)) return true;

  const prefix = targetText.slice(0, 40).trim();
  const suffix = targetText.slice(-30).trim();

  return (
    prefix.length >= 16 &&
    suffix.length >= 12 &&
    domText.includes(prefix) &&
    domText.includes(suffix)
  );
}

/**
 * Last-resort fallback for non-virtualized pages where all user messages are
 * present in the DOM.
 * @param {number} index
 * @returns {boolean} true if jump succeeded, false otherwise.
 */
function jumpToVisibleUserMessageByIndex(index: number): boolean {
  const messages = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
  );

  if (messages.length !== getConversationMessageCount()) {
    return false;
  }

  const message = messages[index];

  if (!message) {
    return false;
  }

  scrollToMatchedElement(message);
  return true;
}

/**
 * Searches virtualized conversations by scrolling until the target text is
 * rendered, then uses the regular DOM text match.
 * @param {Object} message
 * @param {number} index
 * @returns {boolean} true when a scan was started or the target was found.
 */
function jumpToUserMessageByVirtualScan(
  message: NavigatorMessage,
  index: number
): boolean {
  const container = getChatGptScrollContainer();
  const messageCount = getConversationMessageCount();

  if (!container) {
    debugJump('virtual-scan:no-container', { index });
    return false;
  }

  const edge = getTargetEdge(index, messageCount);
  if (edge) {
    jumpToVirtualScanEdge(message.text, container, edge);
    return true;
  }

  const edgeScan = getAdjacentEdgeScan(container, index, messageCount);
  const direction = edgeScan?.direction || getVirtualScanDirection(index);
  const token = ++virtualScanToken;
  const step = Math.max(window.innerHeight * 0.85, 1200);
  const maxAttempts = 24;
  const initialTop =
    edgeScan?.initialTop ??
    getEstimatedScrollTop(container, index, messageCount);

  keepFollowing(4500);

  if (initialTop !== null) {
    container.scrollTo({
      top: initialTop,
      behavior: 'auto',
    });
  }

  debugJump('virtual-scan:start', {
    index,
    direction,
    step,
    attempts: maxAttempts,
    initialTop,
    edgeScan: edgeScan?.edge || null,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    container: getDebugElementLabel(container),
  });

  scanForRenderedMessage(message.text, {
    container,
    direction,
    step,
    attempts: maxAttempts,
    token,
  });

  return true;
}

/**
 * Returns the absolute edge for first/last prompt targets.
 * @param {number} index
 * @param {number} messageCount
 * @returns {'top' | 'bottom' | null}
 */
function getTargetEdge(
  index: number,
  messageCount: number
): 'top' | 'bottom' | null {
  if (index === 0) return 'top';
  if (messageCount > 0 && index === messageCount - 1) return 'bottom';

  return null;
}

/**
 * Handles first/last prompt targets with an absolute edge jump, then retries
 * text matching after ChatGPT has mounted the edge content.
 * @param {string} text
 * @param {HTMLElement} container
 * @param {'top' | 'bottom'} edge
 */
function jumpToVirtualScanEdge(
  text: string,
  container: HTMLElement,
  edge: 'top' | 'bottom'
): void {
  const token = ++virtualScanToken;
  const targetTop = edge === 'top' ? 0 : container.scrollHeight;

  keepFollowing(2500);
  container.scrollTo({
    top: targetTop,
    behavior: 'auto',
  });

  debugJump('virtual-scan:edge-jump', {
    edge,
    targetTop,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    container: getDebugElementLabel(container),
  });

  retryFindRenderedMessage(text, {
    container,
    token,
    attempts: 10,
    delay: 120,
  });
}

/**
 * Estimates a useful starting scrollTop for middle prompt scan fallback.
 * @param {HTMLElement} container
 * @param {number} index
 * @param {number} messageCount
 * @returns {number | null}
 */
function getEstimatedScrollTop(
  container: HTMLElement,
  index: number,
  messageCount: number
): number | null {
  if (messageCount <= 1) return null;

  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const ratio = index / (messageCount - 1);

  return Math.max(0, Math.min(maxTop, maxTop * ratio));
}

/**
 * Starts near-edge prompt scans from the nearest absolute edge instead of a
 * proportional estimate, which is unstable for very long messages.
 * @param {HTMLElement} container
 * @param {number} index
 * @param {number} messageCount
 * @returns {{edge: string, initialTop: number, direction: 1 | -1} | null}
 */
function getAdjacentEdgeScan(
  container: HTMLElement,
  index: number,
  messageCount: number
): AdjacentEdgeScan | null {
  if (index === 1) {
    return {
      edge: 'top-adjacent',
      initialTop: 0,
      direction: 1,
    };
  }

  if (messageCount > 2 && index === messageCount - 2) {
    return {
      edge: 'bottom-adjacent',
      initialTop: container.scrollHeight,
      direction: -1,
    };
  }

  return null;
}

/**
 * Chooses the scan direction by comparing the target index with the currently
 * centered rendered prompt index.
 * @param {number} targetIndex
 * @returns {1 | -1}
 */
function getVirtualScanDirection(targetIndex: number): 1 | -1 {
  const centeredIndex = getCenteredVisibleConversationIndex();

  if (centeredIndex !== -1 && targetIndex < centeredIndex) {
    return -1;
  }

  return 1;
}

/**
 * Returns the mapped conversation index closest to the viewport center.
 * @returns {number}
 */
function getCenteredVisibleConversationIndex(): number {
  const messages = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
  );

  if (messages.length === 0) return -1;

  const viewportCenter = window.innerHeight / 2;
  const indexedMessages = messages
    .map((element) => {
      const index = findConversationIndexByElement(element);
      const rect = element.getBoundingClientRect();
      const center = rect.top + rect.height / 2;

      return {
        index,
        distance: Math.abs(center - viewportCenter),
      };
    })
    .filter((item) => item.index !== -1)
    .sort((a, b) => a.distance - b.distance);

  return indexedMessages[0]?.index ?? -1;
}

/**
 * Repeatedly advances the scroll container until the target prompt is rendered.
 * @param {string} text
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {1 | -1} options.direction
 * @param {number} options.step
 * @param {number} options.attempts
 * @param {number} options.token
 */
function scanForRenderedMessage(
  text: string,
  options: VirtualScanOptions
): void {
  if (options.token !== virtualScanToken) {
    debugJump('virtual-scan:stale-token', {
      token: options.token,
      activeToken: virtualScanToken,
    });
    return;
  }

  if (
    jumpToUserMessageByText(text, {
      behavior: 'auto',
      block: 'center',
    })
  ) {
    debugJump('virtual-scan:target-found', {
      attemptsRemaining: options.attempts,
      scrollTop: options.container.scrollTop,
    });
    return;
  }

  if (options.attempts <= 0) {
    debugJump('virtual-scan:max-attempts', {
      scrollTop: options.container.scrollTop,
    });
    return;
  }

  const currentTop = options.container.scrollTop;
  const maxTop = Math.max(
    0,
    options.container.scrollHeight - options.container.clientHeight
  );
  const nextTop =
    options.direction === 1
      ? Math.min(currentTop + options.step, maxTop)
      : Math.max(currentTop - options.step, 0);

  debugJump('virtual-scan:step', {
    attemptsRemaining: options.attempts,
    direction: options.direction,
    currentTop,
    nextTop,
    maxTop,
    scrollHeight: options.container.scrollHeight,
    clientHeight: options.container.clientHeight,
  });

  if (Math.abs(nextTop - currentTop) < 1) {
    debugJump('virtual-scan:edge-reached', {
      currentTop,
      nextTop,
      maxTop,
      direction: options.direction,
    });
    return;
  }

  options.container.scrollTo({
    top: nextTop,
    behavior: 'auto',
  });

  setTimeout(() => {
    scanForRenderedMessage(text, {
      ...options,
      attempts: options.attempts - 1,
    });
  }, 90);
}

/**
 * Retries matching rendered text after a direct edge or estimated jump.
 * @param {string} text
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {number} options.token
 * @param {number} options.attempts
 * @param {number} options.delay
 */
function retryFindRenderedMessage(
  text: string,
  options: RetryFindOptions
): void {
  if (options.token !== virtualScanToken) return;

  if (
    jumpToUserMessageByText(text, {
      behavior: 'auto',
      block: 'center',
    })
  ) {
    debugJump('virtual-scan:target-found-after-jump', {
      attemptsRemaining: options.attempts,
      scrollTop: options.container.scrollTop,
    });
    return;
  }

  if (options.attempts <= 0) {
    debugJump('virtual-scan:retry-miss', {
      scrollTop: options.container.scrollTop,
    });
    return;
  }

  setTimeout(() => {
    retryFindRenderedMessage(text, {
      ...options,
      attempts: options.attempts - 1,
    });
  }, options.delay);
}

/**
 * Returns a compact element label for debug output.
 * @param {HTMLElement} element
 * @returns {string}
 */
function getDebugElementLabel(element: HTMLElement): string {
  const id = element.id ? `#${element.id}` : '';
  const className =
    typeof element.className === 'string'
      ? `.${element.className.trim().replace(/\s+/g, '.')}`
      : '';

  return `${element.tagName.toLowerCase()}${id}${className}`;
}

/**
 * Retries highlighting after ChatGPT's built-in prompt navigator scrolls.
 * Pure text prompts can be matched by DOM text; prompts with files/images fall
 * back to the user message closest to the viewport center after the scroll.
 * @param {Object} message
 * @param {number} index
 * @param {HTMLElement | null} startElement
 * @param {number} attempts
 */
function retryHighlightJumpTarget(
  message: NavigatorMessage,
  index: number,
  startElement: HTMLElement | null = null,
  attempts = message.canMatchByText ? 28 : 14
): void {
  if (
    message.canMatchByText &&
    highlightVisibleUserMessageByText(message.text)
  ) {
    return;
  }

  if (
    !message.canMatchByText &&
    highlightNonTextJumpTarget(index, startElement, attempts)
  ) {
    return;
  }

  if (attempts <= 1) return;

  setTimeout(
    () => {
      retryHighlightJumpTarget(message, index, startElement, attempts - 1);
    },
    message.canMatchByText ? 150 : 250
  );
}

/**
 * Captures the current center message before a non-text prompt jump starts so
 * retry logic can avoid highlighting the old scroll position.
 * @param {Object} message
 * @returns {HTMLElement | null}
 */
function getNonTextJumpStartElement(
  message: NavigatorMessage
): HTMLElement | null {
  return message.canMatchByText ? null : getCenteredVisibleUserMessage();
}

/**
 * Highlights the non-text jump target without scrolling. ChatGPT's built-in
 * prompt navigator owns the actual scroll for file/image prompts.
 * @param {number} index
 * @param {HTMLElement | null} startElement
 * @param {number} attempts
 * @returns {boolean}
 */
function highlightNonTextJumpTarget(
  index: number,
  startElement: HTMLElement | null,
  attempts: number
): boolean {
  const message = getCenteredVisibleUserMessage();

  if (!message) return false;

  const isRepeatClick =
    index === lastNonTextHighlightIndex &&
    message === lastNonTextHighlightElement;
  const shouldWaitForScroll = attempts > 1 && !isRepeatClick;

  if (shouldWaitForScroll && message === startElement) {
    return false;
  }

  highlightMatchedElement(message);
  lastNonTextHighlightIndex = index;
  lastNonTextHighlightElement = message;
  return true;
}

/**
 * Returns the visible user message whose center is closest to the viewport
 * center, or null if no user message is currently rendered.
 * @returns {HTMLElement | null}
 */
function getCenteredVisibleUserMessage(): HTMLElement | null {
  const messages = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]')
  );

  if (messages.length === 0) return null;

  const viewportCenter = window.innerHeight / 2;
  return messages
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const center = rect.top + rect.height / 2;

      return {
        element,
        distance: Math.abs(center - viewportCenter),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.element;
}

/**
 * Scroll the ChatGPT chat feed to the absolute top or bottom.
 * @param {'top' | 'bottom'} edge
 * @param {'smooth' | 'auto'} [behavior='auto']
 */
export function jumpToAbsoluteEdge(
  edge: 'top' | 'bottom',
  behavior: ScrollBehavior = 'auto'
): void {
  keepFollowing();

  const container = getChatGptScrollContainer();
  if (container) {
    const targetTop = edge === 'top' ? 0 : container.scrollHeight;
    container.scrollTo({
      top: targetTop,
      behavior,
    });

    // Override any pending smooth scrolls from click events
    if (behavior === 'auto') {
      setTimeout(() => {
        container.scrollTo({ top: targetTop, behavior: 'auto' });
      }, 50);
      setTimeout(() => {
        container.scrollTo({ top: targetTop, behavior: 'auto' });
      }, 100);
    }
  }
}
