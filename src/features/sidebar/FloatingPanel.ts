/**
 * Mounts the three jump/view controls next to the small draggable moon button.
 *
 * The toolbar shares the moon's dock rather than the sidebar. CSS anchors it
 * directly to the moon's left edge and vertical center even during dragging.
 */
import { bindFloatingDockDrag } from '@/features/SidebarToggleButton';

let floatingPanel: HTMLElement | null = null;

/**
 * Moves the existing toolbar into the moon's fixed-position dock.
 * The controls retain their existing click and double-click handlers.
 */
export function initFloatingPanel(): void {
  const panel = document.querySelector<HTMLElement>('.navigator-jump-controls');
  const dock = document.getElementById('luna-toc-floating-dock');
  if (!panel || !dock) return;

  floatingPanel = panel;
  dock.appendChild(panel);
  bindFloatingDockDrag(panel);
  setFloatingPanelVisible(false);
}

/**
 * Toggles the moon-attached toolbar; hidden controls cannot receive input.
 * @param {boolean} visible Whether the tools are accessible.
 */
export function setFloatingPanelVisible(visible: boolean): void {
  if (!floatingPanel) return;
  floatingPanel.classList.toggle('navigator-jump-controls-visible', visible);
  floatingPanel.setAttribute('aria-hidden', String(!visible));
  floatingPanel.inert = !visible;
}
