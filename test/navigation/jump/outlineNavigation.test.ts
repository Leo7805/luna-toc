/** @vitest-environment jsdom */
/** Tests precise heading positioning and cancellation of the parent virtual walker. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const promptNavigationMocks = vi.hoisted(() => ({
  jumpToPromptIndex: vi.fn(),
  cancelPromptNavigation: vi.fn(),
}));
const followMocks = vi.hoisted(() => ({ keepFollowing: vi.fn() }));
const platformMocks = vi.hoisted(() => ({ getActivePlatform: vi.fn() }));

vi.mock('@/navigation/jump/promptNavigation', () => promptNavigationMocks);
vi.mock('@/navigation/follow/follow', () => followMocks);
vi.mock('@/platforms', () => platformMocks);

import { cancelOutlineNavigation, jumpToOutlineEntry } from '@/navigation/jump/outlineNavigation';

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  promptNavigationMocks.jumpToPromptIndex.mockReset();
  promptNavigationMocks.jumpToPromptIndex.mockReturnValue(true);
  promptNavigationMocks.cancelPromptNavigation.mockReset();
  followMocks.keepFollowing.mockReset();

  container = document.createElement('div');
  container.className = 'thread-scroll-container';
  container.scrollTop = 100;
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 3000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
  container.getBoundingClientRect = () => ({ top: 100, bottom: 700, height: 600 } as DOMRect);
  document.body.appendChild(container);

  platformMocks.getActivePlatform.mockReturnValue({
    navigation: {
      getThreadScrollContainer: () => container,
      getScrollContainer: () => container,
    },
  });
});

afterEach(() => {
  cancelOutlineNavigation();
  vi.useRealTimers();
  document.body.textContent = '';
  vi.restoreAllMocks();
});

function headingAt(top: number): HTMLElement {
  const heading = document.createElement('h2');
  heading.textContent = 'Section';
  heading.getBoundingClientRect = () => ({ top, bottom: top + 30, height: 30 } as DOMRect);
  container.appendChild(heading);
  return heading;
}

describe('outline navigation', () => {
  it('positions a live heading inside the conversation scroll container, without animation', () => {
    const heading = headingAt(400);
    const resolveCurrentHeading = vi.fn(() => heading);
    const scrollIntoView = vi.fn();
    heading.scrollIntoView = scrollIntoView;

    jumpToOutlineEntry({ element: heading, text: 'Section' }, 3, resolveCurrentHeading);

    expect(resolveCurrentHeading).toHaveBeenCalled();
    expect(promptNavigationMocks.jumpToPromptIndex).not.toHaveBeenCalled();
    expect(promptNavigationMocks.cancelPromptNavigation).toHaveBeenCalledOnce();
    expect(container.scrollTop).toBe(328); // 100 + 400 - 100 - 72
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(heading.classList.contains('chat-toc-outline-heading-highlight')).toBe(true);
  });

  it('clears the yellow heading highlight after the same 600ms as prompt highlights', () => {
    const heading = headingAt(400);
    jumpToOutlineEntry({ element: heading, text: 'Section' }, 3, () => heading);

    expect(heading.classList.contains('chat-toc-outline-heading-highlight')).toBe(true);
    vi.advanceTimersByTime(599);
    expect(heading.classList.contains('chat-toc-outline-heading-highlight')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(heading.classList.contains('chat-toc-outline-heading-highlight')).toBe(false);
  });

  it('never follows a connected stale cached heading if the live resolver selects another', () => {
    const oldHeading = headingAt(200);
    const actualHeading = headingAt(600);
    jumpToOutlineEntry({ element: oldHeading, text: 'Section' }, 2, () => actualHeading);

    expect(container.scrollTop).toBe(528);
    expect(oldHeading.classList.contains('chat-toc-outline-heading-highlight')).toBe(false);
    expect(actualHeading.classList.contains('chat-toc-outline-heading-highlight')).toBe(true);
  });

  it('waits for a virtual heading and cancels its parent walker before landing', () => {
    const staleHeading = document.createElement('h2');
    let mounted: HTMLElement | null = null;
    const resolveCurrentHeading = vi.fn(() => mounted);

    jumpToOutlineEntry({ element: staleHeading, text: 'Section' }, 5, resolveCurrentHeading);
    expect(promptNavigationMocks.jumpToPromptIndex).toHaveBeenCalledWith(5, 10000);
    expect(promptNavigationMocks.cancelPromptNavigation).not.toHaveBeenCalled();

    mounted = headingAt(450);
    vi.advanceTimersByTime(250);
    expect(promptNavigationMocks.cancelPromptNavigation).toHaveBeenCalledOnce();
    expect(container.scrollTop).toBe(378);
  });

  it('does not retry a cancelled heading jump', () => {
    const resolver = vi.fn(() => null);
    jumpToOutlineEntry({ text: 'Section' }, 1, resolver);
    cancelOutlineNavigation();

    vi.advanceTimersByTime(1000);
    expect(resolver).toHaveBeenCalledTimes(2); // initial attempt + immediate retry
  });
});
