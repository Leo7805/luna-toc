/**
 * Creates the full-height edge rail that reveals LunaTOC on hover.
 *
 * The rail is anchored to the viewport rather than a draggable coordinate, so
 * it stays flush with the browser edge through scrolling and window resizing.
 */

/**
 * Creates the right-edge sidebar reveal rail.
 * @returns {HTMLButtonElement} The keyboard-accessible hover trigger.
 */
export function createSidebarToggleButton(): HTMLButtonElement {
  const toggleBtn = document.createElement('button');

  toggleBtn.id = 'luna-toc-toggle-btn';
  toggleBtn.type = 'button';
  toggleBtn.className = 'luna-toc-sidebar-hidden';
  toggleBtn.setAttribute('aria-label', '展开目录');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.innerHTML = '<span class="toggle-sidebar-label" aria-hidden="true">目录</span>';

  document.body.appendChild(toggleBtn);
  return toggleBtn;
}
