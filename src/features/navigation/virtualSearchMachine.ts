/**
 * Defines the small phase machine used by adaptive virtual-list navigation.
 */

export type VirtualSearchPhase =
  | 'initial-estimate'
  | 'seek-response'
  | 'mount-prompt';

export interface VirtualSearchMachineState {
  phase: VirtualSearchPhase;
  mountAttempts: number;
  mountDirection: 1 | -1 | null;
  mountStepViewportRatio: number;
}

/**
 * Creates the initial navigation phase.
 */
export function createVirtualSearchMachine(): VirtualSearchMachineState {
  return {
    phase: 'initial-estimate',
    mountAttempts: 0,
    mountDirection: null,
    mountStepViewportRatio: 0,
  };
}

/**
 * Advances search ownership after one live position observation.
 */
export function advanceVirtualSearchMachine(
  state: VirtualSearchMachineState,
  targetResponseLocated: boolean
): VirtualSearchMachineState {
  if (state.phase === 'mount-prompt') return state;

  return targetResponseLocated
    ? {
        phase: 'mount-prompt',
        mountAttempts: 0,
        mountDirection: null,
        mountStepViewportRatio: 0,
      }
    : { ...state, phase: 'seek-response' };
}

/**
 * Updates mount direction and step size from neighboring response feedback.
 */
export function updatePromptMountFeedback(
  state: VirtualSearchMachineState,
  {
    targetPromptIndex,
    logicalPosition,
    initialDirection,
    initialStepViewportRatio,
    minimumStepViewportRatio,
    maximumStepViewportRatio,
    growthRatio,
    crossingRatio,
  }: {
    targetPromptIndex: number;
    logicalPosition: number | null;
    initialDirection: 1 | -1;
    initialStepViewportRatio: number;
    minimumStepViewportRatio: number;
    maximumStepViewportRatio: number;
    growthRatio: number;
    crossingRatio: number;
  }
): VirtualSearchMachineState {
  if (state.phase !== 'mount-prompt') return state;

  const desiredDirection =
    logicalPosition === null ||
    logicalPosition >= targetPromptIndex
      ? initialDirection
      : initialDirection === 1
        ? -1
        : 1;
  const crossedBoundary =
    state.mountDirection !== null &&
    state.mountDirection !== desiredDirection;
  const nextStep =
    state.mountDirection === null
      ? initialStepViewportRatio
      : crossedBoundary
        ? state.mountStepViewportRatio * crossingRatio
        : state.mountStepViewportRatio * growthRatio;

  return {
    ...state,
    mountAttempts: state.mountAttempts + 1,
    mountDirection: desiredDirection,
    mountStepViewportRatio: Math.min(
      Math.max(nextStep, minimumStepViewportRatio),
      maximumStepViewportRatio
    ),
  };
}
