/**
 * Detects host-page fullscreen media overlays and temporarily yields LunaTOC's
 * interface so native modal controls remain accessible.
 */

const EXTERNAL_OVERLAY_OPEN_CLASS = 'luna-toc-external-overlay-open';
const LIGHTBOX_CLOSE_SELECTOR = '[data-lightbox-close-button="true"]';
const MINIMUM_VIEWPORT_COVERAGE_RATIO = 0.8;

/**
 * Reports whether an element is an open fullscreen media overlay.
 *
 * @example
 * isFullscreenMediaOverlay(document.body.lastElementChild);
 */
export function isFullscreenMediaOverlay(element: Element | null): boolean {
  return (
    isOpenBodyImageOverlay(element) ||
    isFullscreenLightboxOverlay(element)
  );
}

function isOpenBodyImageOverlay(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.parentElement !== document.body) return false;
  if (element.dataset.state !== 'open') return false;
  if (!element.querySelector('img')) return false;

  const style = getComputedStyle(element);
  if (style.position !== 'fixed' || style.display === 'none') return false;

  return coversMostOfViewport(element);
}

function isFullscreenLightboxOverlay(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (!element.querySelector('img')) return false;
  if (!element.querySelector(LIGHTBOX_CLOSE_SELECTOR)) return false;

  const style = getComputedStyle(element);
  if (!isVisiblePositionedLayer(style)) return false;

  return coversMostOfViewport(element);
}

/**
 * Observes host-page overlays and mirrors their active state onto the root
 * element for the shared LunaTOC stylesheet.
 *
 * @example
 * const disconnect = observeExternalOverlays();
 */
export function observeExternalOverlays(): () => void {
  const synchronizeState = (): void => {
    const hasOpenOverlay =
      Array.from(document.body.children).some(isFullscreenMediaOverlay) ||
      Array.from(
        document.querySelectorAll<HTMLElement>(LIGHTBOX_CLOSE_SELECTOR)
      ).some((closeButton) => Boolean(findLightboxLayer(closeButton)));
    document.documentElement.classList.toggle(
      EXTERNAL_OVERLAY_OPEN_CLASS,
      hasOpenOverlay
    );
  };

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some(isRelevantOverlayMutation)) return;
    synchronizeState();
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-state', 'style'],
    childList: true,
    subtree: true,
  });
  window.addEventListener('resize', synchronizeState);
  synchronizeState();

  return () => {
    observer.disconnect();
    window.removeEventListener('resize', synchronizeState);
    document.documentElement.classList.remove(EXTERNAL_OVERLAY_OPEN_CLASS);
  };
}

function isRelevantOverlayMutation(mutation: MutationRecord): boolean {
  if (mutation.target === document.body) return true;

  const bodyChild = findDirectBodyChild(mutation.target);
  if (bodyChild?.dataset.state === 'open') return true;

  if (
    mutation.target instanceof Element &&
    hasLightboxLayerAncestor(mutation.target)
  ) {
    return true;
  }

  return [...mutation.addedNodes, ...mutation.removedNodes].some(
    containsLightboxControl
  );
}

function isVisiblePositionedLayer(style: CSSStyleDeclaration): boolean {
  return (
    (style.position === 'fixed' || style.position === 'absolute') &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || '1') > 0
  );
}

function coversMostOfViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= window.innerWidth * MINIMUM_VIEWPORT_COVERAGE_RATIO &&
    rect.height >= window.innerHeight * MINIMUM_VIEWPORT_COVERAGE_RATIO
  );
}

function findLightboxLayer(element: Element): HTMLElement | null {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (isFullscreenMediaOverlay(current)) return current;
    current = current.parentElement;
  }

  return current && isFullscreenMediaOverlay(current) ? current : null;
}

function hasLightboxLayerAncestor(element: Element): boolean {
  let current: Element | null = element;

  while (current && current !== document.body) {
    if (current.querySelector(LIGHTBOX_CLOSE_SELECTOR)) return true;
    current = current.parentElement;
  }

  return false;
}

function containsLightboxControl(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(LIGHTBOX_CLOSE_SELECTOR) ||
      Boolean(node.querySelector(LIGHTBOX_CLOSE_SELECTOR)))
  );
}

function findDirectBodyChild(node: Node): HTMLElement | null {
  let element =
    node instanceof HTMLElement ? node : node.parentElement;

  while (element && element.parentElement !== document.body) {
    element = element.parentElement;
  }

  return element?.parentElement === document.body ? element : null;
}
