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
  document.body.style.pointerEvents = '';
  document.documentElement.classList.remove(OVERLAY_CLASS);
});

describe('isFullscreenMediaOverlay', () => {
  it('accepts the original open body-level Prompt image layer', () => {
    const overlay = createOverlay();

    expect(isFullscreenMediaOverlay(overlay)).toBe(true);
  });

  it('rejects an open page layer that is not fullscreen media', () => {
    const overlay = createOverlay({ includeImage: false });

    expect(isFullscreenMediaOverlay(overlay)).toBe(false);
  });

  it('accepts an absolute fullscreen image lightbox with a close control', () => {
    const overlay = createLightboxOverlay();

    expect(isFullscreenMediaOverlay(overlay)).toBe(true);
  });

  it('rejects a non-fullscreen image gallery with a close control', () => {
    const overlay = createLightboxOverlay({ fullscreen: false });

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

  it('tracks a nested fullscreen image lightbox', async () => {
    const disconnect = observeExternalOverlays();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const overlay = createLightboxOverlay();
    wrapper.appendChild(overlay);

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

  it('tracks body pointer-events: none as an active external overlay and recovers on restore', async () => {
    const disconnect = observeExternalOverlays();

    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    // Host page disables body pointer interaction (e.g. ChatGPT image preview opens)
    document.body.style.pointerEvents = 'none';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    // Host page restores normal body pointer interaction (e.g. image preview closes)
    document.body.style.pointerEvents = '';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    disconnect();
  });

  it('does not activate overlay state during normal browsing when body pointer-events is auto', () => {
    const disconnect = observeExternalOverlays();

    document.body.style.pointerEvents = 'auto';
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    disconnect();
  });

  it('removes the overlay class and stops observing on disconnect', async () => {
    document.body.style.pointerEvents = 'none';
    const disconnect = observeExternalOverlays();

    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    disconnect();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    document.body.style.pointerEvents = 'auto';
    await Promise.resolve();

    document.body.style.pointerEvents = 'none';
    await Promise.resolve();

    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);
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

function createLightboxOverlay({
  fullscreen = true,
}: {
  fullscreen?: boolean;
} = {}): HTMLDivElement {
  const overlay = document.createElement('div');
  const closeButton = document.createElement('button');
  closeButton.dataset.lightboxCloseButton = 'true';
  overlay.style.display = 'flex';
  overlay.style.position = 'absolute';
  overlay.append(closeButton, document.createElement('img'));
  overlay.getBoundingClientRect = () =>
    ({
      width: fullscreen ? window.innerWidth : window.innerWidth / 2,
      height: fullscreen ? window.innerHeight : window.innerHeight / 2,
    }) as DOMRect;
  return overlay;
}
