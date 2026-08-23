/**
 * Executes adaptive virtual-list navigation from live logical feedback.
 */
import { APP_CONFIG } from '@/config/config';
import type { NavigationAnchor } from './navigationAnchorStore';
import {
  planPromptMountScan,
  planRelativeSearch,
  type RelativeSearchSample,
} from './relativeSearchPlanner';
import type { VisiblePromptPosition } from './visiblePositionResolver';
import {
  advanceVirtualSearchMachine,
  createVirtualSearchMachine,
  updatePromptMountFeedback,
} from './virtualSearchMachine';
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
  maxUnproductiveAttempts?: number;
  maxDurationMs?: number;
  targetDomRecoveryDirection?: 1 | -1 | null;
  onDiagnosticEvent?: (event: VirtualSearchDiagnosticEvent) => void;
  /**
   * Optional progress callback fired at the top of every main-loop
   * iteration. The reported `remaining` is the budget of attempts left
   * before the search gives up.
   */
  onProgress?: (info: { remaining: number }) => void;
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
 * Uses an absolute hint once, then navigates only through relative movement
 * and fresh Prompt-position feedback.
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
  maxUnproductiveAttempts = APP_CONFIG.navigation.search
    .maxUnproductiveAttempts,
  maxDurationMs = APP_CONFIG.navigation.search.maxDurationMs,
  targetDomRecoveryDirection = null,
  onDiagnosticEvent,
  onProgress,
}: VirtualSearchControllerOptions): Promise<VirtualSearchResult> {
  const startedAt = now();
  const confirmedAnchors = await getConfirmedAnchors();
  let machine = createVirtualSearchMachine();
  let attempts = 0;
  let unproductiveAttempts = 0;
  let previousDistance: number | null = null;
  let previousSample: RelativeSearchSample | null = null;
  let lastScrollDelta: number | null = null;
  let lastDirection: 1 | -1 | null = null;
  let lastPlan: VirtualSearchPlan | null = null;
  let lastPosition: VisiblePromptPosition = { status: 'none' };
  let networkBackfillDone = false;

  const finish = (
    status: VirtualSearchResultStatus
  ): VirtualSearchResult => {
    onDiagnosticEvent?.({
      eventName: 'SEARCH_FINISHED',
      details: {
        status,
        phase: machine.phase,
        attempts,
        unproductiveAttempts,
        lastPlanMethod: lastPlan?.method || null,
        lastPositionStatus: lastPosition.status,
      },
    });
    return { status, attempts, lastPlan, lastPosition };
  };

  onDiagnosticEvent?.({
    eventName: 'SEARCH_STARTED',
    details: {
      targetPromptId,
      targetPromptIndex,
      promptCount,
      confirmedAnchorCount: confirmedAnchors.length,
      maxAttempts,
      maxUnproductiveAttempts,
      maxDurationMs,
    },
  });

  while (attempts < Math.max(0, maxAttempts)) {
    onProgress?.({ remaining: Math.max(0, maxAttempts - attempts) });

    const terminalStatus = getTerminalStatus({
      signal,
      startedAt,
      currentTime: now(),
      maxDurationMs,
      isTargetRendered,
    });
    if (terminalStatus) return finish(terminalStatus);

    const observation = await observePosition();
    lastPosition = observation.position;
    observation.anchors.forEach(recordObservation);
    if (isTargetRendered()) return finish('found');
    const metrics = getScrollMetrics();
    const logicalPosition = getClosestLogicalPosition(
      targetPromptIndex,
      observation.position
    );
    const currentDistance =
      logicalPosition === null
        ? null
        : Math.abs(targetPromptIndex - logicalPosition);
    const targetResponseLocated =
      logicalPosition !== null &&
      getMatchedLogicalPositions(observation.position).some(
        (position) =>
          Math.trunc(position) === targetPromptIndex
      );

    onDiagnosticEvent?.({
      eventName: 'POSITION_OBSERVED',
      details: {
        ...getPositionDiagnosticDetails(
          observation.position,
          observation.anchors.length
        ),
        logicalPosition,
        currentDistance,
        phase: machine.phase,
      },
    });

    if (
      attempts === 1 &&
      lastPlan?.method === 'exact-anchor' &&
      lastPlan.lowerAnchor?.source === 'confirmed' &&
      logicalPosition !== null &&
      Math.trunc(logicalPosition) !== targetPromptIndex
    ) {
      await invalidateConfirmedAnchor?.(
        targetPromptId,
        targetPromptIndex
      );
      onDiagnosticEvent?.({
        eventName: 'EXACT_ANCHOR_INVALIDATED',
        details: {
          targetPromptId,
          targetPromptIndex,
          observedLogicalPosition: logicalPosition,
        },
      });
    }

    machine = advanceVirtualSearchMachine(
      machine,
      targetResponseLocated
    );

    const madeProgress =
      currentDistance !== null &&
      (previousDistance === null ||
        currentDistance < previousDistance);
    if (attempts > 0 && machine.phase !== 'mount-prompt') {
      unproductiveAttempts = madeProgress
        ? 0
        : unproductiveAttempts + 1;
      if (
        unproductiveAttempts >=
        Math.max(1, maxUnproductiveAttempts)
      ) {
        return finish(
          logicalPosition === null ? 'unresolved' : 'exhausted'
        );
      }
    }

    let plan: VirtualSearchPlan;
    let phase: string = machine.phase;
    let relativePlanningDetails: Record<string, unknown> = {};
    const currentSample =
      logicalPosition === null
        ? null
        : {
            logicalPosition,
            scrollTop: metrics.scrollTop,
          };

    if (machine.phase === 'mount-prompt') {
      if (
        machine.mountAttempts >=
        APP_CONFIG.navigation.search.maximumPromptMountAttempts
      ) {
        onDiagnosticEvent?.({
          eventName: 'PROMPT_MOUNT_EXHAUSTED',
          details: {
            targetPromptId,
            targetPromptIndex,
            mountAttempts: machine.mountAttempts,
            mountDirection: machine.mountDirection,
            mountStepViewportRatio: machine.mountStepViewportRatio,
            lastPosition: getPositionDiagnosticDetails(
              lastPosition,
              observation.anchors.length
            ),
          },
        });
        return finish('exhausted');
      }
      const searchConfig = APP_CONFIG.navigation.search;
      machine = updatePromptMountFeedback(machine, {
        targetPromptIndex,
        logicalPosition,
        initialDirection: targetDomRecoveryDirection ?? -1,
        initialStepViewportRatio:
          searchConfig.promptMountScanViewportRatio,
        minimumStepViewportRatio:
          searchConfig.minimumPromptMountViewportRatio,
        maximumStepViewportRatio:
          searchConfig.maximumPromptMountViewportCount,
        growthRatio: searchConfig.promptMountStepGrowthRatio,
        crossingRatio:
          searchConfig.promptMountCrossingStepRatio,
      });
      phase = 'mount-prompt';
      plan = planPromptMountScan({
        targetPromptIndex,
        currentScrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
        direction: machine.mountDirection!,
        viewportRatio: machine.mountStepViewportRatio,
      });
    } else if (attempts === 0) {
      plan = planVirtualSearch({
        targetPromptIndex,
        promptCount,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportWidth: metrics.viewportWidth,
        observedAnchors: getObservedAnchors(),
        confirmedAnchors,
      });
      phase = 'initial-estimate';
      if (
        logicalPosition === null &&
        isSameScrollTop(plan.scrollTop, metrics.scrollTop)
      ) {
        plan = createRelativePlan(
          targetPromptIndex,
          metrics.scrollTop,
          metrics.maximumScrollTop,
          metrics.viewportHeight,
          getInteriorRecoveryDirection(
            targetPromptIndex,
            promptCount
          )
        );
        phase = 'initial-mount-recovery';
      }
    } else if (currentSample) {
      const relativePlan = planRelativeSearch({
        targetPromptIndex,
        currentSample,
        previousSample,
        lastScrollDelta,
        maximumScrollTop: metrics.maximumScrollTop,
        viewportHeight: metrics.viewportHeight,
      });
      plan = relativePlan;
      relativePlanningDetails = {
        planningBasis: relativePlan.planningBasis,
        estimatedPixelsPerPrompt:
          relativePlan.estimatedPixelsPerPrompt,
        movementLimit: relativePlan.movementLimit,
      };
      phase = 'seek-response';
      lastDirection =
        targetPromptIndex >= currentSample.logicalPosition ? 1 : -1;
    } else {
      const recoveryDirection = getUnresolvedRecoveryDirection({
        scrollTop: metrics.scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
        lastDirection,
        targetPromptIndex,
        promptCount,
      });
      plan = createRelativePlan(
        targetPromptIndex,
        metrics.scrollTop,
        metrics.maximumScrollTop,
        metrics.viewportHeight,
        recoveryDirection
      );
      lastDirection = recoveryDirection;
      phase = 'unresolved-recovery';
    }

    if (isSameScrollTop(plan.scrollTop, metrics.scrollTop)) {
      const atScrollEdge =
        plan.scrollTop <= SCROLL_POSITION_TOLERANCE_PX ||
        plan.scrollTop >=
          metrics.maximumScrollTop - SCROLL_POSITION_TOLERANCE_PX;

      if (atScrollEdge && !isTargetRendered()) {
        const slideDirection: 1 | -1 =
          plan.scrollTop <= SCROLL_POSITION_TOLERANCE_PX ? -1 : 1;

        onDiagnosticEvent?.({
          eventName: 'EDGE_BACKFILL_WAIT',
          details: {
            phase,
            scrollTop: metrics.scrollTop,
            maximumScrollTop: metrics.maximumScrollTop,
            targetPromptIndex,
          },
        });

        // Wait once for the network backfill to land (scrollHeight grows as
        // ChatGPT fetches the next page of history). The remaining far-jump
        // work is sliding the virtualized render window, which only needs
        // scroll events, not network time.
        if (!networkBackfillDone) {
          networkBackfillDone = true;
          const backfillLanded = await waitForTargetBackfill({
            signal,
            isTargetRendered,
            getScrollMetrics,
          });
          onDiagnosticEvent?.({
            eventName: 'BACKFILL_RESULT',
            details: {
              backfillLanded,
              maximumScrollTop: getScrollMetrics().maximumScrollTop,
              targetPromptIndex,
            },
          });
        }

        // Slide the render window one chunk at a time. At an edge a
        // scrollTo(edge) is a no-op, so nudge inward first to make the return
        // scroll a real movement that mounts the adjacent turns.
        const slideCycles =
          APP_CONFIG.navigation.search.maximumWindowSlideCycles;
        for (let cycle = 0; cycle < slideCycles; cycle++) {
          if (signal?.aborted || isTargetRendered()) break;

          const slideMetrics = getScrollMetrics();
          const edge =
            slideDirection === -1 ? 0 : slideMetrics.maximumScrollTop;
          const inward =
            slideDirection === -1
              ? Math.min(
                  slideMetrics.maximumScrollTop,
                  slideMetrics.scrollTop + slideMetrics.viewportHeight
                )
              : Math.max(
                  0,
                  slideMetrics.scrollTop - slideMetrics.viewportHeight
                );

          scrollTo(inward);
          await waitForRender();
          scrollTo(edge);
          await waitForRender();

          onDiagnosticEvent?.({
            eventName: 'WINDOW_SLIDE_STEP',
            details: {
              cycle: cycle + 1,
              direction: slideDirection,
              inward: Math.round(inward),
              edge: Math.round(edge),
              targetPromptIndex,
            },
          });
        }

        attempts += 1;
        continue;
      }

      lastPlan = plan;
      return finish('exhausted');
    }

    onDiagnosticEvent?.({
      eventName: 'SEARCH_PLAN',
      details: {
        phase,
        method: plan.method,
        scrollTop: plan.scrollTop,
        logicalPosition,
        currentDistance,
        madeProgress,
        unproductiveAttempts,
        mountAttempt:
          machine.phase === 'mount-prompt'
            ? machine.mountAttempts
            : null,
        mountDirection:
          machine.phase === 'mount-prompt'
            ? machine.mountDirection
            : null,
        mountStepViewportRatio:
          machine.phase === 'mount-prompt'
            ? machine.mountStepViewportRatio
            : null,
        ...relativePlanningDetails,
        relativeDelta: plan.scrollTop - metrics.scrollTop,
      },
    });

    lastPlan = plan;
    lastScrollDelta = plan.scrollTop - metrics.scrollTop;
    previousSample = currentSample;
    previousDistance = currentDistance;
    scrollTo(plan.scrollTop);
    onDiagnosticEvent?.({
      eventName: 'SCROLL_APPLIED',
      details: {
        phase,
        plannedScrollTop: plan.scrollTop,
        scrollTopBefore: metrics.scrollTop,
        scrollTopAfter: getScrollMetrics().scrollTop,
        maximumScrollTop: metrics.maximumScrollTop,
      },
    });
    attempts += 1;
    await waitForRender();

    if (isTargetRendered()) return finish('found');
  }

  return finish('exhausted');
}

