/** @vitest-environment jsdom */
/** Tests the authoritative NavigationState lifecycle store. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNavigationState,
  setNavigationJumping,
  setNavigationLanded,
  setNavigationFailed,
  setNavigationIdle,
  onNavigationStateChange,
  updateNavigationProgress,
  resetNavigationStateForTest,
} from '@/navigation/loading/jumpProgressState';

describe('NavigationState store (jumpProgressState)', () => {
  beforeEach(() => {
    resetNavigationStateForTest();
  });

  it('starts in idle state', () => {
    expect(getNavigationState()).toEqual({ state: 'idle' });
  });

  it('setNavigationJumping stores jumping state and notifies transition listener', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(199);

    expect(getNavigationState()).toEqual({
      state: 'jumping',
      targetIndex: 199,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      { state: 'idle' },
      { state: 'jumping', targetIndex: 199 }
    );
  });

  it('setNavigationJumping records optional currentProgressIndex', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(119, 426);

    expect(getNavigationState()).toEqual({
      state: 'jumping',
      targetIndex: 119,
      currentProgressIndex: 426,
    });
    expect(listener).toHaveBeenCalledWith(
      { state: 'idle' },
      { state: 'jumping', targetIndex: 119, currentProgressIndex: 426 }
    );
  });

  it('updateNavigationProgress updates currentProgressIndex while keeping targetIndex and suppresses identical/invalid values', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(119, 426);
    expect(listener).toHaveBeenCalledTimes(1);

    updateNavigationProgress(379);
    expect(getNavigationState()).toEqual({
      state: 'jumping',
      targetIndex: 119,
      currentProgressIndex: 379,
    });
    expect(listener).toHaveBeenCalledTimes(2);

    // Duplicate write is suppressed
    updateNavigationProgress(379);
    expect(listener).toHaveBeenCalledTimes(2);

    // Null or invalid position does not overwrite verified position
    updateNavigationProgress(null);
    updateNavigationProgress(-1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getNavigationState()).toEqual({
      state: 'jumping',
      targetIndex: 119,
      currentProgressIndex: 379,
    });
  });

  it('setNavigationLanded transitions to landed state upon verified completion', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(199);
    setNavigationLanded(199);

    expect(getNavigationState()).toEqual({
      state: 'landed',
      targetIndex: 199,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      { state: 'jumping', targetIndex: 199 },
      { state: 'landed', targetIndex: 199 }
    );
  });

  it('setNavigationFailed transitions to terminal failed state without UI timers', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(199);
    setNavigationFailed(199);

    expect(getNavigationState()).toEqual({
      state: 'failed',
      targetIndex: 199,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      { state: 'jumping', targetIndex: 199 },
      { state: 'failed', targetIndex: 199 }
    );
  });

  it('setNavigationIdle resets to idle', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(199);
    setNavigationIdle();

    expect(getNavigationState()).toEqual({ state: 'idle' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      { state: 'jumping', targetIndex: 199 },
      { state: 'idle' }
    );
  });

  it('suppresses identical duplicate state writes', () => {
    const listener = vi.fn();
    onNavigationStateChange(listener);

    setNavigationJumping(199);
    setNavigationJumping(199); // Duplicate write

    expect(listener).toHaveBeenCalledTimes(1);

    setNavigationIdle();
    setNavigationIdle(); // Duplicate write

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('allows unsubscribing from state transitions cleanly', () => {
    const listener = vi.fn();
    const unsubscribe = onNavigationStateChange(listener);

    setNavigationJumping(199);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    setNavigationLanded(199);
    expect(listener).toHaveBeenCalledTimes(1); // Not called after unsubscribe
  });
});