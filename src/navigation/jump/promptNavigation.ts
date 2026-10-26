/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import { loadUntilMountedViaViewport } from './viewportWalker';
import { executeAbsoluteEdgeJump } from './edgeNavigation';
import { findNextAssistantMessage } from './headingExtractor';
import { NAVIGATION_HIGHLIGHT_DURATION_MS } from './highlightTiming';

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
 *
 * @param options Observer and callback hooks for navigation progress.
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
 * Jumps to the start or end of the current ChatGPT conversation.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 */
export function jumpToConversationEdge(edge: 'top' | 'bottom'): void {
  cancelActiveNavigationSearch();
  jumpToAbsoluteEdge(edge, 'auto');
}

/**
 * Applies a temporary highlight effect to a rendered prompt element.
 */
let highlightedPromptElement: HTMLElement | null = null;
let promptHighlightTimeoutId: number | null = null;

function highlightMatchedElement(element: HTMLElement): void {
  if (promptHighlightTimeoutId !== null) {
    window.clearTimeout(promptHighlightTimeoutId);
    promptHighlightTimeoutId = null;
  }
  if (highlightedPromptElement && highlightedPromptElement !== element) {
    highlightedPromptElement.style.outline = '';
    highlightedPromptElement.style.borderRadius = '';
  }

  element.style.outline = '2px solid #60a5fa';
  element.style.borderRadius = '8px';
  highlightedPromptElement = element;

  promptHighlightTimeoutId = window.setTimeout(() => {
    if (highlightedPromptElement === element) {
      element.style.outline = '';
      element.style.borderRadius = '';
      highlightedPromptElement = null;
    }
    promptHighlightTimeoutId = null;
  }, NAVIGATION_HIGHLIGHT_DURATION_MS);
}

/**
 * Jumps to a prompt through the independent virtual navigation engine.
 * Text fallback requires an unambiguous plain-text message identity.
 *
 * @param message Target message representation.
 * @param index 0-indexed position in the conversation.
 */
export function jumpToMessage(
  message: NavigatorMessage,
  index: number,
  edge: 'top' | 'bottom' = 'top'
): void {
  cancelActiveNavigationSearch();
  jumpWithIndependentVirtualNavigation(message, index, edge);
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number,
  edge: 'top' | 'bottom' = 'top'
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

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
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
  // scroll straight to it.
  const idHit = findRenderedChatGptPrompt(message.id);
  // A text fallback is safe only for a plain-text prompt unique in the
  // entire conversation, not merely among currently mounted DOM elements.
  const normalizedText = message.text.replace(/\s+/g, ' ').trim().toLowerCase();
  const hasUniqueText = Boolean(
    message.canMatchByText &&
    normalizedText &&
    context.prompts.filter((prompt) =>
      prompt.canMatchByText &&
      prompt.text.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedText
    ).length === 1
  );
  const textHit =
    idHit ?? (hasUniqueText ? findRenderedChatGptPromptByText(message.text) : null);
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
    finishIndependentVirtualJump(renderedTarget, message, index, edge);
    return;
  }

  // Step 2 runs after Step 1 misses. Sequential, never in parallel.
  void (async () => {
    const myNavVersion = navigationJumpVersion;
    const loaded = await loadUntilMountedViaViewport(
      message.id,
      index,
      context.prompts,
      container,
      jumpId,
      () => myNavVersion !== navigationJumpVersion
    );
    // A heading jump may cancel the older viewport scan. Do not report
    // a spurious jump failure or move the page after cancellation.
    if (myNavVersion !== navigationJumpVersion) return;
    if (loaded) {
      clearJumpProgress();
      finishIndependentVirtualJump(loaded, message, index, edge);
      return;
    }

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
  index: number,
  edge: 'top' | 'bottom'
): void {
  const jumpVersion = ++navigationJumpVersion;
  const targetAttempts = 8;
  keepFollowing(1800);

  // Scroll the target to the top of the chat viewport (with the
  // configured top padding so it doesn't sit flush against the edge),
  // then highlight it.
  const scrollTargetIntoView = function (el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const previousScrollMarginTop = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${platform().navigation.promptTopOffsetPx}px`;

    if (edge === 'bottom') {
      const assistant = findNextAssistantMessage(el);
      const landing = assistant ?? el;
      landing.scrollIntoView({ behavior: 'auto', block: 'end' });
    } else {
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    el.style.scrollMarginTop = previousScrollMarginTop;
    highlightMatchedElement(el);
    return true;
  };

  if (scrollTargetIntoView(target)) {
    // A virtualized or generating answer might mount shortly after its prompt.
    // Never scroll into the next user's turn when the answer is unavailable.
    if (edge === 'bottom' && !findNextAssistantMessage(target)) {
      const retryAnswer = (attempts: number): void => {
        if (jumpVersion !== navigationJumpVersion || attempts === 0) return;
        const fresh = findRenderedChatGptPrompt(message.id);
        if (!fresh?.isConnected) return;
        const answer = findNextAssistantMessage(fresh);
        if (answer?.isConnected) {
          answer.scrollIntoView({ behavior: 'auto', block: 'end' });
        } else {
          window.setTimeout(() => retryAnswer(attempts - 1), 200);
        }
      };
      window.setTimeout(() => retryAnswer(6), 200);
    }
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
 * Cancels the currently active independent virtual scan before a new jump.
 */
function cancelActiveNavigationSearch(): void {
  navigationJumpVersion += 1;
}

/** Cancels a pending parent-prompt walk before a child-heading landing. */
export function cancelPromptNavigation(): void {
  cancelActiveNavigationSearch();
  clearJumpProgress();
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
  clearJumpProgress();

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