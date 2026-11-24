/**
 * Virtual-layout DOM observation, older-history pagination support, and shared
 * query/render primitives used by the React virtual-layout jump strategy.
 */
import { getActivePlatform } from '@/platforms';
import type { VirtualJumpTargetResult } from '@/platforms/platformInterface';
import { DOM_SETTLE_CONFIG } from '@/navigation/jump/domSettle';
import { seedMountQueue } from '@/navigation/jump/mountQueue';
import { JUMP_STRATEGY_CONFIG } from './config';

/**
 * Queries active platform virtual jump target helper defensively.
 *
 * @param container Active scroll container.
 * @param messageId Target message ID to locate in the virtual layout.
 * @returns Platform virtual jump query result, or an unavailable sentinel.
 */
export function queryJumpTarget(
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
export function waitForRenderedFrame(
  isCancelled?: () => boolean
): Promise<void> {
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
