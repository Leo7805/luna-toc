/**
 * Owns LunaTOC sidebar visibility, pinning, and auto-hide behavior.
 */
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import type { SidebarLayoutMode } from '@/features/sidebar/sidebarPreferences';
import { syncChatGptSideBySide } from '@/features/sidebar/chatGptSideBySide';
import { placeJumpControlsAtPointer } from '@/features/sidebar/jumpControlsPosition';

const PINNED_STORAGE_KEY = 'chatTocSidebarPinned';
const LEGACY_PINNED_STORAGE_PREFIX = 'chatTocSidebarPinned:';
// A short grace period retains portal hover without delayed collapse.
const AUTO_HIDE_DELAY_MS = 60;
/** Time the pointer must remain at the right edge after the initial sidebar reveal. */
export const EDGE_TOOL_DWELL_MS = 50;
const EDGE_TOOL_THRESHOLD_PX = 12;
/** Keep revealed right-edge tools visible briefly after the pointer moves away. */
export const EDGE_TOOL_HIDE_DELAY_MS = 400;
const LAYOUT_MODE_STORAGE_KEY = 'chatToc:activeSidebarLayoutMode';

let sidebar: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let pinBtn: HTMLElement | null = null;
let isPinned = false;
let isHidden = true;
let activeLayoutMode: SidebarLayoutMode | null = null;
let hideTimer = 0;
let edgeToolTimer = 0;
let edgeToolHideTimer = 0;
let edgePointerY = 0;
// The first edge hit opens the sidebar, but cannot arm the toolbar until exit.
let mustLeaveEdgeBeforeTools = false;
let onOpened: (() => void) | null = null;
let onClosed: (() => void) | null = null;
/**
 * @param {HTMLElement} sidebarElement
 * @param {HTMLButtonElement} toggleButton
 */
export function initializeSidebarVisibility(
  sidebarElement: HTMLElement,
  toggleButton: HTMLButtonElement,
  options: { onOpened?: () => void; onClosed?: () => void } = {}
): void {
  onOpened = options.onOpened ?? null;
  onClosed = options.onClosed ?? null;
  activeLayoutMode = null;
  clearEdgeToolTimer();
  clearEdgeToolHideTimer();
  mustLeaveEdgeBeforeTools = false;
  sidebar = sidebarElement;
  toggleBtn = toggleButton;
  pinBtn = document.getElementById('luna-toc-sidebar-pin-btn');

  bindPinButton();
  bindToggleButton();
  bindAutoHide();
  bindKeyboardTools();
  loadPinnedState();
  finishInitializing();
}

/** Exposes right-edge tools to keyboard-only users when the sidebar is open. */
function bindKeyboardTools(): void {
  sidebar?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || event.key.toLowerCase() !== 'j' ||
        isHidden) return;
    const controls = sidebar?.querySelector<HTMLElement>('.navigator-jump-controls');
    const firstButton = controls?.querySelector<HTMLButtonElement>('button');
    if (!firstButton) return;
    event.preventDefault();
    setJumpControlsVisible(true);
    firstButton.focus();
  });
}

function bindPinButton(): void {
  if (!pinBtn) return;

  pinBtn.addEventListener('click', () => {
    setSidebarPinned(!isPinned, { persist: true });
  });
}

function bindToggleButton(): void {
  if (!toggleBtn) return;
  const button = toggleBtn;

  button.addEventListener('pointerenter', () => {
    // First right-edge contact is reserved for opening the sidebar.
    mustLeaveEdgeBeforeTools = true;
    clearEdgeToolTimer();
    handleAutoHideEnter();
  });
  button.addEventListener('focus', handleAutoHideEnter);
  button.addEventListener('pointerleave', scheduleAutoHide);

  button.addEventListener('click', () => {
    mustLeaveEdgeBeforeTools = true;
    clearEdgeToolTimer();
    handleAutoHideEnter();
  });
}

function bindAutoHide(): void {
  if (!sidebar) return;

  sidebar.addEventListener('pointerenter', () => clearHideTimer());
  sidebar.addEventListener('pointerleave', () => {
    clearEdgeToolTimer();
    scheduleJumpControlsHide();
    scheduleAutoHide();
  });

  const controls = sidebar.querySelector<HTMLElement>('.navigator-jump-controls');
  controls?.addEventListener('pointerenter', () => {
    // Preserve buttons already revealed by the dwell timer, never bypass it.
    clearEdgeToolTimer();
    clearEdgeToolHideTimer();
  });
  controls?.addEventListener('pointerleave', scheduleJumpControlsHide);
  controls?.addEventListener('focusin', () => {
    clearEdgeToolHideTimer();
    setJumpControlsVisible(true);
  });
  controls?.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && controls.contains(event.relatedTarget)) {
      return;
    }
    clearEdgeToolHideTimer();
    setJumpControlsVisible(false);
  });

  // The first edge hit opens the sidebar. Subsequent edge dwell is required
  // before the toolbar appears; leaving the edge cancels the pending reveal.
  sidebar.addEventListener('pointermove', (event) => {
    if (event.target instanceof Node && controls?.contains(event.target)) return;
    const atEdge = event.clientX >= window.innerWidth - EDGE_TOOL_THRESHOLD_PX &&
      event.clientX <= window.innerWidth && Number.isFinite(event.clientY);
    if (!atEdge) {
      mustLeaveEdgeBeforeTools = false;
      clearEdgeToolTimer();
      scheduleJumpControlsHide();
      return;
    }
    if (isHidden || mustLeaveEdgeBeforeTools) return;
    clearEdgeToolHideTimer();
    edgePointerY = event.clientY;
    if (controls?.classList.contains('navigator-jump-controls-visible') ||
        edgeToolTimer) return;
    edgeToolTimer = window.setTimeout(() => {
      edgeToolTimer = 0;
      if (isHidden || mustLeaveEdgeBeforeTools || !sidebar) return;
      placeJumpControlsAtPointer(sidebar, edgePointerY);
      setJumpControlsVisible(true);
    }, EDGE_TOOL_DWELL_MS);
  });

  document.addEventListener('pointerover', handleDocumentPointerOver, true);
  document.addEventListener('pointerout', handleDocumentPointerOut, true);
}

