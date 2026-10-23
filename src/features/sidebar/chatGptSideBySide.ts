/**
 * Reserves space beside ChatGPT's conversation surface in side-by-side mode.
 * Never shifts body or changes the host page's responsive media queries.
 */
const CHAT_SURFACE_CLASS = 'luna-toc-chat-side-by-side';
const WIDTH_PROPERTY = '--luna-toc-reserved-sidebar-width';
const MIN_AVAILABLE_CHAT_WIDTH_PX = 560;
const CHAT_CONTENT_SELECTOR = [
  '#thread',
  '#thread-bottom-container',
  '#prompt-textarea',
  '[data-turn]',
  '[data-testid^="conversation-turn"]',
  '.ProseMirror[contenteditable="true"]',
].join(', ');

let sidebar: HTMLElement | null = null;
let layoutEnabled = false;
let currentChatSurface: HTMLElement | null = null;
let sidebarSizeObserver: ResizeObserver | null = null;
let chatTreeObserver: MutationObserver | null = null;

/**
 * Chooses the actual chat surface, not the app root: the latter may be fixed
 * at viewport width while its inner <main> owns message/composer layout.
 */
function getChatGptChatSurface(): HTMLElement | null {
  if (!document.body) return null;

  const candidates = Array.from(
    document.body.querySelectorAll<HTMLElement>('main, [role="main"]')
  ).filter((candidate) =>
    !sidebar?.contains(candidate) &&
    !candidate.closest('[id^="luna-toc-"]') &&
    !candidate.id.startsWith('luna-toc-')
  );

  const main =
    candidates.find((candidate) =>
      candidate.querySelector(CHAT_CONTENT_SELECTOR)
    ) ??
    candidates.find((candidate) => candidate.tagName === 'MAIN') ??
    candidates[0] ??
    null;
  if (!main) return null;

  // Some ChatGPT layouts place the header beside <main> inside a dedicated
  // chat column. Prefer shrinking that column so its header moves as well,
  // but never select the wrapper containing ChatGPT's native navigation.
  const parent = main.parentElement;
  if (!parent || parent === document.body ||
      parent.id === 'root' || parent.id === '__next') return main;

  const siblings = Array.from(parent.children).filter((child) => child !== main);
  const hasHeaderSibling = siblings.some((child) =>
    child.matches('header, [role="banner"]') ||
    Boolean(child.querySelector('header, [role="banner"]'))
  );
  const hasNativeNavigation = siblings.some((child) =>
    child.matches('nav, #stage-slideover-sidebar') ||
    Boolean(child.querySelector('#stage-slideover-sidebar'))
  );
  return hasHeaderSibling && !hasNativeNavigation ? parent : main;
}

/** Returns the rendered sidebar width, falling back to the current drag size. */
function getSidebarWidthPx(element: HTMLElement): number {
  const rendered = element.getBoundingClientRect().width;
  if (rendered > 0) return Math.ceil(rendered);

  const configured = Number.parseFloat(
    element.style.getPropertyValue('--navigator-width')
  );
  return Number.isFinite(configured) && configured > 0
    ? Math.ceil(configured)
    : 0;
}

/** Removes only LunaTOC's styles from the previously selected chat surface. */
function restoreChatSurface(): void {
  currentChatSurface?.classList.remove(CHAT_SURFACE_CLASS);
  currentChatSurface?.style.removeProperty(WIDTH_PROPERTY);
  currentChatSurface = null;
}

/** Enables or disables the host-layout adapter for the selected mode. */
export function setChatGptSideBySideEnabled(enabled: boolean): void {
  layoutEnabled = enabled;
  syncChatGptSideBySide();
}

/**
 * Reserves the sidebar width inside ChatGPT's actual content surface.
 * Narrow viewports retain the existing overlay layout.
 */
export function syncChatGptSideBySide(): void {
  // Avoid layout reads and DOM queries when the side-by-side view is inactive.
  if (!layoutEnabled || !sidebar ||
      sidebar.classList.contains('luna-toc-navigator-hidden') ||
      sidebar.getAttribute('aria-hidden') === 'true') {
    restoreChatSurface();
    return;
  }
  const width = getSidebarWidthPx(sidebar);
  if (width <= 0 || window.innerWidth - width < MIN_AVAILABLE_CHAT_WIDTH_PX) {
    restoreChatSurface();
    return;
  }
  const chatSurface = getChatGptChatSurface();
  const canReserve = chatSurface !== null;

  if (!canReserve || !chatSurface) {
    restoreChatSurface();
    return;
  }

  if (currentChatSurface !== chatSurface) {
    restoreChatSurface();
    currentChatSurface = chatSurface;
  }

  currentChatSurface.style.setProperty(WIDTH_PROPERTY, `${width}px`);
  currentChatSurface.classList.add(CHAT_SURFACE_CLASS);
}

/**
 * Installs resize and SPA-layout listeners. The host tree watcher only
 * recomputes when the chat surface is absent or has been replaced; token
 * streaming inside an unchanged conversation must not cause layout work.
 */
export function initializeChatGptSideBySide(element: HTMLElement): void {
  disposeChatGptSideBySide();
  sidebar = element;
  window.addEventListener('resize', syncChatGptSideBySide);

  if (typeof ResizeObserver !== 'undefined') {
    sidebarSizeObserver = new ResizeObserver(syncChatGptSideBySide);
    sidebarSizeObserver.observe(element);
  }

  if (document.body) {
    chatTreeObserver = new MutationObserver(() => {
      if (!layoutEnabled || !sidebar ||
          sidebar.classList.contains('luna-toc-navigator-hidden') ||
          sidebar.getAttribute('aria-hidden') === 'true') return;
      if (!currentChatSurface?.isConnected) syncChatGptSideBySide();
    });
    chatTreeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  syncChatGptSideBySide();
}

/** Releases observers and fully restores the host conversation layout. */
export function disposeChatGptSideBySide(): void {
  window.removeEventListener('resize', syncChatGptSideBySide);
  sidebarSizeObserver?.disconnect();
  chatTreeObserver?.disconnect();
  sidebarSizeObserver = null;
  chatTreeObserver = null;
  restoreChatSurface();
  sidebar = null;
  layoutEnabled = false;
}
