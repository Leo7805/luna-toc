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
  readMountedWithSidebarIdx as _readMountedWithSidebarIdx,
} from '@/platforms/chatgpt/virtualSearchAdapter';
import {
  createChatGptNavigationJumpId as _createChatGptNavigationJumpId,
  logChatGptNavigationEvent as _logChatGptNavigationEvent,
  isJumpVizDebugEnabled as _isJumpVizDebugEnabled,
} from '@/platforms/chatgpt/navigationDiagnostics';

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
const readMountedWithSidebarIdx = (
  prompts: ReadonlyArray<{ id: string }>,
  root: Parameters<typeof _readMountedWithSidebarIdx>[1] = document
): ReturnType<typeof _readMountedWithSidebarIdx> =>
  _readMountedWithSidebarIdx(prompts, root);
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
 * Step 2: actively load the target prompt when it is not currently
 * mounted. Each iteration takes a 2-viewport step toward the target,
 * waits briefly for ChatGPT to mount more turns, and re-checks whether
 * the target has appeared. Converges when the target mounts, when the
 * user clicks any TOC row (which bumps `navigationJumpVersion`), or
 * once `LOAD_HARD_CAP` retries have been exhausted.
 *
 * The 2-viewport step size was chosen empirically: large enough to make
 * progress on long conversations, small enough that a missed target is
 * recovered within one or two extra iterations rather than at the hard
 * cap. The old `waitForMountedChange` MutationObserver signal was
 * unreliable against ChatGPT's row-by-row async backfill (the mount
 * set kept shifting even when the target wasn't anywhere near), so
 * convergence is now purely "target is mounted" — a business-level
 * condition that doesn't depend on ChatGPT's transient DOM shape.
 */
async function loadUntilMountedViaViewport(
  targetId: string,
  targetIndex: number,
  prompts: ReadonlyArray<{ id: string }>,
  container: HTMLElement,
  jumpId: string
): Promise<HTMLElement | null> {
  const LOAD_HARD_CAP = 30;
  const LOAD_SETTLE_MS = 2000;
  const LOAD_STEP_VIEWPORTS = 2;
  const root = document;

  // Per-step progress, printed only when the `chatTocDebugJumpViz` toggle
  // is enabled so it stays independent of the noisy `chatTocDebugJump`
  // diagnostic stream.
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

  for (let attempt = 0; attempt < LOAD_HARD_CAP; attempt++) {
    // Convergence signal 1: the user picked another prompt while we
    // were sliding toward the target. Bail without touching the
    // container again so the new jump owns the scroll.
    if (myNavVersion !== navigationJumpVersion) {
      logLoadStep({ attempt, result: 'cancelled' });
      return null;
    }

    // Convergence signal 2: the target prompt is mounted. Hand it back
    // so the caller can run `finishIndependentVirtualJump`.
    const target = findRenderedChatGptPrompt(targetId, root);
    if (target) {
      logLoadStep({ attempt, result: 'found' });
      return target;
    }

    // Read the currently-mounted window to figure out which way to step.
    // If nothing is mounted at all, ChatGPT's mount window has gone
    // blank (rare) and continuing would just thrash — give up.
    const mounted = readMountedWithSidebarIdx(prompts, root);
    if (mounted.length === 0) {
      logLoadStep({ attempt, result: 'no-mounted' });
      break;
    }

    const direction = computeDirectionTowardTarget(targetIndex, mounted);
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    // "direction = 1" means the target is at a newer (larger) sidebar
    // index; physically the newer turns sit at the bottom of the
    // visible area regardless of the container's flex-direction. So
    // moving toward a newer prompt must move toward the container's
    // physical bottom — which in a column-reverse container means
    // *increasing* scrollTop toward 0, the same as in a normal flow.
    const step = direction * LOAD_STEP_VIEWPORTS * window.innerHeight;
    const beforeScrollTop = container.scrollTop;
    const nextScrollTop = beforeScrollTop + step;
    // Clamp to the physical edge so we never write a scrollTop that
    // the browser would silently round to the same clamped value.
    // In column-reverse the bottom lives at scrollTop = 0 and the
    // top at -maxScrollTop; in a normal flow it's the opposite.
    const clampedScrollTop = isReverse
      ? Math.max(-maxScrollTop, Math.min(0, nextScrollTop))
      : Math.max(0, Math.min(maxScrollTop, nextScrollTop));
    container.scrollTop = clampedScrollTop;

    logLoadStep({
      attempt,
      direction,
      targetIndex,
      nearestMountedIdx: nearestMountedIndex(targetIndex, mounted),
      beforeScrollTop,
      afterScrollTop: container.scrollTop,
      maxScrollTop,
    });

    await new Promise<void>(function (resolve) {
      setTimeout(resolve, LOAD_SETTLE_MS);
    });
  }

  logLoadStep({ result: 'hard-cap-reached' });
  return null;
}

/**
 * Returns 1 if the target sits "below" the closest mounted prompt in
 * sidebar-index terms (so we should scroll toward newer turns), and -1
 * if it sits "above" (so we should scroll toward older turns). Callers
 * multiply by their container's direction sign themselves.
 */
function computeDirectionTowardTarget(
  targetIndex: number,
  mounted: ReadonlyArray<{ sidebarIdx: number }>
): 1 | -1 {
  let nearestIdx = mounted[0].sidebarIdx;
  let currentDist = Math.abs(targetIndex - nearestIdx);
  for (let j = 1; j < mounted.length; j++) {
    const d = Math.abs(targetIndex - mounted[j].sidebarIdx);
    if (d < currentDist) {
      currentDist = d;
      nearestIdx = mounted[j].sidebarIdx;
    }
  }
  return targetIndex > nearestIdx ? 1 : -1;
}

/**
 * Returns the sidebar index of the mounted prompt closest to `targetIndex`,
 * without the side-effect of `computeDirectionTowardTarget`. Used purely
 * for logging so the diagnostic dump shows how far the loop thinks it
 * is from the target each iteration.
 */
function nearestMountedIndex(
  targetIndex: number,
  mounted: ReadonlyArray<{ sidebarIdx: number }>
): number {
  let nearestIdx = mounted[0].sidebarIdx;
  let currentDist = Math.abs(targetIndex - nearestIdx);
  for (let j = 1; j < mounted.length; j++) {
    const d = Math.abs(targetIndex - mounted[j].sidebarIdx);
    if (d < currentDist) {
      currentDist = d;
      nearestIdx = mounted[j].sidebarIdx;
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