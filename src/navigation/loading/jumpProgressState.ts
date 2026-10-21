/**
 * Authoritative navigation lifecycle state store.
 * Coordinates destination targets, presentation display authority, and status
 * lifecycle transitions without visual linger timers.
 */

export type NavigationState =
  | { state: 'idle' }
  | {
      state: 'jumping';
      targetIndex: number;
      currentProgressIndex?: number | null;
    }
  | {
      state: 'landed';
      targetIndex: number;
    }
  | {
      state: 'failed';
      targetIndex: number;
    };

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
  if (a.state === 'jumping' && b.state === 'jumping') {
    return (
      a.targetIndex === b.targetIndex &&
      a.currentProgressIndex === b.currentProgressIndex
    );
  }
  if (a.state === 'landed' && b.state === 'landed') {
    return a.targetIndex === b.targetIndex;
  }
  if (a.state === 'failed' && b.state === 'failed') {
    return a.targetIndex === b.targetIndex;
  }
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
 * @param currentProgressIndex Optional 0-indexed current visible prompt position.
 */
export function setNavigationJumping(
  targetIndex: number,
  currentProgressIndex: number | null = null
): void {
  const next: NavigationState = {
    state: 'jumping',
    targetIndex,
    ...(currentProgressIndex !== null ? { currentProgressIndex } : {}),
  };
  updateState(next);
}

/**
 * Updates current progress index during active jump without resetting target or watchdog.
 * Preserves last verified position if input is null or invalid.
 */
export function updateNavigationProgress(
  currentProgressIndex: number | null
): void {
  if (currentState.state !== 'jumping') return;
  if (currentProgressIndex === null || currentProgressIndex < 0) return;
  const currentVal =
    'currentProgressIndex' in currentState
      ? currentState.currentProgressIndex
      : undefined;
  if (currentVal === currentProgressIndex) return;
  updateState({
    ...currentState,
    currentProgressIndex,
  });
}

/**
 * Transitions lifecycle state to 'landed' at targetIndex upon verified completion.
 *
 * @param targetIndex 0-indexed position of landed prompt.
 */
export function setNavigationLanded(targetIndex: number): void {
  const next: NavigationState = {
    state: 'landed',
    targetIndex,
  };
  updateState(next);
}

/**
 * Transitions lifecycle state to terminal 'failed' for targetIndex.
 *
 * @param targetIndex 0-indexed position of prompt that failed to land.
 */
export function setNavigationFailed(targetIndex: number): void {
  const next: NavigationState = {
    state: 'failed',
    targetIndex,
  };
  updateState(next);
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