/**
 * Tests generic host-page fullscreen media overlay detection.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  isFullscreenMediaOverlay,
  observeExternalOverlays,
} from '@/features/externalOverlay';

const OVERLAY_CLASS = 'luna-toc-external-overlay-open';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove(OVERLAY_CLASS);
});

describe('isFullscreenMediaOverlay', () => {
  it('accepts an open fixed image layer covering most of the viewport', () => {
    const overlay = createOverlay();

    expect(isFullscreenMediaOverlay(overlay)).toBe(true);
  });

  it('rejects an open page layer that is not fullscreen media', () => {
    const overlay = createOverlay({ includeImage: false });

    expect(isFullscreenMediaOverlay(overlay)).toBe(false);
  });
});

describe('observeExternalOverlays', () => {
  it('mirrors the external overlay state onto the document root', async () => {
    const disconnect = observeExternalOverlays();
    const overlay = createOverlay();

    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(
      true
    );

    overlay.remove();
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(
      false
    );

    disconnect();
  });
});

function createOverlay({
  includeImage = true,
}: {
  includeImage?: boolean;
} = {}): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.dataset.state = 'open';
  overlay.style.display = 'flex';
  overlay.style.position = 'fixed';
  if (includeImage) overlay.appendChild(document.createElement('img'));
  overlay.getBoundingClientRect = () =>
    ({
      width: window.innerWidth,
      height: window.innerHeight,
    }) as DOMRect;
  document.body.appendChild(overlay);
  return overlay;
}
