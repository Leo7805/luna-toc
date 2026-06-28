/**
 * Builds and manages the floating ChatTOC sidebar toggle button.
 */
(function () {
  const POSITION_MARGIN = 8;
  const RIGHT_POSITION_MARGIN = 0;
  const POSITION_STORAGE_KEY = 'chatTocToggleButtonPosition';

  /**
   * Creates the floating toggle button.
   * @returns {HTMLButtonElement}
   */
  function create() {
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
   * Enables pointer dragging for the current page session.
   * @param {HTMLButtonElement} toggleBtn
   */
  function initDrag(toggleBtn) {
    window.addEventListener('resize', () => {
      keepButtonInViewport(toggleBtn);
    });

    toggleBtn.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;

      const rect = toggleBtn.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      let didDrag = false;

      toggleBtn.setPointerCapture(event.pointerId);
      toggleBtn.classList.add('luna-toc-toggle-btn-dragging');

      function handlePointerMove(moveEvent) {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        if (!didDrag && Math.hypot(deltaX, deltaY) < 4) {
          return;
        }

        didDrag = true;

        const nextPosition = clampPosition(
          startLeft + deltaX,
          startTop + deltaY,
          rect.width,
          rect.height
        );

        setPosition(toggleBtn, nextPosition.left, nextPosition.top);
      }

      function handlePointerUp() {
        toggleBtn.releasePointerCapture(event.pointerId);
        toggleBtn.classList.remove('luna-toc-toggle-btn-dragging');
        toggleBtn.removeEventListener('pointermove', handlePointerMove);
        toggleBtn.removeEventListener('pointerup', handlePointerUp);
        toggleBtn.removeEventListener('pointercancel', handlePointerUp);

        if (!didDrag) return;

        toggleBtn.dataset.dragged = 'true';
        savePosition(toggleBtn);
      }

      toggleBtn.addEventListener('pointermove', handlePointerMove);
      toggleBtn.addEventListener('pointerup', handlePointerUp);
      toggleBtn.addEventListener('pointercancel', handlePointerUp);
    });
  }

  /**
   * Applies a fixed viewport position to the toggle button.
   * @param {HTMLButtonElement} toggleBtn
   * @param {number} left
   * @param {number} top
   */
  function setPosition(toggleBtn, left, top) {
    toggleBtn.style.left = `${left}px`;
    toggleBtn.style.top = `${top}px`;
    toggleBtn.style.right = 'auto';
    toggleBtn.style.bottom = 'auto';
  }

  /**
   * Re-clamps the current session position after viewport size changes.
   * @param {HTMLButtonElement} toggleBtn
   */
  function keepButtonInViewport(toggleBtn) {
    const rect = toggleBtn.getBoundingClientRect();
    const nextPosition = clampPosition(
      rect.left,
      rect.top,
      rect.width,
      rect.height
    );

    if (nextPosition.left === rect.left && nextPosition.top === rect.top) {
      return;
    }

    setPosition(toggleBtn, nextPosition.left, nextPosition.top);
    savePosition(toggleBtn);
  }

  /**
   * Keeps the button fully inside the viewport.
   * @param {number} left
   * @param {number} top
   * @param {number} width
   * @param {number} height
   * @returns {{ left: number, top: number }}
   */
  function clampPosition(left, top, width, height) {
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

  function restorePosition(toggleBtn) {
    const savedPosition = storageGet(POSITION_STORAGE_KEY);

    if (!savedPosition || typeof savedPosition !== 'object') return;
    if (
      !Number.isFinite(savedPosition.left) ||
      !Number.isFinite(savedPosition.top)
    ) {
      return;
    }

    const rect = toggleBtn.getBoundingClientRect();
    const nextPosition = clampPosition(
      savedPosition.left,
      savedPosition.top,
      rect.width,
      rect.height
    );

    setPosition(toggleBtn, nextPosition.left, nextPosition.top);
  }

  function savePosition(toggleBtn) {
    const rect = toggleBtn.getBoundingClientRect();

    storageSet(POSITION_STORAGE_KEY, {
      left: rect.left,
      top: rect.top,
    });
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

  window.ChatTocToggleButton = {
    create,
  };
})();
