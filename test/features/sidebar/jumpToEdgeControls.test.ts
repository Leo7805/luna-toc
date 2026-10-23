/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollNavigatorListToEdge } from '@/features/sidebar/jumpToEdgeControls';

describe('scrollNavigatorListToEdge', () => {
  let myPromptsList: HTMLElement;
  let navigatorList: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="navigator-list"></div>
      <div id="myprompts-list"></div>
    `;
    myPromptsList = document.getElementById('myprompts-list')!;
    navigatorList = document.getElementById('navigator-list')!;
  });

  it('scrolls #myprompts-list to top (0) with smooth behavior by default', () => {
    const scrollToMock = vi.fn();
    myPromptsList.scrollTo = scrollToMock;

    scrollNavigatorListToEdge('top');

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
  });

  it('scrolls #myprompts-list to scrollHeight on bottom with custom behavior', () => {
    const scrollToMock = vi.fn();
    myPromptsList.scrollTo = scrollToMock;
    Object.defineProperty(myPromptsList, 'scrollHeight', { value: 750, configurable: true });

    scrollNavigatorListToEdge('bottom', 'auto');

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 750,
      behavior: 'auto',
    });
  });

  it('falls back to #navigator-list when #myprompts-list is absent', () => {
    myPromptsList.remove();
    const scrollToMock = vi.fn();
    navigatorList.scrollTo = scrollToMock;
    Object.defineProperty(navigatorList, 'scrollHeight', { value: 500, configurable: true });

    scrollNavigatorListToEdge('bottom');

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 500,
      behavior: 'smooth',
    });
  });

  it('handles absent list gracefully without throwing', () => {
    document.body.innerHTML = '';
    expect(() => scrollNavigatorListToEdge('top')).not.toThrow();
  });
});
