/**
 * Owns ChatTOC sidebar visibility, pinning, and auto-hide behavior.
 */
(function () {
  const PINNED_STORAGE_KEY = 'chatTocSidebarPinned';
  const LEGACY_PINNED_STORAGE_PREFIX = 'chatTocSidebarPinned:';
  const WIDTH_SPOOF_MESSAGE_TYPE = 'CHATGPT_NAVIGATOR_SET_WIDTH_SPOOF';
  const AUTO_HIDE_DELAY_MS = 300;

  let sidebar = null;
  let toggleBtn = null;
  let pinBtn = null;
  let isPinned = true;
  let isHidden = false;
  let hideTimer = 0;
  /**
   * @param {HTMLElement} sidebarElement
   * @param {HTMLButtonElement} toggleButton
   */
  function init(sidebarElement, toggleButton) {
    sidebar = sidebarElement;
    toggleBtn = toggleButton;
    pinBtn = document.getElementById('luna-toc-sidebar-pin-btn');

    bindPinButton();
    bindToggleButton();
    bindAutoHide();
    loadPinnedState();
    finishInitializing();
  }

  function bindPinButton() {
    if (!pinBtn) return;

    pinBtn.addEventListener('click', () => {
      setPinned(!isPinned, { persist: true });
    });
  }

  function bindToggleButton() {
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', (event) => {
      if (toggleBtn.dataset.dragged === 'true') {
        event.preventDefault();
        toggleBtn.dataset.dragged = 'false';
        return;
      }

      clearHideTimer();
      setHidden(!isHidden);
    });
  }

  function bindAutoHide() {
    if (!sidebar || !toggleBtn) return;

    sidebar.addEventListener('pointerenter', handleAutoHideEnter);
    toggleBtn.addEventListener('pointerenter', handleAutoHideEnter);
    sidebar.addEventListener('pointerleave', scheduleAutoHide);
    toggleBtn.addEventListener('pointerleave', scheduleAutoHide);

    document.addEventListener('pointerover', handleDocumentPointerOver, true);
    document.addEventListener('pointerout', handleDocumentPointerOut, true);
  }

  function handleAutoHideEnter() {
    if (isPinned) return;

    clearHideTimer();
    setHidden(false);
  }

  function scheduleAutoHide() {
    if (isPinned) return;

    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      if (
        isPointerInside(sidebar) ||
        isPointerInside(toggleBtn) ||
        isPointerInsidePreviewTooltip()
      ) {
        return;
      }

      setHidden(true);
    }, AUTO_HIDE_DELAY_MS);
  }

  /**
   * @param {boolean} pinned
   * @param {{ persist?: boolean }} options
   */
  function setPinned(pinned, options = {}) {
    isPinned = pinned;
    clearHideTimer();

    updatePinButtonState();

    if (isPinned) {
      setHidden(false);
    } else if (
      !isPointerInside(sidebar) &&
      !isPointerInside(toggleBtn) &&
      !isPointerInsidePreviewTooltip()
    ) {
      setHidden(true);
    }

    if (options.persist) {
      storageSet(PINNED_STORAGE_KEY, isPinned);
    }
  }

  function loadPinnedState() {
    const savedPinned = getSavedPinnedState();
    const nextPinned = typeof savedPinned === 'boolean' ? savedPinned : true;

    isPinned = nextPinned;
    clearHideTimer();
    updatePinButtonState();
    setHidden(isPinned ? false : true);
  }

  /**
   * Loads the tab-wide pin state and migrates the current route's legacy
   * conversation-scoped value when the tab has not stored a global value yet.
   * @returns {boolean | null}
   */
  function getSavedPinnedState() {
    const savedPinned = storageGet(PINNED_STORAGE_KEY);

    if (typeof savedPinned === 'boolean') {
      return savedPinned;
    }

    const legacyPinned = storageGet(
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
  function getLegacyPageKey() {
    const match = location.pathname.match(/\/c\/([^/]+)/);

    return match?.[1] || `new-chat:${location.pathname}`;
  }

  function updatePinButtonState() {
    pinBtn?.classList.toggle('luna-toc-sidebar-pin-active', isPinned);
    pinBtn?.setAttribute('aria-pressed', String(isPinned));
    pinBtn?.setAttribute(
      'aria-label',
      isPinned ? 'Enable sidebar auto-hide' : 'Pin sidebar open'
    );
  }

  function finishInitializing() {
    sidebar?.classList.remove('luna-toc-navigator-initializing');

    window.requestAnimationFrame(() => {
      sidebar?.classList.add('luna-toc-navigator-ready');
    });
  }

  /**
   * @param {boolean} hidden
   */
  function setHidden(hidden) {
    isHidden = hidden;

    sidebar?.classList.toggle('luna-toc-navigator-hidden', isHidden);
    sidebar?.setAttribute('aria-hidden', String(isHidden));
    if (sidebar && 'inert' in sidebar) {
      sidebar.inert = isHidden;
    }
    toggleBtn?.classList.toggle('luna-toc-sidebar-hidden', isHidden);
    toggleBtn?.classList.toggle('luna-toc-sidebar-visible', !isHidden);
    setWideViewportSpoofEnabled(!isHidden);
  }

  function clearHideTimer() {
    if (!hideTimer) return;

    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  /**
   * @param {Element | null} element
   * @returns {boolean}
   */
  function isPointerInside(element) {
    if (!element) return false;

    return element.matches(':hover');
  }

  function isPointerInsidePreviewTooltip() {
    const tooltip = document.getElementById('luna-toc-preview-tooltip');
    return (
      !!tooltip &&
      tooltip.classList.contains('luna-toc-tooltip-visible') &&
      tooltip.matches(':hover')
    );
  }

  function handleDocumentPointerOver(event) {
    if (!isTooltipEvent(event)) return;

    if (isPinned) return;

    clearHideTimer();
    setHidden(false);
  }

  function handleDocumentPointerOut(event) {
    if (!isTooltipEvent(event)) return;

    scheduleAutoHide();
  }

  function isTooltipEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    return !!target.closest('#luna-toc-preview-tooltip');
  }

  /**
   * Enables the page-context width spoof only while the ChatTOC sidebar is open.
   * @param {boolean} enabled
   */
  function setWideViewportSpoofEnabled(enabled) {
    window.postMessage(
      {
        type: WIDTH_SPOOF_MESSAGE_TYPE,
        enabled,
      },
      '*'
    );
  }

  function storageGet(key) {
    try {
      const rawValue = sessionStorage.getItem(key);

      return rawValue ? JSON.parse(rawValue) : null;
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  window.ChatTocSidebarVisibility = {
    init,
    setHidden,
    setPinned,
  };
})();
