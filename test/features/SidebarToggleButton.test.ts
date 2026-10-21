/**
 * @vitest-environment jsdom
 * Tests the partially hidden, viewport-docked, vertically draggable moon.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';

afterEach(() => {
  document.body.textContent = '';
  sessionStorage.removeItem('chatTocToggleButtonPosition');
  vi.restoreAllMocks();
});

describe('floating directory moon', () => {
  it('creates a compact moon inside a shared edge dock and restores only vertical position', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      left: 120,
      top: 240,
    }));
    const moon = createSidebarToggleButton();
    const dock = moon.parentElement!;

    expect(dock.id).toBe('luna-toc-floating-dock');
    expect(moon.id).toBe('luna-toc-toggle-btn');
    expect(moon.getAttribute('aria-label')).toBe('展开目录');
    expect(moon.getAttribute('aria-expanded')).toBe('false');
    expect(moon.querySelector('svg')).not.toBeNull();
    expect(moon.textContent).toContain('目录');
    expect(dock.style.top).toBe('240px');
    expect(dock.style.left).toBe('');
    expect(dock.style.right).toBe('');
  });

  it('drags the moon and shared dock vertically, without changing the edge alignment', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      top: 200,
    }));
    const moon = createSidebarToggleButton();
    const dock = moon.parentElement!;
    vi.spyOn(dock, 'getBoundingClientRect').mockImplementation(() =>
      ({ top: Number.parseFloat(dock.style.top), height: 42 }) as DOMRect
    );

    moon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
    moon.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, button: 0, clientY: 180 }));
    moon.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientY: 180 }));

    expect(dock.style.top).toBe('280px');
    expect(dock.style.right).toBe('');
    expect(moon.dataset.dragged).toBe('true');
    expect(JSON.parse(sessionStorage.getItem('chatTocToggleButtonPosition')!).top).toBe(280);
  });

  it('reclamps the saved vertical ratio on window resize', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      topRatio: 1,
    }));
    const moon = createSidebarToggleButton();
    const dock = moon.parentElement!;
    const expectedTop = window.innerHeight - 42 - 8;
    expect(dock.style.top).toBe(`${expectedTop}px`);

    window.dispatchEvent(new Event('resize'));
    expect(dock.style.top).toBe(`${expectedTop}px`);
  });
});
