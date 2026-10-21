/**
 * @vitest-environment jsdom
 * Checks the small text-free right-edge handle and legacy position restore.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';

afterEach(() => {
  document.body.textContent = '';
  sessionStorage.removeItem('chatTocToggleButtonPosition');
});

describe('slim sidebar reveal handle', () => {
  it('creates an unlabeled visual trigger with an accessible name', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      left: 120, top: 240,
    }));
    const trigger = createSidebarToggleButton();
    const dock = trigger.parentElement!;

    expect(dock.id).toBe('luna-toc-floating-dock');
    expect(trigger.id).toBe('luna-toc-toggle-btn');
    expect(trigger.getAttribute('aria-label')).toBe('展开目录');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toBe('');
    expect(trigger.querySelector('svg')).toBeNull();
    expect(dock.style.top).toBe('240px');
    expect(dock.style.left).toBe('');
    expect(dock.style.right).toBe('');
  });

  it('preserves an existing vertical ratio after window resize', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      topRatio: 1,
    }));
    const trigger = createSidebarToggleButton();
    const dock = trigger.parentElement!;
    const expectedTop = window.innerHeight - 42 - 8;
    expect(dock.style.top).toBe(`${expectedTop}px`);

    window.dispatchEvent(new Event('resize'));
    expect(dock.style.top).toBe(`${expectedTop}px`);
  });

  it('ignores horizontal positions from previous floating button versions', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      left: 60, top: 135,
    }));
    const trigger = createSidebarToggleButton();
    expect(trigger.parentElement?.style.left).toBe('');
    expect(trigger.parentElement?.style.top).toBe('135px');
  });
});
