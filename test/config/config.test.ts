/**
 * Tests invariants in the shared project configuration.
 */
import { describe, expect, it } from 'vitest';

import { APP_CONFIG } from '@/config/config';

describe('UI stacking configuration', () => {
  it('orders global LunaTOC surfaces by interaction priority', () => {
    const { baseZIndex, offsets } = APP_CONFIG.ui.stacking;
    const sidebar = baseZIndex + offsets.sidebar;
    const toggle = baseZIndex + offsets.toggle;
    const popover = baseZIndex + offsets.popover;
    const modal = baseZIndex + offsets.modal;

    expect(sidebar).toBeLessThan(toggle);
    expect(toggle).toBeLessThan(popover);
    expect(popover).toBeLessThan(modal);
  });
});
