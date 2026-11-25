/**
 * Post-landing stabilization loop, disconnect-recovery handoff, failure
 * reporting, and 600ms repoll fallback for independent virtual prompt jumps.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '@/navigation/follow/follow';
import {
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from '@/navigation/jump/jumpDiagnostics';
import {
  evaluateElementAlignment,
  measureAlignmentErrorPx,
  resolvePromptLandingOffset,
  SUBPIXEL_TOLERANCE_PX,
  type AlignmentEvaluation,
} from '@/navigation/jump/promptAlignment';
import {
  attachSessionUserInputListeners,
  cleanupPromptJumpSession,
  createPromptJumpSession,
  emitSessionAlignmentMeasurement,
  scheduleSessionFrame,
  type DisplacementKind,
  type PromptJumpSession,
} from './promptJumpSession';
import {
  applyTargetLandingAlignment,
  classifyDisplacement,
  findRenderedPrompt,
  getScrollContainer,
  highlightMatchedElement,
  performFinalTopScroll,
} from './promptLanding';
import {
  executeDisconnectRecovery,
  type DisconnectRecoveryContext,
} from './promptRecovery';

const MIN_STABLE_DURATION_MS = 120;
const LAYOUT_SETTLED_QUIET_MS = 350;
const MAX_STABILIZE_DURATION_MS = 1200;
const REALIGN_COOLDOWN_MS = 50;
const MAX_REALIGN_ATTEMPTS = 3;
const REQUIRED_STABLE_FRAMES = 3;
const DISCONNECT_GRACE_FRAMES = 2;
const DISCONNECT_GRACE_MS = 50;
const FRAME_TIMEOUT_MS = 50;

/** Minimum `scrollHeight` delta (px) treated as a virtual-list layout mutation. */
export const LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX = 2;

/**
 * Returns monotonic wall-clock milliseconds for stabilization and bottom-settle budgets.
 */
export function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Narrow facade-owned lifecycle and live-hook delegates passed into
 * `runPostLandingStabilization`. Each callback reads live module hooks at
 * invocation time rather than capturing stale references at session creation.
 */
export interface StabilizationLifecycleHooks {
  isCancelled: () => boolean;
  registerCleanup: (cleanup: () => void) => void;
  clearCleanupIfActive: (cleanup: () => void) => void;
  onJumpComplete: (targetIndex: number) => void;
  onTargetDrivenFailure: (targetIndex: number) => void;
  clearJumpProgress: () => void;
}

/**
 * Inputs required to run post-landing alignment and stabilization for one jump.
 */
export interface RunPostLandingStabilizationParams {
  target: HTMLElement;
  message: NavigatorMessage;
  index: number;
  jumpId: string;
  mode: 'target-driven' | 'viewport-driven';
  alignToTopEdge?: boolean;
  recovery?: DisconnectRecoveryContext;
  initialScrollTopPx: number | null;
  hooks: StabilizationLifecycleHooks;
}

/**
 * Completes an independent jump by aligning the target, highlighting it, and
 * verifying post-landing stability against virtual-list layout shifts or
 * unexpected external scroll changes.
 *
 * Shared by Mounted Fast Path, Virtual Layout, and Viewport Walker strategies.
 * Uses a monotonic wall-clock budget, bounded incremental re-alignment (up to
 * 3 attempts), and bounded disconnect recovery (up to 2 attempts) while reusing
 * a single `jumpId` across all diagnostic events.
 *
 * Returns `null` when stabilization started (or exited on cancellation), or
 * returns the created `PromptJumpSession` when initial alignment returned
 * `null` so the facade can run the deferred 600ms repoll fallback on the same
 * session (reserved for Phase 5E).
 *
 * @param params Target, session metadata, recovery handle, and live facade hooks.
 * @returns The `PromptJumpSession` if initial alignment returned `null`, otherwise `null`.
 */