/**
 * Waits for the configured virtual-list render interval.
 */
export function waitForVirtualRender(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, APP_CONFIG.navigation.search.renderWaitMs);
  });
}

/**
 * Waits for ChatGPT to finish asynchronously mounting turns beyond the
 * currently loaded window. During this backfill the browser re-anchors the
 * scroll position, so the caller must re-observe and re-plan afterwards.
 */
async function waitForTargetBackfill({
  signal,
  isTargetRendered,
  getScrollMetrics,
}: {
  signal?: AbortSignal;
  isTargetRendered: () => boolean;
  getScrollMetrics: () => VirtualScrollMetrics;
}): Promise<boolean> {
  const deadline =
    performance.now() + APP_CONFIG.navigation.search.edgeBackfillWaitMs;

  // Wait for ChatGPT to backfill the next page of history. The scrollable
  // height growing is the signal that a backfill landed; once it has grown we
  // wait for it to stabilise before returning, so the caller re-observes on
  // settled content. If it never grows we keep waiting for the full interval:
  // an in-flight network backfill is indistinguishable from "not started yet"
  // during the first few polls, so an early return would starve it.
  let previousMaximumScrollTop = getScrollMetrics().maximumScrollTop;
  let sawChange = false;
  let stableRounds = 0;

  while (performance.now() < deadline) {
    if (signal?.aborted || isTargetRendered()) return sawChange;
    await new Promise((resolve) => setTimeout(resolve, 120));

    const currentMaximumScrollTop = getScrollMetrics().maximumScrollTop;
    if (
      Math.abs(currentMaximumScrollTop - previousMaximumScrollTop) >
      SCROLL_POSITION_TOLERANCE_PX
    ) {
      previousMaximumScrollTop = currentMaximumScrollTop;
      sawChange = true;
      stableRounds = 0;
    } else {
      stableRounds += 1;
      if (sawChange && stableRounds >= 2) return true;
    }
  }

  return sawChange;
}

