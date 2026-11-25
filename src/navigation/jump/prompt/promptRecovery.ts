/**
 * Bounded, progress-aware disconnect recovery orchestration for post-landing
 * prompt jump sessions. Operates directly on the centralized `PromptJumpSession`
 * state owner without owning independent mutable state.
 */
import { logNavigationEvent } from '@/navigation/jump/jumpDiagnostics';
import type {
  NavigationStrategyName,
  PromptJumpSession,
} from './promptJumpSession';

/**
 * Outcome returned by a target-mounting strategy attempt.
 */
export type MountTargetOutcome =
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

/**
 * Options controlling strategy selection during target mount recovery.
 */
export interface MountTargetOptions {
  skipVirtualLayout?: boolean;
}

/**
 * Recovery handle passed into post-landing stabilization when target remounting
 * is permitted.
 */
export interface DisconnectRecoveryContext {
  recoverTarget: (options?: MountTargetOptions) => Promise<MountTargetOutcome>;
  remainingRecoveries: number;
  initialStrategy: NavigationStrategyName;
  initialVirtualTopOffsetPx?: number;
}

/**
 * Discriminated outcome of a single bounded disconnect recovery attempt.
 */
export type DisconnectRecoveryResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'recovered'; readonly element: HTMLElement }
  | { readonly status: 'failed' };

const VIRTUAL_OFFSET_SHIFT_THRESHOLD_PX = 4;

/**
 * Progress-aware B004 recovery strategy policy:
 * Switches to Viewport Walker when a direct virtual-layout leap collapsed
 * scrollHeight (clamped scrollTop), or on a repeated recovery when the prior
 * virtual-layout recovery did not shift `topOffsetPx` meaningfully (> 4px).
 * When `topOffsetPx` is still converging during cold-start measurement, stays
 * on virtual-layout instead of fighting host scroll compensation.
 *
 * @param session Active prompt jump session.
 * @param recoveryAttempt 1-indexed recovery attempt number.
 * @returns True when recovery should bypass virtual-layout and use Viewport Walker.
 */
export function shouldSkipVirtualLayoutOnRecovery(
  session: PromptJumpSession,
  recoveryAttempt: number
): boolean {
  return (
    session.recovery.activeStrategy === 'virtual-layout' &&
    (session.alignment.lastAlignClamped ||
      (recoveryAttempt >= 2 && !session.recovery.lastVirtualOffsetShifted))
  );
}

/**
 * Updates virtual-layout offset convergence tracking on `session.recovery`
 * after a mounted recovery outcome.
 *
 * @param session Active prompt jump session.
 * @param outcome Mounted strategy outcome to inspect.
 */
export function recordVirtualRecoveryOffsetProgress(
  session: PromptJumpSession,
  outcome: Extract<MountTargetOutcome, { status: 'mounted' }>
): void {
  if (
    outcome.strategy === 'virtual-layout' &&
    typeof outcome.virtualTopOffsetPx === 'number' &&
    Number.isFinite(outcome.virtualTopOffsetPx)
  ) {
    session.recovery.lastVirtualOffsetShifted =
      session.recovery.lastVirtualOffsetPx !== null &&
      Math.abs(
        outcome.virtualTopOffsetPx - session.recovery.lastVirtualOffsetPx
      ) > VIRTUAL_OFFSET_SHIFT_THRESHOLD_PX;
    session.recovery.lastVirtualOffsetPx = outcome.virtualTopOffsetPx;
  } else {
    session.recovery.lastVirtualOffsetShifted = false;
  }
}

/**
 * Executes a single bounded, cancellable disconnect recovery attempt against
 * `recovery.recoverTarget`, mutating `session.recovery` directly and returning
 * a discriminated outcome for the stabilization owner to handle.
 *
 * All eligibility guards, budget decrements, `isRecovering = true`, and
 * `JUMP_DISCONNECT_RECOVERY_START` logging run synchronously before awaiting
 * `recovery.recoverTarget`.
 *
 * @param session Centralized jump session owning mutable recovery state.
 * @param recovery Optional recovery context from the jump coordinator.
 * @returns Discriminated recovery result (`skipped`, `cancelled`, `recovered`, or `failed`).
 * @example
 * const result = await executeDisconnectRecovery(session, recovery);
 */
export async function executeDisconnectRecovery(
  session: PromptJumpSession,
  recovery?: DisconnectRecoveryContext
): Promise<DisconnectRecoveryResult> {
  if (
    session.recovery.isRecovering ||
    session.isCancelled() ||
    !recovery ||
    session.recovery.remainingRecoveries <= 0
  ) {
    return { status: 'skipped' };
  }

  session.recovery.isRecovering = true;
  session.recovery.remainingRecoveries -= 1;
  session.recovery.attemptsUsed += 1;

  const recoveryAttempt = session.recovery.attemptsUsed;
  logNavigationEvent(session.jumpId, 'JUMP_DISCONNECT_RECOVERY_START', {
    targetPromptIndex: session.targetIndex,
    recoveryAttempt,
  });

  const skipVirtualLayout = shouldSkipVirtualLayoutOnRecovery(
    session,
    recoveryAttempt
  );

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
    session.recovery.isRecovering = false;
  }

  if (session.isCancelled() || outcome.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  session.recovery.activeStrategy = outcome.strategy;

  if (outcome.status === 'mounted' && outcome.element.isConnected) {
    recordVirtualRecoveryOffsetProgress(session, outcome);
    return { status: 'recovered', element: outcome.element };
  }

  return { status: 'failed' };
}
