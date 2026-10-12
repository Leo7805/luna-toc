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
 * One-shot MutationObserver wait: resolves `true` once the DOM has
 * changed within `timeoutMs`, `false` on timeout. Debounced so
 * per-node callbacks fired by React during a batch mount coalesce
 * into one effective "mount complete" signal. If `isCancelled` returns
 * true (the user clicked another prompt mid-flight or version bumped),
 * resolves `'cancelled'`.
 *
 * Shared by `waitForMount` and `settleOnce` — both want the same
 * "did the DOM change in response to my scrollTop write" signal.
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

    function finish(result: boolean | 'cancelled'): void {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
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

    setTimeout(function () {
      finish(false);
    }, timeoutMs);
  });
}

/**
 * One round of the to-top-style settle: send a small batch of
 * `scrollTop` writes spaced 10 ms apart, then wait for ChatGPT's
 * MutationObserver to report that the DOM has changed (debounced to
 * 10 ms to coalesce the per-node callbacks React fires during a
 * batch mount). Returns the target element if it landed inside the
 * batch, otherwise null so the outer loop can decide whether to
 * take another step.
 */
async function settleOnce(
  container: HTMLElement,
  mountQueue: MountQueue,
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode,
  targetId: string,
  targetIndex: number,
  direction: 1 | -1,
  isReverse: boolean,
  isCancelled: () => boolean,
  settleMs: number
): Promise<HTMLElement | null> {
  function logSettlePoll(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC settle-poll]', details);
    }
  }

  // Send the same direction step a handful of times in a tight loop.
  // Each write moves one viewport toward the target; together they
  // mimic a continuous flick. 10 ms between writes is short enough
  // to land before ChatGPT has finished processing the previous one
  // (so it sees a batch) and long enough to avoid being collapsed
  // into a single no-op by the browser.
  const MAX_BATCH_SIZE = 5;
  const BATCH_INTERVAL_MS = 10;
  const step = direction * window.innerHeight;
  for (let i = 0; i < MAX_BATCH_SIZE; i++) {
    const next = container.scrollTop + step;
    container.scrollTop = clampScrollTo(container, next, isReverse);
    await new Promise<void>(function (resolve) {
      setTimeout(resolve, BATCH_INTERVAL_MS);
    });
  }

  // Watch for the batch's mount response via MutationObserver. Shared
  // with `waitForMount` — both want the same "did the DOM change in
  // response to my scrollTop write" signal.
  const OBSERVER_DEBOUNCE_MS = 10;
  const OBSERVER_TIMEOUT_MS = Math.max(settleMs, 100);
  const changed = await waitForDomChange(
    document.body,
    isCancelled,
    OBSERVER_TIMEOUT_MS,
    OBSERVER_DEBOUNCE_MS
  );
  if (changed === 'cancelled') return null;

  logSettlePoll({
    phase: 'observer-returned',
    changed: changed === true,
    elapsedMs: OBSERVER_TIMEOUT_MS,
  });

  // Pull whatever ChatGPT mounted during the wait into the queue
  // before re-scanning it for the target. `detectNewMounts` also
  // refreshes the element reference on existing entries, so a
  // re-mount by ChatGPT during virtual render doesn't leave us
  // holding a stale node.
  const newEntries = detectNewMounts(mountQueue, prompts, root);
  for (const entry of newEntries) mountQueue.set(entry.unitKey, entry);

  return findTargetInQueue(mountQueue, targetId, targetIndex);
}

/**
 * One round of "wait for ChatGPT to actually finish mounting after a
 * `scrollTop` change, then check if the target is in the queue".
 */
