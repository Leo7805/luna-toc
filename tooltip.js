/**
 * Shared tooltips for ChatTOC:
 * 1. ChatTocPreviewTooltip: For viewing truncated prompt text in the sidebar.
 * 2. ChatTocButtonTooltip: For showing fast, custom floating tooltips on buttons and icons.
 */

// 1. Preview Tooltip Module
(function () {
  const SHOW_DELAY_MS = 500;
  const HIDE_DELAY_MS = 200;

  let hideTimer = null;
  let showTimer = null;
  let anchorSelector = null;

  /**
   * Creates the tooltip element and wires tooltip hover behavior.
   * @param {Object} options
   * @param {string} options.anchorSelector Selector used to position the tooltip beside the sidebar.
   */
  function init(options = {}) {
    anchorSelector = options.anchorSelector || null;

    create();

    const tooltip = getTooltip();
    if (!tooltip) return;
    if (tooltip.dataset.initialized === 'true') return;

    tooltip.dataset.initialized = 'true';

    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
    });

    tooltip.addEventListener('mouseleave', () => {
      hide();
    });
  }

  /**
   * Creates the tooltip element if it does not already exist.
   */
  function create() {
    if (document.getElementById('navigator-preview-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.id = 'navigator-preview-tooltip';
    document.body.appendChild(tooltip);
  }

  /**
   * Shows a tooltip with the full prompt text near the hovered row.
   * @param {string} text
   * @param {MouseEvent} event
   * @param {HTMLElement} [anchorElement] Element whose top edge anchors the tooltip vertically.
   */
  function show(text, event, anchorElement) {
    const tooltip = getTooltip();
    if (!tooltip) return;

    clearTimeout(hideTimer);
    clearTimeout(showTimer);

    hideTimer = null;
    showTimer = null;
    tooltip.classList.remove('visible');

    const clientX = event.clientX;
    const clientY = event.clientY;

    showTimer = setTimeout(() => {
      tooltip.innerHTML = '';
      if (typeof text === 'object' && text !== null) {
        const titleEl = document.createElement('div');
        titleEl.className = 'navigator-preview-tooltip-title';
        titleEl.textContent = text.title;

        const contentEl = document.createElement('div');
        contentEl.className = 'navigator-preview-tooltip-content';
        contentEl.textContent = text.content;

        tooltip.appendChild(titleEl);
        tooltip.appendChild(contentEl);
      } else {
        const contentEl = document.createElement('div');
        contentEl.className = 'navigator-preview-tooltip-content';
        contentEl.textContent = text;
        tooltip.appendChild(contentEl);
      }
      tooltip.classList.add('visible');
      positionTooltip(tooltip, clientX, clientY, anchorElement);
    }, SHOW_DELAY_MS);
  }

  /**
   * Hides the tooltip after a short delay so pointer transitions are not abrupt.
   */
  function hide() {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);

    showTimer = null;

    const tooltip = getTooltip();
    if (!tooltip) return;

    hideTimer = setTimeout(() => {
      tooltip.classList.remove('visible');
      hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  /**
   * Positions the tooltip beside the sidebar while keeping it in the viewport.
   * @param {HTMLElement} tooltip
   * @param {number} clientX
   * @param {number} clientY
   * @param {HTMLElement} [anchorElement]
   */
  function positionTooltip(tooltip, clientX, clientY, anchorElement) {
    const gap = 8;
    const margin = 16;
    const anchor = anchorSelector ? document.querySelector(anchorSelector) : null;
    const anchorRect = anchor?.getBoundingClientRect();
    const tooltipAnchorRect = anchorElement?.getBoundingClientRect();

    let y = tooltipAnchorRect ? tooltipAnchorRect.top + 4 : clientY + 15;

    const rect = tooltip.getBoundingClientRect();
    const x = anchorRect
      ? Math.max(margin, anchorRect.left - rect.width - gap)
      : Math.max(margin, clientX - rect.width - gap);

    y = Math.max(margin, y);

    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - margin;
    }

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  /**
   * Returns the shared tooltip element.
   * @returns {HTMLElement | null}
   */
  function getTooltip() {
    return document.getElementById('navigator-preview-tooltip');
  }

  window.ChatTocPreviewTooltip = {
    hide,
    init,
    show,
  };
})();

// 2. Button/Icon Label Tooltip Module
(function () {
  let tooltipElement = null;
  let activeTarget = null;

  /**
   * Creates the button tooltip element.
   */
  function create() {
    if (document.getElementById('navigator-button-tooltip')) return;

    tooltipElement = document.createElement('div');
    tooltipElement.id = 'navigator-button-tooltip';
    document.body.appendChild(tooltipElement);
  }

  /**
   * Sets up event delegation for button tooltips.
   */
  function init() {
    create();

    // Listen globally for mouseover to implement instant popup
    document.body.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[title], [data-tooltip]');
      if (!target) {
        if (activeTarget) {
          hide();
          activeTarget = null;
        }
        return;
      }

      // Ignore elements outside our extension sidebar and toggle buttons
      const isInsideSidebar = target.closest('#conversation-navigator-sidebar');
      const isSidebarToggle = target.closest('#toggle-sidebar-btn');
      const isControls = target.closest('.navigator-jump-controls');
      if (!isInsideSidebar && !isSidebarToggle && !isControls) return;

      if (target === activeTarget) return;
      activeTarget = target;

      // Extract title and convert to data-tooltip to disable native slow tooltip
      if (target.hasAttribute('title')) {
        const titleText = target.getAttribute('title');
        target.setAttribute('data-tooltip', titleText);
        target.removeAttribute('title');
      }

      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      show(target, text);
    });

    document.body.addEventListener('mouseout', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target && target === activeTarget) {
        hide();
        activeTarget = null;
      }
    });

    // Instantly hide tooltip if the user clicks the button
    document.body.addEventListener('click', (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (target) {
        hide();
        activeTarget = null;
      }
    });
  }

  /**
   * Shows the button tooltip instantly.
   * @param {HTMLElement} element
   * @param {string} text
   */
  function show(element, text) {
    if (!tooltipElement) create();

    tooltipElement.textContent = text;
    tooltipElement.classList.add('visible');

    positionTooltip(element);
  }

  /**
   * Hides the button tooltip instantly.
   */
  function hide() {
    if (tooltipElement) {
      tooltipElement.classList.remove('visible');
    }
  }

  /**
   * Positions the button tooltip relative to its trigger element.
   * @param {HTMLElement} element
   */
  function positionTooltip(element) {
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const gap = 6;

    let x = 0;
    let y = 0;

    // Check for custom position overrides, or fallback to auto-positioning
    let position = element.getAttribute('data-tooltip-position');
    if (!position) {
      if (rect.right > window.innerWidth - 60) {
        // Near right edge of screen (floating controls)
        position = 'left';
      } else if (rect.top < 60) {
        // Near top of sidebar (header buttons)
        position = 'bottom';
      } else {
        // Default (list items, etc.)
        position = 'top';
      }
    }

    if (position === 'left') {
      x = rect.left - tooltipRect.width - gap;
      y = rect.top + (rect.height - tooltipRect.height) / 2;
    } else if (position === 'bottom') {
      x = rect.left + (rect.width - tooltipRect.width) / 2;
      y = rect.bottom + gap;
    } else { // 'top'
      x = rect.left + (rect.width - tooltipRect.width) / 2;
      y = rect.top - tooltipRect.height - gap;
    }

    // Keep tooltip inside screen boundaries
    x = Math.max(8, Math.min(x, window.innerWidth - tooltipRect.width - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - tooltipRect.height - 8));

    tooltipElement.style.left = `${x}px`;
    tooltipElement.style.top = `${y}px`;
  }

  window.ChatTocButtonTooltip = {
    init,
    hide,
  };
})();
