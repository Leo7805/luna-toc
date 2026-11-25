/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import { executeViewportWalkerStrategy } from './strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from './strategies/virtualLayoutStrategy';
import type { JumpStrategyContext } from './strategies/types';
import {
  cancelActiveEdgeJump,
  executeAbsoluteEdgeJump,
  isPageAtBottom,
} from './edgeNavigation';
import {
  clearPromptHighlightOverlay,
  highlightPromptElement,
} from './promptHighlightOverlay';
import {
  createNavigationJumpId,
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from './jumpDiagnostics';
import { applyTargetLandingAlignment } from './prompt/promptLanding';
import type {
  DisconnectRecoveryContext,
  MountTargetOptions,
  MountTargetOutcome,
} from './prompt/promptRecovery';
import {
  getMonotonicNowMs,
  LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX,
  runPostLandingStabilization,
} from './prompt/promptStabilization';
import {
  alignElementInContainer,
  computePromptLandingOffset,
  measureAlignmentErrorPx,
  SUBPIXEL_TOLERANCE_PX,
  type AlignElementResult,
  type PromptLandingOffsetInput,
  type PromptLandingOffsetResult,
} from './promptAlignment';

export {
  alignElementInContainer,
  computePromptLandingOffset,
  type AlignElementResult,
  type PromptLandingOffsetInput,
  type PromptLandingOffsetResult,
};

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

export interface JumpMessageOptions {
  mode?: 'target-driven' | 'viewport-driven';
  alignToTopEdge?: boolean;
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
let activeStabilizationCleanup: (() => void) | null = null;

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
 * Displays a temporary independent highlight overlay over a rendered prompt element.
 */
function highlightMatchedElement(
  element: HTMLElement,
  messageId?: string
): void {
  highlightPromptElement(
    element,
    getChatGptScrollContainer,
    undefined,
    messageId ? () => findRenderedChatGptPrompt(messageId) : undefined
  );
}

/**
 * Jumps to a prompt using independent virtual navigation.
 *
 * @param message Target message representation.
 * @param index 0-indexed position in the conversation.
 * @param options Execution mode configuration.
 */
export function jumpToMessage(
  message: NavigatorMessage,
  index: number,
  options: JumpMessageOptions = {}
): void {
  clearPromptHighlightOverlay();
  cancelActiveNavigationSearch();
  jumpWithIndependentVirtualNavigation(message, index, options);
}

const MAX_DISCONNECT_RECOVERIES = 2;
const BOTTOM_FIRST_POLL_MS = 40;
const BOTTOM_FIRST_QUIET_MS = 120;
const BOTTOM_FIRST_MAX_WAIT_MS = 1200;

/**
 * Waits (bounded and cancellable) after a native `scrollToBottom()` call until
 * the scroll container reaches the bottom and its `scrollHeight` stabilizes
 * briefly, then calls `holdViewport()` so subsequent alignment of the last
 * prompt does not fight native bottom-follow.
 *
 * Returns `'cancelled'` if superseded or interrupted by user scroll, or
 * `'settled'` once the bottom phase completes or its bounded budget expires.
 */
async function waitForNativeBottomSettle(
  container: HTMLElement,
  isCancelled: () => boolean
): Promise<'settled' | 'cancelled'> {
  if (isCancelled() || !container.isConnected) return 'cancelled';

  let userInterrupted = false;
  const markUserInterrupted = (): void => {
    userInterrupted = true;
  };
  const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
  container.addEventListener('wheel', markUserInterrupted, passiveOpts);
  container.addEventListener('touchstart', markUserInterrupted, passiveOpts);
  container.addEventListener('pointerdown', markUserInterrupted, passiveOpts);

  const startedAt = getMonotonicNowMs();
  let lastObservedHeight = container.scrollHeight;
  let quietAtBottomSince: number | null = null;

  try {
    while (getMonotonicNowMs() - startedAt < BOTTOM_FIRST_MAX_WAIT_MS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, BOTTOM_FIRST_POLL_MS);
      });

      if (isCancelled() || userInterrupted || !container.isConnected) {
        return 'cancelled';
      }

      const now = getMonotonicNowMs();
      const currentHeight = container.scrollHeight;
      const distFromBottom = Math.max(
        0,
        currentHeight - container.scrollTop - container.clientHeight
      );

      if (
        Math.abs(currentHeight - lastObservedHeight) >
        LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX
      ) {
        lastObservedHeight = currentHeight;
        quietAtBottomSince = null;
      } else if (distFromBottom <= SUBPIXEL_TOLERANCE_PX) {
        if (quietAtBottomSince === null) {
          quietAtBottomSince = now;
        }
        if (now - quietAtBottomSince >= BOTTOM_FIRST_QUIET_MS) {
          break;
        }
      } else {
        quietAtBottomSince = null;
      }
    }
  } finally {
    container.removeEventListener('wheel', markUserInterrupted, passiveOpts);
    container.removeEventListener('touchstart', markUserInterrupted, passiveOpts);
    container.removeEventListener('pointerdown', markUserInterrupted, passiveOpts);
  }

  if (isCancelled() || userInterrupted || !container.isConnected) {
    return 'cancelled';
  }

  platform().navigation.holdViewport?.(container);
  return 'settled';
}

