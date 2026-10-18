/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import { executeViewportWalkerStrategy } from './strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from './strategies/virtualLayoutStrategy';
import type { JumpStrategyContext } from './strategies/types';
import { executeAbsoluteEdgeJump } from './edgeNavigation';

function platform() {
  return getActivePlatform();
}

const findRenderedChatGptPrompt = (
  promptId: string,
  root?: ParentNode
): HTMLElement | null =>
  platform().navigation.findRenderedPrompt(promptId, root);
const findRenderedChatGptPromptByText = (
  text: string,
  root?: ParentNode
): HTMLElement | null =>
  platform().navigation.findRenderedPromptByText?.(text, root) ?? null;
const getChatGptScrollContainer = (root?: ParentNode): HTMLElement | null =>
  platform().navigation.getScrollContainer(root);
const createChatGptNavigationJumpId = (): string =>
  platform().diagnostics.createJumpId();
const logChatGptNavigationEvent = (
  jumpId: string,
  eventName: string,
  details: Record<string, unknown> = {},
  storage?: Storage
): void => platform().diagnostics.logEvent(jumpId, eventName, details, storage);

export interface VirtualSearchContext {
  conversationKey: string;
  prompts: NavigatorMessage[];
}

export interface PromptNavigationOptions {
  getVirtualSearchContext: () => VirtualSearchContext;
  onJumpStart?: (targetIndex: number) => void;
  onJumpComplete?: (targetIndex: number) => void;
  onJumpFailed?: (targetIndex: number) => void;
  setJumpProgress?: (progress: {
    active: boolean;
    targetIndex: number;
    remainingSteps?: number;
  }) => void;
  clearJumpProgress?: () => void;
  notifyJumpFailed?: () => void;
}

let getVirtualSearchContext: () => VirtualSearchContext = () => ({
  conversationKey: '',
  prompts: [],
});
let onJumpStart: ((targetIndex: number) => void) | undefined;
let onJumpComplete: ((targetIndex: number) => void) | undefined;
let onJumpFailed: ((targetIndex: number) => void) | undefined;
let setJumpProgress:
  | ((progress: {
      active: boolean;
      targetIndex: number;
      remainingSteps?: number;
    }) => void)
  | undefined;
let clearJumpProgress: (() => void) | undefined;
let notifyJumpFailed: (() => void) | undefined;
let navigationJumpVersion = 0;

/**
 * Connects jump behavior to navigator state and native TOC helpers.
 *
 * @param options Observer and callback hooks for navigation progress.
 */
export function initializePromptNavigation(
  options: PromptNavigationOptions
): void {
  getVirtualSearchContext = options.getVirtualSearchContext;
  onJumpStart = options.onJumpStart;
  onJumpComplete = options.onJumpComplete;
  onJumpFailed = options.onJumpFailed;
  setJumpProgress = options.setJumpProgress;
  clearJumpProgress = options.clearJumpProgress;
  notifyJumpFailed = options.notifyJumpFailed;
}

/**
 * Jumps to the first or last prompt using absolute edge navigation.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 */
export function jumpToConversationEdge(edge: 'top' | 'bottom'): void {
  cancelActiveNavigationSearch();
  jumpToAbsoluteEdge(edge, 'auto');
}

/**
 * Applies a temporary highlight effect to a rendered prompt element.
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
 * Jumps to a prompt using independent virtual navigation.
 *
 * @param message Target message representation.
 * @param index 0-indexed position in the conversation.
 */
export function jumpToMessage(message: NavigatorMessage, index: number): void {
  cancelActiveNavigationSearch();
  jumpWithIndependentVirtualNavigation(message, index);
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number
): void {
  const jumpId = createChatGptNavigationJumpId();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  logChatGptNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
  });

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
  keepFollowing(15_000);
  if (onJumpStart) {
    onJumpStart(index);
  } else {
    setJumpProgress?.({
      active: true,
      targetIndex: index,
      remainingSteps: 50,
    });
  }

  if (!container || !context.conversationKey) {
    if (onJumpFailed) {
      onJumpFailed(index);
    } else {
      clearJumpProgress?.();
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  // Fast path: if the target prompt is already mounted anywhere in the
  // DOM (id match exact, text match as fallback for id-string mismatches),
  // scroll straight to it.
  const idHit = findRenderedChatGptPrompt(message.id);
  const textHit =
    idHit ??
    (message.text ? findRenderedChatGptPromptByText(message.text) : null);
  const renderedTarget = idHit ?? textHit;

  if (renderedTarget) {
    logChatGptNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    finishIndependentVirtualJump(renderedTarget, message, index);
    return;
  }

  // Unmounted target navigation: try virtual-layout fast jump, then fallback to viewport walker.
  void (async () => {
    const myNavVersion = navigationJumpVersion;
    const strategyContext: JumpStrategyContext = {
      targetMessage: message,
      targetIndex: index,
      prompts: context.prompts,
      container,
      jumpId,
      isCancelled: () => myNavVersion !== navigationJumpVersion,
    };

    let loaded: HTMLElement | null = null;
    const virtualAttempt = tryVirtualLayoutStrategy(strategyContext);

    if (virtualAttempt.mode === 'unsupported') {
      loaded = await executeViewportWalkerStrategy(strategyContext);
    } else {
      const outcome = await virtualAttempt.promise;
      if (myNavVersion !== navigationJumpVersion || outcome.status === 'cancelled') {
        return;
      }
      if (outcome.status === 'mounted') {
        finishIndependentVirtualJump(outcome.element, message, index);
        return;
      }
      if (outcome.status === 'capability-failure') {
        loaded = await executeViewportWalkerStrategy(strategyContext);
      } else {
        if (onJumpFailed) {
          onJumpFailed(index);
        } else {
          clearJumpProgress?.();
          notifyJumpFailed?.();
        }
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'not-found',
          attempts: 'virtual-exhausted',
        });
        return;
      }
    }
    if (myNavVersion !== navigationJumpVersion) {
      return;
    }

    if (loaded) {
      finishIndependentVirtualJump(loaded, message, index);
      return;
    }

    if (onJumpFailed) {
      onJumpFailed(index);
    } else {
      clearJumpProgress?.();
      notifyJumpFailed?.();
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      attempts: 'step-2-exhausted',
    });
  })();
}

