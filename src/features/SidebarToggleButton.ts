/**
 * Creates the minimal, unlabeled, viewport-centered sidebar reveal handle.
 *
 * This handle replaces the movable dock. Its fixed position is intentionally
 * independent of saved positions from previous versions.
 */

/**
 * Creates the accessible right-edge trigger without visible text or icons.
 * The 5 × 45px dimensions and vertical centering are defined in content.css.
 * @returns {HTMLButtonElement} The sidebar reveal handle.
 */
export function createSidebarToggleButton(): HTMLButtonElement {
  const dock = document.createElement('div');
  dock.id = 'luna-toc-floating-dock';

  const trigger = document.createElement('button');
  trigger.id = 'luna-toc-toggle-btn';
  trigger.type = 'button';
  trigger.className = 'luna-toc-sidebar-hidden';
  trigger.setAttribute('aria-label', '展开目录');
  trigger.setAttribute('aria-expanded', 'false');

  dock.appendChild(trigger);
  document.body.appendChild(dock);
  return trigger;
}