export function runPostLandingStabilization(
  params: RunPostLandingStabilizationParams
): PromptJumpSession | null {
  const {
    target,
    message,
    index,
    jumpId,
    mode,
    alignToTopEdge,
    recovery,
    initialScrollTopPx,
    hooks,
  } = params;

  const isCancelled = hooks.isCancelled;
  const session = createPromptJumpSession({
    target,
    targetMessageId: message.id,
    targetIndex: index,
    jumpId,
    mode,
    initialStrategy: recovery?.initialStrategy,
    remainingRecoveries: recovery?.remainingRecoveries,
    initialVirtualTopOffsetPx: recovery?.initialVirtualTopOffsetPx,
    initialScrollTopPx,
    isCancelled,
  });

  const cleanupStabilization = (): void => {
    cleanupPromptJumpSession(session);
    hooks.clearCleanupIfActive(cleanupStabilization);
  };
  hooks.registerCleanup(cleanupStabilization);

  const notifyFailure = (
    status: string,
    displacementKind: DisplacementKind = 'none',
    el: HTMLElement | null = null
  ): void => {
    cleanupStabilization();
    if (isCancelled()) return;
    const container = getScrollContainer();
    const alignmentErrorPx = measureAlignmentErrorPx(el, container);
    if (el) {
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
      emitSessionAlignmentMeasurement(
        session,
        'failed',
        el,
        container,
        containerTop + expectedContainerOffsetPx,
        session.alignment.lastAlignClamped,
        undefined,
        displacementKind
      );
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status,
      strategy: session.recovery.activeStrategy,
      realignAttempts: session.stabilization.realignAttempts,
      recoveryAttempts: session.recovery.attemptsUsed,
      alignmentErrorPx,
      clamped: session.alignment.lastAlignClamped,
      displacementKind,
    });
    logJumpFailedDiagnostic({
      targetIndex: index,
      targetMessageId: message.id,
      reason: status,
      strategy: session.recovery.activeStrategy,
      recoveryAttempts: session.recovery.attemptsUsed,
      container,
    });
    if (mode === 'target-driven') {
      hooks.onTargetDrivenFailure(index);
    }
  };

  const initialAlignResult = applyTargetLandingAlignment(
    session,
    target,
    'after-align'
  );
  if (initialAlignResult) {
    if (isCancelled()) {
      cleanupStabilization();
      return null;
    }

    keepFollowing(1800);
    attachSessionUserInputListeners(session);

    // Stamp stabilization budget after initial alignment so timeout accounting
    // matches the original post-landing pass boundary.
    session.stabilization.startedAtMs = getMonotonicNowMs();

    const resetStabilizationPass = (nextTarget: HTMLElement): void => {
      session.stabilization.activeTarget = nextTarget;
      session.stabilization.startedAtMs = getMonotonicNowMs();
      session.stabilization.realignAttempts = 0;
      session.stabilization.lastRealignAtMs = null;
      session.stabilization.consecutiveAlignedFrames = 0;
      session.stabilization.stableSinceMs = null;
      session.stabilization.lastAlignedViewportTopPx = null;
      session.stabilization.consecutiveDisconnectedFrames = 0;
      session.stabilization.disconnectedSinceMs = null;
      session.stabilization.layoutMutatedDuringPass = false;
    };

    const scheduleStabilizeStep = (): void => {
      session.lifecycle.cancelScheduledFrame = scheduleSessionFrame(
        session,
        () => {
          session.lifecycle.cancelScheduledFrame = null;
          stabilizeStep();
        },
        FRAME_TIMEOUT_MS
      );
    };

    const runDisconnectRecovery = async (): Promise<void> => {
      const result = await executeDisconnectRecovery(session, recovery);
      if (result.status === 'skipped') {
        return;
      }
      if (result.status === 'cancelled' || isCancelled()) {
        cleanupStabilization();
        return;
      }
      if (result.status === 'recovered' && result.element.isConnected) {
        resetStabilizationPass(result.element);
        if (applyTargetLandingAlignment(session, result.element, 'realign')) {
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
      if (isCancelled() || session.recovery.isRecovering) return;

      if (session.lifecycle.userInterrupted) {
        cleanupStabilization();
        logNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'cancelled-by-user',
          strategy: session.recovery.activeStrategy,
          realignAttempts: session.stabilization.realignAttempts,
          recoveryAttempts: session.recovery.attemptsUsed,
          displacementKind: 'user-scroll',
        });
        hooks.clearJumpProgress();
        return;
      }

      const now = getMonotonicNowMs();
      const elapsedPassMs = now - session.stabilization.startedAtMs;
      const container = getScrollContainer();

      const scrollHeightChanged = Boolean(
        container &&
          container.isConnected &&
          session.alignment.lastObservedScrollHeight !== null &&
          Math.abs(
            container.scrollHeight - session.alignment.lastObservedScrollHeight
          ) > LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX
      );
      if (scrollHeightChanged && container) {
        session.stabilization.layoutMutatedDuringPass = true;
        session.alignment.lastObservedScrollHeight = container.scrollHeight;
      }

      // Re-resolve by stable message ID; never reuse a disconnected node as connected.
      const resolvedById = findRenderedPrompt(message.id);
      let liveTarget: HTMLElement | null = null;
      if (resolvedById && resolvedById.isConnected) {
        if (resolvedById !== session.stabilization.activeTarget) {
          session.stabilization.activeTarget = resolvedById;
          highlightMatchedElement(resolvedById, message.id);
        }
        liveTarget = resolvedById;
      } else if (
        session.stabilization.activeTarget &&
        session.stabilization.activeTarget.isConnected
      ) {
        liveTarget = session.stabilization.activeTarget;
      } else {
        session.stabilization.activeTarget = null;
      }

      const evalResult: AlignmentEvaluation = liveTarget
        ? evaluateElementAlignment(liveTarget)
        : 'disconnected';

      if (evalResult === 'disconnected') {
        session.stabilization.stableSinceMs = null;
        session.stabilization.consecutiveAlignedFrames = 0;
        session.stabilization.lastAlignedViewportTopPx = null;
        if (session.stabilization.disconnectedSinceMs === null) {
          session.stabilization.disconnectedSinceMs = now;
        }
        session.stabilization.consecutiveDisconnectedFrames += 1;

        const graceElapsed =
          session.stabilization.consecutiveDisconnectedFrames >=
            DISCONNECT_GRACE_FRAMES &&
          now - session.stabilization.disconnectedSinceMs >= DISCONNECT_GRACE_MS;

        if (graceElapsed) {
          if (recovery && session.recovery.remainingRecoveries > 0) {
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

      session.stabilization.disconnectedSinceMs = null;
      session.stabilization.consecutiveDisconnectedFrames = 0;

      if (evalResult === 'correctable' && liveTarget) {
        session.stabilization.stableSinceMs = null;
        session.stabilization.consecutiveAlignedFrames = 0;
        session.stabilization.lastAlignedViewportTopPx = null;

        const displacementKind = classifyDisplacement(
          session,
          container,
          scrollHeightChanged
        );
        if (displacementKind === 'external-scroll-suspected') {
          notifyFailure(
            'external-scroll-suspected',
            'external-scroll-suspected',
            liveTarget
          );
          return;
        }

        const cooldownElapsed =
          session.stabilization.lastRealignAtMs === null ||
          now - session.stabilization.lastRealignAtMs >= REALIGN_COOLDOWN_MS;
        const withinPassBudget = elapsedPassMs < MAX_STABILIZE_DURATION_MS;

        if (
          session.stabilization.realignAttempts < MAX_REALIGN_ATTEMPTS &&
          withinPassBudget
        ) {
          if (cooldownElapsed) {
            session.stabilization.realignAttempts += 1;
            session.stabilization.lastRealignAtMs = now;
            applyTargetLandingAlignment(session, liveTarget, 'realign');
          }
          scheduleStabilizeStep();
          return;
        }

        if (
          withinPassBudget &&
          session.stabilization.lastRealignAtMs !== null &&
          now - session.stabilization.lastRealignAtMs < REALIGN_COOLDOWN_MS
        ) {
          scheduleStabilizeStep();
          return;
        }

        performFinalTopScroll(session, alignToTopEdge, FRAME_TIMEOUT_MS);
        notifyFailure('alignment-unstable', displacementKind, liveTarget);
        return;
      }

      // evalResult is 'aligned' or 'bounded'
      if (container && container.isConnected) {
        session.alignment.lastAppliedScrollTop = container.scrollTop;
        session.alignment.lastObservedScrollHeight = container.scrollHeight;
        session.alignment.lastAppliedDistanceFromBottom = Math.max(
          0,
          container.scrollHeight - container.scrollTop - container.clientHeight
        );
      }

      const currentTargetViewportTopPx = liveTarget
        ? liveTarget.getBoundingClientRect().top
        : null;
      const targetMovedInViewport =
        currentTargetViewportTopPx !== null &&
        session.stabilization.lastAlignedViewportTopPx !== null &&
        Math.abs(
          currentTargetViewportTopPx -
            session.stabilization.lastAlignedViewportTopPx
        ) > SUBPIXEL_TOLERANCE_PX;
      session.stabilization.lastAlignedViewportTopPx = currentTargetViewportTopPx;

      if (targetMovedInViewport) {
        session.stabilization.stableSinceMs = null;
        session.stabilization.consecutiveAlignedFrames = 0;
      } else {
        // Target itself is connected, aligned/bounded, and visually stationary.
        // Offscreen scrollHeight changes compensated by the host do not reset
        // stability while the target stays locked at its landing offset.
        if (session.stabilization.stableSinceMs === null) {
          session.stabilization.stableSinceMs = now;
        }
        session.stabilization.consecutiveAlignedFrames += 1;
      }

      const requiredStableDurationMs =
        session.alignment.didScrollFar ||
        session.stabilization.layoutMutatedDuringPass
          ? LAYOUT_SETTLED_QUIET_MS
          : MIN_STABLE_DURATION_MS;

      if (
        session.stabilization.consecutiveAlignedFrames >=
          REQUIRED_STABLE_FRAMES &&
        session.stabilization.stableSinceMs !== null &&
        now - session.stabilization.stableSinceMs >= requiredStableDurationMs
      ) {
        cleanupStabilization();
        performFinalTopScroll(session, alignToTopEdge, FRAME_TIMEOUT_MS);
        const finalErrorPx = measureAlignmentErrorPx(liveTarget, container);
        if (liveTarget) {
          highlightMatchedElement(liveTarget, message.id);
          const containerTop = container ? container.getBoundingClientRect().top : 0;
          const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
          emitSessionAlignmentMeasurement(
            session,
            'settled',
            liveTarget,
            container,
            containerTop + expectedContainerOffsetPx,
            session.alignment.lastAlignClamped,
            undefined,
            'none'
          );
        }
        logNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'found',
          strategy: session.recovery.activeStrategy,
          realignAttempts: session.stabilization.realignAttempts,
          recoveryAttempts: session.recovery.attemptsUsed,
          alignmentErrorPx: finalErrorPx,
          clamped: session.alignment.lastAlignClamped,
        });
        if (mode === 'target-driven') {
          hooks.onJumpComplete(index);
        }
        return;
      }

      if (elapsedPassMs < MAX_STABILIZE_DURATION_MS) {
        scheduleStabilizeStep();
      } else {
        performFinalTopScroll(session, alignToTopEdge, FRAME_TIMEOUT_MS);
        notifyFailure('alignment-unstable', 'layout-shift', liveTarget);
      }
    };

    scheduleStabilizeStep();
    return null;
  }

  return session;
}