/**
 * Changes the three-button cluster's visual and keyboard state. The cluster
 * itself remains hit-testable so moving back over its footprint reveals it.
 */
function setJumpControlsVisible(visible: boolean): void {
  if (!visible) clearEdgeToolHideTimer();
  const controls = sidebar?.querySelector<HTMLElement>('.navigator-jump-controls');
  if (!controls) return;

  controls.classList.toggle('navigator-jump-controls-visible', visible);
  controls.setAttribute('aria-hidden', String(!visible));
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.tabIndex = visible ? 0 : -1;
  });
}

function handleAutoHideEnter(): void {
  if (isPinned) return;

  clearHideTimer();
  setSidebarHidden(false);
}

function scheduleAutoHide(): void {
  if (isPinned) return;

  clearHideTimer();
  const controlsVisible = sidebar?.querySelector('.navigator-jump-controls-visible');
  hideTimer = window.setTimeout(() => {
    if (
      isPointerInside(sidebar) ||
      isPointerInside(toggleBtn) ||
      isPointerInsidePreviewTooltip() ||
      isPointerInsideContextMenu()
    ) {
      return;
    }

    setSidebarHidden(true);
  }, controlsVisible ? EDGE_TOOL_HIDE_DELAY_MS : AUTO_HIDE_DELAY_MS);
}

/**
 * @param {boolean} pinned
 * @param {{ persist?: boolean }} options
 */
export function setSidebarPinned(
  pinned: boolean,
  options: { persist?: boolean } = {}
): void {
  isPinned = pinned;
  clearHideTimer();

  updatePinButtonState();

  if (isPinned) {
    setSidebarHidden(false);
  } else if (
    !isPointerInside(sidebar) &&
    !isPointerInside(toggleBtn) &&
    !isPointerInsidePreviewTooltip() &&
    !isPointerInsideContextMenu()
  ) {
    setSidebarHidden(true);
  }

  if (options.persist) {
    storageSet(PINNED_STORAGE_KEY, isPinned);
  }
}

/**
 * Applies the chosen layout mode. A new mode restores its default visibility;
 * a reload of the same mode retains the user's manual pin choice.
 */
export function setSidebarLayoutMode(mode: SidebarLayoutMode): void {
  if (activeLayoutMode === mode) return;
  activeLayoutMode = mode;
  const lastSavedMode = storageGet<SidebarLayoutMode>(LAYOUT_MODE_STORAGE_KEY);
  const savedPin = storageGet<boolean>(PINNED_STORAGE_KEY);
  const pinned = lastSavedMode === mode && typeof savedPin === 'boolean'
    ? savedPin : mode === 'side-by-side';
  isPinned = pinned;
  storageSet(LAYOUT_MODE_STORAGE_KEY, mode);
  storageSet(PINNED_STORAGE_KEY, pinned);
  clearHideTimer();
  updatePinButtonState();
  setSidebarHidden(!pinned);
}

function loadPinnedState(): void {
  const savedPinned = getSavedPinnedState();
  // Start collapsed unless the user explicitly pinned this tab.
  const nextPinned = typeof savedPinned === 'boolean' ? savedPinned : false;

  isPinned = nextPinned;
  clearHideTimer();
  updatePinButtonState();
  setSidebarHidden(!isPinned);
}

/**
 * Loads the tab-wide pin state and migrates the current route's legacy
 * conversation-scoped value when the tab has not stored a global value yet.
 * @returns {boolean | null}
 */
function getSavedPinnedState(): boolean | null {
  const savedPinned = storageGet<boolean>(PINNED_STORAGE_KEY);

  if (typeof savedPinned === 'boolean') {
    return savedPinned;
  }

  const legacyPinned = storageGet<boolean>(
    `${LEGACY_PINNED_STORAGE_PREFIX}${getLegacyPageKey()}`
  );

  if (typeof legacyPinned === 'boolean') {
    storageSet(PINNED_STORAGE_KEY, legacyPinned);
    return legacyPinned;
  }

  return null;
}

