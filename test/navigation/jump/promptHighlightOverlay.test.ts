/** @vitest-environment jsdom */
/**
 * Tests promptHighlightOverlay lifecycle, identity-safe DOM replacement
 * reattachment, timer preservation, and cancellation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPromptHighlightOverlay,
  DEFAULT_HIGHLIGHT_DURATION_MS,
  highlightPromptElement,
} from '@/navigation/jump/promptHighlightOverlay';

describe('promptHighlightOverlay', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 1000, bottom: 900, width: 1000, height: 900 } as DOMRect);
    document.body.appendChild(container);
  });

  afterEach(() => {
    clearPromptHighlightOverlay();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('reattaches to a replacement DOM node resolved by stable identity without extending expiration', () => {
    const initialEl = document.createElement('div');
    initialEl.getBoundingClientRect = () =>
      ({ top: 136, left: 100, right: 700, bottom: 200, width: 600, height: 64 } as DOMRect);
    container.appendChild(initialEl);

    const replacementEl = document.createElement('div');
    replacementEl.getBoundingClientRect = () =>
      ({ top: 140, left: 100, right: 700, bottom: 204, width: 600, height: 64 } as DOMRect);

    let liveNode: HTMLElement | null = initialEl;
    highlightPromptElement(initialEl, () => container, DEFAULT_HIGHLIGHT_DURATION_MS, () => liveNode);

    const overlay = document.querySelector<HTMLDivElement>(
      '[data-luna-toc-highlight-overlay="true"]'
    );
    expect(overlay).not.toBeNull();
    expect(overlay!.style.top).toBe('136px');

    // Advance 1500ms, then React/virtualizer replaces the prompt DOM node
    vi.advanceTimersByTime(1500);
    initialEl.remove();
    container.appendChild(replacementEl);
    liveNode = replacementEl;

    // Scroll sync triggers updateHighlightPosition -> reattaches to replacementEl
    container.dispatchEvent(new Event('scroll'));
    const liveOverlay = document.querySelector<HTMLDivElement>(
      '[data-luna-toc-highlight-overlay="true"]'
    );
    expect(liveOverlay).toBe(overlay);
    expect(liveOverlay!.style.top).toBe('140px');

    // Original 2500ms budget must expire after the remaining 1000ms (not extended)
    vi.advanceTimersByTime(999);
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).toBeNull();
  });

  it('tears down cleanly when target disconnects and resolver returns null', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ top: 190, left: 100, right: 700, bottom: 250, width: 600, height: 60 } as DOMRect);
    container.appendChild(el);

    highlightPromptElement(el, () => container, DEFAULT_HIGHLIGHT_DURATION_MS, () => null);
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).not.toBeNull();

    el.remove();
    container.dispatchEvent(new Event('scroll'));
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).toBeNull();
  });

  it('clears overlay immediately on clearPromptHighlightOverlay()', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ top: 190, left: 100, right: 700, bottom: 250, width: 600, height: 60 } as DOMRect);
    container.appendChild(el);

    highlightPromptElement(el, () => container);
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).not.toBeNull();

    clearPromptHighlightOverlay();
    expect(
      document.querySelector('[data-luna-toc-highlight-overlay="true"]')
    ).toBeNull();
  });
});
