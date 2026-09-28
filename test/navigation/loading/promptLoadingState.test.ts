/** @vitest-environment jsdom */
/** Tests the prompt-loading fallback state machine. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLoading,
  setLoading,
  setOnSettleTimeout,
  startSettleTimer,
  clearSettleTimer,
} from '@/navigation/loading/promptLoadingState';

// Mirror APP_CONFIG.ui.sidebar.loadingSettleMs (1000ms) and the module's
// MAX_SETTLE_RETRIES (20) without importing config.
const SETTLE_MS = 1000;
const MAX_RETRIES = 20;

describe('promptLoadingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLoading(false);
    clearSettleTimer();
    setOnSettleTimeout(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts not loading', () => {
    expect(isLoading()).toBe(false);
  });

  it('setLoading flips the flag', () => {
    setLoading(true);
    expect(isLoading()).toBe(true);
    setLoading(false);
    expect(isLoading()).toBe(false);
  });

  it('fires the timeout callback only after the retry budget is exhausted', () => {
    const onTimeout = vi.fn();
    setOnSettleTimeout(onTimeout);
    setLoading(true);
    startSettleTimer();

    // One tick before the budget runs out: nothing fires yet.
    vi.advanceTimersByTime(MAX_RETRIES * SETTLE_MS);
    expect(onTimeout).not.toHaveBeenCalled();

    // The final tick pushes retries past the cap → callback fires once.
    vi.advanceTimersByTime(SETTLE_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire when loading was cleared before the budget ran out', () => {
    const onTimeout = vi.fn();
    setOnSettleTimeout(onTimeout);
    setLoading(true);
    startSettleTimer();
    setLoading(false);
    clearSettleTimer();

    vi.advanceTimersByTime((MAX_RETRIES + 5) * SETTLE_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});