/**
 * Explicit session state owner and low-level resource lifecycle primitives
 * for post-landing prompt jump stabilization and recovery.
 */
import { getActivePlatform } from '@/platforms';
import {
  emitAlignmentMeasurement,
  type AlignmentMeasurementStage,
} from '@/navigation/jump/jumpDiagnostics';
import type { AlignElementResult } from '@/navigation/jump/promptAlignment';

/**
 * Navigation strategy name tracked across stabilization, recovery, and diagnostics.
 */
export type NavigationStrategyName =
  | 'virtual-layout'
  | 'viewport-walker'
  | 'fast-path'
  | 'none';

/**
 * Classification of post-landing target displacement during stabilization.
 */
export type DisplacementKind =
  | 'none'
  | 'layout-shift'
  | 'external-scroll-suspected'
  | 'user-scroll';

/**
 * Mutable resource-lifecycle state owned by a single prompt jump session.
 */
export interface PromptJumpSessionLifecycleState {
  userInterrupted: boolean;
  cancelScheduledFrame: (() => void) | null;
  removeUserInputListeners: (() => void) | null;
}

/**
 * Mutable alignment-tracking state owned by a single prompt jump session.
 */
export interface PromptJumpSessionAlignmentState {
  lastAlignClamped: boolean;
  lastAppliedScrollTop: number | null;
  lastAppliedDistanceFromBottom: number | null;
  lastObservedScrollHeight: number | null;
  didScrollFar: boolean;
}

/**
 * Mutable post-landing stabilization state owned by a single prompt jump session.
 */
export interface PromptJumpSessionStabilizationState {
  activeTarget: HTMLElement | null;
  startedAtMs: number;
  realignAttempts: number;
  lastRealignAtMs: number | null;
  consecutiveAlignedFrames: number;
  stableSinceMs: number | null;
  lastAlignedViewportTopPx: number | null;
  consecutiveDisconnectedFrames: number;
  disconnectedSinceMs: number | null;
  layoutMutatedDuringPass: boolean;
}

/**
 * Mutable disconnect-recovery state owned by a single prompt jump session.
 */
export interface PromptJumpSessionRecoveryState {
  activeStrategy: NavigationStrategyName;
  attemptsUsed: number;
  remainingRecoveries: number;
  isRecovering: boolean;
  lastVirtualOffsetPx: number | null;
  lastVirtualOffsetShifted: boolean;
}

/**
 * Centralized state owner for a single post-landing prompt jump operation.
 */
export interface PromptJumpSession {
  readonly jumpId: string;
  readonly targetMessageId: string;
  readonly targetIndex: number;
  readonly mode: 'target-driven' | 'viewport-driven';
  readonly initialScrollTopPx: number | null;
  readonly isCancelled: () => boolean;
  readonly lifecycle: PromptJumpSessionLifecycleState;
  readonly alignment: PromptJumpSessionAlignmentState;
  readonly stabilization: PromptJumpSessionStabilizationState;
  readonly recovery: PromptJumpSessionRecoveryState;
}

/**
 * Inputs used to construct a new `PromptJumpSession`.
 */
export interface CreatePromptJumpSessionParams {
  target: HTMLElement;
  targetMessageId: string;
  targetIndex: number;
  jumpId: string;
  mode: 'target-driven' | 'viewport-driven';
  initialStrategy?: NavigationStrategyName;
  remainingRecoveries?: number;
  initialVirtualTopOffsetPx?: number;
  initialScrollTopPx?: number | null;
  isCancelled: () => boolean;
}

/**
 * Creates a centralized `PromptJumpSession` owning all mutable state for one
 * post-landing prompt jump operation.
 *
 * Note: `stabilization.startedAtMs` is initialized to `0` and must be stamped
 * with the monotonic clock only when the stabilization pass actually starts
 * (after initial alignment), preserving the original stabilization budget.
 *
 * @param params Session initialization parameters.
 * @returns Newly initialized `PromptJumpSession`.
 * @example
 * const session = createPromptJumpSession({
 *   target,
 *   targetMessageId: message.id,
 *   targetIndex: index,
 *   jumpId,
 *   mode: 'target-driven',
 *   isCancelled: () => jumpVersion !== currentVersion,
 * });
 */
export function createPromptJumpSession(
  params: CreatePromptJumpSessionParams
): PromptJumpSession {
  const initialStrategy: NavigationStrategyName =
    params.initialStrategy ?? 'fast-path';

  return {
    jumpId: params.jumpId,
    targetMessageId: params.targetMessageId,
    targetIndex: params.targetIndex,
    mode: params.mode,
    initialScrollTopPx: params.initialScrollTopPx ?? null,
    isCancelled: params.isCancelled,
    lifecycle: {
      userInterrupted: false,
      cancelScheduledFrame: null,
      removeUserInputListeners: null,
    },
    alignment: {
      lastAlignClamped: false,
      lastAppliedScrollTop: null,
      lastAppliedDistanceFromBottom: null,
      lastObservedScrollHeight: null,
      didScrollFar: initialStrategy !== 'fast-path',
    },
    stabilization: {
      activeTarget: params.target,
      startedAtMs: 0,
      realignAttempts: 0,
      lastRealignAtMs: null,
      consecutiveAlignedFrames: 0,
      stableSinceMs: null,
      lastAlignedViewportTopPx: null,
      consecutiveDisconnectedFrames: 0,
      disconnectedSinceMs: null,
      layoutMutatedDuringPass: false,
    },
    recovery: {
      activeStrategy: initialStrategy,
      attemptsUsed: 0,
      remainingRecoveries: params.remainingRecoveries ?? 0,
      isRecovering: false,
      lastVirtualOffsetPx: params.initialVirtualTopOffsetPx ?? null,
      lastVirtualOffsetShifted: false,
    },
  };
}

