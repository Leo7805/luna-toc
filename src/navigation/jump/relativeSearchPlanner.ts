/**
 * Plans adaptive relative movement from live logical-position feedback.
 */
import { APP_CONFIG } from '@/config/config';
import type { VirtualSearchPlan } from './virtualSearchPlanner';

export interface RelativeSearchSample {
  logicalPosition: number;
  scrollTop: number;
}

export interface RelativeSearchPlannerInput {
  targetPromptIndex: number;
  currentSample: RelativeSearchSample;
  previousSample: RelativeSearchSample | null;
  lastScrollDelta: number | null;
  maximumScrollTop: number;
  viewportHeight: number;
}

export type RelativeSearchPlanningBasis =
  | 'distance-default'
  | 'learned-rate'
  | 'target-crossing'
  | 'stalled-growth';

export interface RelativeSearchPlan extends VirtualSearchPlan {
  planningBasis: RelativeSearchPlanningBasis;
  estimatedPixelsPerPrompt: number | null;
  movementLimit: number;
}

/**
 * Estimates the next relative movement without retaining absolute bounds.
 */
export function planRelativeSearch({
  targetPromptIndex,
  currentSample,
  previousSample,
  lastScrollDelta,
  maximumScrollTop,
  viewportHeight,
}: RelativeSearchPlannerInput): RelativeSearchPlan {
  const viewport = Math.max(1, viewportHeight);
  const logicalDelta =
    targetPromptIndex - currentSample.logicalPosition;
  const direction: 1 | -1 = logicalDelta >= 0 ? 1 : -1;
  const distance = Math.abs(logicalDelta);
  const config = APP_CONFIG.navigation.search;
  const defaultMovementLimit =
    config.maximumRelativeViewportCount * viewport;
  let movementLimit = defaultMovementLimit;
  let planningBasis: RelativeSearchPlanningBasis =
    'distance-default';
  let estimatedPixelsPerPrompt: number | null = null;
  let movement = clamp(
    distance * config.relativeViewportRatio * viewport,
    config.minimumRelativeViewportRatio * viewport,
    movementLimit
  );

  if (previousSample) {
    const previousLogicalDelta =
      targetPromptIndex - previousSample.logicalPosition;
    const crossedTarget =
      previousLogicalDelta !== 0 &&
      Math.sign(previousLogicalDelta) !== Math.sign(logicalDelta);
    const observedPromptDelta = Math.abs(
      currentSample.logicalPosition - previousSample.logicalPosition
    );
    const observedScrollDelta = Math.abs(
      currentSample.scrollTop - previousSample.scrollTop
    );

    if (crossedTarget && lastScrollDelta !== null) {
      planningBasis = 'target-crossing';
      movement = Math.max(
        config.minimumRelativeViewportRatio * viewport,
        Math.abs(lastScrollDelta) * config.crossingStepRatio
      );
    } else if (observedPromptDelta > 0 && observedScrollDelta > 0) {
      planningBasis = 'learned-rate';
      estimatedPixelsPerPrompt =
        observedScrollDelta / observedPromptDelta;
      movementLimit =
        distance <= config.nearTargetPromptDistance
          ? config.maximumNearTargetViewportCount * viewport
          : config.maximumLearnedRelativeViewportCount * viewport;
      movement = clamp(
        distance * estimatedPixelsPerPrompt,
        config.minimumRelativeViewportRatio * viewport,
        movementLimit
      );
    } else if (lastScrollDelta !== null) {
      planningBasis = 'stalled-growth';
      movement = clamp(
        Math.abs(lastScrollDelta) * config.stalledStepGrowthRatio,
        config.minimumRelativeViewportRatio * viewport,
        movementLimit
      );
    }
  }

  return {
    ...createRelativePlan(
      targetPromptIndex,
      currentSample.scrollTop + direction * movement,
      maximumScrollTop
    ),
    planningBasis,
    estimatedPixelsPerPrompt,
    movementLimit,
  };
}

/**
 * Creates a local Prompt-mount scan relative to the current live scroll.
 */
export function planPromptMountScan({
  targetPromptIndex,
  currentScrollTop,
  maximumScrollTop,
  viewportHeight,
  direction,
  viewportRatio = APP_CONFIG.navigation.search
    .promptMountScanViewportRatio,
}: {
  targetPromptIndex: number;
  currentScrollTop: number;
  maximumScrollTop: number;
  viewportHeight: number;
  direction: 1 | -1;
  viewportRatio?: number;
}): VirtualSearchPlan {
  const movement =
    Math.max(1, viewportHeight) *
    Math.max(0, viewportRatio);

  return createRelativePlan(
    targetPromptIndex,
    currentScrollTop + direction * movement,
    maximumScrollTop
  );
}

function createRelativePlan(
  targetPromptIndex: number,
  scrollTop: number,
  maximumScrollTop: number
): VirtualSearchPlan {
  return {
    method: 'linear-probe',
    targetPromptIndex,
    scrollTop: clamp(scrollTop, 0, Math.max(0, maximumScrollTop)),
    lowerAnchor: null,
    upperAnchor: null,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
