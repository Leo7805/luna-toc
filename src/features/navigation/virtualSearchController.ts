/**
 * Executes bounded virtual-list searches without depending on platform DOM.
 */
import { APP_CONFIG } from '@/config/config';
import type { NavigationAnchor } from './navigationAnchorStore';
import type { VisiblePromptPosition } from './visiblePositionResolver';
import {
  planVirtualSearch,
  type VirtualSearchPlan,
} from './virtualSearchPlanner';

export interface VirtualScrollMetrics {
  scrollTop: number;
  maximumScrollTop: number;
  viewportWidth: number;
}

export interface VirtualSearchObservation {
  position: VisiblePromptPosition;
  anchors: NavigationAnchor[];
}

export interface VirtualSearchDiagnosticEvent {
  eventName: string;
  details: Record<string, unknown>;
}

export interface VirtualSearchControllerOptions {
  targetPromptId: string;
  targetPromptIndex: number;
  promptCount: number;
  getConfirmedAnchors: () => Promise<NavigationAnchor[]>;
  getObservedAnchors: () => NavigationAnchor[];
  recordObservation: (anchor: NavigationAnchor) => void;
  getScrollMetrics: () => VirtualScrollMetrics;
  observePosition: () => Promise<VirtualSearchObservation>;
  isTargetRendered: () => boolean;
  scrollTo: (scrollTop: number) => void;
  waitForRender?: () => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  maxAttempts?: number;
  maxDurationMs?: number;
  unresolvedPositionsBeforeAbort?: number;
  onDiagnosticEvent?: (event: VirtualSearchDiagnosticEvent) => void;
}

export type VirtualSearchResultStatus =
  | 'found'
  | 'cancelled'
  | 'exhausted'
  | 'timed-out'
  | 'unresolved';

export interface VirtualSearchResult {
  status: VirtualSearchResultStatus;
  attempts: number;
  lastPlan: VirtualSearchPlan | null;
  lastPosition: VisiblePromptPosition;
}

/**
 * Searches a virtual list through repeated planning, instant scrolling,
 * position observation, and bounded fallback attempts.
 *
 * @example
 * const result = await searchVirtualPrompt({
 *   targetPromptId,
 *   targetPromptIndex,
 *   promptCount,
 *   getConfirmedAnchors,
 *   getObservedAnchors,
 *   recordObservation,
 *   getScrollMetrics,
 *   observePosition,
 *   isTargetRendered,
 *   scrollTo,
 * });
 */
