/**
 * Tests generic host-page fullscreen media overlay detection.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('does not trigger ancestor querySelector scans or overlay sync on deep unrelated streaming mutations', async () => {
    // Build a realistic 6-level ChatGPT-like DOM subtree under document.body
    const root = document.createElement('div');
    root.id = 'root';
    const main = document.createElement('main');
    const thread = document.createElement('div');
    const article = document.createElement('article');
    const markdown = document.createElement('div');
    const paragraph = document.createElement('p');
    markdown.appendChild(paragraph);
    article.appendChild(markdown);
    thread.appendChild(article);
    main.appendChild(thread);
    root.appendChild(main);
    document.body.appendChild(root);

    const disconnect = observeExternalOverlays();

    const qsSpy = vi.spyOn(Element.prototype, 'querySelector');
    const qsaSpy = vi.spyOn(document, 'querySelectorAll');

    // Simulate 100 unrelated ChatGPT streaming mutations (text, leaf spans, class/style toggles)
    for (let i = 0; i < 50; i += 1) {
      const token = document.createElement('span');
      token.textContent = `word-${i} `;
      paragraph.appendChild(token);
      paragraph.className = `streaming-${i}`;
      markdown.style.opacity = i % 2 === 0 ? '1' : '0.99';
    }

    await Promise.resolve();

    // Unrelated streaming mutations must perform zero querySelector scans and zero syncs.
    expect(qsSpy).toHaveBeenCalledTimes(0);
    expect(qsaSpy).toHaveBeenCalledTimes(0);
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    qsSpy.mockRestore();
    qsaSpy.mockRestore();
    disconnect();
  });

  it('does not rescan or resync on unrelated deep mutations even while a lightbox is open', async () => {
    const root = document.createElement('div');
    const article = document.createElement('article');
    const paragraph = document.createElement('p');
    article.appendChild(paragraph);
    root.appendChild(article);

    const lightboxWrapper = document.createElement('div');
    const lightbox = createLightboxOverlay();
    lightboxWrapper.appendChild(lightbox);
    document.body.append(root, lightboxWrapper);

    const disconnect = observeExternalOverlays();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    const qsSpy = vi.spyOn(Element.prototype, 'querySelector');
    const qsaSpy = vi.spyOn(document, 'querySelectorAll');

    for (let i = 0; i < 30; i += 1) {
      paragraph.className = `tick-${i}`;
      const span = document.createElement('span');
      span.textContent = `${i}`;
      paragraph.appendChild(span);
    }

    await Promise.resolve();

    expect(qsSpy).toHaveBeenCalledTimes(0);
    expect(qsaSpy).toHaveBeenCalledTimes(0);
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    qsSpy.mockRestore();
    qsaSpy.mockRestore();
    disconnect();
  });

  it('detects attribute-based opening and closing for body overlays and hidden-then-shown lightboxes', async () => {
    const disconnect = observeExternalOverlays();

    // 1. Body-level overlay toggled via data-state attribute
    const bodyOverlay = document.createElement('div');
    bodyOverlay.dataset.state = 'closed';
    bodyOverlay.style.display = 'flex';
    bodyOverlay.style.position = 'fixed';
    bodyOverlay.appendChild(document.createElement('img'));
    bodyOverlay.getBoundingClientRect = () =>
      ({
        width: window.innerWidth,
        height: window.innerHeight,
      }) as DOMRect;
    document.body.appendChild(bodyOverlay);
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    bodyOverlay.dataset.state = 'open';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    bodyOverlay.dataset.state = 'closed';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);
    bodyOverlay.remove();

    // 2. Nested lightbox inserted hidden, then revealed and hidden via style
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const lightbox = createLightboxOverlay();
    lightbox.style.display = 'none';
    wrapper.appendChild(lightbox);
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    lightbox.style.display = 'flex';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

    lightbox.style.display = 'none';
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

    disconnect();
  });

  it('settles accurately across rapid open and close transitions', async () => {
    const disconnect = observeExternalOverlays();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);

    for (let i = 0; i < 5; i += 1) {
      const overlay = createLightboxOverlay();
      wrapper.appendChild(overlay);
      await Promise.resolve();
      expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(true);

      overlay.remove();
      await Promise.resolve();
      expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);
    }

    // Same-tick open + close settles to closed without stale state
    const transient = createLightboxOverlay();
    wrapper.appendChild(transient);
    transient.remove();
    await Promise.resolve();
    expect(document.documentElement.classList.contains(OVERLAY_CLASS)).toBe(false);

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
