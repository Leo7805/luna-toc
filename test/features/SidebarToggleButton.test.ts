/**
 * @vitest-environment jsdom
 * Checks the fixed, empty right-edge handle independently from old saved positions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';

afterEach(() => {
  document.body.textContent = '';
  sessionStorage.removeItem('chatTocToggleButtonPosition');
});

describe('fixed sidebar reveal handle', () => {
  it('creates an accessible text-free trigger', () => {
    const trigger = createSidebarToggleButton();
    const dock = trigger.parentElement!;

    expect(dock.id).toBe('luna-toc-floating-dock');
    expect(trigger.id).toBe('luna-toc-toggle-btn');
    expect(trigger.type).toBe('button');
    expect(trigger.getAttribute('aria-label')).toBe('展开目录');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toBe('');
    expect(trigger.querySelector('svg')).toBeNull();
  });

  it('ignores saved drag offsets and remains CSS-centered on resize', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      left: 45, top: 160, topRatio: 1,
    }));
    const dock = createSidebarToggleButton().parentElement!;
    expect(dock.getAttribute('style')).toBeNull();
    window.dispatchEvent(new Event('resize'));
    expect(dock.getAttribute('style')).toBeNull();
  });
});
