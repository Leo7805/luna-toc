/** Allows the jump control's empty reveal rail to be moved vertically. */
const POSITION_KEY = 'chatToc:jumpControlsBottom';
const EDGE_PADDING_PX = 12;
const FALLBACK_CLUSTER_HEIGHT_PX = 132;

/** Clamps a persisted/dragged offset to the available sidebar height. */
export function clampJumpControlsBottom(
  bottom: number,
  viewportHeight: number,
  clusterHeight: number
): number {
  const upper = Math.max(EDGE_PADDING_PX, viewportHeight - clusterHeight - EDGE_PADDING_PX);
  return Math.max(EDGE_PADDING_PX, Math.min(upper, Math.round(bottom)));
}

/**
 * Makes the rail around the action buttons draggable without stealing button
 * clicks. The chosen height is retained for this tab's subsequent navigation.
 */
export function initializeJumpControlsPosition(sidebar: HTMLElement): () => void {
  const controls = sidebar.querySelector<HTMLElement>('.navigator-jump-controls');
  if (!controls) return () => {};

  const maxHeight = (): number => sidebar.clientHeight || window.innerHeight;
  const railHeight = (): number => controls.offsetHeight || FALLBACK_CLUSTER_HEIGHT_PX;
  const adjust = (bottom: number): number => {
    const clamped = clampJumpControlsBottom(bottom, maxHeight(), railHeight());
    controls.style.bottom = `${clamped}px`;
    controls.setAttribute('aria-valuenow', String(clamped));
    controls.setAttribute(
      'aria-valuemax',
      String(Math.max(EDGE_PADDING_PX, maxHeight() - railHeight() - EDGE_PADDING_PX))
    );
    return clamped;
  };

  let initial = EDGE_PADDING_PX;
  try {
    const saved = sessionStorage.getItem(POSITION_KEY);
    if (saved !== null && saved.trim() !== '') {
      const parsed = Number(saved);
      if (Number.isFinite(parsed)) initial = parsed;
    }
  } catch {}
  adjust(initial);

  let startY: number | null = null;
  let startBottom = EDGE_PADDING_PX;
  const onPointerMove = (event: PointerEvent): void => {
    if (startY === null) return;
    adjust(startBottom + startY - event.clientY);
  };
  const onPointerUp = (): void => {
    if (startY === null) return;
    startY = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
    try {
      sessionStorage.setItem(POSITION_KEY, String(parseInt(controls.style.bottom, 10)));
    } catch {}
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('button'))) return;
    event.preventDefault();
    startY = event.clientY;
    startBottom = parseInt(controls.style.bottom, 10) || EDGE_PADDING_PX;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== controls) return;
    const step = event.shiftKey ? 30 : 10;
    const delta = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    const next = adjust((parseInt(controls.style.bottom, 10) || EDGE_PADDING_PX) + delta);
    try { sessionStorage.setItem(POSITION_KEY, String(next)); } catch {}
  };
  const onResize = (): void => { adjust(parseInt(controls.style.bottom, 10) || EDGE_PADDING_PX); };
  controls.tabIndex = 0;
  controls.setAttribute('role', 'slider');
  controls.setAttribute('aria-label', '调整右侧三个导航按钮的上下位置');
  controls.setAttribute('aria-valuemin', String(EDGE_PADDING_PX));
  controls.addEventListener('pointerdown', onPointerDown);
  controls.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  return () => {
    onPointerUp();
    controls.removeEventListener('pointerdown', onPointerDown);
    controls.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
  };
}