/**
 * Mounts an unmounted target prompt by trying the virtual-layout strategy
 * first and falling back to the viewport walker when unsupported, on
 * capability failure, or when `skipVirtualLayout` is requested during
 * disconnect recovery to avoid repeating a collapsing direct leap.
 */
async function mountTargetViaStrategy(
  strategyContext: JumpStrategyContext,
  options: MountTargetOptions = {}
): Promise<MountTargetOutcome> {
  if (strategyContext.isCancelled()) {
    return { status: 'cancelled' };
  }

  if (options.skipVirtualLayout) {
    const loaded = await executeViewportWalkerStrategy(strategyContext);
    if (strategyContext.isCancelled()) {
      return { status: 'cancelled' };
    }
    return loaded
      ? { status: 'mounted', element: loaded, strategy: 'viewport-walker' }
      : { status: 'failed', reason: 'step-2-exhausted', strategy: 'viewport-walker' };
  }

  const virtualAttempt = tryVirtualLayoutStrategy(strategyContext);

  if (virtualAttempt.mode === 'unsupported') {
    const loaded = await executeViewportWalkerStrategy(strategyContext);
    if (strategyContext.isCancelled()) {
      return { status: 'cancelled' };
    }
    return loaded
      ? { status: 'mounted', element: loaded, strategy: 'viewport-walker' }
      : { status: 'failed', reason: 'step-2-exhausted', strategy: 'viewport-walker' };
  }

  const outcome = await virtualAttempt.promise;
  if (strategyContext.isCancelled() || outcome.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  if (outcome.status === 'mounted') {
    return {
      status: 'mounted',
      element: outcome.element,
      strategy: 'virtual-layout',
      virtualTopOffsetPx: outcome.topOffsetPx,
    };
  }
  if (
    outcome.status === 'capability-failure' ||
    (outcome.status === 'exhausted' && outcome.reason === 'target-mount-timeout')
  ) {
    const loaded = await executeViewportWalkerStrategy(strategyContext);
    if (strategyContext.isCancelled()) {
      return { status: 'cancelled' };
    }
    return loaded
      ? { status: 'mounted', element: loaded, strategy: 'viewport-walker' }
      : { status: 'failed', reason: 'step-2-exhausted', strategy: 'viewport-walker' };
  }

  return { status: 'failed', reason: 'virtual-exhausted', strategy: 'virtual-layout' };
}

function normalizePromptTextForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Returns true only when `message.text` is non-empty and does not collide
 * (exact or prefix match) with any other prompt in the conversation.
 * Prevents text fallback from jumping to a different prompt with identical text.
 */
function isUniquePromptTextInConversation(
  prompts: ReadonlyArray<NavigatorMessage>,
  message: NavigatorMessage
): boolean {
  const needle = normalizePromptTextForMatch(message.text || '');
  if (!needle) return false;

  for (const other of prompts) {
    if (other.id === message.id) continue;
    const otherNorm = normalizePromptTextForMatch(other.text || '');
    if (!otherNorm) continue;
    if (otherNorm === needle || otherNorm.startsWith(needle) || needle.startsWith(otherNorm)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when `element` exposes a stable message ID that conflicts with
 * `expectedId`, ensuring text fallback never selects a DOM node belonging to
 * a different message.
 */
function hasConflictingElementMessageId(
  element: HTMLElement,
  expectedId: string
): boolean {
  if (!expectedId) return false;
  const raw =
    platform().navigation.getMessageIdFromElement?.(element) ||
    element.getAttribute('data-chatgpt-search-message-ids') ||
    element.getAttribute('data-message-id') ||
    null;
  if (!raw) return false;
  const tokens = raw.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return !tokens.includes(expectedId);
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number,
  options: JumpMessageOptions = {}
): void {
  const mode = options.mode ?? 'target-driven';
  const jumpId = createNavigationJumpId();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  const initialScrollTopPx = container ? container.scrollTop : null;
  const holdResult = container
    ? platform().navigation.holdViewport?.(container)
    : undefined;

  logNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
    ...(holdResult ? { holdViewportStatus: holdResult.status } : {}),
  });

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
  keepFollowing(15_000);
  if (mode === 'target-driven') {
    if (onJumpStart) {
      onJumpStart(index);
    } else {
      setJumpProgress?.({
        active: true,
        targetIndex: index,
        remainingSteps: 50,
      });
    }
  }

  if (!container || !context.conversationKey) {
    if (mode === 'target-driven') {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: 'missing-context',
        strategy: 'none',
        recoveryAttempts: 0,
        container,
      });
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        clearJumpProgress?.();
      }
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  // Fast path: if the target prompt is already mounted anywhere in the
  // DOM (id match exact, text match as fallback for id-string mismatches),
  // align directly and verify post-landing stability via the shared loop.
  const jumpVersion = navigationJumpVersion;
  const createStrategyContext = (): JumpStrategyContext => ({
    targetMessage: message,
    targetIndex: index,
    prompts: context.prompts,
    container: getChatGptScrollContainer() ?? container,
    jumpId,
    isCancelled: () => jumpVersion !== navigationJumpVersion,
  });

  const idHit = findRenderedChatGptPrompt(message.id);
  let textHit: HTMLElement | null = null;
  if (
    !idHit &&
    message.text &&
    isUniquePromptTextInConversation(context.prompts, message)
  ) {
    const candidate = findRenderedChatGptPromptByText(message.text);
    if (candidate && !hasConflictingElementMessageId(candidate, message.id)) {
      textHit = candidate;
    }
  }
  const renderedTarget = idHit ?? textHit;

  if (renderedTarget) {
    logNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    finishIndependentVirtualJump(
      renderedTarget,
      message,
      index,
      jumpId,
      options,
      jumpVersion,
      {
        recoverTarget: (recoveryOpts) =>
          mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
        remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
        initialStrategy: 'fast-path',
      },
      initialScrollTopPx
    );
    return;
  }

  // Unmounted target navigation:
  // For an unmounted LAST prompt, use conditional native bottom-first so ChatGPT's
  // own scroll controller expands the bottom of the virtual list cleanly instead of
  // collapsing scrollHeight on a direct downward leap. Then re-arm holdViewport()
  // and hand off to the standard ID-based Fast Path -> Virtual Layout -> Viewport Walker pipeline.
  const isUnmountedLastPrompt =
    context.prompts.length > 0 && index === context.prompts.length - 1;
  const activeContainerForBottom = getChatGptScrollContainer() ?? container;
  const startedNativeBottomFirst =
    isUnmountedLastPrompt &&
    activeContainerForBottom.isConnected &&
    platform().navigation.scrollToBottom?.(activeContainerForBottom)?.status ===
      'ok';

  void (async () => {
    if (startedNativeBottomFirst) {
      const bottomPhase = await waitForNativeBottomSettle(
        activeContainerForBottom,
        () => jumpVersion !== navigationJumpVersion
      );
      if (jumpVersion !== navigationJumpVersion || bottomPhase === 'cancelled') {
        clearJumpProgress?.();
        return;
      }

      const mountedAfterBottom = findRenderedChatGptPrompt(message.id);
      if (mountedAfterBottom && mountedAfterBottom.isConnected) {
        finishIndependentVirtualJump(
          mountedAfterBottom,
          message,
          index,
          jumpId,
          options,
          jumpVersion,
          {
            recoverTarget: (recoveryOpts) =>
              mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
            remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
            initialStrategy: 'fast-path',
          },
          initialScrollTopPx
        );
        return;
      }
    }

    const mountOutcome = await mountTargetViaStrategy(createStrategyContext());
    if (jumpVersion !== navigationJumpVersion || mountOutcome.status === 'cancelled') {
      return;
    }

    if (mountOutcome.status === 'mounted') {
      finishIndependentVirtualJump(
        mountOutcome.element,
        message,
        index,
        jumpId,
        options,
        jumpVersion,
        {
          recoverTarget: (recoveryOpts) =>
            mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
          remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
          initialStrategy: mountOutcome.strategy,
          initialVirtualTopOffsetPx: mountOutcome.virtualTopOffsetPx,
        },
        initialScrollTopPx
      );
      return;
    }

    logJumpFailedDiagnostic({
      targetIndex: index,
      targetMessageId: message.id,
      reason: mountOutcome.reason,
      strategy: mountOutcome.strategy,
      recoveryAttempts: 0,
    });
    if (mode === 'target-driven') {
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        notifyJumpFailed?.();
        clearJumpProgress?.();
      }
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      attempts: mountOutcome.reason,
    });
  })();
}

