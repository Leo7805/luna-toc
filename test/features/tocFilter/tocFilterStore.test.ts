import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeTocFilterMenu,
  getTocFilterMenuSnapshot,
  getTocFilterMode,
  matchesTocFilter,
  openTocFilterMenu,
  resetTocFilterMode,
  setTocFilterMode,
  subscribeTocFilter,
  subscribeTocFilterMenu,
  type TocFilterMode,
} from '@/features/tocFilter/tocFilterStore';
import * as customTitleStore from '@/features/customTocTitles/customTocTitleStore';
import * as promptMark from '@/features/conversationPrompts/promptMark';

describe('tocFilterStore', () => {
  beforeEach(() => {
    resetTocFilterMode();
    closeTocFilterMenu();
    vi.restoreAllMocks();
  });

  it('initializes with default filter mode "all"', () => {
    expect(getTocFilterMode()).toBe('all');
  });

  it('updates filter mode and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTocFilter(listener);

    setTocFilterMode('renamed');
    expect(getTocFilterMode()).toBe('renamed');
    expect(listener).toHaveBeenCalledTimes(1);

    // Same mode does not re-trigger listener
    setTocFilterMode('renamed');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setTocFilterMode('bookmarked');
    expect(getTocFilterMode()).toBe('bookmarked');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets filter mode to "all"', () => {
    setTocFilterMode('bookmarked');
    expect(getTocFilterMode()).toBe('bookmarked');

    resetTocFilterMode();
    expect(getTocFilterMode()).toBe('all');
  });

  describe('matchesTocFilter', () => {
    it('always matches all messages when mode is "all"', () => {
      expect(matchesTocFilter('msg-1', 'all')).toBe(true);
      expect(matchesTocFilter('msg-2', 'all')).toBe(true);
    });

    it('matches only renamed messages when mode is "renamed"', () => {
      vi.spyOn(customTitleStore, 'getCustomTitle').mockImplementation((id) =>
        id === 'msg-renamed' ? 'Custom Title' : undefined
      );

      expect(matchesTocFilter('msg-renamed', 'renamed')).toBe(true);
      expect(matchesTocFilter('msg-other', 'renamed')).toBe(false);
    });

    it('matches only bookmarked messages when mode is "bookmarked"', () => {
      vi.spyOn(promptMark, 'isPromptMarked').mockImplementation((id) =>
        id === 'msg-marked'
      );

      expect(matchesTocFilter('msg-marked', 'bookmarked')).toBe(true);
      expect(matchesTocFilter('msg-other', 'bookmarked')).toBe(false);
    });

    it('matches renamed or bookmarked messages (logical OR) when mode is "renamed_or_bookmarked"', () => {
      vi.spyOn(customTitleStore, 'getCustomTitle').mockImplementation((id) =>
        id === 'msg-renamed' ? 'Custom Title' : undefined
      );
      vi.spyOn(promptMark, 'isPromptMarked').mockImplementation((id) =>
        id === 'msg-marked'
      );

      expect(matchesTocFilter('msg-renamed', 'renamed_or_bookmarked')).toBe(true);
      expect(matchesTocFilter('msg-marked', 'renamed_or_bookmarked')).toBe(true);
      expect(matchesTocFilter('msg-both', 'renamed_or_bookmarked')).toBe(false);
      expect(matchesTocFilter('msg-neither', 'renamed_or_bookmarked')).toBe(false);
    });
  });

  describe('menu state management', () => {
    it('opens and closes context menu without notifying filter subscribers', () => {
      const filterListener = vi.fn();
      const menuListener = vi.fn();

      const unsubFilter = subscribeTocFilter(filterListener);
      const unsubMenu = subscribeTocFilterMenu(menuListener);

      expect(getTocFilterMenuSnapshot()).toBeNull();

      openTocFilterMenu({ left: 100, top: 200 });

      expect(getTocFilterMenuSnapshot()).toEqual({
        isOpen: true,
        position: { left: 100, top: 200 },
      });
      expect(menuListener).toHaveBeenCalledTimes(1);
      // Crucial requirement: opening menu must NOT rebuild list
      expect(filterListener).not.toHaveBeenCalled();

      closeTocFilterMenu();

      expect(getTocFilterMenuSnapshot()).toBeNull();
      expect(menuListener).toHaveBeenCalledTimes(2);
      expect(filterListener).not.toHaveBeenCalled();

      unsubFilter();
      unsubMenu();
    });
  });
});
