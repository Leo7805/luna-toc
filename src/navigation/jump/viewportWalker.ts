/**
 * Handles low-level viewport stepping and DOM mount synchronization for unmounted prompts.
 */
import { getActivePlatform } from '@/platforms';
import {
  detectNewMounts,
  findTargetInQueue,
  queueSidebarIndices,
  seedMountQueue,
  type MountQueue,
} from './mountQueue';
import { computeDirectionTowardTarget } from './direction';
import { waitForDomChange, DOM_SETTLE_CONFIG } from './domSettle';
import { JUMP_STRATEGY_CONFIG } from './strategies/config';

function platform() {
  return getActivePlatform();
}

const isJumpVizDebugEnabled = (
  storage?: Pick<Storage, 'getItem'>
): boolean =>
  platform().diagnostics.isJumpVizDebugEnabled?.(storage) ?? false;

/**
 * Clamps a candidate `scrollTop` to the physical scroll range. In
 * standard flex the range is `[0, maxScrollTop]`; in column-reverse
 * the historical code path clamped to `[-maxScrollTop, 0]` because
 * older ChatGPT builds used negative scrollTop values. Both branches
 * are kept here so any future regression to the negative range still
 * works — column-reverse is detected from `getComputedStyle`.
 */
function clampScrollTo(
  container: HTMLElement,
  next: number,
  isReverse: boolean
): number {
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight
  );
  return isReverse
    ? Math.max(-maxScrollTop, Math.min(0, next))
    : Math.max(0, Math.min(maxScrollTop, next));
}

/**
 * Pacing helper: yields one browser animation frame between scroll writes.
 */
function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}


/**
 * Checks whether the exact target prompt is currently rendered and connected.
 */
function findExactTarget(
  mountQueue: MountQueue,
  targetId: string,
  targetIndex: number,
  root: ParentNode = document
): HTMLElement | null {
  const el = findTargetInQueue(mountQueue, targetId, targetIndex, root);
  return el && el.isConnected ? el : null;
}

/**
 * Structured termination reason reported when the viewport walker cannot mount the target.
 */
export type ViewportWalkFailureReason =
  | 'no-mounted-at-seed'
  | 'unknown-direction'
  | 'cancelled'
  | 'boundary-exhausted'
  | 'oscillation-no-progress'
  | 'direction-oscillation'
  | 'no-progress-timeout'
  | 'max-steps-reached';

const MAX_WALK_STEPS = 200;
const MAX_UNPRODUCTIVE_STEPS = 8;
const MAX_DIRECTION_FLIPS = 4;
const MAX_NO_PROGRESS_MS = 4000;
const BOUNDARY_TOLERANCE_PX = 1;

function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Tests whether `after` moved in the requested direction relative to `before`.
 * Supports both standard flex and column-reverse negative scrollTop.
 */
function hasMovedTowardTarget(
  before: number,
  after: number,
  direction: 1 | -1
): boolean {
  return (after - before) * direction > 0;
}

/**
 * Returns true only when the container is already at the physical scroll edge
 * in `direction`, distinguishing genuine boundary/pagination stalls from
 * mid-feed host scroll-anchor compensation reversals.
 */
function isAtPhysicalBoundary(
  container: HTMLElement,
  direction: 1 | -1,
  isReverse: boolean
): boolean {
  const maxScrollTop = Math.max(
    0,
    container.scrollHeight - container.clientHeight
  );
  const current = container.scrollTop;
  if (isReverse) {
    return direction === -1
      ? current <= -maxScrollTop + BOUNDARY_TOLERANCE_PX
      : current >= -BOUNDARY_TOLERANCE_PX;
  }
  return direction === -1
    ? current <= BOUNDARY_TOLERANCE_PX
    : current >= maxScrollTop - BOUNDARY_TOLERANCE_PX;
}

/**
 * Returns the minimum sidebar-index distance between `targetIndex` and any
 * currently mounted prompt, or null if no prompts are mounted.
 */
function getFrontierDistanceToTarget(
  targetIndex: number,
  indices: ReadonlyArray<number>
): number | null {
  if (indices.length === 0) return null;
  let minDistance = Infinity;
  for (const idx of indices) {
    const dist = Math.abs(targetIndex - idx);
    if (dist < minDistance) minDistance = dist;
  }
  return Number.isFinite(minDistance) ? minDistance : null;
}

/**
 * Handles a physical scroll boundary stall (e.g. top of conversation).
 * Nudges the scroll container at the boundary to stimulate ChatGPT's
 * scroll-boundary listeners, then waits for DOM mutations or scroll-range expansion.
 */
