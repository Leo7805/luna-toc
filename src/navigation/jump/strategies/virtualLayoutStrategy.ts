/**
 * React virtual-layout jump strategy for unmounted prompts.
 */
import { getActivePlatform } from '@/platforms';
import type { VirtualJumpTargetResult } from '@/platforms/platformInterface';
import { computeDirectionTowardTarget } from '@/navigation/jump/direction';
import { DOM_SETTLE_CONFIG } from '@/navigation/jump/domSettle';
import { queueSidebarIndices, seedMountQueue } from '@/navigation/jump/mountQueue';
import { JUMP_STRATEGY_CONFIG } from './config';
import {
  shouldActivateSuccessorAnchor,
  trySuccessorAnchorRecovery,
} from './successorAnchorRecovery';
import type {
  JumpStrategyContext,
  VirtualStrategyAttempt,
  VirtualStrategyExecutionResult,
} from './types';
import {
  getLowestMountedConnectedIndex,
  queryJumpTarget,
  startDomQuiescenceProgressObserver,
  stimulateTopBoundary,
  waitForRenderedFrame,
} from './virtualLayoutPagination';

export {
  getLowestMountedConnectedIndex,
  startDomQuiescenceProgressObserver,
  stimulateTopBoundary,
  type DomQuiescenceProgressSession,
  type VirtualProgressOutcome,
} from './virtualLayoutPagination';

/**
 * Executes older-history virtual layout pagination by repeatedly scrolling to top,
 * awaiting multi-burst DOM quiescence, and querying fresh host layout state until the target appears.
 *
 * @param context Jump strategy execution context.
 * @param initialResult Initial query result indicating target-not-in-layout.
 * @returns Promise resolving to the execution result.
 */
async function paginateOlderVirtualLayout(
  context: JumpStrategyContext,
  initialResult: Extract<
    VirtualJumpTargetResult,
    { status: 'target-not-in-layout' }
  >
): Promise<VirtualStrategyExecutionResult> {
  const targetMessageId = context.targetMessage.id;
  const container = context.container;
  const isCancelled = context.isCancelled;
  const mountTimeoutMs = JUMP_STRATEGY_CONFIG.virtualLayout.mountTimeoutMs;
  const noProgressTimeoutMs =
    JUMP_STRATEGY_CONFIG.virtualLayout.noProgressTimeoutMs;
  const pollIntervalMs =
    JUMP_STRATEGY_CONFIG.virtualLayout.paginationPollIntervalMs;
  const minQuerySpacingMs =
    JUMP_STRATEGY_CONFIG.virtualLayout.minQuerySpacingMs;

  let currentResult = initialResult;

  while (true) {
    const previousTurnCount = currentResult.turnCount;
    const previousLowestIndex = getLowestMountedConnectedIndex(
      context.prompts,
      document
    );

    if (isCancelled()) {
      return { status: 'cancelled' };
    }

    // 1. Arm progress observer synchronously before boundary scroll
    const session = startDomQuiescenceProgressObserver({
      root: document.body,
      container,
      targetMessageId,
      prompts: context.prompts,
      previousLowestIndex,
      previousTurnCount,
      isCancelled,
      timeoutMs: noProgressTimeoutMs,
      debounceMs: DOM_SETTLE_CONFIG.debounceMs,
      pollIntervalMs,
      minQuerySpacingMs,
    });

    // 2. Stimulate top boundary across frame boundaries
    try {
      await stimulateTopBoundary(container, isCancelled);
    } catch {
      session.dispose();
      return { status: 'exhausted', reason: 'scroll-to-top-threw' };
    }

    if (isCancelled()) {
      session.dispose();
      return { status: 'cancelled' };
    }

    // 3. Await progress outcome
    const outcome = await session.promise;

    if (isCancelled() || outcome.status === 'cancelled') {
      return { status: 'cancelled' };
    }

    if (outcome.status === 'capability-failure') {
      return { status: 'capability-failure', reason: outcome.reason };
    }

    if (outcome.status === 'timeout') {
      return { status: 'exhausted', reason: 'no-progress-timeout' };
    }

    if (outcome.status === 'ok') {
      const topOffsetPx = outcome.result.topOffsetPx;
      if (
        typeof topOffsetPx !== 'number' ||
        !Number.isFinite(topOffsetPx) ||
        topOffsetPx < 0
      ) {
        return { status: 'exhausted', reason: 'target-offset-invalid' };
      }

      const directResult = await executeDirectVirtualJump(context, outcome.result);
      if (directResult.status === 'capability-failure') {
        return { status: 'exhausted', reason: 'target-offset-invalid' };
      }
      return directResult;
    }

    if (outcome.status === 'progress') {
      currentResult = outcome.result;
      continue;
    }
  }
}

