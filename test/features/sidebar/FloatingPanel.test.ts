/**
 * @vitest-environment jsdom
 * Tests pop-out tools remain adjacent to the sidebar and hidden by default.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initFloatingPanel,
  setFloatingPanelVisible,
} from '@/features/sidebar/FloatingPanel';

afterEach(() => {
  document.body.textContent = '';
  sessionStorage.removeItem('chatTocJumpControlsPosition');
  vi.restoreAllMocks();
});

describe('sidebar pop-out toolbar', () => {
  it('moves outside the clipping sidebar and tracks its width on resize', () => {
    document.body.innerHTML = `
      <div id="luna-toc-sidebar">
        <div class="navigator-jump-controls">
          <button id="jump-chat-top-btn">Top</button>
        </div>
      </div>
    `;
    const sidebar = document.getElementById('luna-toc-sidebar')!;
    const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
    let width = 310;
    Object.defineProperty(sidebar, 'offsetWidth', {
      configurable: true, get: () => width,
    });

    initFloatingPanel();

    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.right).toBe('310px');
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.inert).toBe(true);

    setFloatingPanelVisible(true);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.inert).toBe(false);

    width = 450;
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.right).toBe('450px');

    setFloatingPanelVisible(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.inert).toBe(true);
  });
});
