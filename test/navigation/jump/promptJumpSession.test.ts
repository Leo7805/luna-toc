/** @vitest-environment jsdom */
/** Tests centralized PromptJumpSession state ownership and resource lifecycle primitives. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getScrollContainer: vi.fn(),
  emitAlignmentMeasurement: vi.fn(),
}));

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({
    navigation: {
      getScrollContainer: mocks.getScrollContainer,
    },
  }),
}));

vi.mock('@/navigation/jump/jumpDiagnostics', () => ({
  emitAlignmentMeasurement: mocks.emitAlignmentMeasurement,
}));

import {
  attachSessionUserInputListeners,
  cleanupPromptJumpSession,
  createPromptJumpSession,
  emitSessionAlignmentMeasurement,
  scheduleSessionFrame,
} from '@/navigation/jump/prompt/promptJumpSession';

describe('promptJumpSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    mocks.getScrollContainer.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes all 24 mutable state fields with exact fast-path defaults', () => {
    const target = document.createElement('div');
    const session = createPromptJumpSession({
      target,
      targetMessageId: 'msg-1',
      targetIndex: 0,
      jumpId: 'jump-1',
      mode: 'target-driven',
      isCancelled: () => false,
    });

    expect(session.lifecycle).toEqual({
      userInterrupted: false,
      cancelScheduledFrame: null,
      removeUserInputListeners: null,
    });
    expect(session.alignment).toEqual({
      lastAlignClamped: false,
      lastAppliedScrollTop: null,
      lastAppliedDistanceFromBottom: null,
      lastObservedScrollHeight: null,
      didScrollFar: false,
    });
    expect(session.stabilization).toEqual({
      activeTarget: target,
      startedAtMs: 0,
      realignAttempts: 0,
      lastRealignAtMs: null,
      consecutiveAlignedFrames: 0,
      stableSinceMs: null,
      lastAlignedViewportTopPx: null,
      consecutiveDisconnectedFrames: 0,
      disconnectedSinceMs: null,
      layoutMutatedDuringPass: false,
    });
    expect(session.recovery).toEqual({
      activeStrategy: 'fast-path',
      attemptsUsed: 0,
      remainingRecoveries: 0,
      isRecovering: false,
      lastVirtualOffsetPx: null,
      lastVirtualOffsetShifted: false,
    });
  });

  it('initializes virtual-layout session with didScrollFar=true and recovery metadata', () => {
    const target = document.createElement('div');
    const session = createPromptJumpSession({
      target,
      targetMessageId: 'msg-15',
      targetIndex: 14,
      jumpId: 'jump-15',
      mode: 'target-driven',
      initialStrategy: 'virtual-layout',
      remainingRecoveries: 2,
      initialVirtualTopOffsetPx: 18336,
      initialScrollTopPx: 0,
      isCancelled: () => false,
    });

    expect(session.alignment.didScrollFar).toBe(true);
    expect(session.initialScrollTopPx).toBe(0);
    expect(session.recovery.activeStrategy).toBe('virtual-layout');
    expect(session.recovery.remainingRecoveries).toBe(2);
    expect(session.recovery.lastVirtualOffsetPx).toBe(18336);
  });

  it('schedules frame callbacks and suppresses execution when cancelled or cleaned up', () => {
    let version = 1;
    const session = createPromptJumpSession({
      target: document.createElement('div'),
      targetMessageId: 'msg-2',
      targetIndex: 1,
      jumpId: 'jump-2',
      mode: 'target-driven',
      isCancelled: () => version !== 1,
    });

    const cb1 = vi.fn();
    session.lifecycle.cancelScheduledFrame = scheduleSessionFrame(session, cb1, 50);
    cleanupPromptJumpSession(session);
    vi.advanceTimersByTime(100);
    expect(cb1).not.toHaveBeenCalled();
    expect(session.lifecycle.cancelScheduledFrame).toBeNull();

    const cb2 = vi.fn();
    scheduleSessionFrame(session, cb2, 50);
    version = 2; // simulate navigationJumpVersion bump
    vi.advanceTimersByTime(100);
    expect(cb2).not.toHaveBeenCalled();
  });

  it('tracks wheel, touch, pointer, and scroll-key interruptions and removes listeners idempotently', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mocks.getScrollContainer.mockReturnValue(container);

    const makeSession = () =>
      createPromptJumpSession({
        target: document.createElement('div'),
        targetMessageId: 'msg-3',
        targetIndex: 2,
        jumpId: 'jump-3',
        mode: 'target-driven',
        isCancelled: () => false,
      });

    // Wheel interruption on container
    const s1 = makeSession();
    attachSessionUserInputListeners(s1);
    container.dispatchEvent(new Event('wheel'));
    expect(s1.lifecycle.userInterrupted).toBe(true);
    cleanupPromptJumpSession(s1);
    cleanupPromptJumpSession(s1); // idempotent
    expect(s1.lifecycle.removeUserInputListeners).toBeNull();

    // Touch and pointer interruption
    const s2 = makeSession();
    attachSessionUserInputListeners(s2);
    container.dispatchEvent(new Event('touchstart'));
    expect(s2.lifecycle.userInterrupted).toBe(true);
    cleanupPromptJumpSession(s2);

    const s3 = makeSession();
    attachSessionUserInputListeners(s3);
    container.dispatchEvent(new Event('pointerdown'));
    expect(s3.lifecycle.userInterrupted).toBe(true);
    cleanupPromptJumpSession(s3);

    // Keyboard: non-scroll key ignored, ArrowDown interrupts, removed after cleanup
    const s4 = makeSession();
    attachSessionUserInputListeners(s4);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(s4.lifecycle.userInterrupted).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(s4.lifecycle.userInterrupted).toBe(true);
    cleanupPromptJumpSession(s4);

    // After cleanup, further wheel events do not affect the disposed session
    s4.lifecycle.userInterrupted = false;
    container.dispatchEvent(new Event('wheel'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    expect(s4.lifecycle.userInterrupted).toBe(false);
  });

  it('keeps rapid consecutive session cleanups isolated to their own resources', () => {
    let activeCleanup: (() => void) | null = null;
    const cbA = vi.fn();
    const cbB = vi.fn();

    const sessionA = createPromptJumpSession({
      target: document.createElement('div'),
      targetMessageId: 'msg-a',
      targetIndex: 0,
      jumpId: 'jump-a',
      mode: 'target-driven',
      isCancelled: () => false,
    });
    const cleanupA = () => {
      cleanupPromptJumpSession(sessionA);
      if (activeCleanup === cleanupA) activeCleanup = null;
    };
    activeCleanup = cleanupA;
    sessionA.lifecycle.cancelScheduledFrame = scheduleSessionFrame(sessionA, cbA, 50);

    const sessionB = createPromptJumpSession({
      target: document.createElement('div'),
      targetMessageId: 'msg-b',
      targetIndex: 1,
      jumpId: 'jump-b',
      mode: 'target-driven',
      isCancelled: () => false,
    });
    const cleanupB = () => {
      cleanupPromptJumpSession(sessionB);
      if (activeCleanup === cleanupB) activeCleanup = null;
    };
    activeCleanup = cleanupB;
    sessionB.lifecycle.cancelScheduledFrame = scheduleSessionFrame(sessionB, cbB, 50);

    // Stale cleanupA runs after sessionB became active: cancels A only, leaves B intact
    cleanupA();
    expect(activeCleanup).toBe(cleanupB);

    vi.advanceTimersByTime(60);
    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('emits alignment diagnostics using live activeStrategy after recovery mutates it', () => {
    const target = document.createElement('div');
    const session = createPromptJumpSession({
      target,
      targetMessageId: 'msg-60',
      targetIndex: 59,
      jumpId: 'jump-60',
      mode: 'target-driven',
      initialStrategy: 'virtual-layout',
      isCancelled: () => false,
    });

    emitSessionAlignmentMeasurement(session, 'after-align', target, null, 190, false, 'container-scroll');
    session.recovery.activeStrategy = 'viewport-walker';
    emitSessionAlignmentMeasurement(session, 'realign', target, null, 190, true, 'container-scroll', 'layout-shift');

    expect(mocks.emitAlignmentMeasurement).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ strategy: 'virtual-layout', stage: 'after-align' })
    );
    expect(mocks.emitAlignmentMeasurement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        strategy: 'viewport-walker',
        stage: 'realign',
        clamped: true,
        displacementKind: 'layout-shift',
      })
    );
  });
});
