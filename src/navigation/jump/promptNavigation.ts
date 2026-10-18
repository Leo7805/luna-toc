/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import { getChatGptNavigationAlgorithm } from '../navigationSettings';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import { executeViewportWalkerStrategy } from './strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from './strategies/virtualLayoutStrategy';
import type { JumpStrategyContext } from './strategies/types';
import { executeAbsoluteEdgeJump } from './edgeNavigation';

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
): HTMLElement | null =>
  platform().navigation.findRenderedPromptByText?.(text, root) ?? null;
const getChatGptScrollContainer = (root?: ParentNode): HTMLElement | null =>
  platform().navigation.getScrollContainer(root);
const createChatGptNavigationJumpId = (): string =>
  platform().diagnostics.createJumpId();
const logChatGptNavigationEvent = (
  jumpId: string,
  eventName: string,
  details: Record<string, unknown> = {},
  storage?: Storage
): void => platform().diagnostics.logEvent(jumpId, eventName, details, storage);
const isJumpVizDebugEnabled = (
  storage?: Pick<Storage, 'getItem'>
): boolean =>
  platform().diagnostics.isJumpVizDebugEnabled?.(storage) ?? false;

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
  const userSelector = platform().config.selectors.userMessage;
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(userSelector)
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
      const id =
        platform().navigation.getMessageIdFromElement?.(el) ||
        (platform().config.selectors.messageId
          ? el.getAttribute(platform().config.selectors.messageId)
          : null) ||
        '(none)';
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

export interface VirtualSearchContext {
  conversationKey: string;
  prompts: NavigatorMessage[];
}

export interface PromptNavigationOptions {
  getVirtualSearchContext: () => VirtualSearchContext;
  onJumpStart?: (targetIndex: number) => void;
  onJumpComplete?: (targetIndex: number) => void;
  onJumpFailed?: (targetIndex: number) => void;
  setJumpProgress?: (progress: {
    active: boolean;
    targetIndex: number;
    remainingSteps?: number;
  }) => void;
  clearJumpProgress?: () => void;
  notifyJumpFailed?: () => void;
}

let getVirtualSearchContext: () => VirtualSearchContext = () => ({
  conversationKey: '',
  prompts: [],
});
let onJumpStart: ((targetIndex: number) => void) | undefined;
let onJumpComplete: ((targetIndex: number) => void) | undefined;
let onJumpFailed: ((targetIndex: number) => void) | undefined;
let setJumpProgress:
  | ((progress: {
      active: boolean;
      targetIndex: number;
      remainingSteps?: number;
    }) => void)
  | undefined;
let clearJumpProgress: (() => void) | undefined;
let notifyJumpFailed: (() => void) | undefined;
let navigationJumpVersion = 0;

/**
 * Connects jump behavior to navigator state and native TOC helpers.
 *
 * @param options Observer and callback hooks for navigation progress.
 */
export function initializePromptNavigation(
  options: PromptNavigationOptions
): void {
  getVirtualSearchContext = options.getVirtualSearchContext;
  onJumpStart = options.onJumpStart;
  onJumpComplete = options.onJumpComplete;
  onJumpFailed = options.onJumpFailed;
  setJumpProgress = options.setJumpProgress;
  clearJumpProgress = options.clearJumpProgress;
  notifyJumpFailed = options.notifyJumpFailed;
}

/**
 * Jumps to the first or last prompt using ChatGPT's native TOC when available.
 *
 * @param edge Target edge: 'top' or 'bottom'.
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
 *
 * @param message Target message representation.
 * @param index 0-indexed position in the conversation.
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
 * Logs a `[LunaTOC HISTORY BOUNDARY]` diagnostic event.
 * All values must be primitive to keep DevTools console clean.
 */