/**
 * Releases any active scheduled frame handle and user-input listeners owned by
 * `session`. Safe and idempotent when invoked multiple times.
 *
 * @param session Active prompt jump session to dispose.
 */
export function cleanupPromptJumpSession(session: PromptJumpSession): void {
  if (session.lifecycle.cancelScheduledFrame) {
    const cancel = session.lifecycle.cancelScheduledFrame;
    session.lifecycle.cancelScheduledFrame = null;
    cancel();
  }
  if (session.lifecycle.removeUserInputListeners) {
    const remove = session.lifecycle.removeUserInputListeners;
    session.lifecycle.removeUserInputListeners = null;
    remove();
  }
}

/**
 * Schedules a callback on the next animation frame with a fallback timeout so
 * backgrounded or throttled tabs never stall indefinitely. Returns an
 * idempotent cancellation handle.
 *
 * @param session Active prompt jump session providing cancellation state.
 * @param callback Function to invoke once the frame or fallback timer fires.
 * @param timeoutMs Fallback timer budget in milliseconds.
 * @returns Cancellation function clearing both timer and animation frame handles.
 */
export function scheduleSessionFrame(
  session: PromptJumpSession,
  callback: () => void,
  timeoutMs: number
): () => void {
  let settled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let rafId: number | null = null;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const run = () => {
    if (settled) return;
    cleanup();
    if (session.isCancelled()) return;
    callback();
  };

  let inSchedule = true;
  timerId = setTimeout(run, timeoutMs);
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(() => {
      if (inSchedule) return;
      run();
    });
  }
  inSchedule = false;

  return cleanup;
}

/**
 * Attaches passive wheel, touch, pointer, and scroll-key listeners for the
 * lifetime of `session` so user scroll intent interrupts stabilization.
 *
 * @param session Active prompt jump session.
 */
export function attachSessionUserInputListeners(
  session: PromptJumpSession
): void {
  if (session.lifecycle.removeUserInputListeners || typeof window === 'undefined') {
    return;
  }
  const container = getActivePlatform().navigation.getScrollContainer();
  const markUserInterrupted = (): void => {
    session.lifecycle.userInterrupted = true;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === ' '
    ) {
      session.lifecycle.userInterrupted = true;
    }
  };
  const passiveOpts: AddEventListenerOptions = { passive: true, capture: true };
  const eventTarget: EventTarget = container ?? window;
  eventTarget.addEventListener('wheel', markUserInterrupted, passiveOpts);
  eventTarget.addEventListener('touchstart', markUserInterrupted, passiveOpts);
  eventTarget.addEventListener('pointerdown', markUserInterrupted, passiveOpts);
  window.addEventListener('keydown', onKeyDown, true);

  session.lifecycle.removeUserInputListeners = () => {
    eventTarget.removeEventListener('wheel', markUserInterrupted, passiveOpts);
    eventTarget.removeEventListener('touchstart', markUserInterrupted, passiveOpts);
    eventTarget.removeEventListener('pointerdown', markUserInterrupted, passiveOpts);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}

/**
 * Emits a debug-only `[LUNA ALIGNMENT]` measurement using the live strategy
 * currently recorded on `session.recovery.activeStrategy`.
 *
 * @param session Active prompt jump session.
 * @param stage Lifecycle stage label.
 * @param element Target prompt element.
 * @param container Active scroll container, if any.
 * @param expectedViewportTopPx Expected viewport top coordinate in pixels.
 * @param clamped Whether container scroll clamping occurred.
 * @param method Optional alignment method used.
 * @param displacementKind Optional displacement classification.
 */
export function emitSessionAlignmentMeasurement(
  session: PromptJumpSession,
  stage: AlignmentMeasurementStage,
  element: HTMLElement,
  container: HTMLElement | null,
  expectedViewportTopPx: number,
  clamped: boolean,
  method?: AlignElementResult['method'],
  displacementKind?: DisplacementKind
): void {
  emitAlignmentMeasurement({
    jumpId: session.jumpId,
    stage,
    targetMessageId: session.targetMessageId,
    targetIndex: session.targetIndex,
    strategy: session.recovery.activeStrategy,
    element,
    container,
    expectedViewportTopPx,
    clamped,
    method,
    displacementKind,
  });
}
