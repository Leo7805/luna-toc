/**
 * @vitest-environment jsdom
 * Tests that the three controls follow the compact moon rather than the sidebar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';
import {
  initFloatingPanel,
  setFloatingPanelVisible,
} from '@/features/sidebar/FloatingPanel';

afterEach(() => {
  document.body.textContent = '';
  sessionStorage.removeItem('chatTocToggleButtonPosition');
  vi.restoreAllMocks();
});

describe('moon-attached pop-out toolbar', () => {
  it('shares the moon dock, not the sidebar, and defaults to hidden', () => {
    document.body.innerHTML = `
      <div id="luna-toc-sidebar">
        <div class="navigator-jump-controls">
          <button id="jump-chat-top-btn">Top</button>
          <button id="toggle-view-mode-btn">Prompts</button>
          <button id="jump-chat-bottom-btn">Bottom</button>
        </div>
      </div>
    `;
    const moon = createSidebarToggleButton();
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    initFloatingPanel();

    expect(panel.parentElement).toBe(moon.parentElement);
    expect(panel.closest('#luna-toc-sidebar')).toBeNull();
    expect(Array.from(panel.querySelectorAll('button')).map(el => el.id))
      .toEqual(['jump-chat-top-btn', 'toggle-view-mode-btn', 'jump-chat-bottom-btn']);
    expect(panel.style.right).toBe('');
    expect(panel.style.top).toBe('');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.inert).toBe(true);

    setFloatingPanelVisible(true);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    expect(panel.inert).toBe(false);
    setFloatingPanelVisible(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('drags the whole moon dock when pulling the toolbar background', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({ top: 200 }));
    document.body.innerHTML = `
      <div id="luna-toc-sidebar"><div class="navigator-jump-controls">
        <button id="jump-chat-top-btn">Top</button>
      </div></div>
    `;
    const moon = createSidebarToggleButton();
    const dock = moon.parentElement!;
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    initFloatingPanel();

    vi.spyOn(dock, 'getBoundingClientRect').mockImplementation(() =>
      ({ top: Number.parseFloat(dock.style.top), height: 42 }) as DOMRect
    );

    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
    panel.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientY: 160 }));
    panel.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientY: 160 }));

    expect(dock.style.top).toBe('260px');
    expect(panel.parentElement).toBe(dock);
    expect(JSON.parse(sessionStorage.getItem('chatTocToggleButtonPosition')!).top).toBe(260);
  });
});