/**
 * Returns the closest logical Prompt-plus-Segment position to the target.
 */
export function getClosestLogicalPosition(
  targetPromptIndex: number,
  position: VisiblePromptPosition
): number | null {
  const positions = getMatchedLogicalPositions(position);
  if (positions.length === 0) return null;

  return positions.reduce((closest, candidate) =>
    Math.abs(targetPromptIndex - candidate) <
    Math.abs(targetPromptIndex - closest)
      ? candidate
      : closest
  );
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
 * Chooses an inward direction when an initial edge hint cannot mount content.
 */
export function getInteriorRecoveryDirection(
  targetPromptIndex: number,
  promptCount: number
): 1 | -1 {
  return targetPromptIndex >= Math.max(0, promptCount - 1) / 2
    ? -1
    : 1;
}

/**
 * Moves inward from a scroll boundary before reusing the latest search
 * direction for an unresolved position.
 */
function getUnresolvedRecoveryDirection({
  scrollTop,
  maximumScrollTop,
  lastDirection,
  targetPromptIndex,
  promptCount,
}: {
  scrollTop: number;
  maximumScrollTop: number;
  lastDirection: 1 | -1 | null;
  targetPromptIndex: number;
  promptCount: number;
}): 1 | -1 {
  if (scrollTop <= SCROLL_POSITION_TOLERANCE_PX) return 1;
  if (
    maximumScrollTop - scrollTop <=
    SCROLL_POSITION_TOLERANCE_PX
  ) {
    return -1;
  }

  return (
    lastDirection ??
    getInteriorRecoveryDirection(targetPromptIndex, promptCount)
  );
}

function createRelativePlan(
  targetPromptIndex: number,
  currentScrollTop: number,
  maximumScrollTop: number,
  viewportHeight: number,
  direction: 1 | -1
): VirtualSearchPlan {
  return {
    method: 'linear-probe',
    targetPromptIndex,
    scrollTop: clamp(
      currentScrollTop +
        direction * Math.max(1, viewportHeight),
      0,
      maximumScrollTop
    ),
    lowerAnchor: null,
    upperAnchor: null,
  };
}

function getPositionDiagnosticDetails(
  position: VisiblePromptPosition,
  anchorCount: number
): Record<string, unknown> {
  if (position.status !== 'located') {
    return { status: position.status, anchorCount };
  }

  return {
    status: position.status,
    firstPromptIndex: position.firstPromptIndex,
    lastPromptIndex: position.lastPromptIndex,
    matchedBlocks: position.matchedBlocks,
    matchSource: position.matchedBlocks[0]?.source || null,
    anchorCount,
  };
}

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

function isSameScrollTop(first: number, second: number): boolean {
  return Math.abs(first - second) <= SCROLL_POSITION_TOLERANCE_PX;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
