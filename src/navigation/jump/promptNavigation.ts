/**
 * Handles main prompt navigation coordinator, fast-path resolution, and public facade for LunaTOC.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '../follow/follow';
import { getActivePlatform } from '@/platforms';
import { executeViewportWalkerStrategy } from './strategies/viewportWalkerStrategy';
import { tryVirtualLayoutStrategy } from './strategies/virtualLayoutStrategy';
import type { JumpStrategyContext } from './strategies/types';
import { executeAbsoluteEdgeJump, isPageAtBottom } from './edgeNavigation';
import {
  clearPromptHighlightOverlay,
  highlightPromptElement,
} from './promptHighlightOverlay';

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

export interface JumpMessageOptions {
  mode?: 'target-driven' | 'viewport-driven';
  alignToTopEdge?: boolean;
}

export interface PromptLandingOffsetInput {
  desiredViewportTopPx?: number;
  minContainerOffsetPx: number;
  containerTopPx: number;
  containerClientHeightPx: number;
  scrollPaddingTopPx: number;
}

export interface PromptLandingOffsetResult {
  scrollMarginTopPx: number;
  expectedContainerOffsetPx: number;
}

const DEFAULT_MIN_CONTAINER_OFFSET_PX = 16;
const MAX_LANDING_CONTAINER_HEIGHT_RATIO = 0.3;

function sanitizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function readContainerScrollPaddingTopPx(
  container: HTMLElement | null
): number {
  if (
    !container ||
    typeof window === 'undefined' ||
    typeof window.getComputedStyle !== 'function'
  ) {
    return 0;
  }
  try {
    const raw = window.getComputedStyle(container).scrollPaddingTop;
    const parsed = parseFloat(raw || '0');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Computes the temporary `scrollMarginTop` and expected container-relative
 * landing offset for prompt navigation.
 *
 * Converts a viewport-relative target (`desiredViewportTopPx`) into a
 * scroll-container-relative offset, clamps it to 30% of container height on
 * short viewports, and subtracts the container's existing `scrollPaddingTop`
 * so offsets are not double-counted.
 *
 * Exception to the 30% clamp: if the host's own `scrollPaddingTop` already
 * exceeds the clamped target offset, `scrollMarginTopPx` is clamped to `0`
 * (never negative) and `expectedContainerOffsetPx` preserves the host's
 * `scrollPaddingTop`.
 *
 * @param input Geometry and configuration values for the active scroll container.
 * @returns Non-negative `scrollMarginTopPx` and matching `expectedContainerOffsetPx`.
 *
 * @example
 * const { scrollMarginTopPx, expectedContainerOffsetPx } =
 *   computePromptLandingOffset({
 *     desiredViewportTopPx: 190,
 *     minContainerOffsetPx: 16,
 *     containerTopPx: 0,
 *     containerClientHeightPx: 900,
 *     scrollPaddingTopPx: 0,
 *   });
 */
export function computePromptLandingOffset(
  input: PromptLandingOffsetInput
): PromptLandingOffsetResult {
  const minContainerOffset = sanitizeNonNegativeNumber(
    input.minContainerOffsetPx,
    DEFAULT_MIN_CONTAINER_OFFSET_PX
  );
  const scrollPaddingTop = sanitizeNonNegativeNumber(
    input.scrollPaddingTopPx,
    0
  );
  const hasDesiredViewportTop =
    typeof input.desiredViewportTopPx === 'number' &&
    Number.isFinite(input.desiredViewportTopPx) &&
    input.desiredViewportTopPx >= 0;

  if (!hasDesiredViewportTop) {
    return {
      scrollMarginTopPx: minContainerOffset,
      expectedContainerOffsetPx: scrollPaddingTop + minContainerOffset,
    };
  }

  const containerTop = sanitizeFiniteNumber(input.containerTopPx, 0);
  const containerClientHeight = sanitizeNonNegativeNumber(
    input.containerClientHeightPx,
    0
  );

  const rawContainerOffset = input.desiredViewportTopPx! - containerTop;
  const maxContainerOffset =
    containerClientHeight > 0
      ? Math.max(
          minContainerOffset,
          Math.floor(containerClientHeight * MAX_LANDING_CONTAINER_HEIGHT_RATIO)
        )
      : Infinity;

  const targetContainerOffset = Math.min(
    Math.max(minContainerOffset, rawContainerOffset),
    maxContainerOffset
  );

  const scrollMarginTopPx = Math.max(
    0,
    targetContainerOffset - scrollPaddingTop
  );

  return {
    scrollMarginTopPx,
    expectedContainerOffsetPx: scrollPaddingTop + scrollMarginTopPx,
  };
}

function resolvePromptLandingOffset(
  container: HTMLElement | null
): PromptLandingOffsetResult {
  const nav = platform().navigation;
  const containerTopPx = container ? container.getBoundingClientRect().top : 0;
  const containerClientHeightPx = container ? container.clientHeight : 0;
  const scrollPaddingTopPx = readContainerScrollPaddingTopPx(container);

  return computePromptLandingOffset({
    desiredViewportTopPx: nav.promptLandingViewportTopPx,
    minContainerOffsetPx: nav.promptTopOffsetPx,
    containerTopPx,
    containerClientHeightPx,
    scrollPaddingTopPx,
  });
}

export interface AlignElementResult {
  method: 'container-scroll' | 'scroll-into-view' | 'already-aligned' | 'none';
  scrolled: boolean;
  clamped: boolean;
  expectedViewportTopPx: number;
  expectedContainerOffsetPx: number;
  targetScrollTopPx: number | null;
}

