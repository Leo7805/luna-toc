/**
 * Bounded successor-anchor recovery for unmounted tall turns whose initial
 * virtual-layout expansion triggers host scroll-anchor ejection.
 */
import { getActivePlatform } from '@/platforms';
import type { VirtualJumpTargetResult } from '@/platforms/platformInterface';
import type { JumpStrategyContext, VirtualStrategyExecutionResult } from './types';

const MAX_SUCCESSOR_ANCHOR_HOPS = 2;
const ANCHOR_MOUNT_WAIT_MS = 600;
const STEP_BACK_MOUNT_WAIT_MS = 450;
const STABLE_OFFSET_DELTA_PX = 4;

/**
 * Injected primitives from `virtualLayoutStrategy.ts` to keep module
 * boundaries acyclic and reuse the existing mount/frame helpers.
 */
export interface SuccessorAnchorDeps {
  queryJumpTarget: (
    container: HTMLElement,
    messageId: string
  ) => VirtualJumpTargetResult;
  waitForTargetMount: (
    targetId: string,
    container: HTMLElement,
    isCancelled: () => boolean,
    timeoutMs?: number
  ) => Promise<HTMLElement | null>;
  waitForRenderedFrame: (isCancelled?: () => boolean) => Promise<void>;
}

/**
 * Inputs used to decide whether concrete downward-ejection + stagnant-offset
 * evidence justifies activating successor-anchor recovery.
 */
export interface SuccessorAnchorActivationInput {
  readonly currentTopOffsetPx: number;
  readonly currentScrollTop: number;
  readonly nextTopOffsetPx: number | null;
  readonly targetIndex: number;
  readonly promptCount: number;
  readonly offsetThresholdPx: number;
}

/**
 * Returns true only when concrete evidence shows a direct virtual-layout jump
 * was ejected downward past a non-zero, stagnant estimated offset and at least
 * one successor prompt exists to serve as a measurement anchor.
 *
 * Excludes To Top (`currentTopOffsetPx === 0`), Last Prompt (no successor),
 * and converging jumps whose `topOffsetPx` shifted meaningfully.
 *
 * @param input Observed scroll and virtual-offset state after a failed direct jump.
 * @returns True when bounded successor-anchor recovery should activate.
 */
export function shouldActivateSuccessorAnchor(
  input: SuccessorAnchorActivationInput
): boolean {
  if (input.currentTopOffsetPx <= 0) return false;
  if (input.targetIndex < 0 || input.targetIndex + 1 >= input.promptCount) {
    return false;
  }
  if (input.nextTopOffsetPx === null || !Number.isFinite(input.nextTopOffsetPx)) {
    return false;
  }
  const ejectedDownward =
    input.currentScrollTop > input.currentTopOffsetPx + input.offsetThresholdPx;
  const offsetStagnant =
    Math.abs(input.nextTopOffsetPx - input.currentTopOffsetPx) <=
    input.offsetThresholdPx;
  return ejectedDownward && offsetStagnant;
}

function safeHoldViewport(container: HTMLElement): void {
  try {
    getActivePlatform().navigation.holdViewport?.(container);
  } catch {
    // Fail closed if holdViewport is unavailable or throws
  }
}

function findConnectedPrompt(messageId: string): HTMLElement | null {
  try {
    const el = getActivePlatform().navigation.findRenderedPrompt(messageId);
    return el && el.isConnected ? el : null;
  } catch {
    return null;
  }
}

/**
 * Verifies that `messageId` remains connected across a rendered frame boundary
 * (and a second frame if host scroll compensation shifted `scrollTop`), so a
 * momentarily mounted node is never treated as a successful recovery.
 */
async function verifyTargetStablyConnected(
  messageId: string,
  container: HTMLElement,
  isCancelled: () => boolean,
  deps: SuccessorAnchorDeps
): Promise<HTMLElement | null> {
  const scrollBefore = container.scrollTop;
  await deps.waitForRenderedFrame(isCancelled);
  if (isCancelled()) return null;

  if (Math.abs(container.scrollTop - scrollBefore) > STABLE_OFFSET_DELTA_PX) {
    await deps.waitForRenderedFrame(isCancelled);
    if (isCancelled()) return null;
  }

  return findConnectedPrompt(messageId);
}

function readMeasuredOffsetPx(
  container: HTMLElement,
  messageId: string,
  fallbackOffsetPx: number,
  deps: SuccessorAnchorDeps
): number {
  try {
    const res = deps.queryJumpTarget(container, messageId);
    if (res.status === 'ok' && Number.isFinite(res.topOffsetPx) && res.topOffsetPx >= 0) {
      return res.topOffsetPx;
    }
  } catch {
    // Ignore query failure and keep fallback offset
  }
  return fallbackOffsetPx;
}

