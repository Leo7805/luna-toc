/**
 * Prompt jump orchestration: mounted target matching (exact UUID + guarded text
 * fallback), conditional native bottom-first settlement, strategy selection
 * (Virtual Layout -> Viewport Walker fallback), and handoff to post-landing
 * stabilization via a narrow facade callback.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '@/navigation/follow/follow';
import {
  createNavigationJumpId,
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from '@/navigation/jump/jumpDiagnostics';
import { SUBPIXEL_TOLERANCE_PX } from '@/navigation/jump/promptAlignment';
import type { JumpStrategyContext } from '@/navigation/jump/strategies/types';
import { executeViewportWalkerStrategy } from '@/navigation/jump/strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from '@/navigation/jump/strategies/virtualLayoutStrategy';
import { getActivePlatform } from '@/platforms';
import { tryNativeMessageJump } from './nativeMessageJump';
import { findRenderedPrompt, getScrollContainer } from './promptLanding';
import type {
  DisconnectRecoveryContext,
  MountTargetOptions,
  MountTargetOutcome,
} from './promptRecovery';
import {
  getMonotonicNowMs,
  LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX,
} from './promptStabilization';

const MAX_DISCONNECT_RECOVERIES = 2;
const BOTTOM_FIRST_POLL_MS = 40;
const BOTTOM_FIRST_QUIET_MS = 120;
const BOTTOM_FIRST_MAX_WAIT_MS = 1200;

/**
 * Conversation prompt snapshot provided by the navigation facade.
 */
export interface CoordinatorSearchContext {
  conversationKey: string;
  prompts: NavigatorMessage[];
}

/**
 * Payload handed off to post-landing stabilization once a target prompt is mounted.
 */
export interface MountedTargetHandoff {
  target: HTMLElement;
  message: NavigatorMessage;
  index: number;
  jumpId: string;
  mode: 'target-driven' | 'viewport-driven';
  alignToTopEdge?: boolean;
  recovery: DisconnectRecoveryContext;
  initialScrollTopPx: number | null;
}

/**
 * Narrow facade-owned live delegates passed into `coordinatePromptJump`.
 * Every callback reads live module-level hooks at invocation time.
 */
export interface PromptCoordinatorHooks {
  getVirtualSearchContext: () => CoordinatorSearchContext;
  isCancelled: () => boolean;
  onTargetDrivenStart: (targetIndex: number) => void;
  onMissingContextFailure: (targetIndex: number) => void;
  onMountFailure: (targetIndex: number) => void;
  clearJumpProgress: () => void;
  onTargetReady: (handoff: MountedTargetHandoff) => void;
  onJumpComplete?: (targetIndex: number) => void;
}

/**
 * Inputs for coordinating one independent virtual prompt jump.
 */
export interface CoordinatePromptJumpParams {
  message: NavigatorMessage;
  index: number;
  mode: 'target-driven' | 'viewport-driven';
  alignToTopEdge?: boolean;
  hooks: PromptCoordinatorHooks;
}

function findRenderedPromptByText(
  text: string,
  root?: ParentNode
): HTMLElement | null {
  return getActivePlatform().navigation.findRenderedPromptByText?.(text, root) ?? null;
}

function normalizePromptTextForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Returns true only when `message.text` is non-empty and does not collide
 * (exact or prefix match) with any other prompt in the conversation.
 * Prevents text fallback from jumping to a different prompt with identical text.
 *
 * @param prompts Readonly list of prompts in the active conversation.
 * @param message Candidate prompt message being targeted.
 */
