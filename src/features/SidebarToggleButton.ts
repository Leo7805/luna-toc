/**
 * Builds and manages drag positioning and persistence for the floating ChatTOC sidebar toggle button.
 */
export interface ToggleButtonPosition {
  left: number;
  top: number;
}

export const POSITION_MARGIN = 8;
export const RIGHT_POSITION_MARGIN = 0;
export const POSITION_STORAGE_KEY = 'chatTocToggleButtonPosition';

/**
 * Creates the floating sidebar visibility toggle button (legacy Vanilla creator).
 * @returns {HTMLButtonElement}
 */
export function createSidebarToggleButton(): HTMLButtonElement {
  const toggleBtn = document.createElement('button');

  toggleBtn.id = 'luna-toc-toggle-btn';
  toggleBtn.className = 'luna-toc-sidebar-visible';
  toggleBtn.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <path
          fill="currentColor"
          d="M48 8A26 26 0 1 1 15 48C29 52 43 43 49 29C52 21 51 13 48 8Z"
        />
      </svg>
      <span class="toggle-sidebar-label" aria-hidden="true">TOC</span>
    `;

  document.body.appendChild(toggleBtn);
  initDrag(toggleBtn);
  restorePosition(toggleBtn);

  return toggleBtn;
}

/**
 * Enables pointer dragging for the toggle button with boundary clamping and persistence.
 *
 * @param {HTMLButtonElement} toggleBtn The button element.
 * @param {(pos: ToggleButtonPosition) => void} [onPositionChange] Optional callback invoked on position updates.
 * @returns {() => void} Cleanup function to detach listeners.
 */
export function initDrag(
  toggleBtn: HTMLButtonElement,
  onPositionChange?: (pos: ToggleButtonPosition) => void
): () => void {
  const handleResize = (): void => {
    const updated = keepButtonInViewport(toggleBtn);
    if (updated && onPositionChange) {
      onPositionChange(updated);
    }
  };

  window.addEventListener('resize', handleResize);

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    const rect = toggleBtn.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    let didDrag = false;
    let lastPosition: ToggleButtonPosition | null = null;

    try {
      toggleBtn.setPointerCapture(event.pointerId);
    } catch {}
    toggleBtn.classList.add('luna-toc-toggle-btn-dragging');

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (!didDrag && Math.hypot(deltaX, deltaY) < 4) {
        return;
      }

      didDrag = true;

      lastPosition = clampPosition(
        startLeft + deltaX,
        startTop + deltaY,
        rect.width || 42,
        rect.height || 42
      );

      setPosition(toggleBtn, lastPosition.left, lastPosition.top);
    }

    function handlePointerUp(): void {
      try {
        toggleBtn.releasePointerCapture(event.pointerId);
      } catch {}
      toggleBtn.classList.remove('luna-toc-toggle-btn-dragging');
      toggleBtn.removeEventListener('pointermove', handlePointerMove);
      toggleBtn.removeEventListener('pointerup', handlePointerUp);
      toggleBtn.removeEventListener('pointercancel', handlePointerUp);

      if (!didDrag || !lastPosition) return;

      toggleBtn.dataset.dragged = 'true';
      storageSet(POSITION_STORAGE_KEY, lastPosition);

      if (onPositionChange) {
        onPositionChange(lastPosition);
      }
    }

    toggleBtn.addEventListener('pointermove', handlePointerMove);
    toggleBtn.addEventListener('pointerup', handlePointerUp);
    toggleBtn.addEventListener('pointercancel', handlePointerUp);
  };

  toggleBtn.addEventListener('pointerdown', handlePointerDown);

  return () => {
    window.removeEventListener('resize', handleResize);
    toggleBtn.removeEventListener('pointerdown', handlePointerDown);
  };
}

/**
 * Applies a fixed viewport position to the toggle button.
 * @param {HTMLElement} toggleBtn
 * @param {number} left
 * @param {number} top
 */
export function setPosition(
  toggleBtn: HTMLElement,
  left: number,
  top: number
): void {
  toggleBtn.style.left = `${left}px`;
  toggleBtn.style.top = `${top}px`;
  toggleBtn.style.right = 'auto';
  toggleBtn.style.bottom = 'auto';
}

/**
 * Re-clamps the current session position after viewport size changes.
 * @param {HTMLElement} toggleBtn
 * @returns {ToggleButtonPosition | null} The new clamped position if changed; null otherwise.
 */
export function keepButtonInViewport(
  toggleBtn: HTMLElement
): ToggleButtonPosition | null {
  const rect = toggleBtn.getBoundingClientRect();
  const parsedLeft = parseFloat(toggleBtn.style.left);
  const parsedTop = parseFloat(toggleBtn.style.top);
  const currentLeft = Number.isFinite(parsedLeft) ? parsedLeft : rect.left;
  const currentTop = Number.isFinite(parsedTop) ? parsedTop : rect.top;

  const nextPosition = clampPosition(
    currentLeft,
    currentTop,
    rect.width || 42,
    rect.height || 42
  );

  if (nextPosition.left === currentLeft && nextPosition.top === currentTop) {
    return null;
  }

  setPosition(toggleBtn, nextPosition.left, nextPosition.top);
  storageSet(POSITION_STORAGE_KEY, nextPosition);
  return nextPosition;
}

/**
 * Keeps the button fully inside the viewport.
 * @param {number} left
 * @param {number} top
 * @param {number} width
 * @param {number} height
 * @returns {{ left: number, top: number }}
 */
export function clampPosition(
  left: number,
  top: number,
  width: number,
  height: number
): ToggleButtonPosition {
  const maxLeft = Math.max(
    POSITION_MARGIN,
    window.innerWidth - width - RIGHT_POSITION_MARGIN
  );
  const maxTop = Math.max(
    POSITION_MARGIN,
    window.innerHeight - height - POSITION_MARGIN
  );

  return {
    left: Math.min(maxLeft, Math.max(POSITION_MARGIN, left)),
    top: Math.min(maxTop, Math.max(POSITION_MARGIN, top)),
  };
}

/**
 * Restores the button's position from sessionStorage.
 * @param {HTMLElement} toggleBtn
 * @returns {ToggleButtonPosition | null} The restored position if found; null otherwise.
 */
export function restorePosition(
  toggleBtn: HTMLElement
): ToggleButtonPosition | null {
  const savedPosition = storageGet<ToggleButtonPosition>(POSITION_STORAGE_KEY);

  if (!savedPosition) return null;
  if (
    !Number.isFinite(savedPosition.left) ||
    !Number.isFinite(savedPosition.top)
  ) {
    return null;
  }

  const rect = toggleBtn.getBoundingClientRect();
  const nextPosition = clampPosition(
    savedPosition.left,
    savedPosition.top,
    rect.width || 42,
    rect.height || 42
  );

  setPosition(toggleBtn, nextPosition.left, nextPosition.top);
  return nextPosition;
}

/**
 * Saves the button's current position to sessionStorage.
 * @param {HTMLElement} toggleBtn
 */
export function savePosition(toggleBtn: HTMLElement): void {
  const rect = toggleBtn.getBoundingClientRect();

  storageSet(POSITION_STORAGE_KEY, {
    left: rect.left,
    top: rect.top,
  });
}

export function storageGet<T>(key: string): T | null {
  try {
    const rawValue = sessionStorage.getItem(key);

    return rawValue ? (JSON.parse(rawValue) as T) : null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
