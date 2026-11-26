/**
 * @vitest-environment jsdom
 */
/**
 * Tests shared tooltip visibility helpers and previewTooltip lifecycles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buttonTooltip,
  isElementTextTruncated,
  previewTooltip,
} from '@/features/tooltip';

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

  it('does not show preview tooltip if anchorElement is detached before 500ms delay completes', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);

    previewTooltip.show(
      'Detached prompt text',
      new MouseEvent('mouseenter', { clientX: 120, clientY: 140 }),
      anchor
    );

    // Anchor is removed (e.g. TOC re-render / React unmount) before 500ms timer fires
    anchor.remove();
    vi.advanceTimersByTime(500);

    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });

  it('does not show preview tooltip if tooltip DOM node is detached before 500ms delay completes', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;

    previewTooltip.show(
      'Orphaned tooltip text',
      new MouseEvent('mouseenter', { clientX: 120, clientY: 140 })
    );

    tooltip.remove();
    vi.advanceTimersByTime(500);

    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });

  it('cancels earlier pending show timer on rapid hover switching and renders only the latest target', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;
    const anchorA = document.createElement('div');
    const anchorB = document.createElement('div');
    document.body.append(anchorA, anchorB);

    previewTooltip.show(
      'Prompt A',
      new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }),
      anchorA
    );
    vi.advanceTimersByTime(300);

    previewTooltip.show(
      'Prompt B',
      new MouseEvent('mouseenter', { clientX: 100, clientY: 160 }),
      anchorB
    );
    vi.advanceTimersByTime(250);
    // Still waiting for B's 500ms delay (A's timer must have been cancelled)
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);

    vi.advanceTimersByTime(250);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);
    expect(tooltip.textContent).toBe('Prompt B');
  });

  it('cancels pending 500ms show timer when hide() is called before delay completes', () => {
    const tooltip = document.getElementById('luna-toc-preview-tooltip') as HTMLElement;

    previewTooltip.show(
      'Cancelled prompt',
      new MouseEvent('mouseenter', { clientX: 100, clientY: 100 })
    );
    vi.advanceTimersByTime(200);
    previewTooltip.hide();

    vi.advanceTimersByTime(600);
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });
});

describe('buttonTooltip lifecycle, hiding, and rebinding (Finding #5)', () => {
  let sidebar: HTMLDivElement;
  let sidebarButton: HTMLButtonElement;
  let externalButton: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('luna-toc-button-tooltip')?.remove();

    sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebarButton = document.createElement('button');
    sidebarButton.setAttribute('title', 'Switch to My Prompts');
    sidebar.appendChild(sidebarButton);

    externalButton = document.createElement('button');
    externalButton.setAttribute('title', 'External ChatGPT Button');

    document.body.append(sidebar, externalButton);
    buttonTooltip.init();
  });

  afterEach(() => {
    buttonTooltip.hide();
    document.body.innerHTML = '';
    document.getElementById('luna-toc-button-tooltip')?.remove();
    vi.restoreAllMocks();
  });

  it('hides button tooltip when pointer moves from a LunaTOC button to an external element with a title', () => {
    const tooltip = document.getElementById('luna-toc-button-tooltip') as HTMLElement;
    expect(tooltip).not.toBeNull();

    sidebarButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);
    expect(tooltip.textContent).toBe('Switch to My Prompts');

    // Moving directly onto an external ChatGPT button with a title attribute must hide LunaTOC tooltip
    externalButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);
  });

  it('clears activeTarget on buttonTooltip.hide() so re-hovering the same button shows the tooltip again', () => {
    const tooltip = document.getElementById('luna-toc-button-tooltip') as HTMLElement;

    sidebarButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);

    buttonTooltip.hide();
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(false);

    // Re-hovering the same button must display the tooltip again
    sidebarButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);
    expect(tooltip.textContent).toBe('Switch to My Prompts');
  });

  it('is idempotent on repeated init() calls and safely rebinds when body or tooltip node is replaced', () => {
    const addListenerSpy = vi.spyOn(document.body, 'addEventListener');
    buttonTooltip.init();
    buttonTooltip.init();
    expect(addListenerSpy).not.toHaveBeenCalled();

    // Remove the tooltip DOM node and re-hover -> recreates and shows cleanly
    document.getElementById('luna-toc-button-tooltip')?.remove();
    sidebarButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const recreated = document.getElementById('luna-toc-button-tooltip') as HTMLElement;
    expect(recreated).not.toBeNull();
    expect(recreated.isConnected).toBe(true);
    expect(recreated.classList.contains('luna-toc-tooltip-visible')).toBe(true);

    // Replace document.body and call init() -> rebinds listeners to the new body
    const originalBody = document.body;
    const replacementBody = document.createElement('body');
    const newSidebar = document.createElement('div');
    newSidebar.id = 'luna-toc-sidebar';
    const newButton = document.createElement('button');
    newButton.setAttribute('title', 'Rebound Button');
    newSidebar.appendChild(newButton);
    replacementBody.appendChild(newSidebar);

    document.documentElement.replaceChild(replacementBody, originalBody);
    try {
      buttonTooltip.init();
      newButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const activeTooltip = document.getElementById('luna-toc-button-tooltip') as HTMLElement;
      expect(activeTooltip.classList.contains('luna-toc-tooltip-visible')).toBe(true);
      expect(activeTooltip.textContent).toBe('Rebound Button');
    } finally {
      document.documentElement.replaceChild(originalBody, replacementBody);
      buttonTooltip.init();
    }
  });
});