export function isUniquePromptTextInConversation(
  prompts: ReadonlyArray<NavigatorMessage>,
  message: NavigatorMessage
): boolean {
  const needle = normalizePromptTextForMatch(message.text || '');
  if (!needle) return false;

  for (const other of prompts) {
    if (other.id === message.id) continue;
    const otherNorm = normalizePromptTextForMatch(other.text || '');
    if (!otherNorm) continue;
    if (
      otherNorm === needle ||
      otherNorm.startsWith(needle) ||
      needle.startsWith(otherNorm)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when `element` exposes a stable message ID that conflicts with
 * `expectedId`, ensuring text fallback never selects a DOM node belonging to
 * a different message.
 *
 * @param element Candidate DOM element matched by text.
 * @param expectedId Expected stable prompt UUID.
 */
export function hasConflictingElementMessageId(
  element: HTMLElement,
  expectedId: string
): boolean {
  if (!expectedId) return false;
  const raw =
    getActivePlatform().navigation.getMessageIdFromElement?.(element) ||
    element.getAttribute('data-chatgpt-search-message-ids') ||
    element.getAttribute('data-message-id') ||
    null;
  if (!raw) return false;
  const tokens = raw.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return !tokens.includes(expectedId);
}

/**
 * Waits (bounded and cancellable) after a native `scrollToBottom()` call until
 * the scroll container reaches the bottom and its `scrollHeight` stabilizes
 * briefly, then calls `holdViewport()` so subsequent alignment of the last
 * prompt does not fight native bottom-follow.
 *
 * @param container Active scroll container.
 * @param isCancelled Cancellation check predicate.
 * @returns `'cancelled'` if superseded or interrupted by user scroll, or `'settled'`.
 */
export async function waitForNativeBottomSettle(
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

  getActivePlatform().navigation.holdViewport?.(container);
  return 'settled';
}

/**
 * Mounts an unmounted target prompt by trying the virtual-layout strategy
 * first and falling back to the viewport walker when unsupported, on
 * capability failure, or when `skipVirtualLayout` is requested during
 * disconnect recovery to avoid repeating a collapsing direct leap.
 *
 * @param strategyContext Strategy execution parameters.
 * @param options Optional mount flags (e.g. `skipVirtualLayout`).
 */
export async function mountTargetViaStrategy(
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

/**
 * Coordinates an independent virtual prompt jump: checks mounted fast-path
 * (exact UUID then guarded unique text fallback), runs conditional native
 * bottom-first settlement for an unmounted last prompt, mounts via Virtual
 * Layout / Viewport Walker, and hands the mounted target off via `onTargetReady`.
 *
 * @param params Target message, index, mode, and live facade hooks.
 */
export function coordinatePromptJump(params: CoordinatePromptJumpParams): void {
  const { message, index, mode, alignToTopEdge, hooks } = params;
  const jumpId = createNavigationJumpId();
  const context = hooks.getVirtualSearchContext();
  const container = getScrollContainer();

  const initialScrollTopPx = container ? container.scrollTop : null;

  logNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
  });

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
  keepFollowing(15_000);
  if (mode === 'target-driven') {
    hooks.onTargetDrivenStart(index);
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
      hooks.onMissingContextFailure(index);
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
  const createStrategyContext = (): JumpStrategyContext => ({
    targetMessage: message,
    targetIndex: index,
    prompts: context.prompts,
    container: getScrollContainer() ?? container,
    jumpId,
    isCancelled: hooks.isCancelled,
  });

  const idHit = findRenderedPrompt(message.id);
  let textHit: HTMLElement | null = null;
  if (
    !idHit &&
    message.text &&
    isUniquePromptTextInConversation(context.prompts, message)
  ) {
    const candidate = findRenderedPromptByText(message.text);
    if (candidate && !hasConflictingElementMessageId(candidate, message.id)) {
      textHit = candidate;
    }
  }
  const renderedTarget = idHit ?? textHit;

  if (renderedTarget) {
    getActivePlatform().navigation.holdViewport?.(container);
    logNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    hooks.onTargetReady({
      target: renderedTarget,
      message,
      index,
      jumpId,
      mode,
      alignToTopEdge,
      recovery: {
        recoverTarget: (recoveryOpts) =>
          mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
        remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
        initialStrategy: 'fast-path',
      },
      initialScrollTopPx,
    });
    return;
  }

  const nav = getActivePlatform().navigation;
  const isUnmountedLastPrompt =
    index === context.prompts.length - 1 &&
    context.prompts[index]?.id === message.id;

  if (
    !(isUnmountedLastPrompt && typeof nav.scrollToBottom === 'function') &&
    tryNativeMessageJump({
      conversationKey: context.conversationKey,
      message,
      index,
      jumpId,
      mode,
      container,
      isCancelled: hooks.isCancelled,
      onJumpComplete: hooks.onJumpComplete,
      clearJumpProgress: hooks.clearJumpProgress,
      onMountFailure: hooks.onMountFailure,
    })
  ) {
    return;
  }

  nav.holdViewport?.(container);

  const activeContainerForBottom = getScrollContainer() ?? container;
  const startedNativeBottomFirst =
    isUnmountedLastPrompt &&
    activeContainerForBottom.isConnected &&
    nav.scrollToBottom?.(activeContainerForBottom)?.status === 'ok';

  void (async () => {
    if (startedNativeBottomFirst) {
      const bottomPhase = await waitForNativeBottomSettle(
        activeContainerForBottom,
        hooks.isCancelled
      );
      if (hooks.isCancelled() || bottomPhase === 'cancelled') {
        hooks.clearJumpProgress();
        return;
      }

      const mountedAfterBottom = findRenderedPrompt(message.id);
      if (mountedAfterBottom && mountedAfterBottom.isConnected) {
        hooks.onTargetReady({
          target: mountedAfterBottom,
          message,
          index,
          jumpId,
          mode,
          alignToTopEdge,
          recovery: {
            recoverTarget: (recoveryOpts) =>
              mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
            remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
            initialStrategy: 'fast-path',
          },
          initialScrollTopPx,
        });
        return;
      }
    }

    const mountOutcome = await mountTargetViaStrategy(createStrategyContext());
    if (hooks.isCancelled() || mountOutcome.status === 'cancelled') {
      return;
    }

    if (mountOutcome.status === 'mounted') {
      hooks.onTargetReady({
        target: mountOutcome.element,
        message,
        index,
        jumpId,
        mode,
        alignToTopEdge,
        recovery: {
          recoverTarget: (recoveryOpts) =>
            mountTargetViaStrategy(createStrategyContext(), recoveryOpts),
          remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
          initialStrategy: mountOutcome.strategy,
          initialVirtualTopOffsetPx: mountOutcome.virtualTopOffsetPx,
        },
        initialScrollTopPx,
      });
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
      hooks.onMountFailure(index);
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      attempts: mountOutcome.reason,
    });
  })();
}