async function handleBoundaryOrBackfillStall(
  container: HTMLElement,
  mountQueue: MountQueue,
  targetId: string,
  targetIndex: number,
  direction: 1 | -1,
  isReverse: boolean,
  isCancelled: () => boolean,
  settleMs: number,
  root: ParentNode
): Promise<HTMLElement | null | 'resumed'> {
  const preCheck = findExactTarget(mountQueue, targetId, targetIndex, root);
  if (preCheck) return preCheck;

  // Send small burst of edge flick writes (up to 5 writes spaced 10ms)
  // to stimulate host infinite-scroll / pagination observers at the boundary
  const MAX_BATCH_SIZE = 5;
  const BATCH_INTERVAL_MS = 10;
  const step = direction * window.innerHeight;
  for (let i = 0; i < MAX_BATCH_SIZE; i++) {
    if (isCancelled()) return null;
    const next = container.scrollTop + step;
    container.scrollTop = clampScrollTo(container, next, isReverse);
    await new Promise<void>((r) => setTimeout(r, BATCH_INTERVAL_MS));
  }

  const postBatchCheck = findExactTarget(mountQueue, targetId, targetIndex, root);
  if (postBatchCheck) return postBatchCheck;

  const changed = await waitForDomChange(
    document.body,
    isCancelled,
    Math.max(settleMs, 100),
    DOM_SETTLE_CONFIG.debounceMs
  );

  if (changed === 'cancelled' || isCancelled()) return null;

  const targetAfterWait = findExactTarget(mountQueue, targetId, targetIndex, root);
  if (targetAfterWait) return targetAfterWait;

  // Check if boundary expanded (physical scrolling can move now)
  const testScrollTop = clampScrollTo(container, container.scrollTop + step, isReverse);
  if (testScrollTop !== container.scrollTop) {
    return 'resumed';
  }

  return null;
}


/**
 * Actively loads the target prompt when it is not currently mounted.
 * Walks the scroll container toward the target one viewport at a time
 * while simultaneously watching for the target via a passive MutationObserver.
 * Stops immediately the instant the target appears in the DOM.
 *
 * @param targetId Stable prompt ID to search for.
 * @param targetIndex 0-indexed position in the conversation.
 * @param prompts Readonly array of conversation prompt descriptors.
 * @param container Live scroll container element.
 * @param _jumpId Optional diagnostic navigation jump ID.
 * @param isCancelled Optional cancellation check predicate.
 * @returns The mounted target HTMLElement, or null if cancelled or exhausted.
 */
