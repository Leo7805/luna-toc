/** @vitest-environment jsdom */
/** Tests child-outline navigation across ChatGPT virtual DOM replacement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const promptNavigationMocks = vi.hoisted(() => ({
  jumpToPromptIndex: vi.fn(),
}));

const followMocks = vi.hoisted(() => ({
  keepFollowing: vi.fn(),
}));

vi.mock('@/navigation/jump/promptNavigation', () => promptNavigationMocks);
vi.mock('@/navigation/follow/follow', () => followMocks);

import {
  cancelOutlineNavigation,
  jumpToOutlineEntry,
} from '@/navigation/outline/outlineNavigation';

beforeEach(() => {
  vi.useFakeTimers();
  promptNavigationMocks.jumpToPromptIndex.mockReset();
  followMocks.keepFollowing.mockReset();
});

afterEach(() => {
  cancelOutlineNavigation();
  vi.useRealTimers();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

describe('outline navigation', () => {
  it('uses a connected cached heading without restoring the parent prompt', () => {
    const heading = document.createElement('h2');
    const scrollIntoView = vi.fn();

    heading.scrollIntoView = scrollIntoView;
    document.body.appendChild(heading);

    const resolveCurrentHeading = vi.fn();
    jumpToOutlineEntry({ element: heading, text: 'Overview' }, 3, resolveCurrentHeading);

    expect(resolveCurrentHeading).not.toHaveBeenCalled();
    expect(promptNavigationMocks.jumpToPromptIndex).not.toHaveBeenCalled();
    expect(followMocks.keepFollowing).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('re-resolves a disconnected heading after restoring its parent prompt', () => {
    const staleHeading = document.createElement('h2');
    const currentHeading = document.createElement('h2');
    const scrollIntoView = vi.fn();
    let resolutionAttempts = 0;

    currentHeading.scrollIntoView = scrollIntoView;
    const resolveCurrentHeading = vi.fn(() => {
      resolutionAttempts += 1;
      return resolutionAttempts >= 2 ? currentHeading : null;
    });

    jumpToOutlineEntry(
      { element: staleHeading, text: 'Details' },
      5,
      resolveCurrentHeading
    );

    expect(promptNavigationMocks.jumpToPromptIndex).toHaveBeenCalledWith(5, 4000);
    vi.advanceTimersByTime(250);

    expect(resolveCurrentHeading).toHaveBeenCalledTimes(2);
    expect(followMocks.keepFollowing).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the pending 250ms retry timer immediately on cancelOutlineNavigation', () => {
    const staleHeading = document.createElement('h2');
    const resolveCurrentHeading = vi.fn(() => null);

    jumpToOutlineEntry(
      { element: staleHeading, text: 'Pending' },
      2,
      resolveCurrentHeading
    );
    expect(vi.getTimerCount()).toBe(1);

    cancelOutlineNavigation();
    expect(vi.getTimerCount()).toBe(0);

    resolveCurrentHeading.mockClear();
    vi.advanceTimersByTime(1000);
    expect(resolveCurrentHeading).not.toHaveBeenCalled();
    expect(followMocks.keepFollowing).not.toHaveBeenCalled();
  });

  it('cancels the older retry timer immediately when a newer outline jump supersedes it', () => {
    const staleA = document.createElement('h2');
    const staleB = document.createElement('h2');
    const headingB = document.createElement('h2');
    headingB.scrollIntoView = vi.fn();

    const resolverA = vi.fn(() => null);
    let bCalls = 0;
    const resolverB = vi.fn(() => {
      bCalls += 1;
      // Calls 1 & 2 happen synchronously on jumpToOutlineEntry; call 3 is the 250ms retry.
      return bCalls >= 3 ? headingB : null;
    });

    jumpToOutlineEntry({ element: staleA, text: 'A' }, 1, resolverA);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(100);
    jumpToOutlineEntry({ element: staleB, text: 'B' }, 4, resolverB);

    // Jump A's timer must have been cleared; only Jump B's timer remains.
    expect(vi.getTimerCount()).toBe(1);

    resolverA.mockClear();
    vi.advanceTimersByTime(250);

    expect(resolverA).not.toHaveBeenCalled();
    expect(headingB.scrollIntoView).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves zero pending timers after exhausting all 16 retry attempts', () => {
    const staleHeading = document.createElement('h2');
    const resolveCurrentHeading = vi.fn(() => null);

    jumpToOutlineEntry(
      { element: staleHeading, text: 'Missing' },
      7,
      resolveCurrentHeading
    );
    expect(vi.getTimerCount()).toBe(1);

    // 15 retry intervals of 250ms cover attempts 16 down to 1.
    vi.advanceTimersByTime(15 * 250);
    expect(vi.getTimerCount()).toBe(0);

    // Advancing further must not invoke resolver again.
    const callsAtExhaustion = resolveCurrentHeading.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(resolveCurrentHeading).toHaveBeenCalledTimes(callsAtExhaustion);
  });

  it('preserves a reentrant Jump B started synchronously during Jump A retry callback', () => {
    const staleA = document.createElement('h2');
    const staleB = document.createElement('h2');
    const headingB = document.createElement('h2');
    headingB.scrollIntoView = vi.fn();

    let bCalls = 0;
    const resolverB = vi.fn(() => {
      bCalls += 1;
      // Calls 1 & 2 happen synchronously; call 3 runs on Jump B's 250ms retry.
      return bCalls >= 3 ? headingB : null;
    });

    let aCalls = 0;
    const resolverA = vi.fn(() => {
      aCalls += 1;
      if (aCalls === 3) {
        // Trigger Jump B synchronously inside Jump A's first 250ms retry callback.
        jumpToOutlineEntry({ element: staleB, text: 'B' }, 8, resolverB);
      }
      return null;
    });

    jumpToOutlineEntry({ element: staleA, text: 'A' }, 3, resolverA);
    expect(vi.getTimerCount()).toBe(1);

    // Fire Jump A's retry callback -> starts Jump B; Jump A must NOT cancel Jump B or reschedule itself.
    vi.advanceTimersByTime(250);
    expect(vi.getTimerCount()).toBe(1);

    // Fire Jump B's retry callback -> resolves Jump B cleanly.
    vi.advanceTimersByTime(250);
    expect(headingB.scrollIntoView).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
