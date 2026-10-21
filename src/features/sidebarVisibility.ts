/**
 * Owns LunaTOC sidebar visibility, pinning, and auto-hide behavior.
 */
 const PINNED_STORAGE_KEY = 'chatTocSidebarPinned';
const LEGACY_PINNED_STORAGE_PREFIX = 'chatTocSidebarPinned:';
const AUTO_HIDE_DELAY_MS = 300;

let sidebar: HTMLElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let pinBtn: HTMLElement | null = null;
let isPinned = false;
let isHidden = true;
let hideTimer = 0;
let onOpened: (() => void) | null = null;
/**
 * @param {HTMLElement} sidebarElement
 * @param {HTMLButtonElement} toggleButton
 */
export function initializeSidebarVisibility(
  sidebarElement: HTMLElement,
  toggleButton: HTMLButtonElement,
  options: { onOpened?: () => void } = {}
): void {
  onOpened = options.onOpened ?? null;
  sidebar = sidebarElement;
  toggleBtn = toggleButton;
  pinBtn = document.getElementById('luna-toc-sidebar-pin-btn');

  bindPinButton();
  bindToggleButton();
  bindAutoHide();
  loadPinnedState();
  finishInitializing();
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

  button.addEventListener('click', (event) => {
    if (button.dataset.dragged === 'true') {
      event.preventDefault();
      button.dataset.dragged = 'false';
      return;
    }

    clearHideTimer();
    setSidebarHidden(!isHidden);
  });
}

function bindAutoHide(): void {
  if (!sidebar || !toggleBtn) return;

  sidebar.addEventListener('pointerenter', handleAutoHideEnter);
  toggleBtn.addEventListener('pointerenter', handleAutoHideEnter);
  sidebar.addEventListener('pointerleave', scheduleAutoHide);
  toggleBtn.addEventListener('pointerleave', scheduleAutoHide);

  document.addEventListener('pointerover', handleDocumentPointerOver, true);
  document.addEventListener('pointerout', handleDocumentPointerOut, true);
}

function handleAutoHideEnter(): void {
  if (isPinned) return;

  clearHideTimer();
  setSidebarHidden(false);
}

function scheduleAutoHide(): void {
  if (isPinned) return;

  clearHideTimer();
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
  }, AUTO_HIDE_DELAY_MS);
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
  isHidden = hidden;

  sidebar?.classList.toggle('luna-toc-navigator-hidden', isHidden);
  sidebar?.setAttribute('aria-hidden', String(isHidden));
  if (sidebar && 'inert' in sidebar) {
    sidebar.inert = isHidden;
  }
  toggleBtn?.classList.toggle('luna-toc-sidebar-hidden', isHidden);
  toggleBtn?.classList.toggle('luna-toc-sidebar-visible', !isHidden);
  if (justOpened) onOpened?.();
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
