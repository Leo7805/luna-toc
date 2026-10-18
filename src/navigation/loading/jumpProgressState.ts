/**
 * Authoritative navigation lifecycle state store.
 * Coordinates destination targets, presentation display authority, and status
 * lifecycle transitions without visual linger timers.
 */

export type NavigationState =
  | { state: 'idle' }
  | { state: 'jumping'; targetIndex: number }
  | { state: 'landed'; targetIndex: number }
  | { state: 'failed'; targetIndex: number };

export type NavigationStateListener = (
  previous: NavigationState,
  current: NavigationState
) => void;

let currentState: NavigationState = { state: 'idle' };
const listeners = new Set<NavigationStateListener>();

/**
 * Checks structural equality between two NavigationStates to suppress duplicate writes.
 */
function areStatesEqual(a: NavigationState, b: NavigationState): boolean {
  if (a.state !== b.state) return false;
  if ('targetIndex' in a && 'targetIndex' in b) {
    return a.targetIndex === b.targetIndex;
  }
  return true;
}

/**
 * Updates navigation lifecycle state and notifies subscribers if state changed.
 */
function updateState(next: NavigationState): void {
  if (areStatesEqual(currentState, next)) return;
  const previous = currentState;
  currentState = next;
  listeners.forEach((listener) => {
    try {
      listener(previous, next);
    } catch (error) {
      console.error('[LunaTOC] navigation state listener error:', error);
    }
  });
}

/**
 * Returns the current navigation lifecycle state snapshot.
 */
export function getNavigationState(): NavigationState {
  return currentState;
}

/**
 * Transitions lifecycle state to 'jumping' toward targetIndex.
 *
 * @param targetIndex 0-indexed position of target prompt.
 */
export function setNavigationJumping(targetIndex: number): void {
  updateState({ state: 'jumping', targetIndex });
}

/**
 * Transitions lifecycle state to 'landed' at targetIndex upon verified completion.
 *
 * @param targetIndex 0-indexed position of landed prompt.
 */
export function setNavigationLanded(targetIndex: number): void {
  updateState({ state: 'landed', targetIndex });
}

/**
 * Transitions lifecycle state to terminal 'failed' for targetIndex.
 *
 * @param targetIndex 0-indexed position of prompt that failed to land.
 */
export function setNavigationFailed(targetIndex: number): void {
  updateState({ state: 'failed', targetIndex });
}

/**
 * Transitions lifecycle state to 'idle'.
 */
export function setNavigationIdle(): void {
  updateState({ state: 'idle' });
}

/**
 * Subscribes to navigation lifecycle state transitions.
 *
 * @param listener Callback receiving (previous, current) state transition pairs.
 * @returns Unsubscribe function to detach listener.
 */
export function onNavigationStateChange(
  listener: NavigationStateListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resets navigation state store for test isolation.
 */
export function resetNavigationStateForTest(): void {
  currentState = { state: 'idle' };
  listeners.clear();
}