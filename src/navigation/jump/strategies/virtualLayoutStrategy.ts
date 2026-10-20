/**
 * React virtual-layout jump strategy for unmounted prompts.
 */
import { getActivePlatform } from '@/platforms';
import type { VirtualJumpTargetResult } from '@/platforms/platformInterface';
import { computeDirectionTowardTarget } from '@/navigation/jump/direction';
import { DOM_SETTLE_CONFIG } from '@/navigation/jump/domSettle';
import { queueSidebarIndices, seedMountQueue } from '@/navigation/jump/mountQueue';
import { JUMP_STRATEGY_CONFIG } from './config';
import type {
  JumpStrategyContext,
  VirtualStrategyAttempt,
  VirtualStrategyExecutionResult,
} from './types';


/**
 * Queries active platform virtual jump target helper defensively.
 */
function queryJumpTarget(
  container: HTMLElement,
  messageId: string
): VirtualJumpTargetResult {
  const queryVirtualJumpTarget =
    getActivePlatform().navigation.queryVirtualJumpTarget;
  if (typeof queryVirtualJumpTarget !== 'function') {
    return { status: 'unavailable', reason: 'query-function-missing' };
  }
  return queryVirtualJumpTarget(container, messageId);
}

/**
 * Outcome of a multi-burst DOM quiescence observation session.
 */
export type VirtualProgressOutcome =
  | {
      readonly status: 'ok';
      readonly result: Extract<VirtualJumpTargetResult, { status: 'ok' }>;
    }
  | {
      readonly status: 'progress';
      readonly result: Extract<
        VirtualJumpTargetResult,
        { status: 'target-not-in-layout' }
      >;
    }
  | {
      readonly status: 'capability-failure';
      readonly reason: string;
    }
  | {
      readonly status: 'timeout';
    }
  | {
      readonly status: 'cancelled';
    };

/**
 * Active observation session for multi-burst DOM quiescence and layout growth.
 */
export interface DomQuiescenceProgressSession {
  readonly promise: Promise<VirtualProgressOutcome>;
  dispose(): void;
}

const CANCELLATION_POLL_INTERVAL_MS = 100;

/**
 * Yields two animation frames to ensure geometry changes are committed and painted
 * before the next DOM modification. In background tabs or throttled environments where
 * requestAnimationFrame is suspended, falls back to a timer (50ms) as a best-effort
 * safeguard against indefinite hangs.
 *
 * @param isCancelled Optional cancellation check predicate.
 */
function waitForRenderedFrame(isCancelled?: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let raf1Id: number | null = null;
    let raf2Id: number | null = null;

    const cleanup = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (raf1Id !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf1Id);
        raf1Id = null;
      }
      if (raf2Id !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf2Id);
        raf2Id = null;
      }
    };

    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    timerId = setTimeout(done, 50);

    if (typeof requestAnimationFrame === 'function') {
      raf1Id = requestAnimationFrame(() => {
        if (settled || isCancelled?.()) {
          done();
          return;
        }
        raf2Id = requestAnimationFrame(() => {
          done();
        });
      });
    }
  });
}

/**
 * Stimulates top-boundary pagination listeners.
 * When container.scrollTop > 1, scrolling to 0 creates an observable transition.
 * When scrollTop is already clamped at 0, writing 0 produces zero delta, which suppresses
 * scroll events and IntersectionObserver recalculation in Chromium.
 * We displace by a small offset, wait for the frame to render, then restore to 0.
 *
 * @param container Active scroll container.
 * @param isCancelled Callback returning true if navigation was superseded or cancelled.
 */