/**
 * Waits for the target prompt element to mount into the DOM after a coarse virtual scroll.
 *
 * @param targetId Target message ID to wait for.
 * @param container Active chat scroll container.
 * @param isCancelled Callback returning true if navigation was superseded or cancelled.
 * @param timeoutMs Maximum wait time before giving up.
 * @returns Promise resolving to the mounted element, or null if timed out, cancelled, or on host error.
 */
export function waitForTargetMount(
  targetId: string,
  container: HTMLElement,
  isCancelled: () => boolean,
  timeoutMs = JUMP_STRATEGY_CONFIG.virtualLayout.mountTimeoutMs
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver | null = null;
    let rafId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const settle = (result: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    try {
      if (isCancelled()) {
        settle(null);
        return;
      }

      const initialHit = getActivePlatform().navigation.findRenderedPrompt(targetId);
      if (initialHit) {
        settle(initialHit);
        return;
      }

      timerId = setTimeout(() => settle(null), timeoutMs);

      observer = new MutationObserver(() => {
        try {
          if (isCancelled()) {
            settle(null);
            return;
          }
          const hit = getActivePlatform().navigation.findRenderedPrompt(targetId);
          if (hit) {
            settle(hit);
          }
        } catch {
          settle(null);
        }
      });
      observer.observe(container, { childList: true, subtree: true });

      const checkFrame = () => {
        try {
          if (settled) return;
          if (isCancelled()) {
            settle(null);
            return;
          }
          const hit = getActivePlatform().navigation.findRenderedPrompt(targetId);
          if (hit) {
            settle(hit);
            return;
          }
          rafId = requestAnimationFrame(checkFrame);
        } catch {
          settle(null);
        }
      };
      rafId = requestAnimationFrame(checkFrame);
    } catch {
      settle(null);
    }
  });
}

const MAX_DIRECT_JUMP_REFINEMENTS = 4;
const DIRECT_JUMP_REFINEMENT_WAIT_MS = 350;
const DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX = 4;

/**
 * Executes a direct virtual layout jump to a prompt already present in the host layout dataset.
 *
 * On cold-start long conversations, ChatGPT's initial `topOffsetPx` can be an unmeasured
 * estimate that lands a few turns away from the target. Rather than giving up after a single
 * scroll, this function performs bounded iterative refinement: after waiting briefly for
 * ChatGPT to mount and measure the landed region, it re-queries the updated `topOffsetPx`
 * (or nudges one viewport step in the mounted-window direction if the estimate hasn't shifted)
 * up to `MAX_DIRECT_JUMP_REFINEMENTS` times.
 *
 * @param context Strategy execution parameters.
 * @param result Layout query result with status: 'ok'.
 * @returns Promise resolving to execution result.
 */