/**
 * Attempts bounded successor-anchor recovery (at most 2 successor hops) when a
 * direct virtual-layout jump to a very tall unmounted turn is repeatedly
 * ejected downward by host scroll-anchor compensation.
 *
 * Navigating to a valid successor turn (`targetIndex + 1`, or `targetIndex + 2`
 * if the immediate successor is also ejected) allows the host virtualizer to
 * mount and measure the target turn above the anchor so the normal alignment
 * and stabilization pipeline can align it cleanly.
 *
 * @param context Active jump strategy context.
 * @param failedTargetOffsetPx The stagnant estimated offset that was ejected.
 * @param deps Injected query, mount-wait, and frame-wait helpers.
 * @returns `'mounted'` with a verified connected target, `'cancelled'`, or `null` if recovery did not succeed.
 */
export async function trySuccessorAnchorRecovery(
  context: JumpStrategyContext,
  failedTargetOffsetPx: number,
  deps: SuccessorAnchorDeps
): Promise<Extract<VirtualStrategyExecutionResult, { status: 'mounted' | 'cancelled' }> | null> {
  const { container, prompts, targetIndex, targetMessage, isCancelled } = context;

  for (let hop = 1; hop <= MAX_SUCCESSOR_ANCHOR_HOPS; hop++) {
    if (isCancelled()) {
      return { status: 'cancelled' };
    }

    const anchorIndex = targetIndex + hop;
    const anchorPrompt = prompts[anchorIndex];
    if (!anchorPrompt || !anchorPrompt.id) {
      break;
    }

    let anchorQuery: VirtualJumpTargetResult;
    try {
      anchorQuery = deps.queryJumpTarget(container, anchorPrompt.id);
    } catch {
      continue;
    }

    if (
      anchorQuery.status !== 'ok' ||
      !Number.isFinite(anchorQuery.topOffsetPx) ||
      anchorQuery.topOffsetPx < 0
    ) {
      continue;
    }

    safeHoldViewport(container);
    try {
      container.scrollTo({ top: anchorQuery.topOffsetPx, behavior: 'auto' });
    } catch {
      return null;
    }

    const anchorMounted = await deps.waitForTargetMount(
      anchorPrompt.id,
      container,
      isCancelled,
      ANCHOR_MOUNT_WAIT_MS
    );
    if (isCancelled()) {
      return { status: 'cancelled' };
    }
    if (!anchorMounted) {
      continue;
    }

    // Confirm the anchor itself survived host scroll compensation before relying on it
    const stableAnchor = await verifyTargetStablyConnected(
      anchorPrompt.id,
      container,
      isCancelled,
      deps
    );
    if (isCancelled()) {
      return { status: 'cancelled' };
    }
    if (!stableAnchor) {
      continue;
    }

    // 1. Check if the target turn is already stably mounted above the anchor
    const directTarget = findConnectedPrompt(targetMessage.id);
    if (directTarget) {
      const stableTarget = await verifyTargetStablyConnected(
        targetMessage.id,
        container,
        isCancelled,
        deps
      );
      if (isCancelled()) {
        return { status: 'cancelled' };
      }
      if (stableTarget) {
        return {
          status: 'mounted',
          element: stableTarget,
          topOffsetPx: readMeasuredOffsetPx(
            container,
            targetMessage.id,
            failedTargetOffsetPx,
            deps
          ),
        };
      }
    }

    // 2. For a 2-hop anchor (e.g. #16 mounted when targeting #14), step back
    // one turn through the now-mounted intermediate successor (#15) so the
    // target turn (#14) mounts above it with measured heights.
    if (hop > 1) {
      const intermediatePrompt = prompts[targetIndex + 1];
      if (intermediatePrompt && intermediatePrompt.id) {
        const intermediateQuery = deps.queryJumpTarget(
          container,
          intermediatePrompt.id
        );
        if (
          intermediateQuery.status === 'ok' &&
          Number.isFinite(intermediateQuery.topOffsetPx) &&
          intermediateQuery.topOffsetPx >= 0
        ) {
          safeHoldViewport(container);
          try {
            container.scrollTo({
              top: intermediateQuery.topOffsetPx,
              behavior: 'auto',
            });
          } catch {
            return null;
          }

          const steppedTarget = await deps.waitForTargetMount(
            targetMessage.id,
            container,
            isCancelled,
            STEP_BACK_MOUNT_WAIT_MS
          );
          if (isCancelled()) {
            return { status: 'cancelled' };
          }
          if (steppedTarget) {
            const stableStepped = await verifyTargetStablyConnected(
              targetMessage.id,
              container,
              isCancelled,
              deps
            );
            if (isCancelled()) {
              return { status: 'cancelled' };
            }
            if (stableStepped) {
              return {
                status: 'mounted',
                element: stableStepped,
                topOffsetPx: readMeasuredOffsetPx(
                  container,
                  targetMessage.id,
                  failedTargetOffsetPx,
                  deps
                ),
              };
            }
          }
        }
      }
    }
  }

  return null;
}
