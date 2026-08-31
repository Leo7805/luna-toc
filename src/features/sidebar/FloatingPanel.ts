/**
 * Draggable, persistence-aware positioning for the sidebar floating panel.
 *
 * The panel floats over the conversation and exposes top/bottom jump buttons
 * plus the view-mode toggle. Users can drag it vertically; the chosen position
 * persists in sessionStorage and is re-clamped on browser resize.
 */
const FLOATING_PANEL_POSITION_STORAGE_KEY = 'chatTocJumpControlsPosition';

interface FloatingPanelPosition {
  top?: number;
  topRatio?: number;
}

/**
 * Wires up the floating panel's drag, persistence, and viewport clamping.
 * Must be called after the `.navigator-jump-controls` element is in the DOM.
 */
export function initFloatingPanel(): void {
  const floatingPanel = document.querySelector<HTMLElement>(
    '.navigator-jump-controls'
  );
  if (!floatingPanel) return;
  const panel = floatingPanel;

  restoreFloatingPanelPosition(panel);
  window.addEventListener('resize', () => {
    keepFloatingPanelInViewport(panel);
  });
  panel.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
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