/**
 * @vitest-environment jsdom
 * Tests moon hover visibility independently from the main sidebar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';
import { initFloatingPanel } from '@/features/sidebar/FloatingPanel';
import { initializeSidebarVisibility } from '@/features/sidebarVisibility';

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.removeItem('chatTocSidebarPinned');
  sessionStorage.removeItem('chatTocToggleButtonPosition');
  document.body.textContent = '';
});

describe('moon and sidebar hover behavior', () => {
  it('reveals the moon and tools on dock hover, retracts on leave, and leaves the sidebar independently hoverable', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="luna-toc-sidebar">
        <button id="luna-toc-sidebar-pin-btn"></button>
        <div class="navigator-jump-controls"></div>
      </div>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    const moon = createSidebarToggleButton();
    const dock = moon.parentElement!;
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    const onOpened = vi.fn();

    initFloatingPanel();
    initializeSidebarVisibility(sidebar, moon, { onOpened });

    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-open')).toBe(false);

    dock.dispatchEvent(new Event('pointerenter'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(onOpened).toHaveBeenCalledOnce();
    expect(dock.classList.contains('luna-toc-floating-dock-open')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('false');

    // Leaving the moon retracts only the moon/tools initially, not the sidebar.
    dock.dispatchEvent(new Event('pointerleave'));
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-open')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps tools accessible when keyboard focus enters the dock', () => {
    document.body.innerHTML = `
      <div id="luna-toc-sidebar">
        <button id="luna-toc-sidebar-pin-btn"></button>
        <div class="navigator-jump-controls"></div>
      </div>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    const moon = createSidebarToggleButton();
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    initFloatingPanel();
    initializeSidebarVisibility(sidebar, moon);
    const dock = moon.parentElement!;

    dock.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(panel.inert).toBe(false);
    expect(dock.classList.contains('luna-toc-floating-dock-open')).toBe(true);
    dock.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(panel.inert).toBe(true);
  });
});
