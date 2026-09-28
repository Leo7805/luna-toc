/**
 * Handles main prompt navigation from LunaTOC to ChatGPT positions.
 */
import { getChatGptNavigationAlgorithm } from '../navigationSettings';
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
 * mounted. `container.scrollTop` assignments trigger ChatGPT virtualization
 * mount on the new DOM (wheel/keyboard events do not). Each iteration
 * scrolls by `STEP_MULTIPLIER × window.innerHeight` toward the target,
 * waits for the mount list to change via a MutationObserver, and re-checks
 * whether the target appeared. Exits when the target mounts, the mount
 * window stops growing (we reached a ChatGPT edge), or the iteration
 * budget is exhausted.
 *
 * The hard timeout is only a safety net for the case where the fetch
 * never resolves. The `MAX_MS` bound + stable-scrollHeight check should
 * normally decide the loop exits first.
 */
async function loadUntilMountedViaViewport(
  targetId: string,
  targetIndex: number,
  prompts: ReadonlyArray<{ id: string }>,
  container: HTMLElement,
  jumpId: string
): Promise<HTMLElement | null> {
  const MAX_ITERATIONS = 50;
  const STEP_MULTIPLIER = 5;
  const MUTATION_TIMEOUT_MS = 2500;
  const root = document;

  function snapshotUnitKeys(): Set<string> {
    return new Set(
      Array.from(
        root.querySelectorAll('[data-chatgpt-search-unit-key$=":user"]')
      ).map(function (el) {
        return el.getAttribute('data-chatgpt-search-unit-key') || '';
      })
    );
  }

  function waitForMountedChange(
    before: Set<string>
  ): Promise<{ changed: boolean; height: number }> {
    return new Promise(function (resolve) {
      let done = false;
      function check(): void {
        if (done) return;
        const after = snapshotUnitKeys();
        let hasNew = false;
        after.forEach(function (id) {
          if (!before.has(id)) hasNew = true;
        });
        if (hasNew) {
          done = true;
          observer.disconnect();
          resolve({ changed: true, height: container.scrollHeight });
        }
      }
      const observer = new MutationObserver(check);
      observer.observe(root.body, { childList: true, subtree: true });
      check();
      setTimeout(function () {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve({ changed: false, height: container.scrollHeight });
      }, MUTATION_TIMEOUT_MS);
    });
  }

  // Per-step progress, printed only when the `chatTocDebugJumpViz` toggle
  // is enabled so it stays independent of the noisy `chatTocDebugJump`
  // diagnostic stream.
  function logLoadStep(details: Record<string, unknown>): void {
    if (isJumpVizDebugEnabled()) {
      console.log('[LunaTOC load-step]', details);
    }
  }
  const maxScrollTop = container.scrollHeight - container.clientHeight;

  // Step 2: scroll toward the target in large viewport-multiple jumps,
  // checking after each jump whether the target has mounted. ChatGPT's
  // virtualized mount window jumps discretely (not continuously), so a
  // "distance to target" that stays flat between two scrolls is normal —
  // we keep scrolling until we hit a scroll edge (target not found) or
  // the target mounts. No progress-decay heuristic here: it falsely
  // bails when the mount window happens to sit still for a few jumps.
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 1. target already mounted?
    const target = findRenderedChatGptPrompt(targetId, root);
    if (target) {
      logLoadStep({ step: i, result: 'found' });
      return target;
    }

    // 2. read mounted list + nearest sidebar index
    const mounted = readMountedWithSidebarIdx(prompts, root);
    if (mounted.length === 0) break;

    let nearestIdx = mounted[0].sidebarIdx;
    let currentDist = Math.abs(targetIndex - nearestIdx);
    for (let j = 1; j < mounted.length; j++) {
      const d = Math.abs(targetIndex - mounted[j].sidebarIdx);
      if (d < currentDist) {
        currentDist = d;
        nearestIdx = mounted[j].sidebarIdx;
      }
    }

    // 3. direction toward target (column-reverse: -max = oldest, 0 = newest)
    const direction = targetIndex > nearestIdx ? 1 : -1;
    const step = direction * STEP_MULTIPLIER * window.innerHeight;
    const beforeScrollTop = container.scrollTop;
    const nextScrollTop = beforeScrollTop + step;

    // 4. clamp to the scroll edge instead of scrolling past it
    const atEdge =
      (direction === -1 && nextScrollTop <= -maxScrollTop) ||
      (direction === 1 && nextScrollTop >= 0);
    container.scrollTop = atEdge
      ? (direction === -1 ? -maxScrollTop : 0)
      : nextScrollTop;

    if (isJumpVizDebugEnabled()) {
      console.log(
        '[LunaTOC load-step]',
        'i=' + i,
        'dir=' + direction,
        'scrollTop ' + Math.round(beforeScrollTop) + ' -> ' +
          Math.round(container.scrollTop),
        'nearestIdx=' + nearestIdx,
        'targetIdx=' + targetIndex,
        'dist=' + currentDist,
        'atEdge=' + atEdge
      );
    }

    // 5. wait for new mounts
    const beforeKeys = snapshotUnitKeys();
    const waited = await waitForMountedChange(beforeKeys);

    // 6. reached an edge and no new mount appeared → nothing further to
    //    load; stop the loop and fall back to the boundary scan.
    if (atEdge && !waited.changed) {
      logLoadStep({ step: i, result: 'edge-reached' });
      break;
    }
  }

  // Boundary scan: scroll to the two scroll edges and re-check, in case
  // the iterative approach overshot.
  logLoadStep({ result: 'boundary-scan' });
  for (const edge of [-maxScrollTop, 0]) {
    container.scrollTop = edge;
    const beforeKeys = snapshotUnitKeys();
    const waited = await waitForMountedChange(beforeKeys);
    if (waited.changed) {
      const t = findRenderedChatGptPrompt(targetId, root);
      if (t) return t;
    }
  }

  return null;
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

  // Highlight the target as soon as it scrolls into view.
  const highlightTarget = function (): boolean {
    if (!target.isConnected) return false;
    highlightMatchedElement(target);
    return true;
  };

  if (highlightTarget()) {
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
      highlightMatchedElement(latest);
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
 * Scroll the ChatGPT chat feed to the absolute top or bottom.
 * @param {'top' | 'bottom'} edge
 * @param {'smooth' | 'auto'} [behavior='auto']
 */
export function jumpToAbsoluteEdge(
  edge: 'top' | 'bottom',
  behavior: ScrollBehavior = 'auto'
): void {
  keepFollowing();

  // Straight to the real scroll container, matching what the console
  // probe does — do not route through getChatGptScrollContainer, which
  // can resolve to an inner overflow-y wrapper instead of the thread.
  const container = document.querySelector<HTMLElement>(
    '.thread-scroll-container'
  );
  if (!container) return;

  const isReverse =
    window.getComputedStyle(container).flexDirection === 'column-reverse';
  const maxScrollTop = container.scrollHeight - container.clientHeight;
  const targetTop = edge === 'top'
    ? (isReverse ? -maxScrollTop : 0)
    : (isReverse ? 0 : maxScrollTop);

  container.scrollTop = targetTop;

  // Wait for ChatGPT's lazy backfill to actually finish before re-asserting.
  // ChatGPT fetches older conversation pages on demand; while it is fetching
  // the page, scrollHeight grows with every newly mounted turn. Once it
  // stops growing for several consecutive polls (i.e. the last fetch
  // returned the final page, or there was nothing more to load), we know
  // the new scrollTop has had its full effect — re-apply the target and
  // exit. The hard timeout is only a safety net for the case where the
  // fetch never resolves.
  void (async () => {
    const startHeight = container.scrollHeight;
    let stableChecks = 0;
    const REQUIRED_STABLE = 3;
    const MAX_MS = 15000;
    const start = Date.now();
    while (Date.now() - start < MAX_MS) {
      await new Promise<void>(function (resolve) {
        setTimeout(resolve, 500);
      });
      if (container.scrollHeight > startHeight + 50) {
        // a new page just landed; reset the stability counter
        stableChecks = 0;
      } else {
        stableChecks += 1;
        if (stableChecks >= REQUIRED_STABLE) {
          // scrollHeight has settled; re-assert the target so the page
          // settles on the requested edge instead of being snapped back by
          // the last asynchronous anchor recompute.
          container.scrollTop = targetTop;
          return;
        }
      }
    }
  })();
}