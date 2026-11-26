/**
 * Shared tooltips for ChatTOC:
 * 1. Preview tooltip: For viewing truncated prompt text in the sidebar.
 * 2. Button tooltip: For showing fast, custom floating tooltips on buttons and icons.
 */

// 1. Preview Tooltip Module
export interface PreviewTooltipContent {
  title?: string;
  content?: string;
  originalPrompt?: string;
  customTitle?: string;
}

/**
 * Reports whether an element's single-line text exceeds its visible width.
 *
 * @example
 * isElementTextTruncated(document.getElementById('navigator-title')!);
 */
export function isElementTextTruncated(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

export const previewTooltip = (() => {
  const SHOW_DELAY_MS = 500;
  const HIDE_DELAY_MS = 200;

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let anchorSelector: string | null = null;

  /**
   * Creates the tooltip element and wires tooltip hover behavior.
   * @param {Object} options
   * @param {string} options.anchorSelector Selector used to position the tooltip beside the sidebar.
   */
  function init(options: { anchorSelector?: string } = {}): void {
    anchorSelector = options.anchorSelector || null;

    create();

    const tooltip = getTooltip();
    if (!tooltip) return;
    if (tooltip.dataset.initialized === 'true') return;

    tooltip.dataset.initialized = 'true';

    tooltip.addEventListener('mouseenter', () => {
      if (hideTimer !== null) clearTimeout(hideTimer);
    });

    tooltip.addEventListener('mouseleave', () => {
      hide();
    });
  }

  /**
   * Creates the tooltip element if it does not already exist.
   */
  function create(): void {
    if (document.getElementById('luna-toc-preview-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.id = 'luna-toc-preview-tooltip';
    document.body.appendChild(tooltip);
  }

  /**
   * Shows a tooltip with the full prompt text near the hovered row.
   * @param {string} text
   * @param {MouseEvent} event
   * @param {HTMLElement} [anchorElement] Element whose top edge anchors the tooltip vertically.
   */
  function show(
    text: string | PreviewTooltipContent,
    event: MouseEvent,
    anchorElement?: HTMLElement
  ): void {
    const tooltip = getTooltip();
    if (!tooltip) return;

    if (hideTimer !== null) clearTimeout(hideTimer);
    if (showTimer !== null) clearTimeout(showTimer);

    hideTimer = null;
    showTimer = null;
    tooltip.classList.remove('luna-toc-tooltip-visible');

    const clientX = event.clientX;
    const clientY = event.clientY;

    showTimer = setTimeout(() => {
      showTimer = null;
      if (!tooltip.isConnected) return;
      if (anchorElement && !anchorElement.isConnected) return;

      tooltip.innerHTML = '';
      if (typeof text === 'object' && text !== null) {
        if (text.customTitle && text.originalPrompt) {
          tooltip.innerHTML =
            '<div class="navigator-preview-tooltip-custom"></div>' +
            '<div class="navigator-preview-tooltip-original"></div>';
          const customEl = tooltip.querySelector<HTMLElement>(
            '.navigator-preview-tooltip-custom'
          );
          const origEl = tooltip.querySelector<HTMLElement>(
            '.navigator-preview-tooltip-original'
          );
          if (customEl) customEl.textContent = text.customTitle;
          if (origEl) origEl.textContent = text.originalPrompt;
        } else if (text.title && text.content) {
          const titleEl = document.createElement('div');
          titleEl.className = 'navigator-preview-tooltip-title';
          titleEl.textContent = text.title;

          const contentEl = document.createElement('div');
          contentEl.className = 'navigator-preview-tooltip-content';
          contentEl.textContent = text.content;

          tooltip.appendChild(titleEl);
          tooltip.appendChild(contentEl);
        }
      } else {
        const contentEl = document.createElement('div');
        contentEl.className = 'navigator-preview-tooltip-content';
        contentEl.textContent = text;
        tooltip.appendChild(contentEl);
      }
      tooltip.classList.add('luna-toc-tooltip-visible');
      positionTooltip(tooltip, clientX, clientY, anchorElement);
    }, SHOW_DELAY_MS);
  }

  /**
   * Hides the tooltip after a short delay so pointer transitions are not abrupt.
   * If immediate is true, cancels pending timers and removes the visible class immediately.
   *
   * @param {boolean} [immediate=false]
   */
  function hide(immediate: boolean = false): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    if (showTimer !== null) clearTimeout(showTimer);

    showTimer = null;

    const tooltip = getTooltip();
    if (!tooltip) return;

    if (immediate) {
      tooltip.classList.remove('luna-toc-tooltip-visible');
      hideTimer = null;
      return;
    }

    hideTimer = setTimeout(() => {
      tooltip.classList.remove('luna-toc-tooltip-visible');
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
  function positionTooltip(
    tooltip: HTMLElement,
    clientX: number,
    clientY: number,
    anchorElement?: HTMLElement
  ): void {
    const gap = 8;
    const margin = 16;
    let anchor: Element | null = null;
    if (anchorSelector) {
      for (const candidate of document.querySelectorAll(anchorSelector)) {
        if (
          candidate instanceof HTMLElement &&
          candidate.style.display !== 'none'
        ) {
          anchor = candidate;
          break;
        }
      }
      if (!anchor) {
        anchor = document.querySelector(anchorSelector);
      }
    }
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
  function getTooltip(): HTMLElement | null {
    return document.getElementById('luna-toc-preview-tooltip');
  }

  return {
    hide,
    init,
    show,
  };
})();

// 2. Button/Icon Label Tooltip Module
export const buttonTooltip = (() => {
  let tooltipElement: HTMLDivElement | null = null;
  let activeTarget: HTMLElement | null = null;
  let boundBody: HTMLElement | null = null;

  /**
   * Creates or rebinds the button tooltip element.
   */
  function create(): void {
    const existing = document.getElementById('luna-toc-button-tooltip');
    if (existing instanceof HTMLDivElement && existing.isConnected) {
      tooltipElement = existing;
      return;
    }

    tooltipElement = document.createElement('div');
    tooltipElement.id = 'luna-toc-button-tooltip';
    document.documentElement.appendChild(tooltipElement);
  }

  function handleMouseOver(event: MouseEvent): void {
    if (activeTarget && !activeTarget.isConnected) {
      hide();
    }

    const target = getClosestElement(event, '[title], [data-tooltip]');
    if (!target) {
      if (activeTarget) {
        hide();
      }
      return;
    }

    // Ignore elements outside our extension sidebar and toggle buttons
    const isInsideSidebar = target.closest('#luna-toc-sidebar');
    const isSidebarToggle = target.closest('#luna-toc-toggle-btn');
    const isControls = target.closest('.navigator-jump-controls');
    if (!isInsideSidebar && !isSidebarToggle && !isControls) {
      if (activeTarget) {
        hide();
      }
      return;
    }

    if (
      target.dataset.tooltipOverflowOnly === 'true' &&
      !isElementTextTruncated(target)
    ) {
      if (activeTarget) {
        hide();
      }
      return;
    }

    if (target === activeTarget) return;
    activeTarget = target;

    // Extract title and convert to data-tooltip to disable native slow tooltip
    if (target.hasAttribute('title')) {
      const titleText = target.getAttribute('title');
      if (titleText) target.setAttribute('data-tooltip', titleText);
      target.removeAttribute('title');
    }

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    show(target, text);
  }

  function handleMouseOut(event: MouseEvent): void {
    const target = getClosestElement(event, '[data-tooltip]');
    if (
      target &&
      target === activeTarget &&
      !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))
    ) {
      hide();
    }
  }

  function handleClick(event: MouseEvent): void {
    const target = getClosestElement(event, '[data-tooltip]');
    if (target) {
      hide();
    }
  }

  /**
   * Sets up event delegation for button tooltips, idempotent per document.body.
   */
  function init(): void {
    create();

    const body = document.body;
    if (!body) return;
    if (boundBody === body) return;

    if (boundBody) {
      boundBody.removeEventListener('mouseover', handleMouseOver);
      boundBody.removeEventListener('mouseout', handleMouseOut);
      boundBody.removeEventListener('click', handleClick);
      hide();
    }

    body.addEventListener('mouseover', handleMouseOver);
    body.addEventListener('mouseout', handleMouseOut);
    body.addEventListener('click', handleClick);
    boundBody = body;
  }

  /**
   * Shows the button tooltip instantly.
   * @param {HTMLElement} element
   * @param {string} text
   */
  function show(element: HTMLElement, text: string): void {
    if (!tooltipElement || !tooltipElement.isConnected) create();

    if (!tooltipElement) return;

    tooltipElement.textContent = text;
    tooltipElement.classList.add('luna-toc-tooltip-visible');

    positionTooltip(element);
  }

  /**
   * Hides the button tooltip instantly and clears activeTarget so re-hover works.
   */
  function hide(): void {
    if (tooltipElement) {
      tooltipElement.classList.remove('luna-toc-tooltip-visible');
    }
    activeTarget = null;
  }

  /**
   * Positions the button tooltip relative to its trigger element.
   * @param {HTMLElement} element
   */
  function positionTooltip(element: HTMLElement): void {
    if (!tooltipElement) return;
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
    } else {
      // 'top'
      x = rect.left + (rect.width - tooltipRect.width) / 2;
      y = rect.top - tooltipRect.height - gap;
    }

    // Keep tooltip inside screen boundaries
    x = Math.max(8, Math.min(x, window.innerWidth - tooltipRect.width - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - tooltipRect.height - 8));

    tooltipElement.style.left = `${x}px`;
    tooltipElement.style.top = `${y}px`;
  }

  function getClosestElement(
    event: Event,
    selector: string
  ): HTMLElement | null {
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>(selector)
      : null;
  }

  return {
    init,
    hide,
  };
})();
