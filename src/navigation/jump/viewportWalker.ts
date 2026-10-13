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
 * One-shot MutationObserver wait: resolves `true` once the DOM has
 * changed within `timeoutMs`, `false` on timeout. Debounced so
 * per-node callbacks fired by React during a batch mount coalesce
 * into one effective signal. If `isCancelled` returns true, resolves `'cancelled'`.
 * Used strictly during physical boundary stalls.
 */
function waitForDomChange(
  root: ParentNode,
  isCancelled: () => boolean,
  timeoutMs: number,
  debounceMs: number = 10
): Promise<boolean | 'cancelled'> {
  return new Promise<boolean | 'cancelled'>(function (resolve) {
    let settled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function finish(result: boolean | 'cancelled'): void {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      resolve(result);
    }

    const observer = new MutationObserver(function () {
      if (isCancelled()) {
        finish('cancelled');
        return;
      }
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (isCancelled()) {
          finish('cancelled');
          return;
        }
        finish(true);
      }, debounceMs);
    });
    observer.observe(root, { childList: true, subtree: true });

    timeoutTimer = setTimeout(function () {
      if (settled) return;
      finish(false);
    }, timeoutMs);
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

  const OBSERVER_DEBOUNCE_MS = 10;
  const changed = await waitForDomChange(
    document.body,
    isCancelled,
    Math.max(settleMs, 100),
    OBSERVER_DEBOUNCE_MS
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
 * Returns 1 if the target sits "below" the closest mounted prompt in
 * sidebar-index terms (so we should scroll toward newer turns), and -1
 * if it sits "above" (so we should scroll toward older turns).
 */
function computeDirectionTowardTarget(
  targetIndex: number,
  sidebarIndices: ReadonlyArray<number>
): 1 | -1 {
  let nearestIdx = sidebarIndices[0];
  let currentDist = Math.abs(targetIndex - nearestIdx);
  for (let j = 1; j < sidebarIndices.length; j++) {
    const d = Math.abs(targetIndex - sidebarIndices[j]);
    if (d < currentDist) {
      currentDist = d;
      nearestIdx = sidebarIndices[j];
    }
  }
  return targetIndex > nearestIdx ? 1 : -1;
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
  _jumpId?: string,
  isCancelled: () => boolean = () => false
): Promise<HTMLElement | null> {
  const LOAD_SETTLE_MS = 1500;
  const root = document;

  function logLoadStep(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC load-step]', details);
    }
  }

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';

  // Seed the queue to establish initial direction
  const mountQueue: MountQueue = seedMountQueue(prompts, root);
  if (mountQueue.size === 0) {
    logLoadStep({ result: 'no-mounted-at-seed' });
    return null;
  }

  // Initial check: if already mounted, exit immediately in 0 scroll writes
  const initialHit = findExactTarget(mountQueue, targetId, targetIndex, root);
  if (initialHit) {
    logLoadStep({ result: 'found-in-seed' });
    return initialHit;
  }

  const sidebarIndices = queueSidebarIndices(mountQueue);
  if (sidebarIndices.length === 0) {
    return null;
  }
  let direction = computeDirectionTowardTarget(targetIndex, sidebarIndices);

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
    while (!isCancelled()) {
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
      const step = stepDirection * window.innerHeight;
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
        return null;
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
      if (currentIndices.length > 0) {
        direction = computeDirectionTowardTarget(targetIndex, currentIndices);
      }

      const afterScrollTop = container.scrollTop;
      const movedTowardTarget = hasMovedTowardTarget(beforeScrollTop, afterScrollTop, stepDirection);

      if (movedTowardTarget) {
        // Physical scroll moved freely in the requested direction.
        // Keep fast-walking without any MutationObserver or settle delay.
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

      if (isCancelled()) return null;

      if (stallOutcome === 'resumed') {
        // Boundary expanded, resume fast walk
        continue;
      }

      if (stallOutcome) {
        // Target was found during stall handling
        return stallOutcome;
      }

      // Boundary stall could not resolve (exhausted)
      break;
    }

    logLoadStep({ result: isCancelled() ? 'cancelled' : 'exhausted' });
    return null;
  } finally {
    targetObserver.disconnect();
  }
}
