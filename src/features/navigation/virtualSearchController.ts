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

const SCROLL_POSITION_TOLERANCE_PX = 1;

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
  invalidateConfirmedAnchor?: (
    promptId: string,
    promptIndex: number
  ) => Promise<void>;
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
  targetDomRecoveryDirection?: 1 | -1 | null;
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
  invalidateConfirmedAnchor,
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
  targetDomRecoveryDirection = null,
  onDiagnosticEvent,
}: VirtualSearchControllerOptions): Promise<VirtualSearchResult> {
  const startedAt = now();
  let confirmedAnchors = await getConfirmedAnchors();
  let attempts = 0;
  let consecutiveUnresolvedPositions = 0;
  let hasLocatedPosition = false;
  let lastDistance: number | null = null;
  let lastLocatedDirection: 1 | -1 | null = null;
  let lastSearchDirection: 1 | -1 | null = null;
  let directionalProbeCount = 0;
  let bracketDiscoveryCount = 0;
  let lastPlan: VirtualSearchPlan | null = null;
  let lastPosition: VisiblePromptPosition = { status: 'none' };
  let replanAfterStaleAnchor = false;
  let lowerSearchAnchor: NavigationAnchor | null = null;
  let upperSearchAnchor: NavigationAnchor | null = null;

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

    const usedExactTargetAnchor =
      lastPlan?.method === 'exact-anchor' &&
      lastPlan.lowerAnchor?.promptIndex === targetPromptIndex;
    if (
      usedExactTargetAnchor &&
      lastPlan &&
      observation.position.status === 'located' &&
      !observation.position.matchedPromptIndexes.includes(targetPromptIndex)
    ) {
      const staleAnchorSource = lastPlan.lowerAnchor?.source;
      if (staleAnchorSource === 'confirmed') {
        confirmedAnchors = confirmedAnchors.filter(
          ({ promptId, promptIndex }) =>
            promptId !== targetPromptId ||
            promptIndex !== targetPromptIndex
        );
        await invalidateConfirmedAnchor?.(
          targetPromptId,
          targetPromptIndex
        );
      }
      replanAfterStaleAnchor = true;
      onDiagnosticEvent?.({
        eventName: 'EXACT_ANCHOR_INVALIDATED',
        details: {
          targetPromptId,
          targetPromptIndex,
          anchorSource: staleAnchorSource,
          plannedScrollTop: lastPlan.scrollTop,
          firstPromptIndex: observation.position.firstPromptIndex,
          lastPromptIndex: observation.position.lastPromptIndex,
        },
      });
    }

    const metrics = getScrollMetrics();
    const searchDirection = getSearchDirection(
      targetPromptIndex,
      observation.position
    );
    const currentDistance = getTargetDistance(
      targetPromptIndex,
      observation.position
    );
    if (observation.position.status === 'located') {
      hasLocatedPosition = true;
      lastLocatedDirection = searchDirection;
      const nextBounds = updateSearchBounds({
        targetPromptIndex,
        anchors: observation.anchors,
        lowerAnchor: lowerSearchAnchor,
        upperAnchor: upperSearchAnchor,
      });
      lowerSearchAnchor = nextBounds.lowerAnchor;
      upperSearchAnchor = nextBounds.upperAnchor;
    }
    const isNearTarget =
      currentDistance !== null &&
      currentDistance <=
        APP_CONFIG.navigation.search.nearTargetPromptDistance;
    const isRecoveringTargetDom =
      observation.position.status === 'located' &&
      observation.position.matchedPromptIndexes.includes(
        targetPromptIndex
      ) &&
      !isTargetRendered() &&
      targetDomRecoveryDirection !== null;
    const plannedDirection = isRecoveringTargetDom
      ? targetDomRecoveryDirection
      : searchDirection ?? lastLocatedDirection;

    if (plannedDirection !== lastSearchDirection) {
      directionalProbeCount = 0;
      lastSearchDirection = plannedDirection;
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
        !hasLocatedPosition &&
        consecutiveUnresolvedPositions >=
        Math.max(1, unresolvedPositionsBeforeAbort)
      ) {
        return finishSearch('unresolved');
      }
    } else {
      consecutiveUnresolvedPositions = 0;
    }

    const isInitialEstimate = attempts === 0;
    const isTransientUnresolvedRecovery =
      hasLocatedPosition &&
      observation.position.status !== 'located' &&
      plannedDirection !== null;
    let plan: VirtualSearchPlan;

    const isStaleAnchorReplan = replanAfterStaleAnchor;
    replanAfterStaleAnchor = false;

    if (isTransientUnresolvedRecovery) {
      plan = createDirectionalProbePlan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: plannedDirection,
        probeCount: 1,
        promptDistance: null,
        initialViewportCount: 1,
      });
    } else if (isRecoveringTargetDom) {
      const targetAnchors = observation.anchors.filter(
        ({ promptIndex }) => promptIndex === targetPromptIndex
      );
      plan =
        targetAnchors.length > 0
          ? planVirtualSearch({
              targetPromptIndex,
              promptCount,
              maximumScrollTop: metrics.maximumScrollTop,
              viewportWidth: metrics.viewportWidth,
              observedAnchors: targetAnchors,
              confirmedAnchors: [],
            })
          : createDirectionalProbePlan({
              targetPromptIndex,
              currentScrollTop: metrics.scrollTop,
              maximumScrollTop: metrics.maximumScrollTop,
              viewportHeight: metrics.viewportHeight,
              direction: targetDomRecoveryDirection,
              probeCount: 1,
              initialViewportCount:
                APP_CONFIG.navigation.search
                  .targetDomRecoveryViewportCount,
            });
    } else if (isInitialEstimate) {
      plan = planVirtualSearch({
        targetPromptIndex,
        promptCount,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportWidth: metrics.viewportWidth,
        observedAnchors: getObservedAnchors(),
        confirmedAnchors,
      });
    } else if (
      observation.position.status === 'located' &&
      (lowerSearchAnchor || upperSearchAnchor)
    ) {
      const hasSearchBracket = Boolean(
        lowerSearchAnchor && upperSearchAnchor
      );
      if (hasSearchBracket) {
        bracketDiscoveryCount = 0;
        plan = planVirtualSearch({
          targetPromptIndex,
          promptCount,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportWidth: metrics.viewportWidth,
          observedAnchors: [
            lowerSearchAnchor!,
            upperSearchAnchor!,
          ],
          confirmedAnchors: [],
          failedInterpolationAttempts:
            APP_CONFIG.navigation.search
              .interpolationFailuresBeforeBinary,
        });
      } else {
        bracketDiscoveryCount += 1;
        plan = createDirectionalProbePlan({
          targetPromptIndex,
          currentScrollTop: metrics.scrollTop,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportHeight: metrics.viewportHeight,
          direction: plannedDirection!,
          probeCount: bracketDiscoveryCount,
          promptDistance:
            currentDistance === null
              ? null
              : currentDistance *
                APP_CONFIG.navigation.search
                  .bracketDiscoveryDistanceMultiplier,
        });
      }
    } else if (plannedDirection !== null) {
      directionalProbeCount += 1;
      plan = createDirectionalProbePlan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: plannedDirection,
        probeCount: directionalProbeCount,
        promptDistance: currentDistance,
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
      !isStaleAnchorReplan &&
      plannedDirection !== null &&
      !isRecoveringTargetDom &&
      !isTransientUnresolvedRecovery &&
      !isScrollInDirection(
        metrics.scrollTop,
        plan.scrollTop,
        plannedDirection
      )
    ) {
      directionalProbeCount += 1;
      plan = createDirectionalProbePlan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: plannedDirection,
        probeCount: directionalProbeCount,
        promptDistance: currentDistance,
        initialViewportCount: isNearTarget
          ? APP_CONFIG.navigation.search.nearTargetProbeViewportCount
          : undefined,
      });
    }

    if (
      isSameScrollTop(plan.scrollTop, metrics.scrollTop)
    ) {
      if (plannedDirection !== null) {
        directionalProbeCount += 1;
        plan = createDirectionalProbePlan({
          targetPromptIndex,
          currentScrollTop: metrics.scrollTop,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportHeight: metrics.viewportHeight,
          direction: plannedDirection,
          probeCount: directionalProbeCount,
          promptDistance: isRecoveringTargetDom
            ? null
            : currentDistance,
          initialViewportCount: isRecoveringTargetDom
            ? APP_CONFIG.navigation.search.targetDomRecoveryViewportCount
            : isNearTarget
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
        phase: isRecoveringTargetDom
          ? plan.method === 'exact-anchor'
            ? 'target-response-anchor'
            : 'target-dom-recovery'
          : isTransientUnresolvedRecovery
            ? 'transient-unresolved-recovery'
          : isInitialEstimate
            ? 'initial-estimate'
            : isStaleAnchorReplan
              ? 'stale-anchor-replan'
            : lowerSearchAnchor || upperSearchAnchor
              ? lowerSearchAnchor && upperSearchAnchor
                ? 'bracketed-binary-search'
                : 'bracket-discovery'
            : 'relative-search',
        currentDistance,
        isNearTarget,
        directionalProbeCount,
        probeViewportCount:
          Math.abs(plan.scrollTop - metrics.scrollTop) /
          Math.max(1, metrics.viewportHeight),
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

interface SearchBounds {
  lowerAnchor: NavigationAnchor | null;
  upperAnchor: NavigationAnchor | null;
}

/**
 * Retains the closest live anchors on either side of the target Prompt.
 */
export function updateSearchBounds({
  targetPromptIndex,
  anchors,
  lowerAnchor,
  upperAnchor,
}: {
  targetPromptIndex: number;
  anchors: NavigationAnchor[];
  lowerAnchor: NavigationAnchor | null;
  upperAnchor: NavigationAnchor | null;
}): SearchBounds {
  let nextLowerAnchor = lowerAnchor;
  let nextUpperAnchor = upperAnchor;

  anchors.forEach((anchor) => {
    if (
      anchor.promptIndex < targetPromptIndex &&
      (!nextLowerAnchor ||
        anchor.promptIndex >= nextLowerAnchor.promptIndex)
    ) {
      nextLowerAnchor = anchor;
    }
    if (
      anchor.promptIndex > targetPromptIndex &&
      (!nextUpperAnchor ||
        anchor.promptIndex <= nextUpperAnchor.promptIndex)
    ) {
      nextUpperAnchor = anchor;
    }
  });

  return {
    lowerAnchor: nextLowerAnchor,
    upperAnchor: nextUpperAnchor,
  };
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
  const logicalPositions = getMatchedLogicalPositions(position);
  if (logicalPositions.length === 0) return null;

  return Math.min(
    ...logicalPositions.map((logicalPosition) =>
      Math.abs(targetPromptIndex - logicalPosition)
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
  const logicalPositions = getMatchedLogicalPositions(position);
  if (logicalPositions.length === 0) return null;

  const firstIndex = Math.min(...logicalPositions);
  const lastIndex = Math.max(...logicalPositions);

  if (targetPromptIndex > lastIndex) return 1;
  if (targetPromptIndex < firstIndex) return -1;
  return null;
}

/**
 * Converts matched response segments into fractional Prompt coordinates.
 */
export function getMatchedLogicalPositions(
  position: VisiblePromptPosition
): number[] {
  if (position.status !== 'located') return [];

  return position.matchedBlocks.length > 0
    ? position.matchedBlocks.map(
        ({ promptIndex, source, positionRatio = 0 }) =>
          promptIndex + (source === 'segment' ? positionRatio : 0)
      )
    : position.matchedPromptIndexes;
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
  promptDistance = null,
  initialViewportCount = APP_CONFIG.navigation.search
    .initialProbeViewportCount,
}: {
  targetPromptIndex: number;
  currentScrollTop: number;
  maximumScrollTop: number;
  viewportHeight: number;
  direction: 1 | -1;
  probeCount: number;
  promptDistance?: number | null;
  initialViewportCount?: number;
}): VirtualSearchPlan {
  const searchConfig = APP_CONFIG.navigation.search;
  const growingViewportCount = Math.min(
    Math.max(1, initialViewportCount) +
      Math.max(0, probeCount - 1) *
        searchConfig.probeViewportIncrement,
    searchConfig.maximumProbeViewportCount
  );
  const viewportCount =
    promptDistance === null
      ? growingViewportCount
      : promptDistance < 1
        ? 1
        : Math.min(
            Math.max(
              growingViewportCount,
              Math.ceil(
                promptDistance *
                  searchConfig.distanceProbeViewportRatio
              )
            ),
            searchConfig.maximumDistanceProbeViewportCount
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
    const primaryMatch = position.matchedBlocks[0];

    return {
      status: position.status,
      firstPromptIndex: position.firstPromptIndex,
      lastPromptIndex: position.lastPromptIndex,
      matchedBlocks: position.matchedBlocks,
      matchSource: primaryMatch?.source || null,
      segmentIndex: primaryMatch?.segmentIndex ?? null,
      segmentCount: primaryMatch?.segmentCount ?? null,
      positionRatio: primaryMatch?.positionRatio ?? null,
      segmentQuality: primaryMatch?.segmentQuality ?? null,
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
  return Math.abs(first - second) <= SCROLL_POSITION_TOLERANCE_PX;
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