function logHistoryBoundary(
  event: string,
  fields: Record<string, unknown>
): void {
  console.log('[LunaTOC HISTORY BOUNDARY]', { event, ...fields });
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number
): void {
  const jumpId = createChatGptNavigationJumpId();
  const jumpStartMs = performance.now();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  logChatGptNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
  });

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
  keepFollowing(15_000);
  if (onJumpStart) {
    onJumpStart(index);
  } else {
    setJumpProgress?.({
      active: true,
      targetIndex: index,
      remainingSteps: 50,
    });
  }

  if (!container || !context.conversationKey) {
    if (onJumpFailed) {
      onJumpFailed(index);
    } else {
      clearJumpProgress?.();
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  // Fast path: if the target prompt is already mounted anywhere in the
  // DOM (id match exact, text match as fallback for id-string mismatches),
  // scroll straight to it.
  const idHit = findRenderedChatGptPrompt(message.id);
  const textHit =
    idHit ??
    (message.text ? findRenderedChatGptPromptByText(message.text) : null);
  const renderedTarget = idHit ?? textHit;

  if (renderedTarget) {
    logChatGptNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    if (isJumpVizDebugEnabled()) {
      logMountedPromptViz('fast-path');
    }
    finishIndependentVirtualJump(renderedTarget, message, index, jumpId);
    return;
  }

  // Unmounted target navigation: try virtual-layout fast jump, then fallback to viewport walker.
  void (async () => {
    const myNavVersion = navigationJumpVersion;
    const strategyContext: JumpStrategyContext = {
      targetMessage: message,
      targetIndex: index,
      prompts: context.prompts,
      container,
      jumpId,
      isCancelled: () => myNavVersion !== navigationJumpVersion,
    };

    // --- DIAGNOSTIC: START (fast-path miss, entering async strategy) ---
    logHistoryBoundary('START', {
      jumpId,
      targetIndex: index,
      targetVisibleNumber: index + 1,
      targetMessageId: message.id,
      promptCount: context.prompts.length,
      containerScrollTop: container.scrollTop,
      elapsedMs: Math.round(performance.now() - jumpStartMs),
    });

    let loaded: HTMLElement | null = null;
    const virtualAttempt = tryVirtualLayoutStrategy(strategyContext);

    // --- DIAGNOSTIC: STRATEGY_MODE_SELECTED (mode decided by tryVirtualLayoutStrategy) ---
    // Note: the raw bridge query result is logged as INITIAL_VIRTUAL_QUERY
    // inside tryVirtualLayoutStrategy itself.
    logHistoryBoundary('STRATEGY_MODE_SELECTED', {
      jumpId,
      targetIndex: index,
      selectedMode: virtualAttempt.mode,
      unsupportedReason:
        virtualAttempt.mode === 'unsupported' ? virtualAttempt.reason : null,
      elapsedMs: Math.round(performance.now() - jumpStartMs),
    });

    if (virtualAttempt.mode === 'unsupported') {
      loaded = await executeViewportWalkerStrategy(strategyContext);
    } else {
      const outcome = await virtualAttempt.promise;
      if (myNavVersion !== navigationJumpVersion || outcome.status === 'cancelled') {
        // --- DIAGNOSTIC: CANCELLED ---
        logHistoryBoundary('CANCELLED', {
          jumpId,
          targetIndex: index,
          reason: outcome.status === 'cancelled' ? 'virtual-promise-cancelled' : 'nav-version-mismatch',
          elapsedMs: Math.round(performance.now() - jumpStartMs),
        });
        return;
      }
      if (outcome.status === 'mounted') {
        // SUCCESS is logged inside finishIndependentVirtualJump
        finishIndependentVirtualJump(outcome.element, message, index, jumpId);
        return;
      }
      if (outcome.status === 'capability-failure') {
        loaded = await executeViewportWalkerStrategy(strategyContext);
      } else {
        // --- DIAGNOSTIC: FAIL (virtual exhausted) ---
        logHistoryBoundary('FAIL', {
          jumpId,
          targetIndex: index,
          reason: 'virtual-exhausted',
          outcomeStatus: outcome.status,
          elapsedMs: Math.round(performance.now() - jumpStartMs),
        });
        if (onJumpFailed) {
          onJumpFailed(index);
        } else {
          clearJumpProgress?.();
          notifyJumpFailed?.();
        }
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'not-found',
          attempts: 'virtual-exhausted',
        });
        if (isJumpVizDebugEnabled()) {
          console.log('[LunaTOC jump] virtual jump exhausted, giving up cleanly');
        }
        return;
      }
    }
    if (myNavVersion !== navigationJumpVersion) {
      // --- DIAGNOSTIC: CANCELLED (superseded after walker) ---
      logHistoryBoundary('CANCELLED', {
        jumpId,
        targetIndex: index,
        reason: 'nav-version-mismatch-post-walker',
        elapsedMs: Math.round(performance.now() - jumpStartMs),
      });
      return;
    }

    if (loaded) {
      // SUCCESS is logged inside finishIndependentVirtualJump
      finishIndependentVirtualJump(loaded, message, index, jumpId);
      return;
    }

    // --- DIAGNOSTIC: FAIL (walker exhausted or virtual capability-failure) ---
    logHistoryBoundary('FAIL', {
      jumpId,
      targetIndex: index,
      reason: 'step-2-exhausted',
      elapsedMs: Math.round(performance.now() - jumpStartMs),
    });
    if (onJumpFailed) {
      onJumpFailed(index);
    } else {
      clearJumpProgress?.();
      notifyJumpFailed?.();
    }
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
  index: number,
  jumpId?: string
): void {
  const jumpVersion = ++navigationJumpVersion;
  const targetAttempts = 8;

  // Scroll the target to the top of the chat viewport (with the
  // configured top padding so it doesn't sit flush against the edge),
  // then highlight it.
  const scrollTargetIntoView = function (el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const previousScrollMarginTop = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${platform().navigation.promptTopOffsetPx}px`;

    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    el.style.scrollMarginTop = previousScrollMarginTop;
    highlightMatchedElement(el);
    return true;
  };

  if (scrollTargetIntoView(target)) {
    if (jumpVersion !== navigationJumpVersion) return;

    keepFollowing(1800);

    // --- DIAGNOSTIC: SUCCESS ---
    logHistoryBoundary('SUCCESS', {
      jumpId: jumpId ?? null,
      targetIndex: index,
      phase: 'direct-scroll',
    });

    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'found', attempts: targetAttempts }
    );

    onJumpComplete?.(index);
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Each attempt polls once; bail after the budget.
  setTimeout(() => {
    if (jumpVersion !== navigationJumpVersion) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      if (!scrollTargetIntoView(latest)) {
        if (jumpVersion === navigationJumpVersion) {
          onJumpFailed?.(index);
        }
        return;
      }

      if (jumpVersion !== navigationJumpVersion) return;

      keepFollowing(1800);

      // --- DIAGNOSTIC: SUCCESS (after repoll) ---
      logHistoryBoundary('SUCCESS', {
        jumpId: jumpId ?? null,
        targetIndex: index,
        phase: 'repoll',
      });

      logChatGptNavigationEvent(
        createChatGptNavigationJumpId(),
        'JUMP_FINISHED',
        { status: 'found-after-repoll', attempts: targetAttempts }
      );

      onJumpComplete?.(index);
      return;
    }
    logChatGptNavigationEvent(
      createChatGptNavigationJumpId(),
      'JUMP_FINISHED',
      { status: 'target-disappeared-after-search' }
    );
    if (jumpVersion === navigationJumpVersion) {
      onJumpFailed?.(index);
    }
  }, 600);
}

/**
 * Jumps to a prompt by index, with optional high-priority lock to keep
 * LunaTOC's sidebar row pinned while ChatGPT scrolls virtualized content.
 * Lives here because outline navigation uses it for heading-to-heading
 * jumps that don't go through the regular TOC entry path.
 *
 * @param index 0-indexed position in the conversation.
 * @param duration Duration in ms to lock active prompt follow tracking.
 * @returns true if jump fired.
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
 * Cancels active independent and legacy virtual scans before a new jump.
 */
export function cancelActiveNavigationSearch(): void {
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
 *
 * Each click re-asserts `scrollTop = -currentMaxScrollTop` against the
 * *current* scrollHeight and waits briefly for ChatGPT's lazy mount to
 * extend the window.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 * @param behavior Optional ScrollBehavior (default 'auto').
 */
export function jumpToAbsoluteEdge(
  edge: 'top' | 'bottom',
  behavior: ScrollBehavior = 'auto'
): void {
  keepFollowing();
  // A new absolute-edge jump supersedes any in-flight independent virtual
  // jump; otherwise the highlight from a previous TOC click would linger.
  cancelActiveNavigationSearch();
  clearJumpProgress?.();

  const navVersionAtStart = navigationJumpVersion;
  const firstPromptId =
    edge === 'top'
      ? getVirtualSearchContext().prompts[0]?.id ?? null
      : null;

  executeAbsoluteEdgeJump(edge, {
    firstPromptId,
    isCancelled: () => navVersionAtStart !== navigationJumpVersion,
    onFirstPromptVisible: highlightMatchedElement,
  });
}