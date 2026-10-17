/**
 * Computes navigation direction relative to mounted conversation prompts.
 */

export type NavigationDirection = -1 | 1;

/**
 * Computes the navigation direction toward the target prompt relative to currently mounted prompts.
 * Returns -1 if the target is before the nearest mounted prompt (older turns),
 * +1 if the target is after the nearest mounted prompt (newer turns),
 * or null if no mounted sidebar indices are available.
 *
 * @param targetIndex 0-indexed position of the target prompt in the conversation.
 * @param sidebarIndices Readonly array of 0-indexed positions of currently mounted prompts.
 * @returns NavigationDirection (-1 | 1) or null if indices are empty.
 *
 * @example
 * const dir = computeDirectionTowardTarget(0, [10, 11, 12]);
 * // dir === -1 (target is older than mounted prompts)
 */
export function computeDirectionTowardTarget(
  targetIndex: number,
  sidebarIndices: ReadonlyArray<number>
): NavigationDirection | null {
  if (sidebarIndices.length === 0) {
    return null;
  }

  let nearestIdx = sidebarIndices[0];
  let currentDist = Math.abs(targetIndex - nearestIdx);
  for (let j = 1; j < sidebarIndices.length; j++) {
    const d = Math.abs(targetIndex - sidebarIndices[j]);
    if (d < currentDist) {
      currentDist = d;
      nearestIdx = sidebarIndices[j];
    }
  }
  return targetIndex > nearestIdx ? 1 : -1;
}
