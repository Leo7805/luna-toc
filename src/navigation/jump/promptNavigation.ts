/**
 * Handles main prompt navigation from LunaTOC to ChatGPT positions.
 */
import { getChatGptNavigationAlgorithm } from '../navigationSettings';
import { APP_CONFIG } from '@/config/config';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import {
  findRenderedChatGptPrompt as _findRenderedChatGptPrompt,
  findRenderedChatGptPromptByText as _findRenderedChatGptPromptByText,
  getChatGptScrollContainer as _getChatGptScrollContainer,
} from '@/platforms/chatgpt/virtualSearchAdapter';
import {
  createChatGptNavigationJumpId as _createChatGptNavigationJumpId,
  logChatGptNavigationEvent as _logChatGptNavigationEvent,
  isJumpVizDebugEnabled as _isJumpVizDebugEnabled,
} from '@/platforms/chatgpt/navigationDiagnostics';
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

const findRenderedChatGptPrompt = (
  promptId: string,
  root?: ParentNode
): HTMLElement | null =>
  platform().navigation.findRenderedPrompt(promptId, root);
const findRenderedChatGptPromptByText = (
  text: string,
  root?: ParentNode
): HTMLElement | null => _findRenderedChatGptPromptByText(text, root);
const getChatGptScrollContainer = (root?: ParentNode): HTMLElement | null =>
  _getChatGptScrollContainer(root);
const createChatGptNavigationJumpId = (): string =>
  platform().diagnostics.createJumpId();
const logChatGptNavigationEvent = (
  jumpId: string,
  eventName: string,
  details: Record<string, unknown> = {},
  storage: Parameters<typeof _logChatGptNavigationEvent>[3] = localStorage
): void => _logChatGptNavigationEvent(jumpId, eventName, details, storage);
const isJumpVizDebugEnabled = (
  storage: Parameters<typeof _isJumpVizDebugEnabled>[0] = localStorage
): boolean => _isJumpVizDebugEnabled(storage);

/**
 * Prints the currently-mounted and currently-visible user messages to the
 * console, tagged with the given label so callers can distinguish which
 * phase emitted the dump (e.g. `'fast-path'`, `'pre-search'`,
 * `'post-search'`). Active only when the `chatTocDebugJumpViz` toggle is
 * `1` in `localStorage`; default off.
 *
 * @param label Phase identifier prepended to the dump.
 */
