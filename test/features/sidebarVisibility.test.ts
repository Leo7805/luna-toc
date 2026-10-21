/**
 * @vitest-environment jsdom
 * Verifies edge-hover opening and pop-out toolbar pointer coordination.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initFloatingPanel } from '@/features/sidebar/FloatingPanel';
import { initializeSidebarVisibility } from '@/features/sidebarVisibility';

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.removeItem('chatTocSidebarPinned');
  document.body.textContent = '';
});

describe('sidebar edge-rail hover', () => {
  it('opens from the rail and hides pop-out tools after leaving both surfaces', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="luna-toc-sidebar">
        <button id="luna-toc-sidebar-pin-btn"></button>
        <div class="navigator-jump-controls"></div>
      </div>
      <button id="luna-toc-toggle-btn"></button>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    const rail = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    const onOpened = vi.fn();
    initFloatingPanel();
    initializeSidebarVisibility(sidebar, rail, { onOpened });

    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    rail.dispatchEvent(new Event('pointerenter'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(onOpened).toHaveBeenCalledOnce();
    sidebar.dispatchEvent(new Event('pointerenter'));
    expect(panel.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new MouseEvent('pointerleave', {
      relatedTarget: panel,
    }));
    panel.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');

    panel.dispatchEvent(new MouseEvent('pointerleave'));
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
  });
});
