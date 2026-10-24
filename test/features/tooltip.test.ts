/**
 * @vitest-environment jsdom
 */
/**
 * Tests shared tooltip visibility helpers and previewTooltip lifecycles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isElementTextTruncated, previewTooltip } from '@/features/tooltip';

describe('isElementTextTruncated', () => {
  it('returns true when content is wider than the visible element', () => {
    const element = {
      clientWidth: 120,
      scrollWidth: 180,
    } as HTMLElement;

    expect(isElementTextTruncated(element)).toBe(true);
  });

  it('returns false when the full content fits', () => {
    const element = {
      clientWidth: 120,
      scrollWidth: 120,
    } as HTMLElement;

    expect(isElementTextTruncated(element)).toBe(false);
  });
});

describe('previewTooltip immediate vs delayed hide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    previewTooltip.init();
  });

  afterEach(() => {
    previewTooltip.hide(true);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('preserves 200ms delay when hide() is called without arguments', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;
    expect(tooltip).not.toBeNull();

    // Trigger show
    previewTooltip.show('Sample preview text', new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(500);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);

    // Call hide() without arguments
    previewTooltip.hide();

    // Still visible before 200ms
    vi.advanceTimersByTime(100);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);

    // Hidden after 200ms
    vi.advanceTimersByTime(100);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });

  it('dismisses immediately when hide(true) is called', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;
    expect(tooltip).not.toBeNull();

    previewTooltip.show('Sample preview text', new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(500);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);

    // Call hide(true)
    previewTooltip.hide(true);

    // Hidden immediately without advancing timer
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });
});