/**
 * Aligns `el` inside `container` so its top edge lands at
 * `containerTop + expectedContainerOffsetPx` (190px from viewport top on
 * ChatGPT, respecting short-viewport clamping and existing `scrollPaddingTop`
 * without double-counting).
 *
 * Uses direct `container.scrollTo({ top, behavior: 'auto' })` when the scroll
 * container has measurable layout geometry so outer/nested scroll containers
 * are never moved and ChatGPT element styles are not mutated. Falls back to
 * temporary `scrollMarginTop` + `el.scrollIntoView()` only when container
 * layout geometry is unavailable (e.g. headless jsdom or missing container).
 *
 * @param el Connected target prompt element to align.
 * @param container Resolved active scroll container (`.thread-scroll-container`).
 * @returns Alignment method, clamp state, and expected coordinates.
 *
 * @example
 * const result = alignElementInContainer(targetEl, scrollContainer);
 */
export function alignElementInContainer(
  el: HTMLElement,
  container: HTMLElement | null
): AlignElementResult {
  if (!el.isConnected) {
    return {
      method: 'none',
      scrolled: false,
      clamped: false,
      expectedViewportTopPx: 0,
      expectedContainerOffsetPx: 0,
      targetScrollTopPx: null,
    };
  }

  const landing = resolvePromptLandingOffset(container);
  const elRect = el.getBoundingClientRect();
  const containerRect = container ? container.getBoundingClientRect() : null;
  const containerTop = containerRect ? containerRect.top : 0;
  const expectedViewportTopPx = containerTop + landing.expectedContainerOffsetPx;

  const hasElementLayout = !(
    elRect.width === 0 &&
    elRect.height === 0 &&
    elRect.top === 0 &&
    elRect.bottom === 0
  );
  const canUseDirectContainerScroll = Boolean(
    container &&
      container.isConnected &&
      hasElementLayout &&
      container.clientHeight > 0
  );

  if (canUseDirectContainerScroll && container) {
    const currentOffset = elRect.top - containerTop;
    const delta = currentOffset - landing.expectedContainerOffsetPx;

    if (Math.abs(delta) <= SUBPIXEL_TOLERANCE_PX) {
      return {
        method: 'already-aligned',
        scrolled: false,
        clamped: false,
        expectedViewportTopPx,
        expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
        targetScrollTopPx: container.scrollTop,
      };
    }

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight
    );
    const isReverse =
      typeof window !== 'undefined' &&
      typeof window.getComputedStyle === 'function' &&
      window.getComputedStyle(container).flexDirection === 'column-reverse';

    const desiredScrollTop = container.scrollTop + delta;
    const clampedScrollTop = isReverse
      ? Math.max(-maxScrollTop, Math.min(0, desiredScrollTop))
      : Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
    const clamped = Math.abs(clampedScrollTop - desiredScrollTop) > 0.5;

    if (Math.abs(clampedScrollTop - container.scrollTop) > 0.5) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: clampedScrollTop, behavior: 'auto' });
      } else {
        container.scrollTop = clampedScrollTop;
      }
      return {
        method: 'container-scroll',
        scrolled: true,
        clamped,
        expectedViewportTopPx,
        expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
        targetScrollTopPx: clampedScrollTop,
      };
    }

    return {
      method: 'container-scroll',
      scrolled: false,
      clamped: true,
      expectedViewportTopPx,
      expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
      targetScrollTopPx: clampedScrollTop,
    };
  }

  // Fallback when container geometry is unavailable (e.g. headless test DOM).
  const previousScrollMarginTop = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${landing.scrollMarginTopPx}px`;
  el.scrollIntoView({ behavior: 'auto', block: 'start' });
  el.style.scrollMarginTop = previousScrollMarginTop;

  return {
    method: 'scroll-into-view',
    scrolled: true,
    clamped: false,
    expectedViewportTopPx,
    expectedContainerOffsetPx: landing.expectedContainerOffsetPx,
    targetScrollTopPx: container ? container.scrollTop : null,
  };
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
let activeStabilizationCleanup: (() => void) | null = null;

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
 * Jumps to the first or last prompt using absolute edge navigation.
 *
 * @param edge Target edge: 'top' or 'bottom'.
 */
export function jumpToConversationEdge(edge: 'top' | 'bottom'): void {
  cancelActiveNavigationSearch();
  jumpToAbsoluteEdge(edge, 'auto');
}

/**
 * Displays a temporary independent highlight overlay over a rendered prompt element.
 */
function highlightMatchedElement(element: HTMLElement): void {
  highlightPromptElement(element, getChatGptScrollContainer);
}

/**
 * Jumps to a prompt using independent virtual navigation.
 *
 * @param message Target message representation.
 * @param index 0-indexed position in the conversation.
 * @param options Execution mode configuration.
 */
export function jumpToMessage(
  message: NavigatorMessage,
  index: number,
  options: JumpMessageOptions = {}
): void {
  clearPromptHighlightOverlay();
  cancelActiveNavigationSearch();
  jumpWithIndependentVirtualNavigation(message, index, options);
}

type NavigationStrategyName =
  | 'virtual-layout'
  | 'viewport-walker'
  | 'fast-path'
  | 'none';

type MountTargetOutcome =
  | { status: 'mounted'; element: HTMLElement; strategy: 'virtual-layout' | 'viewport-walker' }
  | { status: 'cancelled' }
  | {
      status: 'failed';
      reason: 'virtual-exhausted' | 'step-2-exhausted';
      strategy: 'virtual-layout' | 'viewport-walker';
    };

interface DisconnectRecoveryContext {
  recoverTarget: () => Promise<MountTargetOutcome>;
  remainingRecoveries: number;
  initialStrategy: NavigationStrategyName;
}

function isNavigationDebugEnabled(): boolean {
  try {
    const key = platform().diagnostics.debugStorageKey ?? 'chatTocDebugJump';
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'
    );
  } catch {
    return false;
  }
}

function logJumpFailedDiagnostic(details: {
  targetIndex: number;
  targetMessageId: string;
  reason: string;
  strategy: NavigationStrategyName;
  recoveryAttempts: number;
  container?: HTMLElement | null;
}): void {
  if (!isNavigationDebugEnabled()) return;
  const activeContainer = details.container ?? getChatGptScrollContainer();
  const scrollPosition = activeContainer
    ? {
        scrollTop: activeContainer.scrollTop,
        scrollHeight: activeContainer.scrollHeight,
        clientHeight: activeContainer.clientHeight,
        maxScrollTop: Math.max(
          0,
          activeContainer.scrollHeight - activeContainer.clientHeight
        ),
      }
    : null;

  const payload = {
    targetIndex: details.targetIndex,
    targetMessageId: details.targetMessageId,
    reason: details.reason,
    scrollPosition,
    strategy: details.strategy,
    recoveryAttempts: details.recoveryAttempts,
  };

  // Use console.debug with serialized JSON so handled navigation failures remain
  // readable in DevTools without polluting chrome://extensions error logs.
  console.debug(`[LUNA JUMP FAILED] ${JSON.stringify(payload)}`, payload);
}

const MIN_STABLE_DURATION_MS = 120;
const LAYOUT_SETTLED_QUIET_MS = 350;
const MAX_STABILIZE_DURATION_MS = 1200;
const REALIGN_COOLDOWN_MS = 50;
const MAX_REALIGN_ATTEMPTS = 3;
const REQUIRED_STABLE_FRAMES = 3;
const DISCONNECT_GRACE_FRAMES = 2;
const DISCONNECT_GRACE_MS = 50;
const MAX_DISCONNECT_RECOVERIES = 2;
const FRAME_TIMEOUT_MS = 50;
const SUBPIXEL_TOLERANCE_PX = 2;
const EXTERNAL_SCROLL_THRESHOLD_PX = 4;
const LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX = 2;

type DisplacementKind =
  | 'none'
  | 'layout-shift'
  | 'external-scroll-suspected'
  | 'user-scroll';

function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Mounts an unmounted target prompt by trying the virtual-layout strategy
 * first and falling back to the viewport walker when unsupported or on
 * capability failure.
 */
async function mountTargetViaStrategy(
  strategyContext: JumpStrategyContext
): Promise<MountTargetOutcome> {
  if (strategyContext.isCancelled()) {
    return { status: 'cancelled' };
  }

  const virtualAttempt = tryVirtualLayoutStrategy(strategyContext);

  if (virtualAttempt.mode === 'unsupported') {
    const loaded = await executeViewportWalkerStrategy(strategyContext);
    if (strategyContext.isCancelled()) {
      return { status: 'cancelled' };
    }
    return loaded
      ? { status: 'mounted', element: loaded, strategy: 'viewport-walker' }
      : { status: 'failed', reason: 'step-2-exhausted', strategy: 'viewport-walker' };
  }

  const outcome = await virtualAttempt.promise;
  if (strategyContext.isCancelled() || outcome.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  if (outcome.status === 'mounted') {
    return { status: 'mounted', element: outcome.element, strategy: 'virtual-layout' };
  }
  if (outcome.status === 'capability-failure') {
    const loaded = await executeViewportWalkerStrategy(strategyContext);
    if (strategyContext.isCancelled()) {
      return { status: 'cancelled' };
    }
    return loaded
      ? { status: 'mounted', element: loaded, strategy: 'viewport-walker' }
      : { status: 'failed', reason: 'step-2-exhausted', strategy: 'viewport-walker' };
  }

  return { status: 'failed', reason: 'virtual-exhausted', strategy: 'virtual-layout' };
}

function normalizePromptTextForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Returns true only when `message.text` is non-empty and does not collide
 * (exact or prefix match) with any other prompt in the conversation.
 * Prevents text fallback from jumping to a different prompt with identical text.
 */
function isUniquePromptTextInConversation(
  prompts: ReadonlyArray<NavigatorMessage>,
  message: NavigatorMessage
): boolean {
  const needle = normalizePromptTextForMatch(message.text || '');
  if (!needle) return false;

  for (const other of prompts) {
    if (other.id === message.id) continue;
    const otherNorm = normalizePromptTextForMatch(other.text || '');
    if (!otherNorm) continue;
    if (otherNorm === needle || otherNorm.startsWith(needle) || needle.startsWith(otherNorm)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when `element` exposes a stable message ID that conflicts with
 * `expectedId`, ensuring text fallback never selects a DOM node belonging to
 * a different message.
 */
function hasConflictingElementMessageId(
  element: HTMLElement,
  expectedId: string
): boolean {
  if (!expectedId) return false;
  const raw =
    platform().navigation.getMessageIdFromElement?.(element) ||
    element.getAttribute('data-chatgpt-search-message-ids') ||
    element.getAttribute('data-message-id') ||
    null;
  if (!raw) return false;
  const tokens = raw.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return !tokens.includes(expectedId);
}

/**
 * Uses only LunaTOC anchors, response fingerprints, and virtual search.
 */
function jumpWithIndependentVirtualNavigation(
  message: NavigatorMessage,
  index: number,
  options: JumpMessageOptions = {}
): void {
  const mode = options.mode ?? 'target-driven';
  const jumpId = createChatGptNavigationJumpId();
  const context = getVirtualSearchContext();
  const container = getChatGptScrollContainer();

  const initialScrollTopPx = container ? container.scrollTop : null;
  const holdResult = container
    ? platform().navigation.holdViewport?.(container)
    : undefined;

  logChatGptNavigationEvent(jumpId, 'JUMP_START', {
    conversationKey: context.conversationKey,
    targetPromptId: message.id,
    targetPromptIndex: index,
    promptCount: context.prompts.length,
    ...(holdResult ? { holdViewportStatus: holdResult.status } : {}),
  });

  // Far jumps slide the virtual render window over several seconds. Keep the
  // sidebar follow window open for the slide duration so the sidebar list can
  // scroll to track the target once it reaches the viewport.
  keepFollowing(15_000);
  if (mode === 'target-driven') {
    if (onJumpStart) {
      onJumpStart(index);
    } else {
      setJumpProgress?.({
        active: true,
        targetIndex: index,
        remainingSteps: 50,
      });
    }
  }

  if (!container || !context.conversationKey) {
    if (mode === 'target-driven') {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: 'missing-context',
        strategy: 'none',
        recoveryAttempts: 0,
        container,
      });
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        clearJumpProgress?.();
      }
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'missing-context',
      hasContainer: Boolean(container),
    });
    return;
  }

  // Fast path: if the target prompt is already mounted anywhere in the
  // DOM (id match exact, text match as fallback for id-string mismatches),
  // align directly and verify post-landing stability via the shared loop.
  const jumpVersion = navigationJumpVersion;
  const createStrategyContext = (): JumpStrategyContext => ({
    targetMessage: message,
    targetIndex: index,
    prompts: context.prompts,
    container: getChatGptScrollContainer() ?? container,
    jumpId,
    isCancelled: () => jumpVersion !== navigationJumpVersion,
  });

  const idHit = findRenderedChatGptPrompt(message.id);
  let textHit: HTMLElement | null = null;
  if (
    !idHit &&
    message.text &&
    isUniquePromptTextInConversation(context.prompts, message)
  ) {
    const candidate = findRenderedChatGptPromptByText(message.text);
    if (candidate && !hasConflictingElementMessageId(candidate, message.id)) {
      textHit = candidate;
    }
  }
  const renderedTarget = idHit ?? textHit;

  if (renderedTarget) {
    logChatGptNavigationEvent(jumpId, 'JUMP_FAST_PATH_RESULT', {
      idHit: Boolean(idHit),
      textHit: Boolean(textHit),
      finalElement: renderedTarget.tagName,
    });
    finishIndependentVirtualJump(
      renderedTarget,
      message,
      index,
      jumpId,
      options,
      jumpVersion,
      {
        recoverTarget: () => mountTargetViaStrategy(createStrategyContext()),
        remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
        initialStrategy: 'fast-path',
      },
      initialScrollTopPx
    );
    return;
  }

  // Unmounted target navigation: try virtual-layout fast jump, then fallback to viewport walker.
  void (async () => {
    const mountOutcome = await mountTargetViaStrategy(createStrategyContext());
    if (jumpVersion !== navigationJumpVersion || mountOutcome.status === 'cancelled') {
      return;
    }

    if (mountOutcome.status === 'mounted') {
      finishIndependentVirtualJump(
        mountOutcome.element,
        message,
        index,
        jumpId,
        options,
        jumpVersion,
        {
          recoverTarget: () => mountTargetViaStrategy(createStrategyContext()),
          remainingRecoveries: MAX_DISCONNECT_RECOVERIES,
          initialStrategy: mountOutcome.strategy,
        },
        initialScrollTopPx
      );
      return;
    }

    if (mode === 'target-driven') {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: mountOutcome.reason,
        strategy: mountOutcome.strategy,
        recoveryAttempts: 0,
      });
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        notifyJumpFailed?.();
        clearJumpProgress?.();
      }
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      attempts: mountOutcome.reason,
    });
  })();
}

/**
 * Completes an independent jump by aligning the target, highlighting it, and
 * verifying post-landing stability against virtual-list layout shifts or
 * unexpected external scroll changes.
 *
 * Shared by Mounted Fast Path, Virtual Layout, and Viewport Walker strategies.
 * Uses a monotonic wall-clock budget (600ms per pass), bounded incremental
 * re-alignment (up to 3 attempts), and bounded disconnect recovery (up to 2
 * attempts) while reusing a single jumpId across all diagnostic events.
 */
function finishIndependentVirtualJump(
  target: HTMLElement,
  message: NavigatorMessage,
  index: number,
  jumpId: string,
  options: JumpMessageOptions = {},
  jumpVersion = navigationJumpVersion,
  recovery?: DisconnectRecoveryContext,
  initialScrollTopPx: number | null = null
): void {
  const mode = options.mode ?? 'target-driven';
  let activeStrategy: NavigationStrategyName =
    recovery?.initialStrategy ?? 'fast-path';
  let recoveryAttemptsUsed = 0;
  let realignAttempts = 0;
  let lastAlignClamped = false;
  let lastAppliedScrollTop: number | null = null;
  let lastAppliedDistanceFromBottom: number | null = null;
  let lastObservedScrollHeight: number | null = null;
  let didScrollFar = activeStrategy !== 'fast-path';
  let layoutMutatedDuringPass = false;
  let userInterrupted = false;
  let cancelScheduledFrame: (() => void) | null = null;
  let removeUserInputListeners: (() => void) | null = null;

  const isCancelled = (): boolean => jumpVersion !== navigationJumpVersion;

  const cleanupStabilization = (): void => {
    if (cancelScheduledFrame) {
      const cancel = cancelScheduledFrame;
      cancelScheduledFrame = null;
      cancel();
    }
    if (removeUserInputListeners) {
      const remove = removeUserInputListeners;
      removeUserInputListeners = null;
      remove();
    }
    if (activeStabilizationCleanup === cleanupStabilization) {
      activeStabilizationCleanup = null;
    }
  };
  activeStabilizationCleanup = cleanupStabilization;

  const measureAlignmentErrorPx = (
    el: HTMLElement | null,
    container: HTMLElement | null
  ): number | null => {
    if (!el || !el.isConnected) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.bottom === 0) {
      return 0;
    }
    const containerTop = container ? container.getBoundingClientRect().top : 0;
    const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
    const expectedViewportTopPx = containerTop + expectedContainerOffsetPx;
    return Math.round((rect.top - expectedViewportTopPx) * 10) / 10;
  };

  const notifyFailure = (
    status: string,
    displacementKind: DisplacementKind = 'none',
    el: HTMLElement | null = null
  ): void => {
    cleanupStabilization();
    if (isCancelled()) return;
    const container = platform().navigation.getScrollContainer();
    const alignmentErrorPx = measureAlignmentErrorPx(el, container);
    if (el) {
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
      emitAlignmentMeasurement(
        'failed',
        el,
        container,
        containerTop + expectedContainerOffsetPx,
        lastAlignClamped,
        undefined,
        displacementKind
      );
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status,
      strategy: activeStrategy,
      realignAttempts,
      recoveryAttempts: recoveryAttemptsUsed,
      alignmentErrorPx,
      clamped: lastAlignClamped,
      displacementKind,
    });
    if (mode === 'target-driven') {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: status,
        strategy: activeStrategy,
        recoveryAttempts: recoveryAttemptsUsed,
        container,
      });
      if (onJumpFailed) {
        onJumpFailed(index);
      } else {
        notifyJumpFailed?.();
        clearJumpProgress?.();
      }
    }
  };

  const emitAlignmentMeasurement = (
    stage:
      | 'before-align'
      | 'after-align'
      | 'next-frame'
      | 'realign'
      | 'settled'
      | 'failed',
    el: HTMLElement,
    container: HTMLElement | null,
    expectedViewportTopPx: number,
    clamped: boolean,
    method?: AlignElementResult['method'],
    displacementKind?: DisplacementKind
  ): void => {
    if (!isNavigationDebugEnabled()) return;
    const connected = el.isConnected;
    const actualViewportTopPx = connected
      ? Math.round(el.getBoundingClientRect().top * 10) / 10
      : null;
    const alignmentErrorPx =
      actualViewportTopPx !== null
        ? Math.round((actualViewportTopPx - expectedViewportTopPx) * 10) / 10
        : null;
    const distanceFromBottom = container
      ? Math.round(
          (container.scrollHeight - container.scrollTop - container.clientHeight) * 10
        ) / 10
      : null;

    console.info('[LUNA ALIGNMENT]', {
      jumpId,
      stage,
      targetMessageId: message.id,
      targetIndex: index,
      strategy: activeStrategy,
      targetTag: el.tagName,
      targetUnitKey: el.getAttribute('data-chatgpt-search-unit-key'),
      targetConnected: connected,
      expectedViewportTopPx: Math.round(expectedViewportTopPx * 10) / 10,
      actualViewportTopPx,
      alignmentErrorPx,
      scrollTop: container ? Math.round(container.scrollTop) : null,
      scrollHeight: container ? Math.round(container.scrollHeight) : null,
      clientHeight: container ? Math.round(container.clientHeight) : null,
      distanceFromBottom,
      clamped,
      ...(method ? { method } : {}),
      ...(displacementKind ? { displacementKind } : {}),
    });
  };

  // Scroll the target to the computed landing coordinate inside the active
  // scroll container, emit debug-only alignment measurements if enabled,
  // then highlight it.
  const scrollTargetIntoView = function (
    el: HTMLElement,
    stage: 'after-align' | 'realign' = 'after-align'
  ): AlignElementResult | null {
    if (isCancelled() || !el.isConnected) return null;
    const container = platform().navigation.getScrollContainer();
    const debugEnabled = isNavigationDebugEnabled();

    if (debugEnabled && stage === 'after-align') {
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
      emitAlignmentMeasurement(
        'before-align',
        el,
        container,
        containerTop + expectedContainerOffsetPx,
        false
      );
    }

    const scrollTopBefore =
      container && container.isConnected ? container.scrollTop : null;
    const alignResult = alignElementInContainer(el, container);
    lastAlignClamped = alignResult.clamped;
    if (container && container.isConnected) {
      lastAppliedScrollTop = container.scrollTop;
      lastObservedScrollHeight = container.scrollHeight;
      lastAppliedDistanceFromBottom = Math.max(
        0,
        container.scrollHeight - container.scrollTop - container.clientHeight
      );
      const baselineScrollTop =
        initialScrollTopPx !== null ? initialScrollTopPx : scrollTopBefore;
      if (
        stage === 'after-align' &&
        baselineScrollTop !== null &&
        container.clientHeight > 0 &&
        Math.abs(container.scrollTop - baselineScrollTop) > container.clientHeight
      ) {
        didScrollFar = true;
      }
    }

    if (debugEnabled) {
      emitAlignmentMeasurement(
        stage,
        el,
        container,
        alignResult.expectedViewportTopPx,
        alignResult.clamped,
        alignResult.method
      );
      if (stage === 'after-align' && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (isCancelled()) return;
          const resolved = findRenderedChatGptPrompt(message.id);
          const liveEl =
            resolved && resolved.isConnected ? resolved : el;
          const liveContainer = platform().navigation.getScrollContainer();
          emitAlignmentMeasurement(
            'next-frame',
            liveEl,
            liveContainer,
            alignResult.expectedViewportTopPx,
            alignResult.clamped,
            alignResult.method
          );
        });
      }
    }

    if (stage === 'after-align') {
      highlightMatchedElement(el);
    }
    return alignResult;
  };

  type AlignmentEvaluation = 'aligned' | 'bounded' | 'correctable' | 'disconnected';

  const evaluateAlignment = (el: HTMLElement): AlignmentEvaluation => {
    if (!el.isConnected) return 'disconnected';

    const container = platform().navigation.getScrollContainer();
    const containerRect = container ? container.getBoundingClientRect() : null;
    const containerTop = containerRect ? containerRect.top : 0;
    const containerHeight = container
      ? container.clientHeight || (containerRect ? containerRect.height : 0)
      : 0;
    const rect = el.getBoundingClientRect();

    // Preserve compatibility with headless test environments lacking layout engines
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.bottom === 0) {
      return 'aligned';
    }

    const currentOffset = rect.top - containerTop;
    const { expectedContainerOffsetPx: expectedOffset } =
      resolvePromptLandingOffset(container);
    const diff = currentOffset - expectedOffset;

    if (Math.abs(diff) <= SUBPIXEL_TOLERANCE_PX) {
      return 'aligned';
    }

    if (container) {
      const scrollTop = container.scrollTop;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const isVisibleInContainer =
        currentOffset >= -SUBPIXEL_TOLERANCE_PX &&
        (containerHeight <= 0 || currentOffset < containerHeight - SUBPIXEL_TOLERANCE_PX);

      // Target is above expected offset but container is clamped at minimum scroll boundary.
      // Guard against false positive: element must still be visible inside the container.
      if (
        diff < -SUBPIXEL_TOLERANCE_PX &&
        isVisibleInContainer &&
        scrollTop <= SUBPIXEL_TOLERANCE_PX
      ) {
        return 'bounded';
      }

      // Target is below expected offset but container is clamped at maximum scroll ceiling.
      // Guard against false positive: element must still be visible inside the container.
      if (
        maxScrollTop > 0 &&
        diff > SUBPIXEL_TOLERANCE_PX &&
        isVisibleInContainer &&
        scrollTop >= maxScrollTop - SUBPIXEL_TOLERANCE_PX
      ) {
        return 'bounded';
      }
    }

    return 'correctable';
  };

  const scheduleFrame = (callback: () => void): (() => void) => {
    let settled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const run = () => {
      if (settled) return;
      cleanup();
      if (isCancelled()) return;
      callback();
    };

    let inSchedule = true;
    timerId = setTimeout(run, FRAME_TIMEOUT_MS);
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        if (inSchedule) return;
        run();
      });
    }
    inSchedule = false;

    return cleanup;
  };

  const performFinalTopScroll = () => {
    if (!options.alignToTopEdge) return;
    if (isCancelled()) return;
    const scrollContainer = platform().navigation.getScrollContainer();
    if (!scrollContainer || !scrollContainer.isConnected) return;

    const targetElement = findRenderedChatGptPrompt(message.id);
    if (!targetElement || !targetElement.isConnected) return;

    scrollContainer.scrollTo({ top: 0, behavior: 'auto' });

    scheduleFrame(() => {
      if (isCancelled()) return;
      if (!scrollContainer.isConnected) return;

      const verifiedPrompt = findRenderedChatGptPrompt(message.id);
      if (!verifiedPrompt || !verifiedPrompt.isConnected) return;

      if (scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      }
      highlightMatchedElement(verifiedPrompt);
    });
  };

  const attachUserInputListeners = (): void => {
    if (removeUserInputListeners || typeof window === 'undefined') return;
    const container = platform().navigation.getScrollContainer();
    const markUserInterrupted = (): void => {
      userInterrupted = true;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        userInterrupted = true;
      }
    };
    const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
    const eventTarget: EventTarget = container ?? window;
    eventTarget.addEventListener('wheel', markUserInterrupted, passiveOpts);
    eventTarget.addEventListener('touchstart', markUserInterrupted, passiveOpts);
    eventTarget.addEventListener('pointerdown', markUserInterrupted, passiveOpts);
    window.addEventListener('keydown', onKeyDown, true);

    removeUserInputListeners = () => {
      eventTarget.removeEventListener('wheel', markUserInterrupted, passiveOpts);
      eventTarget.removeEventListener('touchstart', markUserInterrupted, passiveOpts);
      eventTarget.removeEventListener('pointerdown', markUserInterrupted, passiveOpts);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  };

  const classifyDisplacement = (
    container: HTMLElement | null,
    scrollHeightChanged: boolean
  ): DisplacementKind => {
    if (userInterrupted) return 'user-scroll';
    if (container && lastAppliedScrollTop !== null) {
      if (scrollHeightChanged) {
        const currentDistFromBottom = Math.max(
          0,
          container.scrollHeight - container.scrollTop - container.clientHeight
        );
        // Only classify as an external bottom-snap when scrollTop actively
        // jumped downward toward the bottom. If scrollHeight shrank and
        // clamped scrollTop (scrollTop <= lastAppliedScrollTop), it is a
        // layout-induced clamp that should be realigned.
        const isDownwardSnapToBottom =
          currentDistFromBottom <= 2 &&
          lastAppliedDistanceFromBottom !== null &&
          lastAppliedDistanceFromBottom > 24 &&
          container.scrollTop > lastAppliedScrollTop + EXTERNAL_SCROLL_THRESHOLD_PX;
        if (isDownwardSnapToBottom) {
          return 'external-scroll-suspected';
        }
        return 'layout-shift';
      }
      const scrollTopDrift = Math.abs(container.scrollTop - lastAppliedScrollTop);
      if (scrollTopDrift > EXTERNAL_SCROLL_THRESHOLD_PX) {
        return 'external-scroll-suspected';
      }
    }
    return 'layout-shift';
  };

  const initialAlignResult = scrollTargetIntoView(target, 'after-align');
  if (initialAlignResult) {
    if (isCancelled()) {
      cleanupStabilization();
      return;
    }

    keepFollowing(1800);
    attachUserInputListeners();

    // Shared post-landing stabilization loop for Mounted Fast Path, Virtual
    // Layout, and Viewport Walker: verifies alignment stability against
    // virtual-list layout shifts and unexpected external scroll changes using
    // a monotonic wall-clock budget (600ms per pass) and bounded disconnect
    // recovery (up to 2 attempts).
    let activeTarget: HTMLElement | null = target;
    let remainingRecoveries = recovery?.remainingRecoveries ?? 0;
    let isRecovering = false;
    let stabilizeStartedAt = getMonotonicNowMs();
    let lastRealignAt: number | null = null;
    let consecutiveAlignedFrames = 0;
    let stableSince: number | null = null;
    let consecutiveDisconnectedFrames = 0;
    let disconnectedSince: number | null = null;

    const resetStabilizationPass = (nextTarget: HTMLElement): void => {
      activeTarget = nextTarget;
      stabilizeStartedAt = getMonotonicNowMs();
      realignAttempts = 0;
      lastRealignAt = null;
      consecutiveAlignedFrames = 0;
      stableSince = null;
      consecutiveDisconnectedFrames = 0;
      disconnectedSince = null;
      layoutMutatedDuringPass = false;
    };

    const scheduleStabilizeStep = (): void => {
      cancelScheduledFrame = scheduleFrame(() => {
        cancelScheduledFrame = null;
        stabilizeStep();
      });
    };

    const runDisconnectRecovery = async (): Promise<void> => {
      if (isRecovering || isCancelled() || !recovery || remainingRecoveries <= 0) {
        return;
      }
      isRecovering = true;
      remainingRecoveries -= 1;
      recoveryAttemptsUsed += 1;

      const recoveryAttempt = recoveryAttemptsUsed;
      logChatGptNavigationEvent(jumpId, 'JUMP_DISCONNECT_RECOVERY_START', {
        targetPromptIndex: index,
        recoveryAttempt,
      });

      let outcome: MountTargetOutcome;
      try {
        outcome = await recovery.recoverTarget();
      } catch {
        outcome = {
          status: 'failed',
          reason: 'virtual-exhausted',
          strategy: 'virtual-layout',
        };
      } finally {
        isRecovering = false;
      }

      if (isCancelled() || outcome.status === 'cancelled') {
        cleanupStabilization();
        return;
      }

      activeStrategy = outcome.strategy;

      if (outcome.status === 'mounted' && outcome.element.isConnected) {
        resetStabilizationPass(outcome.element);
        if (scrollTargetIntoView(outcome.element, 'realign')) {
          if (isCancelled()) {
            cleanupStabilization();
            return;
          }
          keepFollowing(1800);
          scheduleStabilizeStep();
          return;
        }
      }

      notifyFailure('target-disconnected');
    };

    const stabilizeStep = () => {
      if (isCancelled() || isRecovering) return;

      if (userInterrupted) {
        cleanupStabilization();
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'cancelled-by-user',
          strategy: activeStrategy,
          realignAttempts,
          recoveryAttempts: recoveryAttemptsUsed,
          displacementKind: 'user-scroll',
        });
        clearJumpProgress?.();
        return;
      }

      const now = getMonotonicNowMs();
      const elapsedPassMs = now - stabilizeStartedAt;
      const container = platform().navigation.getScrollContainer();

      const scrollHeightChanged = Boolean(
        container &&
          container.isConnected &&
          lastObservedScrollHeight !== null &&
          Math.abs(container.scrollHeight - lastObservedScrollHeight) >
            LAYOUT_HEIGHT_CHANGE_THRESHOLD_PX
      );
      if (scrollHeightChanged && container) {
        layoutMutatedDuringPass = true;
        lastObservedScrollHeight = container.scrollHeight;
        stableSince = null;
        consecutiveAlignedFrames = 0;
      }

      // Re-resolve by stable message ID; never reuse a disconnected node as connected.
      const resolvedById = findRenderedChatGptPrompt(message.id);
      let liveTarget: HTMLElement | null = null;
      if (resolvedById && resolvedById.isConnected) {
        if (resolvedById !== activeTarget) {
          activeTarget = resolvedById;
          highlightMatchedElement(resolvedById);
        }
        liveTarget = resolvedById;
      } else if (activeTarget && activeTarget.isConnected) {
        liveTarget = activeTarget;
      } else {
        activeTarget = null;
      }

      const evalResult: AlignmentEvaluation = liveTarget
        ? evaluateAlignment(liveTarget)
        : 'disconnected';

      if (evalResult === 'disconnected') {
        stableSince = null;
        consecutiveAlignedFrames = 0;
        if (disconnectedSince === null) {
          disconnectedSince = now;
        }
        consecutiveDisconnectedFrames += 1;

        const graceElapsed =
          consecutiveDisconnectedFrames >= DISCONNECT_GRACE_FRAMES &&
          now - disconnectedSince >= DISCONNECT_GRACE_MS;

        if (graceElapsed) {
          if (recovery && remainingRecoveries > 0) {
            void runDisconnectRecovery();
            return;
          }
          notifyFailure('target-disconnected');
          return;
        }

        if (elapsedPassMs < MAX_STABILIZE_DURATION_MS) {
          scheduleStabilizeStep();
          return;
        }

        notifyFailure('target-disconnected');
        return;
      }

      disconnectedSince = null;
      consecutiveDisconnectedFrames = 0;

      if (evalResult === 'correctable' && liveTarget) {
        stableSince = null;
        consecutiveAlignedFrames = 0;

        const displacementKind = classifyDisplacement(container, scrollHeightChanged);
        if (displacementKind === 'external-scroll-suspected') {
          notifyFailure(
            'external-scroll-suspected',
            'external-scroll-suspected',
            liveTarget
          );
          return;
        }

        const cooldownElapsed =
          lastRealignAt === null || now - lastRealignAt >= REALIGN_COOLDOWN_MS;
        const withinPassBudget = elapsedPassMs < MAX_STABILIZE_DURATION_MS;

        if (realignAttempts < MAX_REALIGN_ATTEMPTS && withinPassBudget) {
          if (cooldownElapsed) {
            realignAttempts += 1;
            lastRealignAt = now;
            scrollTargetIntoView(liveTarget, 'realign');
          }
          scheduleStabilizeStep();
          return;
        }

        if (
          withinPassBudget &&
          lastRealignAt !== null &&
          now - lastRealignAt < REALIGN_COOLDOWN_MS
        ) {
          scheduleStabilizeStep();
          return;
        }

        performFinalTopScroll();
        notifyFailure('alignment-unstable', displacementKind, liveTarget);
        return;
      }

      // evalResult is 'aligned' or 'bounded'
      if (container && container.isConnected) {
        lastAppliedScrollTop = container.scrollTop;
        lastObservedScrollHeight = container.scrollHeight;
        lastAppliedDistanceFromBottom = Math.max(
          0,
          container.scrollHeight - container.scrollTop - container.clientHeight
        );
      }
      if (!scrollHeightChanged) {
        if (stableSince === null) {
          stableSince = now;
        }
        consecutiveAlignedFrames += 1;
      }

      const requiredStableDurationMs =
        didScrollFar || layoutMutatedDuringPass
          ? LAYOUT_SETTLED_QUIET_MS
          : MIN_STABLE_DURATION_MS;

      if (
        consecutiveAlignedFrames >= REQUIRED_STABLE_FRAMES &&
        stableSince !== null &&
        now - stableSince >= requiredStableDurationMs
      ) {
        cleanupStabilization();
        performFinalTopScroll();
        const finalErrorPx = measureAlignmentErrorPx(liveTarget, container);
        if (liveTarget) {
          // Refresh highlight on the final connected target once alignment has
          // settled so the full visibility window begins after navigation completes
          // and recovers from any mid-stabilization unmount/offscreen teardown.
          highlightMatchedElement(liveTarget);
          const containerTop = container ? container.getBoundingClientRect().top : 0;
          const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
          emitAlignmentMeasurement(
            'settled',
            liveTarget,
            container,
            containerTop + expectedContainerOffsetPx,
            lastAlignClamped,
            undefined,
            'none'
          );
        }
        logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
          status: 'found',
          strategy: activeStrategy,
          realignAttempts,
          recoveryAttempts: recoveryAttemptsUsed,
          alignmentErrorPx: finalErrorPx,
          clamped: lastAlignClamped,
        });
        if (mode === 'target-driven') {
          onJumpComplete?.(index);
        }
        return;
      }

      if (elapsedPassMs < MAX_STABILIZE_DURATION_MS) {
        scheduleStabilizeStep();
      } else {
        performFinalTopScroll();
        notifyFailure('alignment-unstable', 'layout-shift', liveTarget);
      }
    };

    scheduleStabilizeStep();
    return;
  }

  // Re-poll briefly in case ChatGPT replaces the bubble during virtual
  // scroll. Each attempt polls once; bail after the budget.
  setTimeout(() => {
    if (isCancelled()) return;
    const latest = findRenderedChatGptPrompt(message.id);
    if (latest && latest.isConnected) {
      if (!scrollTargetIntoView(latest, 'realign')) {
        if (!isCancelled()) {
          logJumpFailedDiagnostic({
            targetIndex: index,
            targetMessageId: message.id,
            reason: 'scroll-failed-after-repoll',
            strategy: activeStrategy,
            recoveryAttempts: recoveryAttemptsUsed,
          });
          onJumpFailed?.(index);
        }
        return;
      }

      if (isCancelled()) return;

      keepFollowing(1800);
      const container = platform().navigation.getScrollContainer();

      logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'found-after-repoll',
        strategy: activeStrategy,
        realignAttempts,
        recoveryAttempts: recoveryAttemptsUsed,
        alignmentErrorPx: measureAlignmentErrorPx(latest, container),
        clamped: lastAlignClamped,
      });

      onJumpComplete?.(index);
      return;
    }
    logChatGptNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'target-disappeared-after-search',
      strategy: activeStrategy,
      realignAttempts,
      recoveryAttempts: recoveryAttemptsUsed,
    });
    if (!isCancelled()) {
      logJumpFailedDiagnostic({
        targetIndex: index,
        targetMessageId: message.id,
        reason: 'target-disappeared-after-search',
        strategy: activeStrategy,
        recoveryAttempts: recoveryAttemptsUsed,
      });
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
  if (activeStabilizationCleanup) {
    const cleanup = activeStabilizationCleanup;
    activeStabilizationCleanup = null;
    cleanup();
  }
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

export { isPageAtBottom };