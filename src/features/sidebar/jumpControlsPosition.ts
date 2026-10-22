/**
 * Positions the three navigation buttons at the pointer's height when the
 * user reaches the right edge; there is no dragged or persisted placement.
 */
const EDGE_PADDING_PX = 12;
const FALLBACK_CLUSTER_HEIGHT_PX = 132;
const lastPointerBySidebar = new WeakMap<HTMLElement, number>();

/** Centers the cluster vertically at a pointer coordinate and clamps to viewport. */
export function clampJumpControlsTop(
  pointerY: number,
  viewportHeight: number,
  clusterHeight: number
): number {
  const upper = Math.max(EDGE_PADDING_PX, viewportHeight - clusterHeight - EDGE_PADDING_PX);
  return Math.max(EDGE_PADDING_PX, Math.min(upper, Math.round(pointerY - clusterHeight / 2)));
}

/** Places the cluster near the last right-edge pointer entry. */
export function placeJumpControlsAtPointer(sidebar: HTMLElement, pointerY: number): void {
  const controls = sidebar.querySelector<HTMLElement>('.navigator-jump-controls');
  if (!controls || !Number.isFinite(pointerY)) return;
  lastPointerBySidebar.set(sidebar, pointerY);
  const height = sidebar.clientHeight || window.innerHeight;
  const groupHeight = controls.offsetHeight || FALLBACK_CLUSTER_HEIGHT_PX;
  controls.style.bottom = 'auto';
  controls.style.top = `${clampJumpControlsTop(pointerY, height, groupHeight)}px`;
}

/** Initializes a centered fallback and reapplies the last pointer height on resize. */
export function initializeJumpControlsPosition(sidebar: HTMLElement): () => void {
  const onResize = (): void => {
    const center = (sidebar.clientHeight || window.innerHeight) / 2;
    placeJumpControlsAtPointer(sidebar, lastPointerBySidebar.get(sidebar) ?? center);
  };
  // Remove the retired drag-position preference once.
  try { sessionStorage.removeItem('chatToc:jumpControlsBottom'); } catch {}
  onResize();
  window.addEventListener('resize', onResize);
  return () => { window.removeEventListener('resize', onResize); };
}
