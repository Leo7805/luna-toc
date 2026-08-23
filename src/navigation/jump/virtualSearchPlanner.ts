/**
 * Plans the next virtual-list scroll position from cached and observed anchors.
 */
import { APP_CONFIG } from '@/config/config';
import type { NavigationAnchor } from './navigationAnchorStore';

export type VirtualSearchMethod =
  | 'exact-anchor'
  | 'interpolation'
  | 'proportional'
  | 'binary'
  | 'linear-probe';

export type PlannedAnchorSource = 'observed' | 'confirmed' | 'boundary';

export interface PlannedSearchAnchor {
  promptIndex: number;
  scrollTop: number;
  source: PlannedAnchorSource;
}

export interface VirtualSearchPlannerInput {
  targetPromptIndex: number;
  promptCount: number;
  maximumScrollTop: number;
  viewportWidth: number;
  observedAnchors: NavigationAnchor[];
  confirmedAnchors: NavigationAnchor[];
  failedInterpolationAttempts?: number;
}

export interface VirtualSearchPlan {
  method: VirtualSearchMethod;
  targetPromptIndex: number;
  scrollTop: number;
  lowerAnchor: PlannedSearchAnchor | null;
  upperAnchor: PlannedSearchAnchor | null;
}

/**
 * Plans one bounded scroll position using exact anchors, nearest-neighbor
 * interpolation, proportional estimation, and binary fallback in that order.
 *
 * @example
 * const plan = planVirtualSearch({
 *   targetPromptIndex: 8,
 *   promptCount: 20,
 *   maximumScrollTop: 10_000,
 *   viewportWidth: 1280,
 *   observedAnchors,
 *   confirmedAnchors,
 * });
 */
export function planVirtualSearch({
  targetPromptIndex,
  promptCount,
  maximumScrollTop,
  viewportWidth,
  observedAnchors,
  confirmedAnchors,
  failedInterpolationAttempts = 0,
}: VirtualSearchPlannerInput): VirtualSearchPlan {
  const safePromptCount = Math.max(1, Math.trunc(promptCount));
  const safeMaximumScrollTop = Math.max(0, maximumScrollTop);
  const safeTargetPromptIndex = clamp(
    Math.trunc(targetPromptIndex),
    0,
    safePromptCount - 1
  );
  const anchors = mergeCompatibleAnchors({
    observedAnchors,
    confirmedAnchors,
    viewportWidth,
    maximumScrollTop: safeMaximumScrollTop,
  });
  const exactAnchor = anchors.find(
    ({ promptIndex }) => promptIndex === safeTargetPromptIndex
  );

  if (exactAnchor) {
    return createPlan(
      'exact-anchor',
      safeTargetPromptIndex,
      exactAnchor.scrollTop,
      exactAnchor,
      exactAnchor,
      safeMaximumScrollTop
    );
  }

  if (anchors.length === 0) {
    const denominator = Math.max(1, safePromptCount - 1);
    const proportionalScrollTop =
      (safeTargetPromptIndex / denominator) * safeMaximumScrollTop;

    return createPlan(
      'proportional',
      safeTargetPromptIndex,
      proportionalScrollTop,
      null,
      null,
      safeMaximumScrollTop
    );
  }

  const lowerAnchor =
    findNearestLowerAnchor(anchors, safeTargetPromptIndex) ||
    createBoundaryAnchor(0, 0);
  const upperAnchor =
    findNearestUpperAnchor(anchors, safeTargetPromptIndex) ||
    createBoundaryAnchor(safePromptCount - 1, safeMaximumScrollTop);
  if (lowerAnchor.scrollTop >= upperAnchor.scrollTop) {
    const denominator = Math.max(1, safePromptCount - 1);
    const proportionalScrollTop =
      (safeTargetPromptIndex / denominator) * safeMaximumScrollTop;

    return createPlan(
      'proportional',
      safeTargetPromptIndex,
      proportionalScrollTop,
      null,
      null,
      safeMaximumScrollTop
    );
  }

  const shouldUseBinary =
    failedInterpolationAttempts >=
    APP_CONFIG.navigation.search.interpolationFailuresBeforeBinary;
  const scrollTop = shouldUseBinary
    ? (lowerAnchor.scrollTop + upperAnchor.scrollTop) / 2
    : interpolateScrollTop(
        safeTargetPromptIndex,
        lowerAnchor,
        upperAnchor
      );

  return createPlan(
    shouldUseBinary ? 'binary' : 'interpolation',
    safeTargetPromptIndex,
    scrollTop,
    lowerAnchor,
    upperAnchor,
    safeMaximumScrollTop
  );
}

