/**
 * Renders a transient, independent `position: fixed` highlight overlay around
 * a target ChatGPT user-message container without mutating ChatGPT DOM nodes.
 */
import { APP_CONFIG } from '@/config/config';

export const DEFAULT_HIGHLIGHT_DURATION_MS = 2500;
const OVERLAY_ATTRIBUTE = 'data-luna-toc-highlight-overlay';

interface VisibleBounds {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface ActiveHighlightSession {
  target: HTMLElement;
  overlay: HTMLDivElement;
  container: HTMLElement | null;
  scrollTarget: EventTarget;
  getScrollContainer: () => HTMLElement | null;
  resolveTarget?: () => HTMLElement | null;
  timerId: ReturnType<typeof setTimeout>;
  rafId: number | null;
  onSync: () => void;
  lastStyleKey: string;
}

let activeSession: ActiveHighlightSession | null = null;

/**
 * Tears down a specific highlight session if it is still active.
 */
function teardownSession(session: ActiveHighlightSession): void {
  if (activeSession !== session) return;
  activeSession = null;

  clearTimeout(session.timerId);
  if (session.rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(session.rafId);
    session.rafId = null;
  }
  session.scrollTarget.removeEventListener('scroll', session.onSync);
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', session.onSync);
  }
  session.overlay.remove();
}

/**
 * Resolves the visible clipping rectangle by intersecting the browser viewport
 * with the active chat scroll container's bounding rect when measurable.
 */
function resolveVisibleBounds(container: HTMLElement | null): VisibleBounds {
  const viewportWidth =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : 0;
  const viewportHeight =
    typeof window !== 'undefined' && Number.isFinite(window.innerHeight)
      ? window.innerHeight
      : 0;

  let top = 0;
  let left = 0;
  let right = viewportWidth;
  let bottom = viewportHeight;

  if (container && container.isConnected) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      top = Math.max(top, rect.top);
      left = Math.max(left, rect.left);
      right = viewportWidth > 0 ? Math.min(right, rect.right) : rect.right;
      bottom = viewportHeight > 0 ? Math.min(bottom, rect.bottom) : rect.bottom;
    }
  }

  return { top, left, right, bottom };
}

/**
 * Synchronizes the overlay's fixed coordinates and `clip-path` with the target
 * element's live bounding rectangle. Tears down the session if the target has
 * disconnected, and skips redundant style writes when geometry is unchanged.
 */
function updateHighlightPosition(session: ActiveHighlightSession): void {
  if (activeSession !== session) return;

  if (!session.overlay.isConnected) {
    teardownSession(session);
    return;
  }

  if (!session.target.isConnected) {
    // Attempt identity-safe reattachment via the caller's message-ID resolver
    // when React/virtualizer reconciliation replaces the prompt DOM node.
    // Preserves the existing expiration timer without extending it.
    let replacement: HTMLElement | null = null;
    if (session.resolveTarget) {
      try {
        replacement = session.resolveTarget();
      } catch {
        replacement = null;
      }
    }
    if (replacement && replacement.isConnected) {
      session.target = replacement;
      session.lastStyleKey = '';
    } else {
      teardownSession(session);
      return;
    }
  }

  if (!session.container || !session.container.isConnected) {
    session.container = session.getScrollContainer();
  }

  const targetRect = session.target.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0) {
    if (session.lastStyleKey !== 'hidden') {
      session.overlay.style.display = 'none';
      session.lastStyleKey = 'hidden';
    }
    return;
  }

  const bounds = resolveVisibleBounds(session.container);
  const isOutsideBounds =
    targetRect.bottom <= bounds.top ||
    targetRect.top >= bounds.bottom ||
    targetRect.right <= bounds.left ||
    targetRect.left >= bounds.right;

  if (isOutsideBounds) {
    if (session.lastStyleKey !== 'hidden') {
      session.overlay.style.display = 'none';
      session.lastStyleKey = 'hidden';
    }
    return;
  }

  const clipTop = Math.max(0, bounds.top - targetRect.top);
  const clipRight = Math.max(0, targetRect.right - bounds.right);
  const clipBottom = Math.max(0, targetRect.bottom - bounds.bottom);
  const clipLeft = Math.max(0, bounds.left - targetRect.left);
  const clipPath =
    clipTop > 0 || clipRight > 0 || clipBottom > 0 || clipLeft > 0
      ? `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`
      : '';

  const styleKey = `${targetRect.top}|${targetRect.left}|${targetRect.width}|${targetRect.height}|${clipPath}`;
  if (session.lastStyleKey === styleKey) {
    return;
  }
  session.lastStyleKey = styleKey;

  const { style } = session.overlay;
  style.display = 'block';
  style.top = `${targetRect.top}px`;
  style.left = `${targetRect.left}px`;
  style.width = `${targetRect.width}px`;
  style.height = `${targetRect.height}px`;
  style.clipPath = clipPath;
}

