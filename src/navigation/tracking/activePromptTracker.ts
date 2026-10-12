/**
 * Tracks the visible active prompt in the chat viewport using IntersectionObserver
 * and MutationObserver, with cursor locking during navigation jumps.
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
  setActiveIndex(index: number): boolean;
  forceActiveIndex(index: number): void;
  lockActiveIndex(index: number, durationMs?: number): void;
  unlockActiveIndex(): void;
  isLocked(): boolean;
  getLockedIndex(): number | null;
  findConversationIndexByElement(element: HTMLElement): number;
  getMountedPromptSignature(): string;
  observeVisiblePrompts(): void;
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
  let lockedNavigatorIndex: number | null = null;
  let lockedNavigatorTimer: ReturnType<typeof setTimeout> | null = null;
  let activePromptObserver: IntersectionObserver | null = null;
  let activePromptMutationObserver: MutationObserver | null = null;
  let activePromptMutationTimer: ReturnType<typeof setTimeout> | null = null;

  function resolvePlatform(): Platform {
    return options.getPlatform ? options.getPlatform() : getActivePlatform();
  }

  function getActiveIndex(): number | null {
    return activeNavigatorIndex;
  }

  function isLocked(): boolean {
    return lockedNavigatorIndex !== null && lockedNavigatorTimer !== null;
  }

  function getLockedIndex(): number | null {
    return lockedNavigatorIndex;
  }

  function lockActiveIndex(index: number, durationMs = 2000): void {
    if (lockedNavigatorTimer !== null) {
      clearTimeout(lockedNavigatorTimer);
    }
    lockedNavigatorIndex = index;
    forceActiveIndex(index);
    lockedNavigatorTimer = setTimeout(() => {
      lockedNavigatorIndex = null;
      lockedNavigatorTimer = null;
    }, durationMs);
  }

  function unlockActiveIndex(): void {
    if (lockedNavigatorTimer !== null) {
      clearTimeout(lockedNavigatorTimer);
      lockedNavigatorTimer = null;
    }
    lockedNavigatorIndex = null;
  }

  function forceActiveIndex(index: number): void {
    const activeIndexChanged = index !== activeNavigatorIndex;
    activeNavigatorIndex = index;
    options.onActiveIndexChange?.(index, activeIndexChanged);
  }

  function setActiveIndex(index: number): boolean {
    if (
      lockedNavigatorIndex !== null &&
      index !== lockedNavigatorIndex &&
      lockedNavigatorTimer !== null
    ) {
      return false;
    }
    forceActiveIndex(index);
    return true;
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

  function getMountedPromptSignature(): string {
    const platform = resolvePlatform();
    const userSelector = platform.config.selectors.userMessage;
    if (!userSelector || typeof document === 'undefined') return '';

    return Array.from(document.querySelectorAll<HTMLElement>(userSelector))
      .map(
        (element) =>
          platform.navigation.getPromptUnitKeyFromElement?.(element) ||
          platform.navigation.getMessageIdFromElement?.(element) ||
          (platform.config.selectors.messageId
            ? element.getAttribute(platform.config.selectors.messageId)
            : '') ||
          ''
      )
      .join('|');
  }

  function observeVisiblePrompts(): void {
    if (activePromptObserver) {
      activePromptObserver.disconnect();
      activePromptObserver = null;
    }

    if (typeof IntersectionObserver === 'undefined') return;

    activePromptObserver = new IntersectionObserver(
      (entries) => {
        const topEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!topEntry) return;
        if (!(topEntry.target instanceof HTMLElement)) return;
        const index = findConversationIndexByElement(topEntry.target);
        if (index !== -1) {
          setActiveIndex(index);
        }
      },
      { threshold: [0.1, 0.25, 0.5, 0.75, 1] }
    );

    const platform = resolvePlatform();
    const userSelector = platform.config.selectors.userMessage;
    if (userSelector && typeof document !== 'undefined') {
      document
        .querySelectorAll<HTMLElement>(userSelector)
        .forEach((element) => activePromptObserver?.observe(element));
    }
  }

  function initTracking(): void {
    if (
      typeof MutationObserver === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }

    if (activePromptMutationObserver) {
      activePromptMutationObserver.disconnect();
      activePromptMutationObserver = null;
    }

    let lastMountSignature = getMountedPromptSignature();

    const reobserveIfMountedChanged = (): void => {
      const signature = getMountedPromptSignature();
      if (signature === lastMountSignature) return;
      lastMountSignature = signature;
      observeVisiblePrompts();
    };

    activePromptMutationObserver = new MutationObserver(() => {
      if (activePromptMutationTimer !== null) {
        clearTimeout(activePromptMutationTimer);
      }
      activePromptMutationTimer = setTimeout(reobserveIfMountedChanged, 200);
    });

    if (document.body) {
      activePromptMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    observeVisiblePrompts();
  }

  function disconnect(): void {
    if (activePromptObserver) {
      activePromptObserver.disconnect();
      activePromptObserver = null;
    }
    if (activePromptMutationObserver) {
      activePromptMutationObserver.disconnect();
      activePromptMutationObserver = null;
    }
    if (activePromptMutationTimer !== null) {
      clearTimeout(activePromptMutationTimer);
      activePromptMutationTimer = null;
    }
    if (lockedNavigatorTimer !== null) {
      clearTimeout(lockedNavigatorTimer);
      lockedNavigatorTimer = null;
    }
    lockedNavigatorIndex = null;
  }

  function reset(): void {
    disconnect();
    activeNavigatorIndex = null;
  }

  return {
    getActiveIndex,
    setActiveIndex,
    forceActiveIndex,
    lockActiveIndex,
    unlockActiveIndex,
    isLocked,
    getLockedIndex,
    findConversationIndexByElement,
    getMountedPromptSignature,
    observeVisiblePrompts,
    initTracking,
    disconnect,
    reset,
  };
}
