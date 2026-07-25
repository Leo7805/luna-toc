/** @vitest-environment jsdom */
/** Tests child-outline navigation across ChatGPT virtual DOM replacement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const promptNavigationMocks = vi.hoisted(() => ({
  jumpToPromptIndex: vi.fn(),
  lockPromptIndex: vi.fn(),
}));

vi.mock('@/features/navigation/promptNavigation', () => promptNavigationMocks);

import {
  cancelOutlineNavigation,
  jumpToOutlineEntry,
} from '@/features/navigation/outlineNavigation';

beforeEach(() => {
  vi.useFakeTimers();
  promptNavigationMocks.jumpToPromptIndex.mockReset();
  promptNavigationMocks.lockPromptIndex.mockReset();
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
    expect(promptNavigationMocks.lockPromptIndex).toHaveBeenCalledWith(3);
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
    expect(promptNavigationMocks.lockPromptIndex).toHaveBeenCalledWith(5);
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
});
