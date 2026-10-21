/**
 * Creates the slim, unlabeled, translucent sidebar reveal handle.
 *
 * Its viewport-fixed position preserves the previous tab's vertical placement
 * without carrying over the old floating moon or detached toolbar behavior.
 */
const POSITION_STORAGE_KEY = 'chatTocToggleButtonPosition';
const HANDLE_HEIGHT_PX = 42;
const POSITION_MARGIN_PX = 8;

interface SavedHandlePosition {
  top?: number;
  topRatio?: number;
}

/**
 * Creates the accessible, 10px-wide right-edge trigger.
 * Its visible content is intentionally empty.
 * @returns The sidebar reveal trigger.
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

  const saved = readSavedPosition();
  if (saved) {
    dock.style.top = `${resolveTop(saved, 0)}px`;
  }

  window.addEventListener('resize', () => {
    const top = resolveTop(saved, dock.getBoundingClientRect().top);
    dock.style.top = `${top}px`;
  });

  return trigger;
}

function clampTop(top: number): number {
  const maxTop = Math.max(
    POSITION_MARGIN_PX,
    window.innerHeight - HANDLE_HEIGHT_PX - POSITION_MARGIN_PX
  );
  return Math.max(POSITION_MARGIN_PX, Math.min(maxTop, top));
}

function resolveTop(saved: SavedHandlePosition | null, fallbackTop: number): number {
  if (typeof saved?.topRatio === 'number' && Number.isFinite(saved.topRatio)) {
    const maxTop = Math.max(
      POSITION_MARGIN_PX,
      window.innerHeight - HANDLE_HEIGHT_PX - POSITION_MARGIN_PX
    );
    return clampTop(
      POSITION_MARGIN_PX + saved.topRatio * (maxTop - POSITION_MARGIN_PX)
    );
  }

  if (typeof saved?.top === 'number' && Number.isFinite(saved.top)) {
    return clampTop(saved.top);
  }

  return clampTop(fallbackTop);
}

function readSavedPosition(): SavedHandlePosition | null {
  try {
    const raw = sessionStorage.getItem(POSITION_STORAGE_KEY);
    return raw ? JSON.parse(raw) as SavedHandlePosition : null;
  } catch {
    return null;
  }
}