async function waitForMount(
  mountQueue: MountQueue,
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode,
  targetId: string,
  targetIndex: number,
  isCancelled: () => boolean,
  timeoutMs: number
): Promise<HTMLElement | null | 'cancelled'> {
  const OBSERVER_DEBOUNCE_MS = 10;

  function checkAfterMount(): HTMLElement | null {
    const newEntries = detectNewMounts(mountQueue, prompts, root);
    for (const entry of newEntries) mountQueue.set(entry.unitKey, entry);
    return findTargetInQueue(mountQueue, targetId, targetIndex);
  }

  // Cheap synchronous re-scan first — many of ChatGPT's in-memory
  // mounts land before the next paint, so this catches the easy hits
  // without paying the observer latency.
  const immediateHit = checkAfterMount();
  if (immediateHit) return immediateHit;

  // Wait for the next DOM change and re-scan; loop because one
  // observer signal can carry multiple mounts and ChatGPT may keep
  // mounting additional batches as it processes the scrollTop write.
  while (true) {
    const result = await waitForDomChange(
      root,
      isCancelled,
      timeoutMs,
      OBSERVER_DEBOUNCE_MS
    );
    if (result === 'cancelled') return 'cancelled';
    const hit = checkAfterMount();
    if (hit) return hit;
    if (result === false) return null;
  }
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
 * The loop maintains a `MountQueue` of every prompt LunaTOC knows has been
 * mounted in the DOM, and steps `scrollTop` toward the target one viewport
 * at a time. After each step the loop immediately re-scans the queue for the
 * target. When no new prompts mount across a step, enters `settleOnce` to wait
 * for async backfill.
 *
 * @param targetId Stable prompt ID to search for.
 * @param targetIndex 0-indexed position in the conversation.
 * @param prompts Readonly array of conversation prompt descriptors.
 * @param container Live scroll container element.
 * @param jumpId Optional diagnostic navigation jump ID.
 * @param isCancelled Optional cancellation check predicate.
 * @returns The mounted target HTMLElement, or null if cancelled or exhausted.
 *
 * @example
 * ```ts
 * const element = await loadUntilMountedViaViewport(
 *   'prompt-1',
 *   0,
 *   prompts,
 *   container,
 *   'jump-123',
 *   () => isCancelled
 * );
 * ```
 */
export async function loadUntilMountedViaViewport(
  targetId: string,
  targetIndex: number,
  prompts: ReadonlyArray<{ id: string }>,
  container: HTMLElement,
  jumpId?: string,
  isCancelled: () => boolean = () => false
): Promise<HTMLElement | null> {
  const LOAD_HARD_CAP = 30;
  const LOAD_SETTLE_MS = 1500;
  const root = document;

  function logLoadStep(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC load-step]', details);
    }
  }

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';

  // Seed the queue with whatever ChatGPT currently has mounted.
  const mountQueue: MountQueue = seedMountQueue(prompts, root);

  if (mountQueue.size === 0) {
    logLoadStep({ result: 'no-mounted-at-seed' });
    return null;
  }

  // Cheap pre-check: if the target is already in the seed, return immediately.
  const initialHit = findTargetInQueue(mountQueue, targetId, targetIndex);
  if (initialHit) {
    logLoadStep({ result: 'found-in-seed' });
    return initialHit;
  }

  for (let attempt = 0; attempt < LOAD_HARD_CAP; attempt++) {
    // Cancellation: the user picked another prompt mid-flight.
    if (isCancelled()) {
      logLoadStep({ attempt, result: 'cancelled' });
      return null;
    }

    // Compute the next step using the queue's current sidebar-index spread.
    const sidebarIndices = queueSidebarIndices(mountQueue);
    if (sidebarIndices.length === 0) {
      logLoadStep({ attempt, result: 'queue-empty' });
      break;
    }
    const direction = computeDirectionTowardTarget(targetIndex, sidebarIndices);
    const step = direction * window.innerHeight;
    const beforeScrollTop = container.scrollTop;
    const nextScrollTop = beforeScrollTop + step;
    const clampedScrollTop = clampScrollTo(container, nextScrollTop, isReverse);
    container.scrollTop = clampedScrollTop;
    logLoadStep({
      attempt,
      phase: 'step',
      direction,
      beforeScrollTop,
      afterScrollTop: clampedScrollTop,
      deltaScrollTop: clampedScrollTop - beforeScrollTop,
    });

    // Wait for mount triggered by scrollTop write, then check queue.
    const MOUNT_WAIT_TIMEOUT_MS = 500;
    const waitResult = await waitForMount(
      mountQueue,
      prompts,
      root,
      targetId,
      targetIndex,
      isCancelled,
      MOUNT_WAIT_TIMEOUT_MS
    );
    if (waitResult === 'cancelled') {
      logLoadStep({ attempt, result: 'cancelled-after-wait' });
      return null;
    }
    if (waitResult) {
      logLoadStep({
        attempt,
        result: 'found-after-wait',
        direction,
      });
      return waitResult;
    }

    // No hit within the wait. Settle with a batch of scrollTop writes.
    const settled = await settleOnce(
      container,
      mountQueue,
      prompts,
      root,
      targetId,
      targetIndex,
      direction,
      isReverse,
      isCancelled,
      LOAD_SETTLE_MS
    );
    if (settled) {
      logLoadStep({ attempt, result: 'found-after-settle' });
      return settled;
    }
    if (isCancelled()) {
      logLoadStep({ attempt, result: 'cancelled-after-settle' });
      return null;
    }
  }

  logLoadStep({ result: 'hard-cap-reached' });
  return null;
}
