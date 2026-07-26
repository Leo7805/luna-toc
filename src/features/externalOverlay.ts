/**
 * Detects host-page fullscreen media overlays and temporarily yields LunaTOC's
 * interface so native modal controls remain accessible.
 */

const EXTERNAL_OVERLAY_OPEN_CLASS = 'luna-toc-external-overlay-open';
const MINIMUM_VIEWPORT_COVERAGE_RATIO = 0.8;

/**
 * Reports whether an element is an open, body-level fullscreen media overlay.
 *
 * @example
 * isFullscreenMediaOverlay(document.body.lastElementChild);
 */
export function isFullscreenMediaOverlay(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.parentElement !== document.body) return false;
  if (element.dataset.state !== 'open') return false;
  if (!element.querySelector('img')) return false;

  const style = getComputedStyle(element);
  if (style.position !== 'fixed' || style.display === 'none') return false;

  const rect = element.getBoundingClientRect();
  return (
    rect.width >= window.innerWidth * MINIMUM_VIEWPORT_COVERAGE_RATIO &&
    rect.height >= window.innerHeight * MINIMUM_VIEWPORT_COVERAGE_RATIO
  );
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
    const hasOpenOverlay = Array.from(document.body.children).some(
      isFullscreenMediaOverlay
    );
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
  if (!bodyChild || bodyChild.dataset.state !== 'open') return false;
  if (bodyChild.querySelector('img')) return true;

  return Array.from(mutation.addedNodes).some(
    (node) =>
      node instanceof HTMLImageElement ||
      (node instanceof Element && Boolean(node.querySelector('img')))
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