export async function stimulateTopBoundary(
  container: HTMLElement,
  isCancelled: () => boolean
): Promise<void> {
  const maxScroll = Math.max(
    0,
    container.scrollHeight - container.clientHeight
  );

  // Normal / non-boundary or unscrollable path:
  // When scrolled down (scrollTop > 1) or when container has no scrollable overflow (maxScroll <= 0),
  // scroll directly to 0 without pulse or frame waits, keeping scrollTo side effect synchronous.
  if (container.scrollTop > 1 || maxScroll <= 0) {
    container.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  // Actual boundary pulse path (scrollTop <= 1 && maxScroll > 0):
  const PULSE_OFFSET_PX = 32;
  const pulseTarget = Math.min(PULSE_OFFSET_PX, maxScroll);
  if (pulseTarget > 0) {
    container.scrollTop = pulseTarget;
    await waitForRenderedFrame(isCancelled);
    if (isCancelled()) return;
  }
  container.scrollTo({ top: 0, behavior: 'auto' });
  await waitForRenderedFrame(isCancelled);
}

/**
 * Synchronously attaches a MutationObserver to observe DOM mutation bursts until
 * host layout growth is detected or the overall timeout budget expires.
 *
 * @param params Observer configuration parameters.
 * @returns Active session exposing promise and immediate dispose function.
 */
export function startDomQuiescenceProgressObserver(params: {
  root: ParentNode;
  container: HTMLElement;
  targetMessageId: string;
  prompts?: ReadonlyArray<{ id: string }>;
  previousLowestIndex?: number | null;
  previousTurnCount: number;
  isCancelled: () => boolean;
  timeoutMs?: number;
  debounceMs?: number;
  pollIntervalMs?: number;
  minQuerySpacingMs?: number;
}): DomQuiescenceProgressSession {
  const {
    root,
    container,
    targetMessageId,
    prompts,
    previousLowestIndex,
    previousTurnCount,
    isCancelled,
    timeoutMs = JUMP_STRATEGY_CONFIG.virtualLayout.noProgressTimeoutMs,
    debounceMs = DOM_SETTLE_CONFIG.debounceMs,
    pollIntervalMs = JUMP_STRATEGY_CONFIG.virtualLayout.paginationPollIntervalMs,
    minQuerySpacingMs = JUMP_STRATEGY_CONFIG.virtualLayout.minQuerySpacingMs,
  } = params;

  let settled = false;
  let observer: MutationObserver | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledQueryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelCheckTimer: ReturnType<typeof setInterval> | null = null;
  let lastQueryTime = -Infinity;

  let sessionResolve!: (outcome: VirtualProgressOutcome) => void;
  const promise = new Promise<VirtualProgressOutcome>((resolve) => {
    sessionResolve = resolve;
  });

  const cleanup = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (scheduledQueryTimer !== null) {
      clearTimeout(scheduledQueryTimer);
      scheduledQueryTimer = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (cancelCheckTimer !== null) {
      clearInterval(cancelCheckTimer);
      cancelCheckTimer = null;
    }
  };

  const settle = (outcome: VirtualProgressOutcome) => {
    if (settled) return;
    settled = true;
    cleanup();
    sessionResolve(outcome);
  };

  const checkProgress = (result: VirtualJumpTargetResult): boolean => {
    if (result.status !== 'target-not-in-layout') return false;
    if (result.turnCount > previousTurnCount) return true;
    if (
      previousLowestIndex !== null &&
      previousLowestIndex !== undefined &&
      prompts
    ) {
      const currentLowest = getLowestMountedConnectedIndex(prompts, root);
      if (currentLowest !== null && currentLowest < previousLowestIndex) {
        return true;
      }
    }
    return false;
  };

  if (isCancelled()) {
    settle({ status: 'cancelled' });
    return {
      promise,
      dispose: () => settle({ status: 'cancelled' }),
    };
  }

  const executeQuery = () => {
    if (settled) return;
    if (isCancelled()) {
      settle({ status: 'cancelled' });
      return;
    }

    lastQueryTime = performance.now();

    let freshResult: VirtualJumpTargetResult;
    try {
      freshResult = queryJumpTarget(container, targetMessageId);
    } catch {
      settle({ status: 'capability-failure', reason: 'bridge-query-threw' });
      return;
    }

    if (freshResult.status === 'unavailable') {
      settle({ status: 'capability-failure', reason: 'bridge-unavailable' });
      return;
    }

    if (freshResult.status === 'ok') {
      settle({ status: 'ok', result: freshResult });
      return;
    }

    if (checkProgress(freshResult)) {
      settle({
        status: 'progress',
        result: freshResult as Extract<
          VirtualJumpTargetResult,
          { status: 'target-not-in-layout' }
        >,
      });
      return;
    }

    // Incidental / premature quiescence: turnCount has not yet increased.
    // Continue observing within the same watchdog budget.
  };

  const scheduleQuery = () => {
    if (settled || isCancelled()) return;

    // Coalesce repeated wake-ups into an existing pending query probe
    if (scheduledQueryTimer !== null) {
      return;
    }

    const elapsed = performance.now() - lastQueryTime;
    if (elapsed >= minQuerySpacingMs) {
      executeQuery();
    } else {
      const wait = minQuerySpacingMs - elapsed;
      scheduledQueryTimer = setTimeout(() => {
        scheduledQueryTimer = null;
        if (!settled && !isCancelled()) {
          executeQuery();
        }
      }, wait);
    }
  };

  // Synchronously attach MutationObserver BEFORE returning
  observer = new MutationObserver(() => {
    if (isCancelled()) {
      settle({ status: 'cancelled' });
      return;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      scheduleQuery();
    }, debounceMs);
  });

  try {
    observer.observe(root, { childList: true, subtree: true });
  } catch {
    settle({ status: 'capability-failure', reason: 'observer-attach-failed' });
    return {
      promise,
      dispose: () => settle({ status: 'cancelled' }),
    };
  }

  // Arm low-frequency fallback polling
  if (pollIntervalMs > 0) {
    pollTimer = setInterval(() => {
      if (settled) return;
      if (isCancelled()) {
        settle({ status: 'cancelled' });
        return;
      }
      // If a debounce is already scheduled in <= debounceMs, let that check fire
      if (debounceTimer !== null) {
        return;
      }
      scheduleQuery();
    }, pollIntervalMs);
  }

  // Arm per-batch no-progress watchdog budget
  watchdogTimer = setTimeout(() => {
    if (settled) return;
    if (isCancelled()) {
      settle({ status: 'cancelled' });
      return;
    }

    // Clear any pending throttled or debounced query
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (scheduledQueryTimer !== null) {
      clearTimeout(scheduledQueryTimer);
      scheduledQueryTimer = null;
    }

    // Final read-only timeout-boundary query (bypasses minQuerySpacingMs throttling)
    let finalResult: VirtualJumpTargetResult | null = null;
    try {
      finalResult = queryJumpTarget(container, targetMessageId);
    } catch {
      // Bridge throw will result in timeout or capability-failure
    }

    if (isCancelled()) {
      settle({ status: 'cancelled' });
      return;
    }

    if (finalResult && finalResult.status === 'ok') {
      settle({ status: 'ok', result: finalResult });
      return;
    }

    if (
      finalResult &&
      checkProgress(finalResult)
    ) {
      settle({
        status: 'progress',
        result: finalResult as Extract<
          VirtualJumpTargetResult,
          { status: 'target-not-in-layout' }
        >,
      });
      return;
    }

    settle({ status: 'timeout' });
  }, timeoutMs);

  // Arm lightweight cancellation-only wake-up interval
  cancelCheckTimer = setInterval(() => {
    if (isCancelled()) {
      settle({ status: 'cancelled' });
    }
  }, CANCELLATION_POLL_INTERVAL_MS);

  return {
    promise,
    dispose: () => settle({ status: 'cancelled' }),
  };
}