function logMountedPromptViz(label: string): void {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-chatgpt-search-unit-key$=":user"]'
    )
  );
  const visible = all.filter(function (el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  const hidden = all.filter(function (el) {
    const r = el.getBoundingClientRect();
    return !(r.top < window.innerHeight && r.bottom > 0);
  });
  function truncate(s: string, n: number): string {
    const oneLine = s.replace(/\s+/g, ' ').trim();
    return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
  }
  function dump(list: HTMLElement[], header: string): void {
    console.log(`  ${header} (n=${list.length}):`);
    list.forEach(function (el, i) {
      const r = el.getBoundingClientRect();
      const id = el.getAttribute('data-chatgpt-search-message-ids') || '(none)';
      const text = truncate(el.textContent || '', 40);
      console.log(
        `    ${i + 1}. ${id.slice(0, 8)} "${text}"` +
          `  top=${Math.round(r.top)} bot=${Math.round(r.bottom)}`
      );
    });
  }
  console.log(`[🚩LunaTOC viz][${label}] viewport=${window.innerHeight}px`);
  console.log(`  mounted total = ${all.length}`);
  dump(visible, 'visible (in viewport)');
  dump(hidden, 'mounted but not in viewport');
}

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
 * into one effective "mount complete" signal. If `myNavVersion` no
 * longer matches `navigationJumpVersion` (the user clicked another
 * prompt mid-flight), resolves `'cancelled'`.
 *
 * Shared by `waitForMount` and `settleOnce` — both want the same
 * "did the DOM change in response to my scrollTop write" signal.
 */
function waitForDomChange(
  root: ParentNode,
  myNavVersion: number,
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
      if (myNavVersion !== navigationJumpVersion) {
        finish('cancelled');
        return;
      }
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (myNavVersion !== navigationJumpVersion) {
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
 * Step 2: actively load the target prompt when it is not currently
 * mounted. The loop maintains a `MountQueue` of every prompt LunaTOC
 * knows has been mounted in the DOM, and steps `scrollTop` toward the
 * target one viewport at a time. After each step the loop immediately
 * re-scans the queue for the target — Layer 1 and synchronous Layer 2
 * mounts (already in ChatGPT's memory) are returned with no wait.
 * When no new prompts mount across a step, we enter a single-shot
 * `settleOnce` that re-asserts `scrollTop` and waits for ChatGPT's
 * async backfill (the case where the target sits in Layer 3 and needs
 * a network fetch).
 *
 * Converges when the target mounts, when the user clicks any other
 * TOC row (which bumps `navigationJumpVersion`), or once
 * `LOAD_HARD_CAP` retries have been exhausted.
 */
async function loadUntilMountedViaViewport(
  targetId: string,
  targetIndex: number,
  prompts: ReadonlyArray<{ id: string }>,
  container: HTMLElement,
  jumpId: string
): Promise<HTMLElement | null> {
  // Step-size bounds for the distance-plus-overshoot heuristic below.
  // The overshoot is meant to push ChatGPT into its "load more
  // memory" mode, where it bulk-mounts many prompts in one burst
  // instead of the 3–6 prompts per discrete scrollTop write we get
  // when asking for the immediate vicinity. The next iteration can
  // always step back if the overshoot overshoots the target entirely.
  // Threshold below which we skip the overshoot and step precisely.
  // For very short jumps the overshoot pushes scrollTop so far past
  // the target that ChatGPT clamps the response and we end up taking
  // several attempts to actually land on the target; precise steps
  // converge in the same time the bulk-mount overshoot saves.
  const LOAD_STEP_NO_OVERSHOOT_DISTANCE = 30;
  // Fraction of the remaining distance that we cross past the target.
  // Tested at 0.3 against a 213-prompt conversation: that ratio was
  // enough to push ChatGPT into bulk-mount mode in 1–2 attempts.
  const LOAD_STEP_OVERSHOOT_FRACTION = 0.3;
  // Minimum number of prompts we deliberately overshoot by, so that
  // even a "you are right next to the target" step still tells ChatGPT
  // "the user wants more" and triggers a memory-wide mount.
  const LOAD_STEP_OVERSHOOT_MIN_PROMPTS = 5;
  // Rough estimate of how many prompts fit into a single viewport.
  // 200 px is what the previous log-based testing showed on this
  // workspace; we deliberately round down so a step never overshoots
  // a real mount window.
  const PROMPTS_PER_VIEWPORT_ESTIMATE = 4;
  // Empirical width of the mount window that ChatGPT's column-reverse
  // renderer produces per scrollTop write. A near-mode step larger
  // than this window crosses the target without producing any mount
  // that contains it.
  const MOUNT_WINDOW_PROMPTS = 4;
  const LOAD_HARD_CAP = 30;
  const LOAD_SETTLE_MS = 1500;
  const root = document;

  function logLoadStep(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC load-step]', details);
    }
  }

  // Snapshot the navigation version so a click on any TOC row cancels
  // this load loop on the next iteration. This is the same mechanism
  // the to-top settle loop uses to honour mid-jump user intent.
  const myNavVersion = navigationJumpVersion;
  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';

  // Seed the queue with whatever ChatGPT currently has mounted.
  // Step 2 only enters here when the fast path already missed, so
  // the seed covers Layer 1 plus any sibling turns ChatGPT happens
  // to have on screen.
  const mountQueue: MountQueue = seedMountQueue(prompts, root);
  if (mountQueue.size === 0) {
    logLoadStep({ result: 'no-mounted-at-seed' });
    return null;
  }

  // Cheap pre-check: if the target is already in the seed, the user
  // just happened to click a prompt that ChatGPT had on screen.
  const initialHit = findTargetInQueue(mountQueue, targetId, targetIndex);
  if (initialHit) {
    logLoadStep({ result: 'found-in-seed' });
    return initialHit;
  }

  for (let attempt = 0; attempt < LOAD_HARD_CAP; attempt++) {
    // Cancellation: the user picked another prompt mid-flight.
    if (myNavVersion !== navigationJumpVersion) {
      logLoadStep({ attempt, result: 'cancelled' });
      return null;
    }

    // Compute the next step using the queue's current sidebar-index
    // spread. If the queue is empty there's nothing left to chase.
    const sidebarIndices = queueSidebarIndices(mountQueue);
    if (sidebarIndices.length === 0) {
      logLoadStep({ attempt, result: 'queue-empty' });
      break;
    }
    const direction = computeDirectionTowardTarget(targetIndex, sidebarIndices);
    // Cross the remaining distance plus an overshoot so ChatGPT's
    // virtual mount sees a scrollTop value *past* the target. In our
    // to-top testing that pattern triggered ChatGPT into "load more
    // memory" mode and bulk-mounted ~150 prompts in a single burst,
    // instead of the 3–6 prompts it mounts when asked for the
    // immediate vicinity. The final `scrollIntoView` in
    // `finishIndependentVirtualJump` brings the target back into
    // view, so the user never sees the overshoot. If the overshoot
    // overshoots the target entirely, the next iteration just steps
    // back the other way (hard cap = 30 absorbs any pathological case).
    const nearestMountedIdx = nearestMountedTo(targetIndex, sidebarIndices);
    const distancePrompts = Math.abs(targetIndex - nearestMountedIdx);
    const overshootPrompts =
      distancePrompts <= LOAD_STEP_NO_OVERSHOOT_DISTANCE
        ? 0
        : Math.max(
            LOAD_STEP_OVERSHOOT_MIN_PROMPTS,
            distancePrompts * LOAD_STEP_OVERSHOOT_FRACTION
          );
    const stepPrompts =
      distancePrompts > LOAD_STEP_NO_OVERSHOOT_DISTANCE
        ? // Far mode: keep the aggressive "distance plus overshoot" step
          // that triggers ChatGPT's bulk-mount response on long jumps.
          distancePrompts + overshootPrompts
        : // Near mode: half-distance shrinker, clamped to ≤ one mount
          // window so the step never crosses the bulk-mount boundary.
          Math.min(
            MOUNT_WINDOW_PROMPTS,
            Math.max(1, Math.floor(distancePrompts / 2))
          );
    const stepViewports = stepPrompts / PROMPTS_PER_VIEWPORT_ESTIMATE;
    const step = direction * stepViewports * window.innerHeight;
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

    // Wait for ChatGPT's React commit + browser layout to finish the
    // mount triggered by the scrollTop write, then check the queue.
    const MOUNT_WAIT_TIMEOUT_MS = 500;
    const waitResult = await waitForMount(
      mountQueue,
      prompts,
      root,
      targetId,
      targetIndex,
      myNavVersion,
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
    // No hit within the wait. Either ChatGPT has clamped us at the
    // edge (Layer 3 fetch pending) or the mount window slid without
    // picking up anything new. Either way we need ChatGPT to
    // actually settle, so fall through to the to-top-style settle
    // that sends a batch of scrollTop writes plus a longer observer
    // wait.
    const settled = await settleOnce(
      container,
      mountQueue,
      prompts,
      root,
      targetId,
      targetIndex,
      direction,
      isReverse,
      myNavVersion,
      LOAD_SETTLE_MS
    );
    if (settled) {
      logLoadStep({ attempt, result: 'found-after-settle' });
      return settled;
    }
    if (myNavVersion !== navigationJumpVersion) {
      logLoadStep({ attempt, result: 'cancelled-after-settle' });
      return null;
    }
  }

  logLoadStep({ result: 'hard-cap-reached' });
  return null;
}

/**
 * One round of the to-top-style settle: send a small batch of
 * `scrollTop` writes spaced 10 ms apart, then wait for ChatGPT's
 * MutationObserver to report that the DOM has changed (debounced to
 * 10 ms to coalesce the per-node callbacks React fires during a
 * batch mount). Returns the target element if it landed inside the
 * batch, otherwise null so the outer loop can decide whether to
 * take another step.
 *
 * The previous design polled the DOM every 50 ms while writing a
 * single `scrollTop` per attempt, which left the per-mount latency
 * on the poll interval floor. Sending a batch of `scrollTop` writes
 * mimics what a manual flick does — multiple scroll events in the
 * same JS turn — and lets ChatGPT coalesce them into one bulk mount
 * response. The MutationObserver fires the moment React commits the
 * new nodes, so we don't have to wait out a 50 ms poll after the
 * mount has already landed.
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
  myNavVersion: number,
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
    myNavVersion,
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
 *
 * `scrollTop = N` triggers ChatGPT's virtual mount asynchronously
 * through React commit + browser layout, so an immediate
 * `querySelectorAll` reads the DOM *before* ChatGPT has inserted the
 * new bubble. The target ends up one slot outside the bulk-mount
 * range, the loop walks past it on the next attempt with a tiny step,
 * and the run stalls.
 *
 * `waitForMount` listens for the MutationObserver that fires when
 * ChatGPT's React commit lands, debounced so the per-node callbacks
 * coalesce into one effective "mount complete" signal. Returns the
 * target element if it landed inside the wait, `null` on timeout, or
 * `'cancelled'` if the user clicked another prompt mid-flight.
 */
async function waitForMount(
  mountQueue: MountQueue,
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode,
  targetId: string,
  targetIndex: number,
  myNavVersion: number,
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
      myNavVersion,
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
 * if it sits "above" (so we should scroll toward older turns). Accepts
 * a flat list of sidebar indices so callers don't have to materialise
 * an array of objects just to ask for a direction.
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
 * Returns the sidebar index of the mounted prompt closest to
 * `targetIndex`. The caller uses it to compute "how far is the
 * target from the closest mounted prompt" before sizing the next
 * `scrollTop` step.
 */
function nearestMountedTo(
  targetIndex: number,
  sidebarIndices: ReadonlyArray<number>
): number {
  let nearestIdx = sidebarIndices[0];
  let currentDist = Math.abs(targetIndex - nearestIdx);
  for (let j = 1; j < sidebarIndices.length; j++) {
    const d = Math.abs(targetIndex - sidebarIndices[j]);
    if (d < currentDist) {
      currentDist = d;
      nearestIdx = sidebarIndices[j];
    }
  }
  return nearestIdx;
}

interface VirtualSearchContext {
  conversationKey: string;
  prompts: NavigatorMessage[];
}

interface PromptNavigationOptions {
  getVirtualSearchContext: () => VirtualSearchContext;
  setJumpProgress: (progress: {
    active: boolean;
    targetIndex: number;
    remainingSteps: number;
  }) => void;
  clearJumpProgress: () => void;
  notifyJumpFailed: () => void;
}

let getVirtualSearchContext: () => VirtualSearchContext = () => ({
  conversationKey: '',
  prompts: [],
});
let setJumpProgress: (progress: {
  active: boolean;
  targetIndex: number;
  remainingSteps: number;
}) => void = () => {};
let clearJumpProgress: () => void = () => {};
let notifyJumpFailed: () => void = () => {};
let navigationJumpVersion = 0;

/**
 * Connects jump behavior to navigator state and native TOC helpers.
 * @param {Object} options
 * @param {() => HTMLElement[]} options.getNativePromptButtons
 * @param {(element: HTMLElement) => number} options.findConversationIndexByElement
 * @param {() => VirtualSearchContext} options.getVirtualSearchContext
 * @param {(progress: object) => void} options.setJumpProgress
 * @param {() => void} options.clearJumpProgress
 */
export function initializePromptNavigation(
  options: PromptNavigationOptions
): void {
  getVirtualSearchContext = options.getVirtualSearchContext;
  setJumpProgress = options.setJumpProgress;
  clearJumpProgress = options.clearJumpProgress;
  notifyJumpFailed = options.notifyJumpFailed;
}

/**
 * Jumps to the first or last prompt using ChatGPT's native TOC when available.
 * @param {'top' | 'bottom'} edge
 */
export function jumpToConversationEdge(edge: 'top' | 'bottom'): void {
  if (usesIndependentVirtualNavigation()) {
    cancelActiveNavigationSearch();
    jumpToAbsoluteEdge(edge, 'auto');
    return;
  }

  // Legacy ChatGPT-native-TOC path intentionally removed. LunaTOC runs on
  // `independent-virtual` everywhere; on the new ChatGPT web the native
  // TOC buttons are gone, so the old branch below would always mis-route.
  logChatGptNavigationEvent(
    createChatGptNavigationJumpId(),
    'JUMP_FALLBACK_LEGACY_NATIVE',
    { edge }
  );
  jumpToAbsoluteEdge(edge, 'smooth');
}

/**
 * Scrolls to the given element and applies a temporary highlight effect.
 * @param {HTMLElement} element
 * @param {ScrollBehavior} [behavior='smooth']
 * @param {ScrollLogicalPosition} [block='center']
 */
function scrollToMatchedElement(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
  block: ScrollLogicalPosition = 'center'
): void {
  keepFollowing();

  element.scrollIntoView({
    behavior,
    block,
  });

  highlightWhenVisible(element);
}

/**
 * Highlights an element after it enters the viewport, with a timeout fallback.
 * @param {HTMLElement} element
 */
function highlightWhenVisible(element: HTMLElement): void {
  let didHighlight = false;
  let observer: IntersectionObserver | null = null;

  const finish = () => {
    if (didHighlight) return;

    didHighlight = true;
    observer?.disconnect();
    highlightMatchedElement(element);
  };

  const fallbackTimer = setTimeout(finish, 900);

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || entry.intersectionRatio < 0.2) return;

      clearTimeout(fallbackTimer);
      finish();
    },
    {
      threshold: [0.2],
    }
  );

  observer.observe(element);
}

/**
 * Applies a temporary highlight effect to a rendered prompt element.
 */
function highlightMatchedElement(element: HTMLElement): void {
  element.style.outline = '2px solid #60a5fa';
  element.style.borderRadius = '8px';

  setTimeout(() => {
    element.style.outline = '';
    element.style.borderRadius = '';
  }, 1200);
}

/**
 * Jumps to a prompt. Prefer ChatGPT's built-in prompt navigator because it can
 * scroll virtualized conversations; DOM text/index fallbacks only work for
 * messages currently rendered in the page.
 */
export function jumpToMessage(message: NavigatorMessage, index: number): void {
  cancelActiveNavigationSearch();

  if (usesIndependentVirtualNavigation()) {
    jumpWithIndependentVirtualNavigation(message, index);
    return;
  }

  // Legacy native path intentionally removed — LunaTOC runs on
  // `independent-virtual` everywhere; this branch is unreachable in
  // practice. The fall-through log keeps a trail if configuration ever
  // changes.
  logChatGptNavigationEvent(
    createChatGptNavigationJumpId(),
    'JUMP_FALLBACK_LEGACY',
    { index }
  );
  jumpToAbsoluteEdge('top', 'auto');
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number
): void {
  const jumpId = createChatGptNavigationJumpId();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  logChatGptNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
  });

  // Far jumps slide the virtual render window over several seconds. Hold the
  // active-row lock for the whole slide so scroll-follow cannot snap the
  // highlight to intermediate prompts mid-jump.
  keepFollowing(15_000);
  setJumpProgress({
    active: true,
    targetIndex: index,
    remainingSteps: 50,
  });

  if (!container || !context.conversationKey) {
    clearJumpProgress();
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  // Fast path: if the target prompt is already mounted anywhere in the
  // DOM (id match exact, text match as fallback for id-string mismatches),
  // scroll straight to it. The browser scrolls as part of `scrollIntoView`
  // so a target that's mounted but off-screen is still a one-step jump.
  const idHit = findRenderedChatGptPrompt(message.id);
  const textHit =
    idHit ??
    (message.text ? findRenderedChatGptPromptByText(message.text) : null);
  const renderedTarget = idHit ?? textHit;
  if (renderedTarget) {
    clearJumpProgress();
    logChatGptNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    if (isJumpVizDebugEnabled()) {
      logMountedPromptViz('fast-path');
    }
    finishIndependentVirtualJump(renderedTarget, message, index);
    return;
  }

  // Step 2 runs after Step 1 misses. Sequential, never in parallel.
  void (async () => {
    const loaded = await loadUntilMountedViaViewport(
      message.id,
      index,
      context.prompts,
      container,
      jumpId
    );
    if (loaded) {
      clearJumpProgress();
      finishIndependentVirtualJump(loaded, message, index);
      return;
    }

    // Step 2 failed to mount the target. Stop silently — a jump that
    // cannot resolve should not fall back to the legacy anchor-search
    // algorithm, whose scrollTop probing bounces the view between the
    // two newest turns and looks like the page is glitching.
    clearJumpProgress();
    notifyJumpFailed();
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      attempts: 'step-2-exhausted',
    });
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC jump] target not mounted, giving up silently');
    }
  })();
}

