/**
 * Positions the detached jump/tool controls beside the sidebar's left edge.
 *
 * The toolbar remains vertically draggable, remembers its relative viewport
 * position, and appears only while the user interacts with the sidebar.
 */
const FLOATING_PANEL_POSITION_STORAGE_KEY = 'chatTocJumpControlsPosition';

interface FloatingPanelPosition {
  top?: number;
  topRatio?: number;
}

let floatingPanel: HTMLElement | null = null;

/**
 * Initializes the pop-out toolbar after its buttons have been created.
 * Moves the toolbar to document.body so the sidebar's overflow cannot clip it.
 */
export function initFloatingPanel(): void {
  const panel = document.querySelector<HTMLElement>('.navigator-jump-controls');
  const sidebar = document.getElementById('luna-toc-sidebar');
  if (!panel || !sidebar) return;

  floatingPanel = panel;
  document.body.appendChild(panel);
  alignFloatingPanel(panel, sidebar);
  restoreFloatingPanelPosition(panel);
  setFloatingPanelVisible(false);

  window.addEventListener('resize', () => {
    alignFloatingPanel(panel, sidebar);
    keepFloatingPanelInViewport(panel);
  });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => alignFloatingPanel(panel, sidebar)).observe(sidebar);
  }

  panel.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    ) return;
    event.preventDefault();

    const rect = panel.getBoundingClientRect();
    const startY = event.clientY;
    const startTop = rect.top;
    let didDrag = false;

    panel.setPointerCapture(event.pointerId);
    panel.classList.add('navigator-jump-controls-dragging');

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaY = moveEvent.clientY - startY;
      if (!didDrag && Math.abs(deltaY) < 4) return;
      didDrag = true;
      setFloatingPanelPosition(
        panel,
        clampFloatingPanelTop(startTop + deltaY, rect.height)
      );
    }

    function handlePointerUp(): void {
      try {
        panel.releasePointerCapture(event.pointerId);
      } catch {}

      panel.classList.remove('navigator-jump-controls-dragging');
      panel.removeEventListener('pointermove', handlePointerMove);
      panel.removeEventListener('pointerup', handlePointerUp);
      panel.removeEventListener('pointercancel', handlePointerUp);
      if (didDrag) saveFloatingPanelPosition(panel);
    }

    panel.addEventListener('pointermove', handlePointerMove);
    panel.addEventListener('pointerup', handlePointerUp);
    panel.addEventListener('pointercancel', handlePointerUp);
  });
}

/**
 * Shows or hides the floating tools while keeping them inert when hidden.
 * @param visible Whether the pop-out controls should accept interaction.
 */
export function setFloatingPanelVisible(visible: boolean): void {
  if (!floatingPanel) return;
  floatingPanel.classList.toggle('navigator-jump-controls-visible', visible);
  floatingPanel.setAttribute('aria-hidden', String(!visible));
  floatingPanel.inert = !visible;
}

/**
 * Keeps the toolbar's right edge flush with the sidebar's left edge.
 */
function alignFloatingPanel(panel: HTMLElement, sidebar: HTMLElement): void {
  panel.style.right = `${sidebar.offsetWidth}px`;
}

function saveFloatingPanelPosition(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect();
  storageSet(FLOATING_PANEL_POSITION_STORAGE_KEY, {
    topRatio: getFloatingPanelTopRatio(rect.top, rect.height),
  });
}

function restoreFloatingPanelPosition(panel: HTMLElement): void {
  const savedPosition = storageGet<FloatingPanelPosition>(
    FLOATING_PANEL_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedFloatingPanelTop(savedPosition, panel);
  if (nextTop != null) setFloatingPanelPosition(panel, nextTop);
}

function keepFloatingPanelInViewport(panel: HTMLElement): void {
  const rect = panel.getBoundingClientRect();
  const savedPosition = storageGet<FloatingPanelPosition>(
    FLOATING_PANEL_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedFloatingPanelTop(savedPosition, panel, rect);
  if (nextTop == null || Math.abs(nextTop - rect.top) < 1) return;
  setFloatingPanelPosition(panel, nextTop);
  saveFloatingPanelPosition(panel);
}

function setFloatingPanelPosition(panel: HTMLElement, top: number): void {
  panel.style.top = `${top}px`;
}

function storageGet<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clampFloatingPanelTop(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  return Math.min(maxTop, Math.max(minTop, top));
}

function getFloatingPanelTopRatio(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  const range = maxTop - minTop;
  if (range <= 0) return 0;
  return (clampFloatingPanelTop(top, height) - minTop) / range;
}

function getSavedFloatingPanelTop(
  savedPosition: FloatingPanelPosition | null,
  panel: HTMLElement,
  rect?: DOMRect
): number | null {
  if (!savedPosition) return null;
  const panelRect = rect || panel.getBoundingClientRect();

  if (
    typeof savedPosition.topRatio === 'number' &&
    Number.isFinite(savedPosition.topRatio)
  ) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - panelRect.height - 8);
    return clampFloatingPanelTop(
      minTop + savedPosition.topRatio * (maxTop - minTop),
      panelRect.height
    );
  }
  if (
    typeof savedPosition.top === 'number' &&
    Number.isFinite(savedPosition.top)
  ) {
    return clampFloatingPanelTop(savedPosition.top, panelRect.height);
  }
  return null;
}