/**
 * Completes an independent jump by aligning the target, highlighting it, and
 * verifying post-landing stability against virtual-list layout shifts or
 * unexpected external scroll changes.
 *
 * Shared by Mounted Fast Path, Virtual Layout, and Viewport Walker strategies.
 * Uses a monotonic wall-clock budget (600ms per pass), bounded incremental
 * re-alignment (up to 3 attempts), and bounded disconnect recovery (up to 2
 * attempts) while reusing a single jumpId across all diagnostic events.
 */
function finishIndependentVirtualJump(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number,
  jumpId: string,
  options: JumpMessageOptions = {},
  jumpVersion = navigationJumpVersion,
  recovery?: DisconnectRecoveryContext,
  initialScrollTopPx: number | null = null
): void {
  const isCancelled = (): boolean => jumpVersion !== navigationJumpVersion;
  const deferredRepollSession = runPostLandingStabilization({
    target,
    message,
    index,
    jumpId,
    mode: options.mode ?? 'target-driven',
    alignToTopEdge: options.alignToTopEdge,
    recovery,
    initialScrollTopPx,
    hooks: {
      isCancelled,
      registerCleanup: (cleanup) => {
        activeStabilizationCleanup = cleanup;
      },
      clearCleanupIfActive: (cleanup) => {
        if (activeStabilizationCleanup === cleanup) {
          activeStabilizationCleanup = null;
        }
      },
      onJumpComplete: (targetIndex) => onJumpComplete?.(targetIndex),
      onTargetDrivenFailure: (targetIndex) => {
        if (onJumpFailed) {
          onJumpFailed(targetIndex);
        } else {
          notifyJumpFailed?.();
          clearJumpProgress?.();
        }
      },
      clearJumpProgress: () => clearJumpProgress?.(),
    },
  });

  if (!deferredRepollSession) {
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Retained here temporarily until Phase 5E addresses its timer
  // cleanup ownership.
  setTimeout(() => {
    if (isCancelled()) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      if (!applyTargetLandingAlignment(deferredRepollSession, latest, 'realign')) {
        if (!isCancelled()) {
          logJumpFailedDiagnostic({
            targetIndex: index,
            targetMessageId: message.id,
            reason: 'scroll-failed-after-repoll',
            strategy: deferredRepollSession.recovery.activeStrategy,
            recoveryAttempts: deferredRepollSession.recovery.attemptsUsed,
          });
          onJumpFailed?.(index);
        }
        return;
      }

      if (isCancelled()) return;

      keepFollowing(1800);
      const container = platform().navigation.getScrollContainer();

      logNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'found-after-repoll',
        strategy: deferredRepollSession.recovery.activeStrategy,
        realignAttempts: deferredRepollSession.stabilization.realignAttempts,
        recoveryAttempts: deferredRepollSession.recovery.attemptsUsed,
        alignmentErrorPx: measureAlignmentErrorPx(latest, container),
        clamped: deferredRepollSession.alignment.lastAlignClamped,
      });

      onJumpComplete?.(index);
      return;
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'target-disappeared-after-search',
      strategy: deferredRepollSession.recovery.activeStrategy,
      realignAttempts: deferredRepollSession.stabilization.realignAttempts,
      recoveryAttempts: deferredRepollSession.recovery.attemptsUsed,
    });
    if (!isCancelled()) {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: 'target-disappeared-after-search',
        strategy: deferredRepollSession.recovery.activeStrategy,
        recoveryAttempts: deferredRepollSession.recovery.attemptsUsed,
      });
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
  cancelActiveEdgeJump();
  if (activeStabilizationCleanup) {
    const cleanup = activeStabilizationCleanup;
    activeStabilizationCleanup = null;
    cleanup();
  }
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
  clearPromptHighlightOverlay();
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
    onFirstPromptVisible: (el) =>
      highlightMatchedElement(el, firstPromptId ?? undefined),
  });
}

export { isPageAtBottom };