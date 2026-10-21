/**
 * @vitest-environment jsdom
 * Verifies hover, pinning, and right-side toolbar visibility ownership.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';
import {
  initializeSidebarVisibility,
  setSidebarPinned,
} from '@/features/sidebarVisibility';

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.removeItem('chatTocSidebarPinned');
  sessionStorage.removeItem('chatTocToggleButtonPosition');
  document.body.textContent = '';
});

function setup(): {
  sidebar: HTMLElement;
  trigger: HTMLButtonElement;
  dock: HTMLElement;
  panel: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="luna-toc-sidebar">
      <button id="luna-toc-sidebar-pin-btn"></button>
      <div class="navigator-jump-controls">
        <button id="jump-chat-top-btn"></button>
        <button id="toggle-view-mode-btn"></button>
        <button id="jump-chat-bottom-btn"></button>
      </div>
    </div>
  `;
  const sidebar = document.getElementById('luna-toc-sidebar')!;
  const trigger = createSidebarToggleButton();
  const dock = trigger.parentElement!;
  const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
  return { sidebar, trigger, dock, panel };
}

describe('sidebar reveal handle and right-side tools', () => {
  it('opens from the slim trigger, hides only the trigger, and closes on pointer leave', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, dock, panel } = setup();
    const onOpened = vi.fn();
    initializeSidebarVisibility(sidebar, trigger, { onOpened });

    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
    expect(dock.getAttribute('aria-hidden')).toBe('false');
    expect(dock.inert).toBe(false);

    trigger.dispatchEvent(new Event('pointerenter'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(onOpened).toHaveBeenCalledOnce();
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);
    expect(dock.getAttribute('aria-hidden')).toBe('true');
    expect(dock.inert).toBe(true);

    // The tools stay inside the sidebar, visible and interactive with it.
    expect(panel.parentElement).toBe(sidebar);
    expect(Array.from(panel.querySelectorAll('button')).map(x => x.id))
      .toEqual(['jump-chat-top-btn', 'toggle-view-mode-btn', 'jump-chat-bottom-btn']);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.closest('[aria-hidden="true"]')).toBeNull();

    sidebar.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(panel.closest('[aria-hidden="true"]')).toBe(sidebar);
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
    expect(dock.inert).toBe(false);
  });

  it('keeps the trigger hidden for a pinned sidebar and restores it after unpinning', () => {
    const { sidebar, trigger, dock } = setup();
    initializeSidebarVisibility(sidebar, trigger);

    setSidebarPinned(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);

    setSidebarPinned(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
  });

  it('also opens from keyboard focus on the slim trigger', () => {
    const { sidebar, trigger, dock } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new FocusEvent('focus'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);
  });
});