export async function loadUntilMountedViaViewport(
  targetId: string,
  targetIndex: number,
  prompts: ReadonlyArray<{ id: string }>,
  container: HTMLElement,
  jumpId?: string,
  isCancelled: () => boolean = () => false,
  onFailureReason?: (reason: ViewportWalkFailureReason) => void
): Promise<HTMLElement | null> {
  const LOAD_SETTLE_MS = 1500;
  const root = document;

  function logLoadStep(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC load-step]', details);
    }
  }

  function finishWithFailure(reason: ViewportWalkFailureReason): null {
    onFailureReason?.(reason);
    logLoadStep({ result: reason });
    return null;
  }

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';

  // Seed the queue to establish initial direction
  const mountQueue: MountQueue = seedMountQueue(prompts, root);
  if (mountQueue.size === 0) {
    return finishWithFailure('no-mounted-at-seed');
  }

  // Initial check: if already mounted, exit immediately in 0 scroll writes
  const initialHit = findExactTarget(mountQueue, targetId, targetIndex, root);
  if (initialHit) {
    logLoadStep({ result: 'found-in-seed' });
    return initialHit;
  }

  const sidebarIndices = queueSidebarIndices(mountQueue);
  const initialDirection = computeDirectionTowardTarget(
    targetIndex,
    sidebarIndices
  );
  if (initialDirection === null) {
    return finishWithFailure('unknown-direction');
  }
  let direction = initialDirection;

  // Passive exact-target observer for the lifetime of this walk
  let detectedTarget: HTMLElement | null = null;
  const targetObserver = new MutationObserver(() => {
    if (isCancelled()) return;
    const found = findExactTarget(mountQueue, targetId, targetIndex, root);
    if (found) {
      detectedTarget = found;
    }
  });

  try {
    targetObserver.observe(root, { childList: true, subtree: true });

    let stepIndex = 0;
    let unproductiveSteps = 0;
    let directionFlips = 0;
    let bestScrollTopInDirection: number | null = container.scrollTop;
    let bestFrontierDistance = getFrontierDistanceToTarget(
      targetIndex,
      sidebarIndices
    );
    let lastProgressAtMs = getMonotonicNowMs();
    let failureReason: ViewportWalkFailureReason = 'boundary-exhausted';

    while (!isCancelled()) {
      if (stepIndex >= MAX_WALK_STEPS) {
        failureReason = 'max-steps-reached';
        break;
      }
      if (getMonotonicNowMs() - lastProgressAtMs >= MAX_NO_PROGRESS_MS) {
        failureReason = 'no-progress-timeout';
        break;
      }

      const currentStep = stepIndex++;

      // Check if target was detected by passive observer or direct check
      const observedHit = detectedTarget as HTMLElement | null;
      if (observedHit && observedHit.isConnected) {
        return observedHit;
      }
      const targetBeforeStep = findExactTarget(mountQueue, targetId, targetIndex, root);
      if (targetBeforeStep) {
        return targetBeforeStep;
      }

      const beforeScrollTop = container.scrollTop;
      const stepDirection = direction;
      const step =
        stepDirection *
        (window.innerHeight * JUMP_STRATEGY_CONFIG.viewportWalker.stepViewports);
      const nextScrollTop = beforeScrollTop + step;
      const clampedScrollTop = clampScrollTo(container, nextScrollTop, isReverse);

      container.scrollTop = clampedScrollTop;
      logLoadStep({
        step: currentStep,
        phase: 'fast-step',
        direction: stepDirection,
        beforeScrollTop,
        afterScrollTop: clampedScrollTop,
      });

      // Pacing: yield one browser animation frame
      await nextAnimationFrame();

      if (isCancelled()) {
        return finishWithFailure('cancelled');
      }

      // Target check after frame yield
      const observedPostFrame = detectedTarget as HTMLElement | null;
      if (observedPostFrame && observedPostFrame.isConnected) {
        return observedPostFrame;
      }

      // Ingest currently/newly mounted prompts into mountQueue
      const freshMounts = detectNewMounts(mountQueue, prompts, root);
      for (const entry of freshMounts) {
        mountQueue.set(entry.unitKey, entry);
      }
      for (const [key, entry] of mountQueue) {
        if (!entry.element.isConnected) {
          mountQueue.delete(key);
        }
      }

      const targetAfterFrame = findExactTarget(mountQueue, targetId, targetIndex, root);
      if (targetAfterFrame) {
        return targetAfterFrame;
      }

      // Recompute mounted indices and direction toward target
      const currentIndices = queueSidebarIndices(mountQueue);
      const nextDir = computeDirectionTowardTarget(targetIndex, currentIndices);
      const afterScrollTop = container.scrollTop;
      const movedTowardTarget = hasMovedTowardTarget(
        beforeScrollTop,
        afterScrollTop,
        stepDirection
      );

      if (nextDir !== null && nextDir !== direction) {
        direction = nextDir;
        directionFlips += 1;
        bestScrollTopInDirection = afterScrollTop;
        if (directionFlips >= MAX_DIRECTION_FLIPS) {
          failureReason = 'direction-oscillation';
          break;
        }
      }

      const frontierDistance = getFrontierDistanceToTarget(
        targetIndex,
        currentIndices
      );
      const frontierImproved =
        frontierDistance !== null &&
        (bestFrontierDistance === null || frontierDistance < bestFrontierDistance);
      if (frontierImproved && frontierDistance !== null) {
        bestFrontierDistance = frontierDistance;
      }

      const netScrollImproved =
        bestScrollTopInDirection === null ||
        hasMovedTowardTarget(
          bestScrollTopInDirection,
          afterScrollTop,
          stepDirection
        );
      if (netScrollImproved) {
        bestScrollTopInDirection = afterScrollTop;
      }

      if ((movedTowardTarget && netScrollImproved) || frontierImproved) {
        // Meaningful net progress toward target; reset unproductive counters
        unproductiveSteps = 0;
        lastProgressAtMs = getMonotonicNowMs();
        continue;
      }

      if (movedTowardTarget) {
        // Frame moved locally, but host compensation has kept us behind our
        // previous best position in this direction.
        unproductiveSteps += 1;
        if (unproductiveSteps >= MAX_UNPRODUCTIVE_STEPS) {
          failureReason = 'oscillation-no-progress';
          break;
        }
        continue;
      }

      // Did not move toward target: only invoke boundary/backfill stall when
      // actually at a physical scroll boundary (not mid-feed host compensation).
      if (!isAtPhysicalBoundary(container, stepDirection, isReverse)) {
        unproductiveSteps += 1;
        if (unproductiveSteps >= MAX_UNPRODUCTIVE_STEPS) {
          failureReason = 'oscillation-no-progress';
          break;
        }
        continue;
      }

      // Physical stall: hit boundary without target. Enter boundary/backfill wait.
      const stallOutcome = await handleBoundaryOrBackfillStall(
        container,
        mountQueue,
        targetId,
        targetIndex,
        direction,
        isReverse,
        isCancelled,
        LOAD_SETTLE_MS,
        root
      );

      if (isCancelled()) return finishWithFailure('cancelled');

      if (stallOutcome === 'resumed') {
        // Boundary expanded via pagination/backfill; treat as productive progress
        unproductiveSteps = 0;
        lastProgressAtMs = getMonotonicNowMs();
        bestScrollTopInDirection = container.scrollTop;
        continue;
      }

      if (stallOutcome) {
        // Target was found during stall handling
        return stallOutcome;
      }

      // Boundary stall could not resolve (exhausted)
      failureReason = 'boundary-exhausted';
      break;
    }

    return finishWithFailure(isCancelled() ? 'cancelled' : failureReason);
  } finally {
    targetObserver.disconnect();
  }
}
