/** @vitest-environment jsdom */
/** Tests the sidebar status banner state transitions, formatting, and timers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getStatusSnapshot,
  resetStatusForTesting,
  setSidebarStatus,
} from '@/navigation/ui/sidebarStatus';

describe('sidebarStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStatusForTesting();
  });

  afterEach(() => {
    setSidebarStatus({ state: 'idle' });
    resetStatusForTesting();
    vi.useRealTimers();
  });

  it('renders loading states for initial load and backfill progress', () => {
    setSidebarStatus({ state: 'loading', promptCount: 0 });
    expect(getStatusSnapshot()).toEqual({ state: 'loading', text: 'Loading…' });

    setSidebarStatus({ state: 'loading', promptCount: 5 });
    expect(getStatusSnapshot()).toEqual({
      state: 'loading',
      text: 'Loading... (5 so far)',
    });
  });

  it('renders persistent empty state without retract timer', () => {
    setSidebarStatus({ state: 'empty' });
    expect(getStatusSnapshot()).toEqual({ state: 'empty', text: 'No prompts' });

    vi.advanceTimersByTime(10000);
    expect(getStatusSnapshot()).toEqual({ state: 'empty', text: 'No prompts' });
  });

  it('renders jumping state with target format', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 2, remainingSteps: 1 },
    });

    expect(getStatusSnapshot().state).toBe('jumping');
    expect(getStatusSnapshot().text).toBe('To #3');
  });

  it('renders unified format with destination and current position (To #N · Now #M)', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 426 },
    });

    expect(getStatusSnapshot()).toEqual({
      state: 'jumping',
      text: 'To #120 · Now #427',
    });
  });

  it('updates text on progress advance', () => {
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 426 },
    });

    expect(getStatusSnapshot().text).toBe('To #120 · Now #427');

    // Advance progress: Now #380
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 119, currentProgressIndex: 379 },
    });

    expect(getStatusSnapshot().text).toBe('To #120 · Now #380');
  });

  it('retracts complete state to idle after linger delay', () => {
    setSidebarStatus({ state: 'complete', promptCount: 1 });
    expect(getStatusSnapshot()).toEqual({ state: 'complete', text: '1 prompt' });

    vi.advanceTimersByTime(2500);
    expect(getStatusSnapshot()).toEqual({ state: 'idle', text: '' });
  });

  it('retracts failed jump state to idle after linger delay', () => {
    setSidebarStatus({ state: 'failed' });
    expect(getStatusSnapshot()).toEqual({ state: 'failed', text: 'Jump failed' });

    vi.advanceTimersByTime(2500);
    expect(getStatusSnapshot()).toEqual({ state: 'idle', text: '' });
  });
});