/**
 * Returns the legacy per-conversation storage suffix for one-time migration.
 * @returns {string}
 */
function getLegacyPageKey(): string {
  const match = location.pathname.match(/\/c\/([^/]+)/);

  return match?.[1] || `new-chat:${location.pathname}`;
}

function updatePinButtonState(): void {
  pinBtn?.classList.toggle('luna-toc-sidebar-pin-active', isPinned);
  pinBtn?.setAttribute('aria-pressed', String(isPinned));
  pinBtn?.setAttribute(
    'aria-label',
    isPinned ? '启用侧边栏自动隐藏' : '固定侧边栏'
  );
}

function finishInitializing(): void {
  sidebar?.classList.remove('luna-toc-navigator-initializing');

  window.requestAnimationFrame(() => {
    sidebar?.classList.add('luna-toc-navigator-ready');
  });
}

/**
 * @param {boolean} hidden
 */
export function setSidebarHidden(hidden: boolean): void {
  const justOpened = isHidden && !hidden;
  const justClosed = !isHidden && hidden;
  isHidden = hidden;
  if (hidden) {
    clearEdgeToolTimer();
    clearEdgeToolHideTimer();
    mustLeaveEdgeBeforeTools = false;
  }

  // The menu lives in a separate React portal, outside the collapsing sidebar.
  // Explicitly dismiss it so no orphaned actions remain visible or interactive.
  if (hidden) promptContextMenuController.close();

  sidebar?.classList.toggle('luna-toc-navigator-hidden', isHidden);
  sidebar?.setAttribute('aria-hidden', String(isHidden));
  if (sidebar && 'inert' in sidebar) {
    sidebar.inert = isHidden;
  }
  toggleBtn?.classList.toggle('luna-toc-sidebar-hidden', isHidden);
  toggleBtn?.classList.toggle('luna-toc-sidebar-visible', !isHidden);
  toggleBtn?.setAttribute('aria-expanded', String(!isHidden));
  const dock = document.getElementById('luna-toc-floating-dock');
  dock?.classList.toggle('luna-toc-floating-dock-hidden', !isHidden);
  dock?.setAttribute('aria-hidden', String(!isHidden));
  if (dock) dock.inert = !isHidden;
  setJumpControlsVisible(false);
  syncChatGptSideBySide();
  if (justOpened) onOpened?.();
  if (justClosed) onClosed?.();
}

/** Starts a cancellable 400ms grace period after leaving the edge/buttons. */
function scheduleJumpControlsHide(): void {
  const controls = sidebar?.querySelector<HTMLElement>('.navigator-jump-controls');
  if (!controls?.classList.contains('navigator-jump-controls-visible') ||
      controls.contains(document.activeElement) || edgeToolHideTimer) return;
  edgeToolHideTimer = window.setTimeout(() => {
    edgeToolHideTimer = 0;
    setJumpControlsVisible(false);
  }, EDGE_TOOL_HIDE_DELAY_MS);
}

/** Cancels a pending toolbar hide when the pointer returns. */
function clearEdgeToolHideTimer(): void {
  if (!edgeToolHideTimer) return;
  window.clearTimeout(edgeToolHideTimer);
  edgeToolHideTimer = 0;
}

/** Cancels any right-edge dwell without changing the sidebar visibility. */
function clearEdgeToolTimer(): void {
  if (!edgeToolTimer) return;
  window.clearTimeout(edgeToolTimer);
  edgeToolTimer = 0;
}

function clearHideTimer(): void {
  if (!hideTimer) return;

  window.clearTimeout(hideTimer);
  hideTimer = 0;
}

/**
 * @param {Element | null} element
 * @returns {boolean}
 */
function isPointerInside(element: Element | null): boolean {
  if (!element) return false;

  return element.matches(':hover');
}

function isPointerInsidePreviewTooltip(): boolean {
  const tooltip = document.getElementById('luna-toc-preview-tooltip');
  return (
    !!tooltip &&
    tooltip.classList.contains('luna-toc-tooltip-visible') &&
    tooltip.matches(':hover')
  );
}

function isPointerInsideContextMenu(): boolean {
  const host = document.getElementById('luna-toc-react-host');
  return (
    !!host?.hasAttribute('data-luna-toc-context-menu-open') &&
    isPointerInside(host)
  );
}

function handleDocumentPointerOver(event: Event): void {
  if (!isSidebarExtensionSurfaceEvent(event)) return;

  if (isPinned) return;

  clearHideTimer();
  setSidebarHidden(false);
}

function handleDocumentPointerOut(event: Event): void {
  if (!isSidebarExtensionSurfaceEvent(event)) return;

  scheduleAutoHide();
}

function isSidebarExtensionSurfaceEvent(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  return !!target.closest(
    '#luna-toc-preview-tooltip, #luna-toc-react-host[data-luna-toc-context-menu-open]'
  );
}

function storageGet<T>(key: string): T | null {
  try {
    const rawValue = sessionStorage.getItem(key);

    return rawValue ? (JSON.parse(rawValue) as T) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