/**
 * Inspects currently mounted and connected prompt elements to find the lowest sidebar index.
 *
 * @param prompts Readonly list of conversation prompts.
 * @param root Document or parent node to inspect.
 * @returns The minimum sidebar index of mounted connected prompts, or null if none found.
 */
export function getLowestMountedConnectedIndex(
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode = document
): number | null {
  try {
    const queue = seedMountQueue(prompts, root);
    const indices: number[] = [];
    for (const entry of queue.values()) {
      if (entry.element && entry.element.isConnected) {
        indices.push(entry.sidebarIdx);
      }
    }
    return indices.length > 0 ? Math.min(...indices) : null;
  } catch {
    return null;
  }
}

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

      if (isCancelled()) {
        return { status: 'cancelled' };
      }

      try {
        container.scrollTo({
          top: topOffsetPx,
          behavior: 'auto',
        });
      } catch {
        return { status: 'exhausted', reason: 'target-scroll-threw' };
      }

      const mountedElement = await waitForTargetMount(
        targetMessageId,
        container,
        isCancelled,
        mountTimeoutMs
      );

      if (isCancelled()) {
        return { status: 'cancelled' };
      }

      if (mountedElement) {
        return { status: 'mounted', element: mountedElement };
      }

      return { status: 'exhausted', reason: 'target-mount-timeout' };
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

/**
 * Executes a direct virtual layout jump to a prompt already present in the host layout dataset.
 *
 * @param context Strategy execution parameters.
 * @param result Layout query result with status: 'ok'.
 * @returns Promise resolving to execution result.
 */
async function executeDirectVirtualJump(
  context: JumpStrategyContext,
  result: Extract<VirtualJumpTargetResult, { status: 'ok' }>
): Promise<VirtualStrategyExecutionResult> {
  const topOffsetPx = result.topOffsetPx;
  if (
    typeof topOffsetPx !== 'number' ||
    !Number.isFinite(topOffsetPx) ||
    topOffsetPx < 0
  ) {
    return { status: 'capability-failure', reason: 'invalid-top-offset' };
  }

  if (context.isCancelled()) {
    return { status: 'cancelled' };
  }

  try {
    context.container.scrollTo({
      top: topOffsetPx,
      behavior: 'auto',
    });
  } catch {
    return { status: 'exhausted', reason: 'container-scroll-threw' };
  }

  const mountedElement = await waitForTargetMount(
    context.targetMessage.id,
    context.container,
    context.isCancelled,
    JUMP_STRATEGY_CONFIG.virtualLayout.mountTimeoutMs
  );

  if (context.isCancelled()) {
    return { status: 'cancelled' };
  }

  if (mountedElement) {
    return { status: 'mounted', element: mountedElement };
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