async function executeDirectVirtualJump(
  context: JumpStrategyContext,
  result: Extract<VirtualJumpTargetResult, { status: 'ok' }>
): Promise<VirtualStrategyExecutionResult> {
  let currentTopOffsetPx = result.topOffsetPx;
  if (
    typeof currentTopOffsetPx !== 'number' ||
    !Number.isFinite(currentTopOffsetPx) ||
    currentTopOffsetPx < 0
  ) {
    return { status: 'capability-failure', reason: 'invalid-top-offset' };
  }

  const fullMountTimeoutMs = JUMP_STRATEGY_CONFIG.virtualLayout.mountTimeoutMs;
  const firstWaitMs = Math.min(DIRECT_JUMP_REFINEMENT_WAIT_MS, fullMountTimeoutMs);
  let triedSuccessorAnchor = false;

  for (let attempt = 0; attempt <= MAX_DIRECT_JUMP_REFINEMENTS; attempt++) {
    if (context.isCancelled()) {
      return { status: 'cancelled' };
    }

    try {
      getActivePlatform().navigation.holdViewport?.(context.container);
    } catch {
      // Fail closed if holdViewport is unavailable or throws
    }

    try {
      context.container.scrollTo({
        top: currentTopOffsetPx,
        behavior: 'auto',
      });
    } catch {
      return { status: 'exhausted', reason: 'container-scroll-threw' };
    }

    const scrollTopAfterWrite = context.container.scrollTop;

    const isLastAttempt = attempt === MAX_DIRECT_JUMP_REFINEMENTS;
    const waitMs = isLastAttempt ? fullMountTimeoutMs : firstWaitMs;
    const mountedElement = await waitForTargetMount(
      context.targetMessage.id,
      context.container,
      context.isCancelled,
      waitMs
    );

    if (context.isCancelled()) {
      return { status: 'cancelled' };
    }

    if (mountedElement) {
      const scrolledAwayDuringMount =
        Math.abs(context.container.scrollTop - scrollTopAfterWrite) >
        DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX;

      // On cold-start jumps where host scroll-anchor compensation immediately
      // moved scrollTop during mount, verify the exact target UUID survives
      // one rendered frame before handing off; if it transiently unmounts due
      // to virtualizer height collapse, fall through to bounded refinement.
      if (!isLastAttempt && scrolledAwayDuringMount) {
        const wasConnected = mountedElement.isConnected;
        await waitForRenderedFrame(context.isCancelled);
        if (context.isCancelled()) {
          return { status: 'cancelled' };
        }
        const verifiedElement = getActivePlatform().navigation.findRenderedPrompt(
          context.targetMessage.id
        );
        if (verifiedElement && (!wasConnected || verifiedElement.isConnected)) {
          return {
            status: 'mounted',
            element: verifiedElement,
            topOffsetPx: currentTopOffsetPx,
          };
        }
      } else {
        return {
          status: 'mounted',
          element: mountedElement,
          topOffsetPx: currentTopOffsetPx,
        };
      }
    }

    if (isLastAttempt) {
      break;
    }

    const currentScrollTop = context.container.scrollTop;
    const viewportDriftedFromWrite =
      Math.abs(currentScrollTop - scrollTopAfterWrite) >
      DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX;

    // Re-query the virtual layout: scrolling to the initial estimate often
    // triggers ChatGPT to measure unmeasured turns and refine `topOffsetPx`,
    // or causes native viewport compensation to push `container.scrollTop` away
    // from `topOffsetPx` (e.g. cold-start topOffsetPx=0 pushed to ~4961px).
    const nextResult = queryJumpTarget(
      context.container,
      context.targetMessage.id
    );
    if (
      nextResult.status === 'ok' &&
      Number.isFinite(nextResult.topOffsetPx) &&
      nextResult.topOffsetPx >= 0
    ) {
      const offsetChanged =
        Math.abs(nextResult.topOffsetPx - currentTopOffsetPx) >
        DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX;
      const viewportDriftedFromTarget =
        viewportDriftedFromWrite &&
        Math.abs(currentScrollTop - nextResult.topOffsetPx) >
          DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX;

      // When a direct jump to a stagnant non-zero offset is ejected downward
      // by host scroll compensation (signature of a very tall unmounted turn
      // expanding and reverting), attempt bounded successor-anchor recovery
      // once instead of repeating the same failing direct jump.
      if (
        !triedSuccessorAnchor &&
        shouldActivateSuccessorAnchor({
          currentTopOffsetPx,
          currentScrollTop,
          nextTopOffsetPx: nextResult.topOffsetPx,
          targetIndex: context.targetIndex,
          promptCount: context.prompts.length,
          offsetThresholdPx: DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX,
        })
      ) {
        triedSuccessorAnchor = true;
        const anchorOutcome = await trySuccessorAnchorRecovery(
          context,
          currentTopOffsetPx,
          {
            queryJumpTarget,
            waitForTargetMount,
            waitForRenderedFrame,
          }
        );
        if (context.isCancelled() || anchorOutcome?.status === 'cancelled') {
          return { status: 'cancelled' };
        }
        if (anchorOutcome?.status === 'mounted') {
          return anchorOutcome;
        }
        // Anchor recovery could not establish a stable target: exit cleanly
        // rather than repeating the same ejected static offset.
        break;
      }

      if (offsetChanged || viewportDriftedFromTarget) {
        currentTopOffsetPx = nextResult.topOffsetPx;
        continue;
      }
    }

    // If the layout estimate did not shift yet, check whether the currently
    // mounted prompts tell us which direction the target lies and nudge by
    // one viewport step from the actual viewport position (when drifted) or
    // the previous target offset to bring adjacent turns into the mount window.
    let direction: -1 | 1 | null = null;
    try {
      const queue = seedMountQueue(context.prompts);
      const sidebarIndices = queueSidebarIndices(queue);
      direction = computeDirectionTowardTarget(
        context.targetIndex,
        sidebarIndices
      );
    } catch {
      direction = null;
    }

    if (direction !== null) {
      const maxScrollTop = Math.max(
        0,
        context.container.scrollHeight - context.container.clientHeight
      );
      const stepPx = Math.max(
        Math.round((context.container.clientHeight || 800) * 0.85),
        400
      );
      const nudgeBase = viewportDriftedFromWrite
        ? currentScrollTop
        : currentTopOffsetPx;
      const nudged = Math.max(
        0,
        Math.min(maxScrollTop || Infinity, nudgeBase + direction * stepPx)
      );
      if (Math.abs(nudged - nudgeBase) > DIRECT_JUMP_OFFSET_CHANGE_THRESHOLD_PX) {
        currentTopOffsetPx = nudged;
        continue;
      }
    }

    // No refined offset and no directional signal: finish the remaining
    // original mountTimeoutMs window once before reporting exhaustion.
    const remainingWaitMs = Math.max(0, fullMountTimeoutMs - firstWaitMs);
    if (remainingWaitMs > 0) {
      const lateElement = await waitForTargetMount(
        context.targetMessage.id,
        context.container,
        context.isCancelled,
        remainingWaitMs
      );
      if (context.isCancelled()) {
        return { status: 'cancelled' };
      }
      if (lateElement) {
        return {
          status: 'mounted',
          element: lateElement,
          topOffsetPx: currentTopOffsetPx,
        };
      }
    }
    break;
  }

  return { status: 'exhausted', reason: 'target-mount-timeout' };
}

