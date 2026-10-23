/**
 * Tracks the visible active prompt in the chat viewport using top-boundary
 * viewport geometry, requestAnimationFrame throttling, and MutationObserver.
 */
import { getActivePlatform } from '@/platforms';
import type { Platform } from '@/platforms/platformInterface';

export interface ActivePromptTrackerOptions {
  /**
   * Returns current conversation messages to match DOM elements against message IDs.
   */
  getMessages: () => Array<{ id: string }>;
  /**
   * Called when active index is updated.
   * @param index The active prompt index.
   * @param changed True if the index is different from the previous active index.
   */
  onActiveIndexChange?: (index: number, changed: boolean) => void;
  /**
   * Optional platform resolver for dependency injection in tests.
   */
  getPlatform?: () => Platform;
}

export interface ActivePromptTracker {
  getActiveIndex(): number | null;
  findConversationIndexByElement(element: HTMLElement): number;
  checkActivePrompt(): void;
  initTracking(): void;
  disconnect(): void;
  reset(): void;
}

/**
 * Creates an instance-scoped tracker for viewport-active prompt detection.
 *
 * @param options Configuration and callback options.
 * @returns Isolated ActivePromptTracker instance.
 */
export function createActivePromptTracker(
  options: ActivePromptTrackerOptions
): ActivePromptTracker {
  let activeNavigatorIndex: number | null = null;
  let activePromptMutationObserver: MutationObserver | null = null;
  let isTracking = false;
  let rafId: number | null = null;

  function resolvePlatform(): Platform {
    return options.getPlatform ? options.getPlatform() : getActivePlatform();
  }

  function getActiveIndex(): number | null {
    return activeNavigatorIndex;
  }

  function findConversationIndexByElement(
    element: HTMLElement,
    indexByMessageId: ReadonlyMap<string, number> = buildMessageIndex()
  ): number {
    const platform = resolvePlatform();
    const id =
      platform.navigation.getMessageIdFromElement?.(element) ??
      (platform.config.selectors.messageId
        ? element.getAttribute(platform.config.selectors.messageId) ||
          element
            .closest<HTMLElement>(`[${platform.config.selectors.messageId}]`)
            ?.getAttribute(platform.config.selectors.messageId)
        : null);
    if (!id) return -1;
    return indexByMessageId.get(id) ?? -1;
  }

  function buildMessageIndex(): Map<string, number> {
    return new Map(options.getMessages().map((message, index) => [message.id, index]));
  }

  function checkActivePrompt(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const platform = resolvePlatform();
    const container =
      platform.navigation.getThreadScrollContainer?.() ??
      platform.navigation.getScrollContainer?.() ??
      null;
    const containerTop = container ? container.getBoundingClientRect().top : 0;
    // Aligns with promptNavigation landing geometry: elements land at `containerTop + promptTopOffsetPx`
    // via scrollMarginTop. Aligning the activation boundary ensures that landing at the intended top
    // position immediately and consistently activates the target prompt.
    const targetOffset = platform.navigation.promptTopOffsetPx ?? 16;
    const SUBPIXEL_TOLERANCE_PX = 2;
    const referenceBoundary = containerTop + targetOffset + SUBPIXEL_TOLERANCE_PX;

    const userSelector = platform.config.selectors.userMessage;
    if (!userSelector || typeof document === 'undefined') return;

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(userSelector)
    );
    if (elements.length === 0) return;

    let latestAboveTop: number | null = null;
    let lowestMountedIndex: number | null = null;
    // Index messages once per check rather than linearly scanning for each DOM node.
    const indexByMessageId = buildMessageIndex();

    for (const element of elements) {
      const index = findConversationIndexByElement(element, indexByMessageId);
      if (index === -1) continue;

      if (lowestMountedIndex === null || index < lowestMountedIndex) {
        lowestMountedIndex = index;
      }

      const rect = element.getBoundingClientRect();
      if (rect.top <= referenceBoundary) {
        if (latestAboveTop === null || index > latestAboveTop) {
          latestAboveTop = index;
        }
      }
    }

    let nextIndex: number | null = null;
    if (latestAboveTop !== null) {
      nextIndex = latestAboveTop;
    } else if (lowestMountedIndex === 0) {
      nextIndex = 0;
    } else {
      nextIndex =
        activeNavigatorIndex ??
        (lowestMountedIndex !== null
          ? Math.max(0, lowestMountedIndex - 1)
          : null);
    }

    if (nextIndex !== null && nextIndex !== activeNavigatorIndex) {
      const changed = activeNavigatorIndex !== nextIndex;
      activeNavigatorIndex = nextIndex;
      options.onActiveIndexChange?.(nextIndex, changed);
    }
  }

  function scheduleGeometryCheck(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof requestAnimationFrame === 'undefined') {
      checkActivePrompt();
      return;
    }
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      checkActivePrompt();
    });
  }

  function handleScroll(): void {
    scheduleGeometryCheck();
  }

  function initTracking(): void {
    if (typeof document === 'undefined') return;
    if (isTracking) return;
    isTracking = true;

    document.addEventListener('scroll', handleScroll, {
      capture: true,
      passive: true,
    });

    if (typeof MutationObserver !== 'undefined' && document.body) {
      if (activePromptMutationObserver) {
        activePromptMutationObserver.disconnect();
      }
      activePromptMutationObserver = new MutationObserver(() => {
        scheduleGeometryCheck();
      });
      activePromptMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    checkActivePrompt();
  }

  function disconnect(): void {
    isTracking = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'scroll',
        handleScroll,
        { capture: true } as EventListenerOptions
      );
    }
    if (activePromptMutationObserver) {
      activePromptMutationObserver.disconnect();
      activePromptMutationObserver = null;
    }
    if (rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
    }
  }

  function reset(): void {
    disconnect();
    activeNavigatorIndex = null;
  }

  return {
    getActiveIndex,
    findConversationIndexByElement,
    checkActivePrompt,
    initTracking,
    disconnect,
    reset,
  };
}