export async function searchVirtualPrompt({
  targetPromptId,
  targetPromptIndex,
  promptCount,
  getConfirmedAnchors,
  getObservedAnchors,
  recordObservation,
  getScrollMetrics,
  observePosition,
  isTargetRendered,
  scrollTo,
  waitForRender = waitForVirtualRender,
  now = () => performance.now(),
  signal,
  maxAttempts = APP_CONFIG.navigation.search.maxAttempts,
  maxDurationMs = APP_CONFIG.navigation.search.maxDurationMs,
  unresolvedPositionsBeforeAbort = APP_CONFIG.navigation.search
    .unresolvedPositionsBeforeAbort,
  onDiagnosticEvent,
}: VirtualSearchControllerOptions): Promise<VirtualSearchResult> {
  const startedAt = now();
  const confirmedAnchors = await getConfirmedAnchors();
  const visitedScrollTops = new Set<number>();
  let attempts = 0;
  let consecutiveUnresolvedPositions = 0;
  let failedInterpolationAttempts = 0;
  let ignoreConfirmedTargetAnchor = false;
  let lastDistance: number | null = null;
  let lastPlan: VirtualSearchPlan | null = null;
  let lastPosition: VisiblePromptPosition = { status: 'none' };

  const finishSearch = (
    status: VirtualSearchResultStatus
  ): VirtualSearchResult => {
    onDiagnosticEvent?.({
      eventName: 'SEARCH_FINISHED',
      details: {
        status,
        attempts,
        lastPlanMethod: lastPlan?.method || null,
        lastPositionStatus: lastPosition.status,
      },
    });
    return createResult(status, attempts, lastPlan, lastPosition);
  };

  onDiagnosticEvent?.({
    eventName: 'SEARCH_STARTED',
    details: {
      targetPromptId,
      targetPromptIndex,
      promptCount,
      confirmedAnchorCount: confirmedAnchors.length,
      maxAttempts,
      maxDurationMs,
      unresolvedPositionsBeforeAbort,
    },
  });

  while (attempts < Math.max(0, maxAttempts)) {
    const terminalStatus = getTerminalStatus({
      signal,
      startedAt,
      currentTime: now(),
      maxDurationMs,
      isTargetRendered,
    });

    if (terminalStatus) {
      return finishSearch(terminalStatus);
    }

    const observation = await observePosition();
    lastPosition = observation.position;
    observation.anchors.forEach(recordObservation);
    onDiagnosticEvent?.({
      eventName: 'POSITION_OBSERVED',
      details: getPositionDiagnosticDetails(
        observation.position,
        observation.anchors.length
      ),
    });

    const currentDistance = getTargetDistance(
      targetPromptIndex,
      observation.position
    );

    if (lastPlan?.method === 'interpolation') {
      failedInterpolationAttempts =
        currentDistance === null ||
        (lastDistance !== null && currentDistance >= lastDistance)
          ? failedInterpolationAttempts + 1
          : 0;
    }

    if (currentDistance === null) {
      consecutiveUnresolvedPositions += 1;
      if (
        consecutiveUnresolvedPositions >=
        Math.max(1, unresolvedPositionsBeforeAbort)
      ) {
        return finishSearch('unresolved');
      }
    } else {
      consecutiveUnresolvedPositions = 0;
      lastDistance = currentDistance;
    }

    const metrics = getScrollMetrics();
    const eligibleConfirmedAnchors = ignoreConfirmedTargetAnchor
      ? confirmedAnchors.filter(
          ({ promptId, promptIndex }) =>
            promptId !== targetPromptId || promptIndex !== targetPromptIndex
        )
      : confirmedAnchors;
    let plan = planVirtualSearch({
      targetPromptIndex,
      promptCount,
      maximumScrollTop: metrics.maximumScrollTop,
      viewportWidth: metrics.viewportWidth,
      observedAnchors: getObservedAnchors(),
      confirmedAnchors: eligibleConfirmedAnchors,
      failedInterpolationAttempts,
    });
    if (hasVisitedScrollTop(visitedScrollTops, plan.scrollTop)) {
      if (plan.method === 'exact-anchor' && !ignoreConfirmedTargetAnchor) {
        ignoreConfirmedTargetAnchor = true;
        plan = planVirtualSearch({
          targetPromptIndex,
          promptCount,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportWidth: metrics.viewportWidth,
          observedAnchors: getObservedAnchors().filter(
            ({ promptIndex }) => promptIndex !== targetPromptIndex
          ),
          confirmedAnchors: eligibleConfirmedAnchors.filter(
            ({ promptId, promptIndex }) =>
              promptId !== targetPromptId || promptIndex !== targetPromptIndex
          ),
          failedInterpolationAttempts,
        });
      } else if (plan.method !== 'binary') {
        failedInterpolationAttempts =
          APP_CONFIG.navigation.search.interpolationFailuresBeforeBinary;
        plan = planVirtualSearch({
          targetPromptIndex,
          promptCount,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportWidth: metrics.viewportWidth,
          observedAnchors: getObservedAnchors(),
          confirmedAnchors: eligibleConfirmedAnchors,
          failedInterpolationAttempts,
        });
      }

      if (hasVisitedScrollTop(visitedScrollTops, plan.scrollTop)) {
        lastPlan = plan;
        return finishSearch('exhausted');
      }
    }

    onDiagnosticEvent?.({
      eventName: 'SEARCH_PLAN',
      details: {
        method: plan.method,
        scrollTop: plan.scrollTop,
        lowerAnchor: plan.lowerAnchor,
        upperAnchor: plan.upperAnchor,
        failedInterpolationAttempts,
        observedAnchorCount: getObservedAnchors().length,
        eligibleConfirmedAnchorCount: eligibleConfirmedAnchors.length,
      },
    });
    visitedScrollTops.add(normalizeScrollTop(plan.scrollTop));
    lastPlan = plan;
    const scrollTopBefore = metrics.scrollTop;
    scrollTo(plan.scrollTop);
    onDiagnosticEvent?.({
      eventName: 'SCROLL_APPLIED',
      details: {
        method: plan.method,
        plannedScrollTop: plan.scrollTop,
        scrollTopBefore,
        scrollTopAfter: getScrollMetrics().scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
      },
    });
    attempts += 1;
    await waitForRender();

    if (isTargetRendered()) {
      return finishSearch('found');
    }

    if (
      plan.method === 'exact-anchor' &&
      plan.lowerAnchor?.source === 'confirmed'
    ) {
      ignoreConfirmedTargetAnchor = true;
    }
  }

  return finishSearch('exhausted');
}