/**
 * Combines compatible confirmed anchors with current observed anchors.
 * Observed values replace confirmed values at the same prompt index.
 */
function mergeCompatibleAnchors({
  observedAnchors,
  confirmedAnchors,
  viewportWidth,
  maximumScrollTop,
}: Pick<
  VirtualSearchPlannerInput,
  | 'observedAnchors'
  | 'confirmedAnchors'
  | 'viewportWidth'
  | 'maximumScrollTop'
>): PlannedSearchAnchor[] {
  const tolerance =
    APP_CONFIG.navigation.anchorCache.viewportWidthTolerance;
  const anchorsByPromptIndex = new Map<number, PlannedSearchAnchor>();

  confirmedAnchors
    .filter(
      (anchor) =>
        Math.abs(anchor.viewportWidth - viewportWidth) <= tolerance
    )
    .forEach((anchor) => {
      anchorsByPromptIndex.set(anchor.promptIndex, {
        promptIndex: anchor.promptIndex,
        scrollTop: anchor.scrollProgress * maximumScrollTop,
        source: 'confirmed',
      });
    });

  observedAnchors.forEach((anchor) => {
    anchorsByPromptIndex.set(anchor.promptIndex, {
      promptIndex: anchor.promptIndex,
      scrollTop: anchor.scrollTop,
      source: 'observed',
    });
  });

  return [...anchorsByPromptIndex.values()].sort(
    (first, second) => first.promptIndex - second.promptIndex
  );
}

/**
 * Returns the closest known anchor below the target index.
 */
function findNearestLowerAnchor(
  anchors: PlannedSearchAnchor[],
  targetPromptIndex: number
): PlannedSearchAnchor | null {
  for (let index = anchors.length - 1; index >= 0; index -= 1) {
    const anchor = anchors[index]!;
    if (anchor.promptIndex < targetPromptIndex) return anchor;
  }

  return null;
}

/**
 * Returns the closest known anchor above the target index.
 */
function findNearestUpperAnchor(
  anchors: PlannedSearchAnchor[],
  targetPromptIndex: number
): PlannedSearchAnchor | null {
  return (
    anchors.find(({ promptIndex }) => promptIndex > targetPromptIndex) ||
    null
  );
}

/**
 * Interpolates the target scroll position between its nearest known bounds.
 */
function interpolateScrollTop(
  targetPromptIndex: number,
  lowerAnchor: PlannedSearchAnchor,
  upperAnchor: PlannedSearchAnchor
): number {
  const indexDistance =
    upperAnchor.promptIndex - lowerAnchor.promptIndex;

  if (indexDistance <= 0) {
    return (lowerAnchor.scrollTop + upperAnchor.scrollTop) / 2;
  }

  const targetRatio =
    (targetPromptIndex - lowerAnchor.promptIndex) / indexDistance;

  return (
    lowerAnchor.scrollTop +
    targetRatio * (upperAnchor.scrollTop - lowerAnchor.scrollTop)
  );
}

/**
 * Creates a synthetic top or bottom anchor when one real bound is missing.
 */
function createBoundaryAnchor(
  promptIndex: number,
  scrollTop: number
): PlannedSearchAnchor {
  return {
    promptIndex,
    scrollTop,
    source: 'boundary',
  };
}

/**
 * Creates a clamped immutable search-plan value.
 */
function createPlan(
  method: VirtualSearchMethod,
  targetPromptIndex: number,
  scrollTop: number,
  lowerAnchor: PlannedSearchAnchor | null,
  upperAnchor: PlannedSearchAnchor | null,
  maximumScrollTop: number
): VirtualSearchPlan {
  return {
    method,
    targetPromptIndex,
    scrollTop: clamp(scrollTop, 0, maximumScrollTop),
    lowerAnchor,
    upperAnchor,
  };
}

/**
 * Restricts a number to an inclusive range.
 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
