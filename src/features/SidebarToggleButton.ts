/**
 * Creates the docked LunaTOC moon button and coordinates vertical dragging.
 *
 * The entire dock slides partially beyond the viewport edge when idle. Both
 * the moon button and its pop-out tool cluster share the same fixed position.
 */
const DOCK_ID = 'luna-toc-floating-dock';
const POSITION_STORAGE_KEY = 'chatTocToggleButtonPosition';
const DOCK_HEIGHT_PX = 42;
const POSITION_MARGIN_PX = 8;

interface SavedDockPosition {
  top?: number;
  topRatio?: number;
}

/**
 * Creates the right-edge moon button and its shared floating dock.
 * @returns {HTMLButtonElement} A draggable button labelled "目录".
 */
export function createSidebarToggleButton(): HTMLButtonElement {
  const dock = document.createElement('div');
  dock.id = DOCK_ID;

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'luna-toc-toggle-btn';
  toggleBtn.type = 'button';
  toggleBtn.className = 'luna-toc-sidebar-hidden';
  toggleBtn.setAttribute('aria-label', '展开目录');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <path fill="currentColor"
        d="M48 8A26 26 0 1 1 15 48C29 52 43 43 49 29C52 21 51 13 48 8Z" />
    </svg>
    <span class="toggle-sidebar-label" aria-hidden="true">目录</span>
  `;

  dock.appendChild(toggleBtn);
  document.body.appendChild(dock);
  restoreDockPosition(dock);
  bindFloatingDockDrag(toggleBtn);

  window.addEventListener('resize', () => {
    const saved = readSavedPosition();
    const top = positionFromSaved(saved, dock.getBoundingClientRect().top);
    dock.style.top = `${top}px`;
  });

  return toggleBtn;
}

/**
 * Allows either the moon or the tool-cluster background to drag the dock.
 * The dock moves vertically only and always stays attached to the right edge.
 * @param {HTMLElement} handle Element providing pointer drag gestures.
 */
export function bindFloatingDockDrag(handle: HTMLElement): void {
  const dock = document.getElementById(DOCK_ID);
  if (!dock) return;

  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (handle !== document.getElementById('luna-toc-toggle-btn') &&
        event.target instanceof Element &&
        event.target.closest('button'))
    ) return;

    const startTop = dock.getBoundingClientRect().top;
    const startY = event.clientY;
    let didDrag = false;

    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is not available in all synthetic/test environments.
    }

    function move(moveEvent: PointerEvent): void {
      const delta = moveEvent.clientY - startY;
      if (!didDrag && Math.abs(delta) < 4) return;
      didDrag = true;
      dock.style.top = `${clampDockTop(startTop + delta)}px`;
      dock.classList.add('luna-toc-floating-dock-dragging');
    }

    function finish(): void {
      try {
        handle.releasePointerCapture?.(event.pointerId);
      } catch {}
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      dock.classList.remove('luna-toc-floating-dock-dragging');
      if (!didDrag) return;

      if (handle === document.getElementById('luna-toc-toggle-btn')) {
        handle.dataset.dragged = 'true';
      }
      const top = clampDockTop(dock.getBoundingClientRect().top);
      dock.style.top = `${top}px`;
      writeSavedPosition(top);
    }

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
}

function clampDockTop(top: number): number {
  const maxTop = Math.max(POSITION_MARGIN_PX, window.innerHeight -
    DOCK_HEIGHT_PX - POSITION_MARGIN_PX);
  return Math.max(POSITION_MARGIN_PX, Math.min(maxTop, top));
}

function positionFromSaved(saved: SavedDockPosition | null, currentTop: number): number {
  if (typeof saved?.topRatio === 'number' && Number.isFinite(saved.topRatio)) {
    const maxTop = Math.max(POSITION_MARGIN_PX, window.innerHeight -
      DOCK_HEIGHT_PX - POSITION_MARGIN_PX);
    return clampDockTop(
      POSITION_MARGIN_PX + saved.topRatio * (maxTop - POSITION_MARGIN_PX)
    );
  }
  if (typeof saved?.top === 'number' && Number.isFinite(saved.top)) {
    return clampDockTop(saved.top);
  }
  return clampDockTop(currentTop);
}

function restoreDockPosition(dock: HTMLElement): void {
  const saved = readSavedPosition();
  if (saved) {
    dock.style.top = `${positionFromSaved(saved, 0)}px`;
  }
}

function readSavedPosition(): SavedDockPosition | null {
  try {
    const raw = sessionStorage.getItem(POSITION_STORAGE_KEY);
    return raw ? JSON.parse(raw) as SavedDockPosition : null;
  } catch {
    return null;
  }
}

function writeSavedPosition(top: number): void {
  const maxTop = Math.max(POSITION_MARGIN_PX, window.innerHeight -
    DOCK_HEIGHT_PX - POSITION_MARGIN_PX);
  const range = maxTop - POSITION_MARGIN_PX;
  try {
    sessionStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
      top,
      topRatio: range > 0 ? (top - POSITION_MARGIN_PX) / range : 0,
    }));
  } catch {
    // An unavailable session store must not block dragging.
  }
}
