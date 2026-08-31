/**
 * Draggable, persistence-aware positioning for the sidebar jump-controls panel.
 *
 * The panel floats over the conversation and exposes top/bottom jump buttons.
 * Users can drag it vertically; the chosen position persists in sessionStorage
 * and is re-clamped on browser resize.
 */
const JUMP_CONTROLS_POSITION_STORAGE_KEY = 'chatTocJumpControlsPosition';

interface JumpControlsPosition {
  top?: number;
  topRatio?: number;
}

/**
 * Wires up the jump-controls drag, persistence, and viewport clamping.
 * Must be called after the `.navigator-jump-controls` element is in the DOM.
 */
export function initJumpControlsPositioning(): void {
  const jumpControls = document.querySelector<HTMLElement>(
    '.navigator-jump-controls'
  );
  if (!jumpControls) return;
  const controls = jumpControls;

  restoreJumpControlsPosition(controls);
  window.addEventListener('resize', () => {
    keepJumpControlsInViewport(controls);
  });
  controls.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    )
      return;
    event.preventDefault();

    const rect = controls.getBoundingClientRect();
    const startY = event.clientY;
    const startTop = rect.top;
    let didDrag = false;

    controls.setPointerCapture(event.pointerId);
    controls.classList.add('navigator-jump-controls-dragging');

    function handlePointerMove(moveEvent: PointerEvent): void {
      const deltaY = moveEvent.clientY - startY;
      if (!didDrag && Math.abs(deltaY) < 4) return;
      didDrag = true;
      setJumpControlsPosition(
        controls,
        clampJumpControlsTop(startTop + deltaY, rect.height)
      );
    }

    function handlePointerUp(): void {
      try {
        controls.releasePointerCapture(event.pointerId);
      } catch {}

      controls.classList.remove('navigator-jump-controls-dragging');
      controls.removeEventListener('pointermove', handlePointerMove);
      controls.removeEventListener('pointerup', handlePointerUp);
      controls.removeEventListener('pointercancel', handlePointerUp);
      if (didDrag) saveJumpControlsPosition(controls);
    }

    controls.addEventListener('pointermove', handlePointerMove);
    controls.addEventListener('pointerup', handlePointerUp);
    controls.addEventListener('pointercancel', handlePointerUp);
  });
}

function saveJumpControlsPosition(jumpControls: HTMLElement): void {
  const rect = jumpControls.getBoundingClientRect();
  storageSet(JUMP_CONTROLS_POSITION_STORAGE_KEY, {
    topRatio: getJumpControlsTopRatio(rect.top, rect.height),
  });
}

function restoreJumpControlsPosition(jumpControls: HTMLElement): void {
  const savedPosition = storageGet<JumpControlsPosition>(
    JUMP_CONTROLS_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls);
  if (nextTop != null) setJumpControlsPosition(jumpControls, nextTop);
}

function keepJumpControlsInViewport(jumpControls: HTMLElement): void {
  const rect = jumpControls.getBoundingClientRect();
  const savedPosition = storageGet<JumpControlsPosition>(
    JUMP_CONTROLS_POSITION_STORAGE_KEY
  );
  const nextTop = getSavedJumpControlsTop(savedPosition, jumpControls, rect);
  if (nextTop == null || Math.abs(nextTop - rect.top) < 1) return;
  setJumpControlsPosition(jumpControls, nextTop);
  saveJumpControlsPosition(jumpControls);
}

function setJumpControlsPosition(jumpControls: HTMLElement, top: number): void {
  jumpControls.style.top = `${top}px`;
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

function clampJumpControlsTop(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  return Math.min(maxTop, Math.max(minTop, top));
}

function getJumpControlsTopRatio(top: number, height: number): number {
  const minTop = 8;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  const range = maxTop - minTop;
  if (range <= 0) return 0;
  return (clampJumpControlsTop(top, height) - minTop) / range;
}

function getSavedJumpControlsTop(
  savedPosition: JumpControlsPosition | null,
  jumpControls: HTMLElement,
  rect?: DOMRect
): number | null {
  if (!savedPosition) return null;
  const panelRect = rect || jumpControls.getBoundingClientRect();

  if (
    typeof savedPosition.topRatio === 'number' &&
    Number.isFinite(savedPosition.topRatio)
  ) {
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - panelRect.height - 8);
    return clampJumpControlsTop(
      minTop + savedPosition.topRatio * (maxTop - minTop),
      panelRect.height
    );
  }
  if (
    typeof savedPosition.top === 'number' &&
    Number.isFinite(savedPosition.top)
  ) {
    return clampJumpControlsTop(savedPosition.top, panelRect.height);
  }
  return null;
}