/**
 * Completes an independent jump by highlighting the target and waiting for
 * ChatGPT's virtual rendering to settle. Highlights the target as soon
 * as it scrolls into the viewport, with a short fallback in case the
 * settle never triggers a visible change.
 */
function finishIndependentVirtualJump(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number
): void {
  const jumpVersion = ++navigationJumpVersion;
  const targetAttempts = 8;

  // Scroll the target to the top of the chat viewport (with the
  // configured top padding so it doesn't sit flush against the edge),
  // then highlight it.
  const scrollTargetIntoView = function (el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const previousScrollMarginTop = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${platform().navigation.promptTopOffsetPx}px`;

    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    el.style.scrollMarginTop = previousScrollMarginTop;
    highlightMatchedElement(el);
    return true;
  };

  if (scrollTargetIntoView(target)) {
    if (jumpVersion !== navigationJumpVersion) return;

    keepFollowing(1800);

    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'found', attempts: targetAttempts }
    );

    onJumpComplete?.(index);
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Each attempt polls once; bail after the budget.
  setTimeout(() => {
    if (jumpVersion !== navigationJumpVersion) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      if (!scrollTargetIntoView(latest)) {
        if (jumpVersion === navigationJumpVersion) {
          onJumpFailed?.(index);
        }
        return;
      }

      if (jumpVersion !== navigationJumpVersion) return;

      keepFollowing(1800);

      logChatGptNavigationEvent(
        createChatGptNavigationJumpId(),
        'JUMP_FINISHED',
        { status: 'found-after-repoll', attempts: targetAttempts }
      );

      onJumpComplete?.(index);
      return;
    }
    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'target-disappeared-after-search' }
    );
    if (jumpVersion === navigationJumpVersion) {
      onJumpFailed?.(index);
    }
  }, 600);
}

/**
 * Jumps to a prompt by index, with optional high-priority lock to keep
 * LunaTOC's sidebar row pinned while ChatGPT scrolls virtualized content.
 * Lives here because outline navigation uses it for heading-to-heading
 * jumps that don't go through the regular TOC entry path.
 *
 * @param index 0-indexed position in the conversation.
 * @param duration Duration in ms to lock active prompt follow tracking.
 * @returns true if jump fired.
 */
export function jumpToPromptIndex(
  index: number,
  duration: number = 4000
): boolean {
  const context = getVirtualSearchContext();
  const message = context.prompts[index];
  if (!message) return false;
  cancelActiveNavigationSearch();
  keepFollowing(duration);
  jumpWithIndependentVirtualNavigation(message, index);
  return true;
}

/**
 * Cancels active independent and legacy virtual scans before a new jump.
 */
export function cancelActiveNavigationSearch(): void {
  navigationJumpVersion += 1;
}

/**
 * Scroll the ChatGPT chat feed to the absolute top or bottom.
 *
 * Each click re-asserts `scrollTop = -currentMaxScrollTop` against the
 * *current* scrollHeight and waits briefly for ChatGPT's lazy mount to
 * extend the window.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 * @param behavior Optional ScrollBehavior (default 'auto').
 */
export function jumpToAbsoluteEdge(
  edge: 'top' | 'bottom',
  behavior: ScrollBehavior = 'auto'
): void {
  keepFollowing();
  // A new absolute-edge jump supersedes any in-flight independent virtual
  // jump; otherwise the highlight from a previous TOC click would linger.
  cancelActiveNavigationSearch();
  clearJumpProgress?.();

  const navVersionAtStart = navigationJumpVersion;
  const firstPromptId =
    edge === 'top'
      ? getVirtualSearchContext().prompts[0]?.id ?? null
      : null;

  executeAbsoluteEdgeJump(edge, {
    firstPromptId,
    isCancelled: () => navVersionAtStart !== navigationJumpVersion,
    onFirstPromptVisible: highlightMatchedElement,
  });
}