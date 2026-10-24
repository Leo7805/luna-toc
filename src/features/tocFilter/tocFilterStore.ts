/**
 * In-memory store and event coordinator for LunaTOC Table of Contents filtering
 * and filter context-menu interactions.
 */
import { getCustomTitle } from '@/features/customTocTitles/customTocTitleStore';
import { isPromptMarked } from '@/features/conversationPrompts/promptMark';

export type TocFilterMode =
  | 'all'
  | 'renamed'
  | 'bookmarked'
  | 'renamed_or_bookmarked';

export interface TocFilterMenuState {
  isOpen: boolean;
  position: { left: number; top: number };
}

let filterMode: TocFilterMode = 'all';
const filterListeners = new Set<() => void>();

let menuState: TocFilterMenuState | null = null;
const menuListeners = new Set<() => void>();

function notifyFilterListeners(): void {
  filterListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error in TOC filter listener:', error);
    }
  });
}

function notifyMenuListeners(): void {
  menuListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error in TOC filter menu listener:', error);
    }
  });
}

/**
 * Returns the currently active TOC filter mode.
 */
export function getTocFilterMode(): TocFilterMode {
  return filterMode;
}

/**
 * Sets a new TOC filter mode and notifies subscribers if changed.
 */
export function setTocFilterMode(nextMode: TocFilterMode): void {
  if (filterMode === nextMode) return;
  filterMode = nextMode;
  notifyFilterListeners();
}

/**
 * Resets the filter mode back to default 'all'.
 */
export function resetTocFilterMode(): void {
  setTocFilterMode('all');
}

/**
 * Subscribes to filter mode changes (used by React components and TOC list renderer).
 */
export function subscribeTocFilter(listener: () => void): () => void {
  filterListeners.add(listener);
  return () => {
    filterListeners.delete(listener);
  };
}

/**
 * Evaluates whether a prompt with the given messageId satisfies the specified filter mode.
 */
export function matchesTocFilter(
  messageId: string,
  mode: TocFilterMode = filterMode
): boolean {
  if (mode === 'all') return true;
  if (!messageId) return false;

  const isRenamed = Boolean(getCustomTitle(messageId));
  const isMarked = isPromptMarked(messageId);

  if (mode === 'renamed') return isRenamed;
  if (mode === 'bookmarked') return isMarked;
  if (mode === 'renamed_or_bookmarked') return isRenamed || isMarked;

  return true;
}

/**
 * Opens the TOC filter context menu at the given client coordinates.
 */
export function openTocFilterMenu(position: { left: number; top: number }): void {
  menuState = {
    isOpen: true,
    position,
  };
  notifyMenuListeners();
}

/**
 * Closes the TOC filter context menu.
 */
export function closeTocFilterMenu(): void {
  if (!menuState) return;
  menuState = null;
  notifyMenuListeners();
}

/**
 * Returns the current menu state snapshot for React useSyncExternalStore.
 */
export function getTocFilterMenuSnapshot(): TocFilterMenuState | null {
  return menuState;
}

/**
 * Subscribes to menu visibility and position changes (separate from list rebuilds).
 */
export function subscribeTocFilterMenu(listener: () => void): () => void {
  menuListeners.add(listener);
  return () => {
    menuListeners.delete(listener);
  };
}

export const tocFilterStore = {
  getMode: getTocFilterMode,
  setMode: setTocFilterMode,
  resetMode: resetTocFilterMode,
  subscribe: subscribeTocFilter,
  matches: matchesTocFilter,
  openMenu: openTocFilterMenu,
  closeMenu: closeTocFilterMenu,
  getMenuSnapshot: getTocFilterMenuSnapshot,
  subscribeMenu: subscribeTocFilterMenu,
};
