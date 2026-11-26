/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import {
  cancelActiveEdgeJump,
  executeAbsoluteEdgeJump,
  isPageAtBottom,
} from './edgeNavigation';
import { clearPromptHighlightOverlay } from './promptHighlightOverlay';
import {
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from './jumpDiagnostics';
import { coordinatePromptJump } from './prompt/promptCoordinator';
import {
  applyTargetLandingAlignment,
  findRenderedPrompt,
  getScrollContainer,
  highlightMatchedElement,
} from './prompt/promptLanding';
import type { DisconnectRecoveryContext } from './prompt/promptRecovery';
import { runPostLandingStabilization } from './prompt/promptStabilization';
import {
  alignElementInContainer,
  computePromptLandingOffset,
  measureAlignmentErrorPx,
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

/**
 * Delegates independent virtual prompt jump orchestration to `promptCoordinator`
 * while preserving live facade hooks and `navigationJumpVersion` cancellation.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number,
  options: JumpMessageOptions = {}
): void {
  const jumpVersion = navigationJumpVersion;
  coordinatePromptJump({
    message,
    index,
    mode: options.mode ?? 'target-driven',
    alignToTopEdge: options.alignToTopEdge,
    hooks: {
      getVirtualSearchContext: () => getVirtualSearchContext(),
      isCancelled: () => jumpVersion !== navigationJumpVersion,
      onTargetDrivenStart: (targetIndex) => {
        if (onJumpStart) {
          onJumpStart(targetIndex);
        } else {
          setJumpProgress?.({
            active: true,
            targetIndex,
            remainingSteps: 50,
          });
        }
      },
      onMissingContextFailure: (targetIndex) => {
        if (onJumpFailed) {
          onJumpFailed(targetIndex);
        } else {
          clearJumpProgress?.();
        }
      },
      onMountFailure: (targetIndex) => {
        if (onJumpFailed) {
          onJumpFailed(targetIndex);
        } else {
          notifyJumpFailed?.();
          clearJumpProgress?.();
        }
      },
      clearJumpProgress: () => clearJumpProgress?.(),
      onJumpComplete: (targetIndex) => onJumpComplete?.(targetIndex),
      onTargetReady: (handoff) => {
        finishIndependentVirtualJump(
          handoff.target,
          handoff.message,
          handoff.index,
          handoff.jumpId,
          { mode: handoff.mode, alignToTopEdge: handoff.alignToTopEdge },
          jumpVersion,
          handoff.recovery,
          handoff.initialScrollTopPx
        );
      },
    },
  });
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

  const disposeDeferredRepoll = activeStabilizationCleanup;
  let repollDisposed = false;
  const disposeSession = (): void => {
    if (repollDisposed) return;
    repollDisposed = true;
    disposeDeferredRepoll?.();
  };

  if (isCancelled()) {
    disposeSession();
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Owned by `deferredRepollSession.lifecycle.cancelRepollTimer` so
  // cancellation or supersession clears the timer immediately.
  const repollTimerId = setTimeout(() => {
    deferredRepollSession.lifecycle.cancelRepollTimer = null;
    try {
      if (isCancelled()) return;
      const latest = findRenderedPrompt(message.id);
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
            disposeSession();
            onJumpFailed?.(index);
          }
          return;
        }

        if (isCancelled()) return;

        keepFollowing(1800);
        const container = getScrollContainer();

        logNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'found-after-repoll',
          strategy: deferredRepollSession.recovery.activeStrategy,
          realignAttempts: deferredRepollSession.stabilization.realignAttempts,
          recoveryAttempts: deferredRepollSession.recovery.attemptsUsed,
          alignmentErrorPx: measureAlignmentErrorPx(latest, container),
          clamped: deferredRepollSession.alignment.lastAlignClamped,
        });

        disposeSession();
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
        disposeSession();
        onJumpFailed?.(index);
      }
    } finally {
      disposeSession();
    }
  }, 600);

  deferredRepollSession.lifecycle.cancelRepollTimer = () => {
    clearTimeout(repollTimerId);
  };
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