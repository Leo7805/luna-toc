/**
 * Synchronous post-landing target alignment execution, final top-edge scroll
 * verification, and displacement classification for prompt jump sessions.
 */
import { getActivePlatform } from '@/platforms';
import { isNavigationDebugEnabled } from '@/navigation/jump/jumpDiagnostics';
import {
  alignElementInContainer,
  resolvePromptLandingOffset,
  type AlignElementResult,
} from '@/navigation/jump/promptAlignment';
import { highlightPromptElement } from '@/navigation/jump/promptHighlightOverlay';
import {
  emitSessionAlignmentMeasurement,
  scheduleSessionFrame,
  type DisplacementKind,
  type PromptJumpSession,
} from './promptJumpSession';

const EXTERNAL_SCROLL_THRESHOLD_PX = 4;

function getScrollContainer(root?: ParentNode): HTMLElement | null {
  return getActivePlatform().navigation.getScrollContainer(root);
}

function findRenderedPrompt(
  promptId: string,
  root?: ParentNode
): HTMLElement | null {
  return getActivePlatform().navigation.findRenderedPrompt(promptId, root);
}

function highlightMatchedElement(
  element: HTMLElement,
  messageId?: string
): void {
  highlightPromptElement(
    element,
    getScrollContainer,
    undefined,
    messageId ? () => findRenderedPrompt(messageId) : undefined
  );
}

/**
 * Scrolls the target element to the computed landing coordinate inside the
 * active scroll container, updates `session.alignment`, emits debug-only
 * alignment measurements when enabled, and highlights the target on initial
 * landing (`stage === 'after-align'`).
 *
 * @param session Centralized prompt jump session owning mutable alignment state.
 * @param el Connected target prompt element to align.
 * @param stage Landing stage (`'after-align'` or `'realign'`).
 * @returns Alignment result, or `null` if the session was cancelled or `el` is disconnected.
 * @example
 * const result = applyTargetLandingAlignment(session, target, 'after-align');
 */
export function applyTargetLandingAlignment(
  session: PromptJumpSession,
  el: HTMLElement,
  stage: 'after-align' | 'realign' = 'after-align'
): AlignElementResult | null {
  if (session.isCancelled() || !el.isConnected) return null;
  const container = getScrollContainer();
  const debugEnabled = isNavigationDebugEnabled();

  if (debugEnabled && stage === 'after-align') {
    const containerTop = container ? container.getBoundingClientRect().top : 0;
    const { expectedContainerOffsetPx } = resolvePromptLandingOffset(container);
    emitSessionAlignmentMeasurement(
      session,
      'before-align',
      el,
      container,
      containerTop + expectedContainerOffsetPx,
      false
    );
  }

  // Re-arm viewport hold before post-mount alignment and realignment writes
  // because coarse virtual jumps or height collapses can briefly touch
  // distanceFromBottom=0 and re-enable ChatGPT's native bottom compensation.
  if (
    container &&
    container.isConnected &&
    (stage === 'realign' || session.recovery.activeStrategy !== 'fast-path')
  ) {
    getActivePlatform().navigation.holdViewport?.(container);
  }

  const scrollTopBefore =
    container && container.isConnected ? container.scrollTop : null;
  const alignResult = alignElementInContainer(el, container);
  session.alignment.lastAlignClamped = alignResult.clamped;
  if (container && container.isConnected) {
    session.alignment.lastAppliedScrollTop = container.scrollTop;
    session.alignment.lastObservedScrollHeight = container.scrollHeight;
    session.alignment.lastAppliedDistanceFromBottom = Math.max(
      0,
      container.scrollHeight - container.scrollTop - container.clientHeight
    );
    const baselineScrollTop =
      session.initialScrollTopPx !== null
        ? session.initialScrollTopPx
        : scrollTopBefore;
    if (
      stage === 'after-align' &&
      baselineScrollTop !== null &&
      container.clientHeight > 0 &&
      Math.abs(container.scrollTop - baselineScrollTop) > container.clientHeight
    ) {
      session.alignment.didScrollFar = true;
    }
  }

  if (debugEnabled) {
    emitSessionAlignmentMeasurement(
      session,
      stage,
      el,
      container,
      alignResult.expectedViewportTopPx,
      alignResult.clamped,
      alignResult.method
    );
    if (stage === 'after-align' && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (session.isCancelled()) return;
        const resolved = findRenderedPrompt(session.targetMessageId);
        const liveEl = resolved && resolved.isConnected ? resolved : el;
        const liveContainer = getScrollContainer();
        emitSessionAlignmentMeasurement(
          session,
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
    highlightMatchedElement(el, session.targetMessageId);
  }
  return alignResult;
}

/**
 * When `alignToTopEdge` is enabled (e.g. To Top navigation), scrolls the
 * container cleanly to `top: 0` and schedules a one-frame verification pass
 * that re-asserts `top: 0` and refreshes the target highlight.
 *
 * @param session Active prompt jump session.
 * @param alignToTopEdge Whether top-edge alignment is enabled for this jump.
 * @param frameTimeoutMs Fallback frame timeout in milliseconds.
 */
export function performFinalTopScroll(
  session: PromptJumpSession,
  alignToTopEdge: boolean | undefined,
  frameTimeoutMs: number
): void {
  if (!alignToTopEdge) return;
  if (session.isCancelled()) return;
  const scrollContainer = getScrollContainer();
  if (!scrollContainer || !scrollContainer.isConnected) return;

  const targetElement = findRenderedPrompt(session.targetMessageId);
  if (!targetElement || !targetElement.isConnected) return;

  scrollContainer.scrollTo({ top: 0, behavior: 'auto' });

  scheduleSessionFrame(
    session,
    () => {
      if (session.isCancelled()) return;
      if (!scrollContainer.isConnected) return;

      const verifiedPrompt = findRenderedPrompt(session.targetMessageId);
      if (!verifiedPrompt || !verifiedPrompt.isConnected) return;

      if (scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      }
      highlightMatchedElement(verifiedPrompt, session.targetMessageId);
    },
    frameTimeoutMs
  );
}

/**
 * Classifies post-landing target displacement as user input, suspected
 * external scroll interference (e.g. downward bottom-snap or unprovoked
 * scrollTop drift), or a correctable virtual-list layout shift.
 *
 * @param session Active prompt jump session.
 * @param container Active scroll container, if any.
 * @param scrollHeightChanged Whether `container.scrollHeight` mutated since the last check.
 * @returns Classified displacement kind.
 */
export function classifyDisplacement(
  session: PromptJumpSession,
  container: HTMLElement | null,
  scrollHeightChanged: boolean
): DisplacementKind {
  if (session.lifecycle.userInterrupted) return 'user-scroll';
  if (container && session.alignment.lastAppliedScrollTop !== null) {
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
        session.alignment.lastAppliedDistanceFromBottom !== null &&
        session.alignment.lastAppliedDistanceFromBottom > 24 &&
        container.scrollTop >
          session.alignment.lastAppliedScrollTop + EXTERNAL_SCROLL_THRESHOLD_PX;
      if (isDownwardSnapToBottom) {
        return 'external-scroll-suspected';
      }
      return 'layout-shift';
    }
    const scrollTopDrift = Math.abs(
      container.scrollTop - session.alignment.lastAppliedScrollTop
    );
    if (scrollTopDrift > EXTERNAL_SCROLL_THRESHOLD_PX) {
      return 'external-scroll-suspected';
    }
  }
  return 'layout-shift';
}