/**
 * Evaluates navigation capability and executes the React virtual-layout jump strategy.
 *
 * Resolves capability once during the Initial Selection Phase:
 * - If bridge is missing/unavailable or direction is unsupported, selects Legacy Mode (unsupported).
 * - If target is in layout (ok) or older (target-not-in-layout with direction -1), locks Virtual Mode.
 *
 * @param context Strategy execution parameters including target prompt and cancellation check.
 * @returns VirtualStrategyAttempt indicating whether Virtual Mode is locked or Legacy Mode should run.
 */
export function tryVirtualLayoutStrategy(
  context: JumpStrategyContext
): VirtualStrategyAttempt {
  if (!JUMP_STRATEGY_CONFIG.virtualLayout.enabled) {
    return { mode: 'unsupported', reason: 'config-disabled' };
  }

  if (context.isCancelled()) {
    return {
      mode: 'virtual',
      promise: Promise.resolve({ status: 'cancelled' }),
    };
  }

  let platform;
  try {
    platform = getActivePlatform();
  } catch {
    return { mode: 'unsupported', reason: 'platform-resolution-failed' };
  }

  const queryVirtualJumpTarget = platform.navigation.queryVirtualJumpTarget;
  if (typeof queryVirtualJumpTarget !== 'function') {
    return { mode: 'unsupported', reason: 'bridge-unavailable' };
  }

  const targetMessageId = context.targetMessage.id;
  let result: VirtualJumpTargetResult;
  try {
    result = queryVirtualJumpTarget(context.container, targetMessageId);
  } catch {
    return { mode: 'unsupported', reason: 'bridge-query-threw' };
  }

  if (
    !result ||
    typeof result !== 'object' ||
    typeof result.status !== 'string'
  ) {
    return { mode: 'unsupported', reason: 'bridge-result-invalid' };
  }

  if (result.status === 'unavailable') {
    return { mode: 'unsupported', reason: 'bridge-unavailable' };
  }

  if (result.status === 'ok') {
    return {
      mode: 'virtual',
      promise: executeDirectVirtualJump(context, result),
    };
  }

  if (result.status === 'target-not-in-layout') {
    let sidebarIndices: number[] = [];
    try {
      const queue = seedMountQueue(context.prompts);
      sidebarIndices = queueSidebarIndices(queue);
    } catch {
      return { mode: 'unsupported', reason: 'mount-queue-failed' };
    }

    const direction = computeDirectionTowardTarget(
      context.targetIndex,
      sidebarIndices
    );

    if (direction === 1) {
      return {
        mode: 'unsupported',
        reason: 'downward-virtual-pagination-unimplemented',
      };
    }

    if (direction === null) {
      return { mode: 'unsupported', reason: 'unknown-direction' };
    }

    // direction === -1: Older history supported by Phase 2B
    return {
      mode: 'virtual',
      promise: paginateOlderVirtualLayout(context, result),
    };
  }

  return { mode: 'unsupported', reason: 'unknown-status' };
}