/**
 * Completes an independent jump by highlighting the target and waiting for
 * ChatGPT's virtual rendering to settle. Highlights the target as soon
 * as it scrolls into the viewport, with a short fallback in case the
 * settle never triggers a visible change.
 */
function finishIndependentVirtualJump(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number
): void {
  const jumpVersion = ++navigationJumpVersion;
  const targetAttempts = 8;
  keepFollowing(1800);

  // Scroll the target to the top of the chat viewport (with the
  // configured top padding so it doesn't sit flush against the edge),
  // then highlight it. scrollIntoView with block:'start' drives the
  // column-reverse thread-scroll-container correctly — a bare highlight
  // (without this scroll) is what made clicks look like a no-op.
  const scrollTargetIntoView = function (el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const previousScrollMarginTop = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${APP_CONFIG.platforms.chatgpt.promptTopOffsetPx}px`;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    el.style.scrollMarginTop = previousScrollMarginTop;
    highlightMatchedElement(el);
    return true;
  };

  if (scrollTargetIntoView(target)) {
    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'found', attempts: targetAttempts }
    );
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Each attempt polls once; bail after the budget.
  setTimeout(() => {
    if (jumpVersion !== navigationJumpVersion) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      scrollTargetIntoView(latest);
      logChatGptNavigationEvent(
        createChatGptNavigationJumpId(),
        'JUMP_FINISHED',
        { status: 'found-after-repoll', attempts: targetAttempts }
      );
      return;
    }
    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'target-disappeared-after-search' }
    );
  }, 600);
}

/**
 * Jumps to a prompt by index, with optional high-priority lock to keep
 * LunaTOC's sidebar row pinned while ChatGPT scrolls virtualized content.
 * Lives here because outline navigation uses it for heading-to-heading
 * jumps that don't go through the regular TOC entry path.
 * @param {number} index
 * @param {number} [duration=4000]
 * @returns {boolean} true if jump fired.
 */
export function jumpToPromptIndex(
  index: number,
  duration: number = 4000
): boolean {
  const context = getVirtualSearchContext();
  const message = context.prompts[index];
  if (!message) return false;
  cancelActiveNavigationSearch();
  keepFollowing(duration);
  jumpWithIndependentVirtualNavigation(message, index);
  return true;
}

/**
 * Locks the sidebar active-row for a duration without navigating again.
 * Used by outline navigation to keep the highlighted subsection pinned
 * while the user reads ChatGPT's response.
 */
export function lockPromptIndex(
  index: number,
  duration: number = 1800
): void {
  keepFollowing(duration);
  // setJumpProgress + clearJumpProgress are wired by sidebarController via
  // initializePromptNavigation; nothing to do here beyond keeping the chat
  // container in lock-step mode for the duration.
}

/**
 * Cancels active independent and legacy virtual scans before a new jump.
 */
function cancelActiveNavigationSearch(): void {
  navigationJumpVersion += 1;
}

/**
 * Returns whether ChatGPT navigation must avoid all native TOC behavior.
 */
function usesIndependentVirtualNavigation(): boolean {
  return getChatGptNavigationAlgorithm() === 'independent-virtual';
}

/**
 * Tracks the active edge-jump retry loop so a second click cancels the
 * previous loop instead of stacking on top of it.
 */
let activeEdgeJumpVersion = 0;
const EDGE_JUMP_HARD_CAP = 30;
const EDGE_JUMP_SETTLE_MS = 1500;
const EDGE_JUMP_HEIGHT_GROWTH_EPSILON = 50;
/** How close to the visible top of the scroll container the first prompt
 * must be before the loop considers the "found first prompt" condition met.
 * ChatGPT often mounts the very first prompt well before the user is
 * actually scrolled to it, so we require it to be in the visible band.
 */
const EDGE_JUMP_FIRST_PROMPT_VISIBLE_BAND_PX = 200;

/**
 * Scroll the ChatGPT chat feed to the absolute top or bottom.
 *
 * Each click re-asserts `scrollTop = -currentMaxScrollTop` against the
 * *current* scrollHeight and waits briefly for ChatGPT's lazy mount to
 * extend the window. Repeating is what actually moves the page toward
 * prompt 1 — a single write gets clamped by ChatGPT's mount window,
 * and that clamp only widens after each retry.
 *
 * The loop exits when the first prompt is both mounted in the DOM and
 * visible at the top of the scroll container. If the user clicks any
 * TOC row in the meantime, the navigation-version bump cancels this
 * loop on the next tick.
 *
 * @param {'top' | 'bottom'} edge
 * @param {'smooth' | 'auto'} [behavior='auto']
 */
export function jumpToAbsoluteEdge(
  edge: 'top' | 'bottom',
  behavior: ScrollBehavior = 'auto'
): void {
  keepFollowing();
  // A new absolute-edge jump supersedes any in-flight independent virtual
  // jump; otherwise the highlight from a previous TOC click would linger
  // even after the user explicitly chose to leave that prompt behind.
  cancelActiveNavigationSearch();
  clearJumpProgress();

  // Straight to the real thread scroll container via the platform adapter.
  const container =
    platform().navigation.getThreadScrollContainer?.() ??
    platform().navigation.getScrollContainer();
  if (!container) return;

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';
  const jumpVersion = ++activeEdgeJumpVersion;
  // Snapshot the navigation version so a click on any TOC row cancels
  // this edge loop alongside whatever virtual-jump it triggered.
  const navVersionAtStart = navigationJumpVersion;

  // For the top edge, look up the first prompt's id so the loop can stop
  // as soon as that prompt is actually visible. The bottom edge has no
  // equivalent anchor — it's bounded by the newest prompt, which is
  // already on screen before the loop starts.
  const firstPromptId =
    edge === 'top'
      ? getVirtualSearchContext().prompts[0]?.id ?? null
      : null;

  void retryEdgeUntilSettled(
    container,
    edge,
    isReverse,
    jumpVersion,
    navVersionAtStart,
    firstPromptId
  );
}

/**
 * Iteratively re-asserts the edge scroll position while ChatGPT's mount
 * window keeps growing. Exits when the first prompt reaches the visible
 * top band, when the user clicks any other TOC row (which bumps
 * `navigationJumpVersion`), when another to-top click cancels this one
 * (`activeEdgeJumpVersion`), or once `EDGE_JUMP_HARD_CAP` retries have
 * been exhausted.
 */
async function retryEdgeUntilSettled(
  container: HTMLElement,
  edge: 'top' | 'bottom',
  isReverse: boolean,
  jumpVersion: number,
  navVersionAtStart: number,
  firstPromptId: string | null
): Promise<void> {
  const logEdgeSettle = (details: Record<string, unknown>): void => {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC edge-settle]', details);
    }
  };

  for (let attempt = 0; attempt < EDGE_JUMP_HARD_CAP; attempt++) {
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      navVersionAtStart !== navigationJumpVersion
    ) {
      logEdgeSettle({ attempt, phase: 'cancelled' });
      return;
    }

    const beforeHeight = container.scrollHeight;
    const beforeScrollTop = container.scrollTop;
    const maxScrollTop = beforeHeight - container.clientHeight;
    const targetTop = edge === 'top'
      ? (isReverse ? -maxScrollTop : 0)
      : (isReverse ? 0 : maxScrollTop);

    container.scrollTop = targetTop;
    logEdgeSettle({
      attempt,
      edge,
      isReverse,
      maxScrollTop,
      targetTop,
      beforeScrollTop,
      beforeHeight,
    });

    await new Promise<void>(function (resolve) {
      setTimeout(resolve, EDGE_JUMP_SETTLE_MS);
    });
    if (
      jumpVersion !== activeEdgeJumpVersion ||
      navVersionAtStart !== navigationJumpVersion
    ) {
      logEdgeSettle({ attempt, phase: 'cancelled-after-sleep' });
      return;
    }

    // Convergence signal 1: the first prompt is mounted and visible
    // inside the top band of the scroll container. ChatGPT mounts DOM
    // nodes well before it actually scrolls the user to them, so we
    // also require the prompt's visible-top offset to be inside the
    // top band — otherwise the loop would short-circuit at attempt 0
    // while the user is still looking at the middle of the conversation.
    // On convergence, paint the chat-side highlight so the user sees
    // the prompt LunaTOC just landed them on.
    const firstPromptInView = firstPromptId
      ? findFirstPromptInTopBand(container, firstPromptId)
      : null;
    if (firstPromptInView) {
      highlightMatchedElement(firstPromptInView);
      logEdgeSettle({ attempt, phase: 'first-prompt-visible' });
      return;
    }

    const afterHeight = container.scrollHeight;
    const grown = afterHeight > beforeHeight + EDGE_JUMP_HEIGHT_GROWTH_EPSILON;
    logEdgeSettle({
      attempt,
      phase: 'settled',
      afterScrollTop: container.scrollTop,
      afterHeight,
      grown,
    });
    // Convergence signal 2: scrollHeight stopped growing, meaning
    // ChatGPT's mount window has stabilised at whatever boundary it
    // is willing to expose. The next to-top click can re-trigger this
    // loop if the user wants to try again after manual scrolling.
    if (!grown) return;
  }
  logEdgeSettle({ phase: 'hard-cap-reached' });
}

/**
 * Returns the first-prompt element when it is mounted in the DOM and
 * its visible top sits inside the top band of the scroll container.
 * This is the user-facing "you're at the very start of the conversation"
 * check, distinct from `findRenderedChatGptPrompt`, which would also
 * succeed when the prompt is mounted far below the visible area.
 */
function findFirstPromptInTopBand(
  container: HTMLElement,
  firstPromptId: string
): HTMLElement | null {
  const firstPrompt = findRenderedChatGptPrompt(firstPromptId);
  if (!firstPrompt) return null;

  const promptRect = firstPrompt.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const visibleTop = promptRect.top - containerRect.top;
  if (visibleTop >= 0 && visibleTop <= EDGE_JUMP_FIRST_PROMPT_VISIBLE_BAND_PX) {
    return firstPrompt;
  }
  return null;
}