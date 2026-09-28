/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigatorMocks = vi.hoisted(() => ({
  jumpToAbsoluteEdge: vi.fn(),
  jumpToEdge: vi.fn(),
}));

vi.mock('@/navigation/navigatorController', () => ({
  navigatorController: navigatorMocks,
}));

import { createJumpToEdgeControls } from '@/features/sidebar/jumpToEdgeControls';

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <div class="navigator-jump-controls">
      <button id="toggle-view-mode-btn" type="button"></button>
    </div>
    <div id="navigator-list"></div>
  `;
});

describe('jump-to-edge controls', () => {
  it('creates the two controls around the view-mode button', () => {
    const cluster = createJumpToEdgeControls(() => false);

    expect(Array.from(cluster.children).map((element) => element.id)).toEqual([
      'jump-chat-top-btn',
      'toggle-view-mode-btn',
      'jump-chat-bottom-btn',
    ]);
    expect(
      document.getElementById('jump-chat-top-btn')?.getAttribute('aria-label')
    ).toBe('Jump to top');
    expect(
      document.getElementById('jump-chat-bottom-btn')?.getAttribute('aria-label')
    ).toBe('Jump to bottom');
  });

  it('delegates chat-view clicks to the navigator controller', () => {
    createJumpToEdgeControls(() => false);

    document.getElementById('jump-chat-top-btn')?.click();
    document
      .getElementById('jump-chat-bottom-btn')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(navigatorMocks.jumpToEdge).toHaveBeenCalledWith('top');
    expect(navigatorMocks.jumpToAbsoluteEdge).toHaveBeenCalledWith('bottom');
  });

  it('scrolls the sidebar list while My Prompts is active', () => {
    const list = document.getElementById('navigator-list') as HTMLElement;
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;
    Object.defineProperty(list, 'scrollHeight', { value: 480 });

    createJumpToEdgeControls(() => true);
    document.getElementById('jump-chat-top-btn')?.click();
    document
      .getElementById('jump-chat-bottom-btn')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(scrollTo).toHaveBeenNthCalledWith(1, {
      top: 0,
      behavior: 'smooth',
    });
    expect(scrollTo).toHaveBeenNthCalledWith(2, {
      top: 480,
      behavior: 'auto',
    });
    expect(navigatorMocks.jumpToEdge).not.toHaveBeenCalled();
    expect(navigatorMocks.jumpToAbsoluteEdge).not.toHaveBeenCalled();
  });
});
