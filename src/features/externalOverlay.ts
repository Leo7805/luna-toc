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

/**
 * Reports whether the host page has disabled body-level pointer interaction.
 */
function isBodyPointerEventsDisabled(): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  return getComputedStyle(document.body).pointerEvents === 'none';
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
  const activeOverlayLayers = new Set<HTMLElement>();
  const knownCloseButtons = new Set<HTMLElement>();

  const synchronizeState = (): void => {
    activeOverlayLayers.clear();
    knownCloseButtons.clear();

    const bodyPointerEventsDisabled = isBodyPointerEventsDisabled();

    for (const child of document.body.children) {
      if (child instanceof HTMLElement && isFullscreenMediaOverlay(child)) {
        activeOverlayLayers.add(child);
      }
    }

    const closeButtons = document.querySelectorAll<HTMLElement>(
      LIGHTBOX_CLOSE_SELECTOR
    );
    for (const closeButton of closeButtons) {
      knownCloseButtons.add(closeButton);
      const layer = findLightboxLayer(closeButton);
      if (layer) {
        activeOverlayLayers.add(layer);
      }
    }

    const hasOpenOverlay =
      bodyPointerEventsDisabled || activeOverlayLayers.size > 0;
    document.documentElement.classList.toggle(
      EXTERNAL_OVERLAY_OPEN_CLASS,
      hasOpenOverlay
    );
  };

  const observer = new MutationObserver((mutations) => {
    if (
      !mutations.some((mutation) =>
        isRelevantOverlayMutation(
          mutation,
          activeOverlayLayers,
          knownCloseButtons
        )
      )
    ) {
      return;
    }
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
    activeOverlayLayers.clear();
    knownCloseButtons.clear();
    document.documentElement.classList.remove(EXTERNAL_OVERLAY_OPEN_CLASS);
  };
}

function isRelevantOverlayMutation(
  mutation: MutationRecord,
  activeOverlayLayers: ReadonlySet<HTMLElement>,
  knownCloseButtons: ReadonlySet<HTMLElement>
): boolean {
  if (mutation.target === document.body) return true;

  const bodyChild = findDirectBodyChild(mutation.target);
  if (
    bodyChild &&
    (bodyChild.dataset.state === 'open' || activeOverlayLayers.has(bodyChild))
  ) {
    return true;
  }

  if (mutation.type === 'attributes') {
    if (
      mutation.target === bodyChild &&
      mutation.attributeName === 'data-state'
    ) {
      return true;
    }
    if (mutation.target instanceof HTMLElement) {
      if (activeOverlayLayers.has(mutation.target)) return true;
      if (
        knownCloseButtons.size > 0 &&
        containsAnyKnownNode(mutation.target, knownCloseButtons)
      ) {
        return true;
      }
    }
    return false;
  }

  // childList mutation: check tracked close buttons for removals or in-lightbox
  // updates without walking ancestors with querySelector.
  if (knownCloseButtons.size > 0) {
    for (const closeButton of knownCloseButtons) {
      if (!closeButton.isConnected) return true;
    }
    if (
      mutation.target instanceof Element &&
      containsAnyKnownNode(mutation.target, knownCloseButtons)
    ) {
      return true;
    }
    for (const removedNode of mutation.removedNodes) {
      if (
        removedNode instanceof Element &&
        containsAnyKnownNode(removedNode, knownCloseButtons)
      ) {
        return true;
      }
    }
  }

  for (const addedNode of mutation.addedNodes) {
    if (containsLightboxControl(addedNode)) return true;
  }

  return false;
}

function containsAnyKnownNode(
  container: Element,
  nodes: ReadonlySet<HTMLElement>
): boolean {
  for (const node of nodes) {
    if (container.contains(node)) return true;
  }
  return false;
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

function containsLightboxControl(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (node.matches(LIGHTBOX_CLOSE_SELECTOR)) return true;
  return node.childElementCount > 0 && Boolean(node.querySelector(LIGHTBOX_CLOSE_SELECTOR));
}

function findDirectBodyChild(node: Node): HTMLElement | null {
  let element =
    node instanceof HTMLElement ? node : node.parentElement;

  while (element && element.parentElement !== document.body) {
    element = element.parentElement;
  }

  return element?.parentElement === document.body ? element : null;
}
