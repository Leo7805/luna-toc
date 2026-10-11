/**
 * Shared Shadow DOM portal container access for LunaTOC React components.
 */

let portalContainer: HTMLDivElement | null = null;

/**
 * Sets the active Shadow DOM portal container element.
 *
 * @param {HTMLDivElement | null} container The portal element or null during cleanup.
 *
 * @example
 * setReactPortalContainer(portalElement);
 */
export function setReactPortalContainer(
  container: HTMLDivElement | null
): void {
  portalContainer = container;
}

/**
 * Returns the Shadow DOM container used by React portals.
 *
 * @example
 * const container = getReactPortalContainer();
 *
 * @throws {Error} If the React host has not finished initializing.
 */
export function getReactPortalContainer(): HTMLDivElement {
  if (!portalContainer) {
    throw new Error('The LunaTOC React host has not been initialized.');
  }

  return portalContainer;
}