/**
 * Waits for the configured virtual-list rendering interval.
 */
export function waitForVirtualRender(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, APP_CONFIG.navigation.search.renderWaitMs);
  });
}

/**
 * Returns the distance from the target index to a resolved visible range.
 */
export function getTargetDistance(
  targetPromptIndex: number,
  position: VisiblePromptPosition
): number | null {
  if (position.status !== 'located') return null;
  if (position.matchedPromptIndexes.length === 0) return null;

  return Math.min(
    ...position.matchedPromptIndexes.map((promptIndex) =>
      Math.abs(targetPromptIndex - promptIndex)
    )
  );
}

/**
 * Converts a position union into compact, text-free diagnostic details.
 */
function getPositionDiagnosticDetails(
  position: VisiblePromptPosition,
  anchorCount: number
): Record<string, unknown> {
  if (position.status === 'located') {
    return {
      status: position.status,
      firstPromptIndex: position.firstPromptIndex,
      lastPromptIndex: position.lastPromptIndex,
      matchedBlocks: position.matchedBlocks,
      anchorCount,
    };
  }

  if (position.status === 'ambiguous') {
    return {
      status: position.status,
      candidatePromptIndexes: position.candidatePromptIndexes,
      ambiguousBlockIds: position.ambiguousBlockIds,
      anchorCount,
    };
  }

  return {
    status: position.status,
    anchorCount,
  };
}

/**
 * Returns a terminal state before another observation or scroll attempt.
 */
function getTerminalStatus({
  signal,
  startedAt,
  currentTime,
  maxDurationMs,
  isTargetRendered,
}: {
  signal?: AbortSignal;
  startedAt: number;
  currentTime: number;
  maxDurationMs: number;
  isTargetRendered: () => boolean;
}): VirtualSearchResultStatus | null {
  if (signal?.aborted) return 'cancelled';
  if (isTargetRendered()) return 'found';
  if (currentTime - startedAt >= Math.max(0, maxDurationMs)) {
    return 'timed-out';
  }

  return null;
}

/**
 * Checks whether a rounded scroll position has already been attempted.
 */
function hasVisitedScrollTop(
  visitedScrollTops: Set<number>,
  scrollTop: number
): boolean {
  return visitedScrollTops.has(normalizeScrollTop(scrollTop));
}

/**
 * Normalizes sub-pixel scroll positions for repeat detection.
 */
function normalizeScrollTop(scrollTop: number): number {
  return Math.round(scrollTop);
}

/**
 * Creates a detached search result.
 */
function createResult(
  status: VirtualSearchResultStatus,
  attempts: number,
  lastPlan: VirtualSearchPlan | null,
  lastPosition: VisiblePromptPosition
): VirtualSearchResult {
  return {
    status,
    attempts,
    lastPlan,
    lastPosition,
  };
}
