/**
 * @vitest-environment jsdom
 * Verifies the fixed full-height sidebar edge trigger.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';

afterEach(() => { document.body.textContent = ''; });

describe('edge-mounted sidebar rail', () => {
  it('creates a full-height rail without restoring a draggable position', () => {
    sessionStorage.setItem('chatTocToggleButtonPosition', JSON.stringify({
      left: 120, top: 240,
    }));
    const rail = createSidebarToggleButton();

    expect(rail.id).toBe('luna-toc-toggle-btn');
    expect(rail.getAttribute('aria-expanded')).toBe('false');
    expect(rail.getAttribute('aria-label')).toBe('展开目录');
    expect(rail.style.left).toBe('');
    expect(rail.style.top).toBe('');
    expect(rail.style.right).toBe('');
    expect(rail.textContent).toContain('目录');
    sessionStorage.removeItem('chatTocToggleButtonPosition');
  });
});
