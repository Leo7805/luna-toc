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
  emitAlignmentMeasurement as emitJumpAlignmentMeasurement,
  isNavigationDebugEnabled,
  logJumpFailedDiagnostic,
  logNavigationEvent,
  type AlignmentMeasurementStage,
} from './jumpDiagnostics';
import {
  alignElementInContainer,
  computePromptLandingOffset,
  evaluateElementAlignment,
  measureAlignmentErrorPx,
  resolvePromptLandingOffset,
  SUBPIXEL_TOLERANCE_PX,
  type AlignElementResult,
  type AlignmentEvaluation,
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

type NavigationStrategyName =
  | 'virtual-layout'
  | 'viewport-walker'
  | 'fast-path'
  | 'none';

type MountTargetOutcome =
  | {
      status: 'mounted';
      element: HTMLElement;
      strategy: 'virtual-layout' | 'viewport-walker';
      virtualTopOffsetPx?: number;
    }
  | { status: 'cancelled' }
  | {
      status: 'failed';
      reason: 'virtual-exhausted' | 'step-2-exhausted';
      strategy: 'virtual-layout' | 'viewport-walker';
    };

interface MountTargetOptions {
  skipVirtualLayout?: boolean;
}

interface DisconnectRecoveryContext {
  recoverTarget: (options?: MountTargetOptions) => Promise<MountTargetOutcome>;
  remainingRecoveries: number;
  initialStrategy: NavigationStrategyName;
  initialVirtualTopOffsetPx?: number;
}

const MIN_STABLE_DURATION_MS = 120;
const LAYOUT_SETTLED_QUIET_MS = 350;
const MAX_STABILIZE_DURATION_MS = 1200;
const REALIGN_COOLDOWN_MS = 50;
const MAX_REALIGN_ATTEMPTS = 3;
const REQUIRED_STABLE_FRAMES = 3;
const DISCONNECT_GRACE_FRAMES = 2;
const DISCONNECT_GRACE_MS = 50;
const MAX_DISCONNECT_RECOVERIES = 2;
const FRAME_TIMEOUT_MS = 50;
const EXTERNAL_SCROLL_THRESHOLD_PX = 4;
const LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX = 2;
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

type DisplacementKind =
  | 'none'
  | 'layout-shift'
  | 'external-scroll-suspected'
  | 'user-scroll';

function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
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
  const mode = options.mode ?? 'target-driven';
  let activeStrategy: NavigationStrategyName =
    recovery?.initialStrategy ?? 'fast-path';
  let recoveryAttemptsUsed = 0;
  let realignAttempts = 0;
  let lastAlignClamped = false;
  let lastAppliedScrollTop: number | null = null;
  let lastAppliedDistanceFromBottom: number | null = null;
  let lastObservedScrollHeight: number | null = null;
  let didScrollFar = activeStrategy !== 'fast-path';
  let layoutMutatedDuringPass = false;
  let userInterrupted = false;
  let cancelScheduledFrame: (() => void) | null = null;
  let removeUserInputListeners: (() => void) | null = null;

  const isCancelled = (): boolean => jumpVersion !== navigationJumpVersion;

  const cleanupStabilization = (): void => {
    if (cancelScheduledFrame) {
      const cancel = cancelScheduledFrame;
      cancelScheduledFrame = null;
      cancel();
    }
    if (removeUserInputListeners) {
      const remove = removeUserInputListeners;
      removeUserInputListeners = null;
      remove();
    }
    if (activeStabilizationCleanup === cleanupStabilization) {
      activeStabilizationCleanup = null;
    }
  };
  activeStabilizationCleanup = cleanupStabilization;

  const notifyFailure = (
    status: string,
    displacementKind: DisplacementKind = 'none',
    el: HTMLElement | null = null
  ): void => {
    cleanupStabilization();
    if (isCancelled()) return;
    const container = platform().navigation.getScrollContainer();
    const alignmentErrorPx = measureAlignmentErrorPx(el, container);
    if (el) {
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
      emitAlignmentMeasurement(
        'failed',
        el,
        container,
        containerTop + expectedContainerOffsetPx,
        lastAlignClamped,
        undefined,
        displacementKind
      );
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status,
      strategy: activeStrategy,
      realignAttempts,
      recoveryAttempts: recoveryAttemptsUsed,
      alignmentErrorPx,
      clamped: lastAlignClamped,
      displacementKind,
    });
    logJumpFailedDiagnostic({
      targetIndex: index,
      targetMessageId: message.id,
      reason: status,
      strategy: activeStrategy,
      recoveryAttempts: recoveryAttemptsUsed,
      container,
    });
    if (mode === 'target-driven') {
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        notifyJumpFailed?.();
        clearJumpProgress?.();
      }
    }
  };

  const emitAlignmentMeasurement = (
    stage: AlignmentMeasurementStage,
    el: HTMLElement,
    container: HTMLElement | null,
    expectedViewportTopPx: number,
    clamped: boolean,
    method?: AlignElementResult['method'],
    displacementKind?: DisplacementKind
  ): void => {
    emitJumpAlignmentMeasurement({
      jumpId,
      stage,
      targetMessageId: message.id,
      targetIndex: index,
      strategy: activeStrategy,
      element: el,
      container,
      expectedViewportTopPx,
      clamped,
      method,
      displacementKind,
    });
  };

  // Scroll the target to the computed landing coordinate inside the active
  // scroll container, emit debug-only alignment measurements if enabled,
  // then highlight it.
  const scrollTargetIntoView = function (
    el: HTMLElement,
    stage: 'after-align' | 'realign' = 'after-align'
  ): AlignElementResult | null {
    if (isCancelled() || !el.isConnected) return null;
    const container = platform().navigation.getScrollContainer();
    const debugEnabled = isNavigationDebugEnabled();

    if (debugEnabled && stage === 'after-align') {
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
      emitAlignmentMeasurement(
        'before-align',
        el,
        container,
        containerTop + expectedContainerOffsetPx,
        false
      );
    }

    // Re-arm viewport hold before post-mount alignment and realignment writes
    // because coarse virtual jumps or height collapses can briefly touch
    // distanceFromBottom=0 and re-enable ChatGPT's native bottom compensation.
    if (
      container &&
      container.isConnected &&
      (stage === 'realign' || activeStrategy !== 'fast-path')
    ) {
      platform().navigation.holdViewport?.(container);
    }

    const scrollTopBefore =
      container && container.isConnected ? container.scrollTop : null;
    const alignResult = alignElementInContainer(el, container);
    lastAlignClamped = alignResult.clamped;
    if (container && container.isConnected) {
      lastAppliedScrollTop = container.scrollTop;
      lastObservedScrollHeight = container.scrollHeight;
      lastAppliedDistanceFromBottom = Math.max(
        0,
        container.scrollHeight - container.scrollTop - container.clientHeight
      );
      const baselineScrollTop =
        initialScrollTopPx !== null ? initialScrollTopPx : scrollTopBefore;
      if (
        stage === 'after-align' &&
        baselineScrollTop !== null &&
        container.clientHeight > 0 &&
        Math.abs(container.scrollTop - baselineScrollTop) > container.clientHeight
      ) {
        didScrollFar = true;
      }
    }

    if (debugEnabled) {
      emitAlignmentMeasurement(
        stage,
        el,
        container,
        alignResult.expectedViewportTopPx,
        alignResult.clamped,
        alignResult.method
      );
      if (stage === 'after-align' && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (isCancelled()) return;
          const resolved = findRenderedChatGptPrompt(message.id);
          const liveEl =
            resolved && resolved.isConnected ? resolved : el;
          const liveContainer = platform().navigation.getScrollContainer();
          emitAlignmentMeasurement(
            'next-frame',
            liveEl,
            liveContainer,
            alignResult.expectedViewportTopPx,
            alignResult.clamped,
            alignResult.method
          );
        });
      }
    }

    if (stage === 'after-align') {
      highlightMatchedElement(el, message.id);
    }
    return alignResult;
  };

  const scheduleFrame = (callback: () => void): (() => void) => {
    let settled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const run = () => {
      if (settled) return;
      cleanup();
      if (isCancelled()) return;
      callback();
    };

    let inSchedule = true;
    timerId = setTimeout(run, FRAME_TIMEOUT_MS);
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        if (inSchedule) return;
        run();
      });
    }
    inSchedule = false;

    return cleanup;
  };

  const performFinalTopScroll = () => {
    if (!options.alignToTopEdge) return;
    if (isCancelled()) return;
    const scrollContainer = platform().navigation.getScrollContainer();
    if (!scrollContainer || !scrollContainer.isConnected) return;

    const targetElement = findRenderedChatGptPrompt(message.id);
    if (!targetElement || !targetElement.isConnected) return;

    scrollContainer.scrollTo({ top: 0, behavior: 'auto' });

    scheduleFrame(() => {
      if (isCancelled()) return;
      if (!scrollContainer.isConnected) return;

      const verifiedPrompt = findRenderedChatGptPrompt(message.id);
      if (!verifiedPrompt || !verifiedPrompt.isConnected) return;

      if (scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      }
      highlightMatchedElement(verifiedPrompt, message.id);
    });
  };

  const attachUserInputListeners = (): void => {
    if (removeUserInputListeners || typeof window === 'undefined') return;
    const container = platform().navigation.getScrollContainer();
    const markUserInterrupted = (): void => {
      userInterrupted = true;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        userInterrupted = true;
      }
    };
    const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
    const eventTarget: EventTarget = container ?? window;
    eventTarget.addEventListener('wheel', markUserInterrupted, passiveOpts);
    eventTarget.addEventListener('touchstart', markUserInterrupted, passiveOpts);
    eventTarget.addEventListener('pointerdown', markUserInterrupted, passiveOpts);
    window.addEventListener('keydown', onKeyDown, true);

    removeUserInputListeners = () => {
      eventTarget.removeEventListener('wheel', markUserInterrupted, passiveOpts);
      eventTarget.removeEventListener('touchstart', markUserInterrupted, passiveOpts);
      eventTarget.removeEventListener('pointerdown', markUserInterrupted, passiveOpts);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  };

  const classifyDisplacement = (
    container: HTMLElement | null,
    scrollHeightChanged: boolean
  ): DisplacementKind => {
    if (userInterrupted) return 'user-scroll';
    if (container && lastAppliedScrollTop !== null) {
      if (scrollHeightChanged) {
        const currentDistFromBottom = Math.max(
          0,
          container.scrollHeight - container.scrollTop - container.clientHeight
        );
        // Only classify as an external bottom-snap when scrollTop actively
        // jumped downward toward the bottom. If scrollHeight shrank and
        // clamped scrollTop (scrollTop <= lastAppliedScrollTop), it is a
        // layout-induced clamp that should be realigned.
        const isDownwardSnapToBottom =
          currentDistFromBottom <= 2 &&
          lastAppliedDistanceFromBottom !== null &&
          lastAppliedDistanceFromBottom > 24 &&
          container.scrollTop > lastAppliedScrollTop + EXTERNAL_SCROLL_THRESHOLD_PX;
        if (isDownwardSnapToBottom) {
          return 'external-scroll-suspected';
        }
        return 'layout-shift';
      }
      const scrollTopDrift = Math.abs(container.scrollTop - lastAppliedScrollTop);
      if (scrollTopDrift > EXTERNAL_SCROLL_THRESHOLD_PX) {
        return 'external-scroll-suspected';
      }
    }
    return 'layout-shift';
  };

  const initialAlignResult = scrollTargetIntoView(target, 'after-align');
  if (initialAlignResult) {
    if (isCancelled()) {
      cleanupStabilization();
      return;
    }

    keepFollowing(1800);
    attachUserInputListeners();

    // Shared post-landing stabilization loop for Mounted Fast Path, Virtual
    // Layout, and Viewport Walker: verifies alignment stability against
    // virtual-list layout shifts and unexpected external scroll changes using
    // a monotonic wall-clock budget (600ms per pass) and bounded disconnect
    // recovery (up to 2 attempts).
    let activeTarget: HTMLElement | null = target;
    let remainingRecoveries = recovery?.remainingRecoveries ?? 0;
    let isRecovering = false;
    let stabilizeStartedAt = getMonotonicNowMs();
    let lastRealignAt: number | null = null;
    let consecutiveAlignedFrames = 0;
    let stableSince: number | null = null;
    let lastAlignedViewportTopPx: number | null = null;
    let consecutiveDisconnectedFrames = 0;
    let disconnectedSince: number | null = null;
    let lastRecoveryVirtualOffsetPx: number | null =
      recovery?.initialVirtualTopOffsetPx ?? null;
    let lastVirtualOffsetShifted = false;

    const resetStabilizationPass = (nextTarget: HTMLElement): void => {
      activeTarget = nextTarget;
      stabilizeStartedAt = getMonotonicNowMs();
      realignAttempts = 0;
      lastRealignAt = null;
      consecutiveAlignedFrames = 0;
      stableSince = null;
      lastAlignedViewportTopPx = null;
      consecutiveDisconnectedFrames = 0;
      disconnectedSince = null;
      layoutMutatedDuringPass = false;
    };

    const scheduleStabilizeStep = (): void => {
      cancelScheduledFrame = scheduleFrame(() => {
        cancelScheduledFrame = null;
        stabilizeStep();
      });
    };

    const runDisconnectRecovery = async (): Promise<void> => {
      if (isRecovering || isCancelled() || !recovery || remainingRecoveries <= 0) {
        return;
      }
      isRecovering = true;
      remainingRecoveries -= 1;
      recoveryAttemptsUsed += 1;

      const recoveryAttempt = recoveryAttemptsUsed;
      logNavigationEvent(jumpId, 'JUMP_DISCONNECT_RECOVERY_START', {
        targetPromptIndex: index,
        recoveryAttempt,
      });

      // Progress-aware recovery strategy selection:
      // Switch to Viewport Walker when a direct virtual-layout leap collapsed
      // scrollHeight (clamped scrollTop), OR on a repeated recovery when the
      // prior virtual-layout recovery did not shift topOffsetPx meaningfully
      // (repeating the same static coordinate). When topOffsetPx is still
      // converging during cold-start measurement, stay on virtual-layout
      // instead of forcing a viewport walk that fights host scroll compensation.
      const skipVirtualLayout =
        activeStrategy === 'virtual-layout' &&
        (lastAlignClamped || (recoveryAttempt >= 2 && !lastVirtualOffsetShifted));

      let outcome: MountTargetOutcome;
      try {
        outcome = await recovery.recoverTarget({ skipVirtualLayout });
      } catch {
        outcome = {
          status: 'failed',
          reason: skipVirtualLayout ? 'step-2-exhausted' : 'virtual-exhausted',
          strategy: skipVirtualLayout ? 'viewport-walker' : 'virtual-layout',
        };
      } finally {
        isRecovering = false;
      }

      if (isCancelled() || outcome.status === 'cancelled') {
        cleanupStabilization();
        return;
      }

      activeStrategy = outcome.strategy;

      if (outcome.status === 'mounted' && outcome.element.isConnected) {
        if (
          outcome.strategy === 'virtual-layout' &&
          typeof outcome.virtualTopOffsetPx === 'number' &&
          Number.isFinite(outcome.virtualTopOffsetPx)
        ) {
          lastVirtualOffsetShifted =
            lastRecoveryVirtualOffsetPx !== null &&
            Math.abs(outcome.virtualTopOffsetPx - lastRecoveryVirtualOffsetPx) > 4;
          lastRecoveryVirtualOffsetPx = outcome.virtualTopOffsetPx;
        } else {
          lastVirtualOffsetShifted = false;
        }
        resetStabilizationPass(outcome.element);
        if (scrollTargetIntoView(outcome.element, 'realign')) {
          if (isCancelled()) {
            cleanupStabilization();
            return;
          }
          keepFollowing(1800);
          scheduleStabilizeStep();
          return;
        }
      }

      notifyFailure('target-disconnected');
    };

    const stabilizeStep = () => {
      if (isCancelled() || isRecovering) return;

      if (userInterrupted) {
        cleanupStabilization();
        logNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'cancelled-by-user',
          strategy: activeStrategy,
          realignAttempts,
          recoveryAttempts: recoveryAttemptsUsed,
          displacementKind: 'user-scroll',
        });
        clearJumpProgress?.();
        return;
      }

      const now = getMonotonicNowMs();
      const elapsedPassMs = now - stabilizeStartedAt;
      const container = platform().navigation.getScrollContainer();

      const scrollHeightChanged = Boolean(
        container &&
          container.isConnected &&
          lastObservedScrollHeight !== null &&
          Math.abs(container.scrollHeight - lastObservedScrollHeight) >
            LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX
      );
      if (scrollHeightChanged && container) {
        layoutMutatedDuringPass = true;
        lastObservedScrollHeight = container.scrollHeight;
      }

      // Re-resolve by stable message ID; never reuse a disconnected node as connected.
      const resolvedById = findRenderedChatGptPrompt(message.id);
      let liveTarget: HTMLElement | null = null;
      if (resolvedById && resolvedById.isConnected) {
        if (resolvedById !== activeTarget) {
          activeTarget = resolvedById;
          highlightMatchedElement(resolvedById, message.id);
        }
        liveTarget = resolvedById;
      } else if (activeTarget && activeTarget.isConnected) {
        liveTarget = activeTarget;
      } else {
        activeTarget = null;
      }

      const evalResult: AlignmentEvaluation = liveTarget
        ? evaluateElementAlignment(liveTarget)
        : 'disconnected';

      if (evalResult === 'disconnected') {
        stableSince = null;
        consecutiveAlignedFrames = 0;
        lastAlignedViewportTopPx = null;
        if (disconnectedSince === null) {
          disconnectedSince = now;
        }
        consecutiveDisconnectedFrames += 1;

        const graceElapsed =
          consecutiveDisconnectedFrames >= DISCONNECT_GRACE_FRAMES &&
          now - disconnectedSince >= DISCONNECT_GRACE_MS;

        if (graceElapsed) {
          if (recovery && remainingRecoveries > 0) {
            void runDisconnectRecovery();
            return;
          }
          notifyFailure('target-disconnected');
          return;
        }

        if (elapsedPassMs < MAX_STABILIZE_DURATION_MS) {
          scheduleStabilizeStep();
          return;
        }

        notifyFailure('target-disconnected');
        return;
      }

      disconnectedSince = null;
      consecutiveDisconnectedFrames = 0;

      if (evalResult === 'correctable' && liveTarget) {
        stableSince = null;
        consecutiveAlignedFrames = 0;
        lastAlignedViewportTopPx = null;

        const displacementKind = classifyDisplacement(container, scrollHeightChanged);
        if (displacementKind === 'external-scroll-suspected') {
          notifyFailure(
            'external-scroll-suspected',
            'external-scroll-suspected',
            liveTarget
          );
          return;
        }

        const cooldownElapsed =
          lastRealignAt === null || now - lastRealignAt >= REALIGN_COOLDOWN_MS;
        const withinPassBudget = elapsedPassMs < MAX_STABILIZE_DURATION_MS;

        if (realignAttempts < MAX_REALIGN_ATTEMPTS && withinPassBudget) {
          if (cooldownElapsed) {
            realignAttempts += 1;
            lastRealignAt = now;
            scrollTargetIntoView(liveTarget, 'realign');
          }
          scheduleStabilizeStep();
          return;
        }

        if (
          withinPassBudget &&
          lastRealignAt !== null &&
          now - lastRealignAt < REALIGN_COOLDOWN_MS
        ) {
          scheduleStabilizeStep();
          return;
        }

        performFinalTopScroll();
        notifyFailure('alignment-unstable', displacementKind, liveTarget);
        return;
      }

      // evalResult is 'aligned' or 'bounded'
      if (container && container.isConnected) {
        lastAppliedScrollTop = container.scrollTop;
        lastObservedScrollHeight = container.scrollHeight;
        lastAppliedDistanceFromBottom = Math.max(
          0,
          container.scrollHeight - container.scrollTop - container.clientHeight
        );
      }

      const currentTargetViewportTopPx = liveTarget
        ? liveTarget.getBoundingClientRect().top
        : null;
      const targetMovedInViewport =
        currentTargetViewportTopPx !== null &&
        lastAlignedViewportTopPx !== null &&
        Math.abs(currentTargetViewportTopPx - lastAlignedViewportTopPx) >
          SUBPIXEL_TOLERANCE_PX;
      lastAlignedViewportTopPx = currentTargetViewportTopPx;

      if (targetMovedInViewport) {
        stableSince = null;
        consecutiveAlignedFrames = 0;
      } else {
        // Target itself is connected, aligned/bounded, and visually stationary.
        // Offscreen scrollHeight changes that are compensated by the host do
        // not reset stability while the target stays locked at its landing offset.
        if (stableSince === null) {
          stableSince = now;
        }
        consecutiveAlignedFrames += 1;
      }

      const requiredStableDurationMs =
        didScrollFar || layoutMutatedDuringPass
          ? LAYOUT_SETTLED_QUIET_MS
          : MIN_STABLE_DURATION_MS;

      if (
        consecutiveAlignedFrames >= REQUIRED_STABLE_FRAMES &&
        stableSince !== null &&
        now - stableSince >= requiredStableDurationMs
      ) {
        cleanupStabilization();
        performFinalTopScroll();
        const finalErrorPx = measureAlignmentErrorPx(liveTarget, container);
        if (liveTarget) {
          // Refresh highlight on the final connected target once alignment has
          // settled so the full visibility window begins after navigation completes
          // and recovers from any mid-stabilization unmount/offscreen teardown.
          highlightMatchedElement(liveTarget, message.id);
          const containerTop = container ? container.getBoundingClientRect().top : 0;
          const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
          emitAlignmentMeasurement(
            'settled',
            liveTarget,
            container,
            containerTop + expectedContainerOffsetPx,
            lastAlignClamped,
            undefined,
            'none'
          );
        }
        logNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'found',
          strategy: activeStrategy,
          realignAttempts,
          recoveryAttempts: recoveryAttemptsUsed,
          alignmentErrorPx: finalErrorPx,
          clamped: lastAlignClamped,
        });
        if (mode === 'target-driven') {
          onJumpComplete?.(index);
        }
        return;
      }

      if (elapsedPassMs < MAX_STABILIZE_DURATION_MS) {
        scheduleStabilizeStep();
      } else {
        performFinalTopScroll();
        notifyFailure('alignment-unstable', 'layout-shift', liveTarget);
      }
    };

    scheduleStabilizeStep();
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Each attempt polls once; bail after the budget.
  setTimeout(() => {
    if (isCancelled()) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      if (!scrollTargetIntoView(latest, 'realign')) {
        if (!isCancelled()) {
          logJumpFailedDiagnostic({
            targetIndex: index,
            targetMessageId: message.id,
            reason: 'scroll-failed-after-repoll',
            strategy: activeStrategy,
            recoveryAttempts: recoveryAttemptsUsed,
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
        strategy: activeStrategy,
        realignAttempts,
        recoveryAttempts: recoveryAttemptsUsed,
        alignmentErrorPx: measureAlignmentErrorPx(latest, container),
        clamped: lastAlignClamped,
      });

      onJumpComplete?.(index);
      return;
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'target-disappeared-after-search',
      strategy: activeStrategy,
      realignAttempts,
      recoveryAttempts: recoveryAttemptsUsed,
    });
    if (!isCancelled()) {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: 'target-disappeared-after-search',
        strategy: activeStrategy,
        recoveryAttempts: recoveryAttemptsUsed,
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