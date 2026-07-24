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
  viewportHeight: number;
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
  let attempts = 0;
  let consecutiveUnresolvedPositions = 0;
  let lastDistance: number | null = null;
  let lastSearchDirection: 1 | -1 | null = null;
  let directionalProbeCount = 0;
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

    const metrics = getScrollMetrics();
    const searchDirection = getSearchDirection(
      targetPromptIndex,
      observation.position
    );
    const currentDistance = getTargetDistance(
      targetPromptIndex,
      observation.position
    );
    const isNearTarget =
      currentDistance !== null &&
      currentDistance <=
        APP_CONFIG.navigation.search.nearTargetPromptDistance;

    if (searchDirection !== lastSearchDirection) {
      directionalProbeCount = 0;
      lastSearchDirection = searchDirection;
    }
    if (
      isNearTarget &&
      (lastDistance === null || currentDistance < lastDistance)
    ) {
      directionalProbeCount = 0;
    }
    lastDistance = currentDistance;

    if (observation.position.status !== 'located') {
      consecutiveUnresolvedPositions += 1;
      if (
        consecutiveUnresolvedPositions >=
        Math.max(1, unresolvedPositionsBeforeAbort)
      ) {
        return finishSearch('unresolved');
      }
    } else {
      consecutiveUnresolvedPositions = 0;
    }

    const isInitialEstimate = attempts === 0;
    let plan: VirtualSearchPlan;

    if (isInitialEstimate) {
      plan = planVirtualSearch({
        targetPromptIndex,
        promptCount,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportWidth: metrics.viewportWidth,
        observedAnchors: getObservedAnchors(),
        confirmedAnchors,
      });
    } else if (searchDirection !== null) {
      directionalProbeCount += 1;
      plan = createDirectionalProbePlan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: searchDirection,
        probeCount: directionalProbeCount,
        initialViewportCount: isNearTarget
          ? APP_CONFIG.navigation.search.nearTargetProbeViewportCount
          : undefined,
      });
    } else {
      plan = planVirtualSearch({
        targetPromptIndex,
        promptCount,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportWidth: metrics.viewportWidth,
        observedAnchors: observation.anchors,
        confirmedAnchors: [],
        failedInterpolationAttempts:
          APP_CONFIG.navigation.search.interpolationFailuresBeforeBinary,
      });
    }

    if (
      isInitialEstimate &&
      searchDirection !== null &&
      !isScrollInDirection(
        metrics.scrollTop,
        plan.scrollTop,
        searchDirection
      )
    ) {
      directionalProbeCount += 1;
      plan = createDirectionalProbePlan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: searchDirection,
        probeCount: directionalProbeCount,
        initialViewportCount: isNearTarget
          ? APP_CONFIG.navigation.search.nearTargetProbeViewportCount
          : undefined,
      });
    }

    if (
      isSameScrollTop(plan.scrollTop, metrics.scrollTop)
    ) {
      if (searchDirection !== null) {
        directionalProbeCount += 1;
        plan = createDirectionalProbePlan({
          targetPromptIndex,
          currentScrollTop: metrics.scrollTop,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportHeight: metrics.viewportHeight,
          direction: searchDirection,
          probeCount: directionalProbeCount,
          initialViewportCount: isNearTarget
            ? APP_CONFIG.navigation.search.nearTargetProbeViewportCount
            : undefined,
        });
      }

      if (
        isSameScrollTop(plan.scrollTop, metrics.scrollTop)
      ) {
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
        phase: isInitialEstimate ? 'initial-estimate' : 'relative-search',
        currentDistance,
        isNearTarget,
        directionalProbeCount,
        observedAnchorCount: getObservedAnchors().length,
        eligibleConfirmedAnchorCount:
          isInitialEstimate ? confirmedAnchors.length : 0,
      },
    });
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
 * Returns the direction from the visible prompt range toward the target.
 */
export function getSearchDirection(
  targetPromptIndex: number,
  position: VisiblePromptPosition
): 1 | -1 | null {
  if (position.status !== 'located') return null;
  if (position.matchedPromptIndexes.length === 0) return null;

  const firstIndex = Math.min(...position.matchedPromptIndexes);
  const lastIndex = Math.max(...position.matchedPromptIndexes);

  if (targetPromptIndex > lastIndex) return 1;
  if (targetPromptIndex < firstIndex) return -1;
  return null;
}

/**
 * Creates a bounded linearly growing probe in the target direction.
 */
export function createDirectionalProbePlan({
  targetPromptIndex,
  currentScrollTop,
  maximumScrollTop,
  viewportHeight,
  direction,
  probeCount,
  initialViewportCount = APP_CONFIG.navigation.search
    .initialProbeViewportCount,
}: {
  targetPromptIndex: number;
  currentScrollTop: number;
  maximumScrollTop: number;
  viewportHeight: number;
  direction: 1 | -1;
  probeCount: number;
  initialViewportCount?: number;
}): VirtualSearchPlan {
  const searchConfig = APP_CONFIG.navigation.search;
  const viewportCount = Math.min(
    Math.max(1, initialViewportCount) +
      Math.max(0, probeCount - 1) * searchConfig.probeViewportIncrement,
    searchConfig.maximumProbeViewportCount
  );
  const scrollTop = clamp(
    currentScrollTop + direction * viewportCount * Math.max(1, viewportHeight),
    0,
    Math.max(0, maximumScrollTop)
  );

  return {
    method: 'linear-probe',
    targetPromptIndex,
    scrollTop,
    lowerAnchor: null,
    upperAnchor: null,
  };
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
 * Checks whether two scroll positions resolve to the same browser pixel.
 */
function isSameScrollTop(first: number, second: number): boolean {
  return normalizeScrollTop(first) === normalizeScrollTop(second);
}

/**
 * Checks whether a planned scroll advances in the requested direction.
 */
function isScrollInDirection(
  currentScrollTop: number,
  plannedScrollTop: number,
  direction: 1 | -1
): boolean {
  return direction === 1
    ? plannedScrollTop > currentScrollTop
    : plannedScrollTop < currentScrollTop;
}

/**
 * Restricts a number to an inclusive range.
 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
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