/**
 * Removes any currently active prompt highlight overlay and cancels its timer,
 * event listeners, and animation frame. Safe to call repeatedly.
 *
 * @example
 * clearPromptHighlightOverlay();
 */
export function clearPromptHighlightOverlay(): void {
  if (activeSession) {
    teardownSession(activeSession);
  }
}

/**
 * Displays a temporary blue highlight rectangle over `target` using an
 * independent `position: fixed` overlay appended to `document.body`.
 * Defaults to 2500ms so the highlight stays clearly visible after alignment.
 *
 * Starting a new highlight immediately tears down any prior highlight session.
 *
 * @param target The rendered prompt element to highlight.
 * @param getScrollContainer Resolves the active chat scroll container for clipping and scroll sync.
 * @param durationMs Optional visibility duration in milliseconds (default 2500ms).
 *
 * @example
 * highlightPromptElement(promptElement, () => getChatGptScrollContainer());
 */
export function highlightPromptElement(
  target: HTMLElement,
  getScrollContainer: () => HTMLElement | null,
  durationMs: number = DEFAULT_HIGHLIGHT_DURATION_MS,
  resolveTarget?: () => HTMLElement | null
): void {
  clearPromptHighlightOverlay();

  if (
    !target.isConnected ||
    typeof document === 'undefined' ||
    !document.body
  ) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.setAttribute(OVERLAY_ATTRIBUTE, 'true');
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.boxSizing = 'border-box';
  overlay.style.border = '2px solid #60a5fa';
  overlay.style.borderRadius = '8px';
  overlay.style.background = 'transparent';
  overlay.style.margin = '0';
  overlay.style.zIndex = String(APP_CONFIG.ui.stacking.baseZIndex - 1);
  document.body.appendChild(overlay);

  const container = getScrollContainer();
  const scrollTarget: EventTarget =
    container && container.isConnected ? container : window;

  const session: ActiveHighlightSession = {
    target,
    overlay,
    container: container && container.isConnected ? container : null,
    scrollTarget,
    getScrollContainer,
    resolveTarget,
    timerId: setTimeout(() => {
      teardownSession(session);
    }, durationMs),
    rafId: null,
    onSync: () => {
      updateHighlightPosition(session);
    },
    lastStyleKey: '',
  };

  activeSession = session;

  scrollTarget.addEventListener('scroll', session.onSync, { passive: true });
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', session.onSync, { passive: true });
  }

  updateHighlightPosition(session);

  if (activeSession === session && typeof requestAnimationFrame === 'function') {
    let isTicking = false;
    const tick = () => {
      if (activeSession !== session || isTicking) return;
      isTicking = true;
      try {
        session.rafId = null;
        updateHighlightPosition(session);
        if (activeSession !== session) return;
        session.rafId = requestAnimationFrame(tick);
      } finally {
        isTicking = false;
      }
    };
    session.rafId = requestAnimationFrame(tick);
  }
}
