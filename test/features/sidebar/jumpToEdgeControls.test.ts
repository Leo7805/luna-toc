/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigatorMocks = vi.hoisted(() => ({
  jumpToAbsoluteEdge: vi.fn(),
  jumpToEdge: vi.fn(),
  jumpToLastPrompt: vi.fn(),
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
    ).toBe('跳转到顶部');
    expect(
      document.getElementById('jump-chat-bottom-btn')?.getAttribute('aria-label')
    ).toBe('跳转到底部');
  });

  it('delegates single clicks immediately to jumpToEdge without timer delay', () => {
    createJumpToEdgeControls(() => false);

    document.getElementById('jump-chat-top-btn')?.click();
    expect(navigatorMocks.jumpToEdge).toHaveBeenCalledWith('top');

    document.getElementById('jump-chat-bottom-btn')?.click();
    expect(navigatorMocks.jumpToEdge).toHaveBeenCalledWith('bottom');
    expect(navigatorMocks.jumpToLastPrompt).not.toHaveBeenCalled();
  });

  it('delegates double-click on bottom to jumpToLastPrompt while click events invoke physical-bottom', () => {
    createJumpToEdgeControls(() => false);

    const bottomBtn = document.getElementById('jump-chat-bottom-btn')!;

    // Browser event sequence: click -> click -> dblclick
    bottomBtn.click();
    bottomBtn.click();
    bottomBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(navigatorMocks.jumpToEdge).toHaveBeenCalledTimes(2);
    expect(navigatorMocks.jumpToEdge).toHaveBeenCalledWith('bottom');
    expect(navigatorMocks.jumpToLastPrompt).toHaveBeenCalledOnce();
  });

  it('delegates double-click on top to jumpToAbsoluteEdge', () => {
    createJumpToEdgeControls(() => false);

    document
      .getElementById('jump-chat-top-btn')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(navigatorMocks.jumpToAbsoluteEdge).toHaveBeenCalledWith('top');
  });

  it('scrolls the sidebar list immediately while My Prompts is active', () => {
    const list = document.getElementById('navigator-list') as HTMLElement;
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;
    Object.defineProperty(list, 'scrollHeight', { value: 480 });

    createJumpToEdgeControls(() => true);
    document.getElementById('jump-chat-top-btn')?.click();
    document.getElementById('jump-chat-bottom-btn')?.click();
    document
      .getElementById('jump-chat-bottom-btn')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(scrollTo).toHaveBeenNthCalledWith(1, {
      top: 0,
      behavior: 'smooth',
    });
    expect(scrollTo).toHaveBeenNthCalledWith(2, {
      top: 480,
      behavior: 'smooth',
    });
    expect(scrollTo).toHaveBeenNthCalledWith(3, {
      top: 480,
      behavior: 'auto',
    });
    expect(navigatorMocks.jumpToEdge).not.toHaveBeenCalled();
    expect(navigatorMocks.jumpToAbsoluteEdge).not.toHaveBeenCalled();
    expect(navigatorMocks.jumpToLastPrompt).not.toHaveBeenCalled();
  });
});
