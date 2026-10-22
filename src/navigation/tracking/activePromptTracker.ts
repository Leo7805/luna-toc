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
   * Called when active viewport index is updated.
   * @param index The active prompt index.
   * @param changed True if the index is different from the previous active index.
   */
  onActiveIndexChange?: (index: number, changed: boolean) => void;
  /**
   * Called when genuine user browse intent (wheel/touch inside active chat) is detected.
   */
  onUserBrowseIntent?: () => void;
  /**
   * Optional platform resolver for dependency injection in tests.
   */
  getPlatform?: () => Platform;
}

export interface ActivePromptTracker {
  getActiveIndex(): number | null;
  getViewportIndex(): number | null;
  findConversationIndexByElement(element: HTMLElement): number;
  checkActivePrompt(): void;
  /**
   * Synchronously seeds viewport index at target following successful navigation.
   * Cancels pending RAF and emits change notification without establishing locks.
   *
   * @param index 0-indexed position of the active prompt.
   */
  syncViewportIndex(index: number): void;
  syncActiveIndex(index: number): void;
  initTracking(): void;
  disconnect(): void;
  reset(): void;
}

function isIgnoredSidebarEvent(event: Event): boolean {
  const target = event.target;
  return (
    target instanceof Element &&
    Boolean(target.closest('#luna-toc-sidebar, #navigator-list'))
  );
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

  function resolveScrollContainer(): HTMLElement | null {
    const platform = resolvePlatform();
    return (
      platform.navigation.getThreadScrollContainer?.() ??
      platform.navigation.getScrollContainer?.() ??
      null
    );
  }

  function getActiveIndex(): number | null {
    return activeNavigatorIndex;
  }

  function getViewportIndex(): number | null {
    return activeNavigatorIndex;
  }

  function findConversationIndexByElement(element: HTMLElement): number {
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
    return options.getMessages().findIndex((message) => message.id === id);
  }

  /**
   * Seeds viewport index synchronously, cancels pending RAF, and emits change callback.
   *
   * @param index 0-indexed position of landed prompt.
   */
  function syncViewportIndex(index: number): void {
    if (rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
    }

    const previousIndex = activeNavigatorIndex;
    activeNavigatorIndex = index;

    const changed = previousIndex !== index;
    options.onActiveIndexChange?.(index, changed);
  }

  function checkActivePrompt(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const platform = resolvePlatform();
    const container = resolveScrollContainer();
    const containerRect = container ? container.getBoundingClientRect() : null;
    const containerTop = containerRect ? containerRect.top : 0;
    const containerBottom = containerRect ? containerRect.bottom : 0;

    // Aligns with promptNavigation landing geometry: elements land at `containerTop + promptTopOffsetPx`
    // via scrollMarginTop. Aligning the activation boundary ensures that landing at the intended top
    // position immediately and consistently activates the target prompt.
    const targetOffset = platform.navigation.promptTopOffsetPx ?? 16;
    const SUBPIXEL_TOLERANCE_PX = 2;
    const referenceBoundary = containerTop + targetOffset + SUBPIXEL_TOLERANCE_PX;

    const renderedPromptElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        platform.config.selectors.userMessage
      )
    );

    interface VisibleCandidate {
      index: number;
      top: number;
    }
    const visibleCandidates: VisibleCandidate[] = [];

    let latestAboveTop: number | null = null;
    let lowestMountedIndex: number | null = null;
    const viewportTop = containerTop + targetOffset;
    const viewportBottom = containerBottom;

    for (const element of renderedPromptElements) {
      const index = findConversationIndexByElement(element);
      if (index === -1) continue;

      if (lowestMountedIndex === null || index < lowestMountedIndex) {
        lowestMountedIndex = index;
      }

      const rect = element.getBoundingClientRect();

      // Rule B fallback tracking: preserve existing top-boundary ownership calculation
      if (rect.top <= referenceBoundary) {
        if (latestAboveTop === null || index > latestAboveTop) {
          latestAboveTop = index;
        }
      }

      // Rule A candidate evaluation: is element visible within the scroll container viewport?
      const entryThreshold = Math.min(16, Math.max(1, rect.height * 0.5));
      const isVisible =
        Boolean(container) &&
        rect.height > 0 &&
        rect.bottom >= viewportTop + SUBPIXEL_TOLERANCE_PX &&
        rect.top <= viewportBottom - entryThreshold;

      if (isVisible) {
        visibleCandidates.push({ index, top: rect.top });
      }
    }

    let nextIndex: number | null = null;

    // Rule A: Visible TOC Prompt First (visually topmost among visible valid prompts)
    if (visibleCandidates.length > 0) {
      visibleCandidates.sort((a, b) => a.top - b.top);
      nextIndex = visibleCandidates[0].index;
    } else {
      // Rule B: Fallback to existing top-boundary ownership algorithm unchanged
      const isAtTop = Boolean(
        container && container.scrollTop <= SUBPIXEL_TOLERANCE_PX
      );
      const canFallbackToZero =
        lowestMountedIndex === 0 &&
        (activeNavigatorIndex === null || isAtTop);

      if (latestAboveTop !== null) {
        nextIndex = latestAboveTop;
      } else if (canFallbackToZero) {
        nextIndex = 0;
      } else {
        nextIndex =
          activeNavigatorIndex ??
          (lowestMountedIndex !== null
            ? Math.max(0, lowestMountedIndex - 1)
            : null);
      }
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

  function handleScroll(event: Event): void {
    if (isIgnoredSidebarEvent(event)) return;
    scheduleGeometryCheck();
  }

  function isEventInsideActiveChat(
    event: Event,
    container: HTMLElement
  ): boolean {
    if (isIgnoredSidebarEvent(event)) return false;
    const target = event.target;
    return (
      target instanceof Node &&
      (target === container || container.contains(target))
    );
  }

  function handleWheelOrTouch(event: Event): void {
    const container = resolveScrollContainer();
    if (!container) return;
    if (isEventInsideActiveChat(event, container)) {
      options.onUserBrowseIntent?.();
    }
  }

  function initTracking(): void {
    if (typeof document === 'undefined') return;
    if (isTracking) return;
    isTracking = true;

    document.addEventListener('scroll', handleScroll, {
      capture: true,
      passive: true,
    });

    document.addEventListener('wheel', handleWheelOrTouch, {
      capture: true,
      passive: true,
    });

    document.addEventListener('touchmove', handleWheelOrTouch, {
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
      document.removeEventListener(
        'wheel',
        handleWheelOrTouch,
        { capture: true } as EventListenerOptions
      );
      document.removeEventListener(
        'touchmove',
        handleWheelOrTouch,
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
    getViewportIndex,
    findConversationIndexByElement,
    checkActivePrompt,
    syncViewportIndex,
    syncActiveIndex: syncViewportIndex,
    initTracking,
    disconnect,
    reset,
  };
}
