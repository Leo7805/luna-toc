/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { setLoading } from '@/navigation/loading/promptLoadingState';
import { getStatusSnapshot, resetStatusForTesting } from '@/navigation/ui/sidebarStatus';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

describe('tocListRenderer', () => {
  let listElement: HTMLElement;
  let hintElement: HTMLElement;

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = `
      <div id="navigator-list"></div>
      <div class="navigator-hint"></div>
      <div id="sidebar-status-band"></div>
    `;
    listElement = document.getElementById('navigator-list')!;
    hintElement = document.querySelector('.navigator-hint')!;
  });

  const mockMessages: NavigatorMessage[] = [
    { id: 'msg-1', text: 'First user prompt', canMatchByText: true, createTime: 100 },
    { id: 'msg-2', text: 'Second user prompt', canMatchByText: true, createTime: 200 },
    { id: 'msg-3', text: 'Third prompt about coding', canMatchByText: true, createTime: 300 },
  ];

  it('renders all messages into #navigator-list and hides empty hint', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => 0,
      onItemClick: vi.fn(),
    });

    renderer.render();

    expect(listElement.children.length).toBe(3);
    expect(hintElement.hidden).toBe(true);
    expect(listElement.children[0].classList.contains('navigator-item-active')).toBe(true);
    expect(listElement.children[1].classList.contains('navigator-item-active')).toBe(false);
  });

  it('filters rows by search query and updates hint when no match found', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    renderer.setSearchQuery('coding');
    expect(listElement.children.length).toBe(1);
    expect(hintElement.hidden).toBe(true);

    renderer.setSearchQuery('nonexistent keyword');
    expect(listElement.children.length).toBe(0);
    expect(hintElement.hidden).toBe(false);
    expect(hintElement.textContent).toBe('No matching prompts.');
  });

  it('shows empty hint when message list is empty', () => {
    const renderer = createTocListRenderer({
      getMessages: () => [],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    renderer.render();
    expect(listElement.children.length).toBe(0);
    expect(hintElement.hidden).toBe(false);
    expect(hintElement.textContent).toBe('Waiting for prompts...');
  });

  it('renders stable empty state when prompts are empty and loading is false', () => {
    resetStatusForTesting();
    setLoading(false);
    const renderer = createTocListRenderer({
      getMessages: () => [],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    // Initial render with completed=true renders empty state
    renderer.render({ completed: true });
    expect(getStatusSnapshot()).toEqual({
      state: 'empty',
      text: 'No prompts',
    });

    // Subsequent normal render without completed=true must stay empty, not revert to idle
    renderer.render();
    expect(getStatusSnapshot()).toEqual({
      state: 'empty',
      text: 'No prompts',
    });
  });

  it('invokes onItemClick callback when a TOC row is clicked', () => {
    const onItemClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick,
    });

    renderer.render();
    const secondItem = listElement.children[1] as HTMLElement;
    secondItem.click();

    expect(onItemClick).toHaveBeenCalledWith(mockMessages[1], 1);
  });

  it('updates active item UI and toggles active class', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      isFollowingMode: () => false,
    });

    renderer.render();
    const items = renderer.getNavigatorItems();
    expect(items[0].classList.contains('navigator-item-active')).toBe(false);

    renderer.updateActiveItemUI(0, true);
    expect(items[0].classList.contains('navigator-item-active')).toBe(true);

    renderer.updateActiveItemUI(1, true);
    expect(items[0].classList.contains('navigator-item-active')).toBe(false);
    expect(items[1].classList.contains('navigator-item-active')).toBe(true);
  });

  it('determines correct status band state', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    expect(renderer.pickStatusBandState(true)).toBe('complete');
    expect(renderer.pickStatusBandState(false)).toBe('loading');

    const emptyRenderer = createTocListRenderer({
      getMessages: () => [],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    expect(emptyRenderer.pickStatusBandState(true)).toBe('empty');
  });

  it('does not force or snap active cursor on load completion', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => 0,
      onItemClick: vi.fn(),
      isFollowingMode: () => false,
    });

    renderer.render({ completed: true });
    const items = renderer.getNavigatorItems();
    expect(items[0].classList.contains('navigator-item-active')).toBe(true);
    expect(items[2].classList.contains('navigator-item-active')).toBe(false);
  });

  it('isolates state across independent renderer instances', () => {
    const rendererA = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    const rendererB = createTocListRenderer({
      getMessages: () => [],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    rendererA.setSearchQuery('test');
    expect(rendererA.getSearchQuery()).toBe('test');
    expect(rendererB.getSearchQuery()).toBe('');
  });

  it('renders custom TOC title and applies styling class when set', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    });

    const { setCustomTitle, removeCustomTitle } = await import(
      '@/features/customTocTitles/customTocTitleStore'
    );
    await setCustomTitle('msg-2', 'Renamed Step 2');

    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    renderer.render();

    const secondItem = listElement.children[1] as HTMLElement;
    expect(secondItem.querySelector('.navigator-item-index')?.textContent).toBe('2.');
    expect(secondItem.querySelector('.navigator-item-text')?.textContent).toBe('Renamed Step 2');
    expect(secondItem.classList.contains('navigator-item-custom-title')).toBe(true);

    const firstItem = listElement.children[0] as HTMLElement;
    expect(firstItem.querySelector('.navigator-item-index')?.textContent).toBe('1.');
    expect(firstItem.querySelector('.navigator-item-text')?.textContent).toBe('First user prompt');
    expect(firstItem.classList.contains('navigator-item-custom-title')).toBe(false);

    await removeCustomTitle('msg-2');
  });

  describe('initial active TOC scroll-position synchronization', () => {
    let scrollToMock: ReturnType<typeof vi.fn>;
    const origGetBCR = window.HTMLElement.prototype.getBoundingClientRect;

    beforeEach(() => {
      scrollToMock = vi.fn();
      listElement.scrollTo = scrollToMock as unknown as typeof listElement.scrollTo;
      setLoading(true);
    });

    afterEach(() => {
      window.HTMLElement.prototype.getBoundingClientRect = origGetBCR;
      setLoading(false);
    });

    function mockLayout(itemTop = 600, containerHeight = 500) {
      window.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this === listElement) {
          return { top: 0, bottom: containerHeight, height: containerHeight, left: 0, right: 200, width: 200 } as DOMRect;
        }
        return { top: itemTop, bottom: itemTop + 40, height: 40, left: 0, right: 200, width: 200 } as DOMRect;
      };
    }

    it('does not force scroll or finalize initial sync while loading is in progress', () => {
      mockLayout(600);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 2,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render();
      expect(scrollToMock).not.toHaveBeenCalled();
      expect(renderer.ensureActiveItemVisible()).toBe(false);
    });

    it('scrolls active item into view on completed render when active index is known, using behavior auto and bypassing follow', () => {
      mockLayout(600);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 2,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render({ completed: true });
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'auto' });
    });

    it('scrolls active item on updateActiveItemUI when active arrives after completed render, then respects follow on subsequent updates', () => {
      mockLayout(600);
      let activeIndex: number | null = null;
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => activeIndex,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render({ completed: true });
      expect(scrollToMock).not.toHaveBeenCalled();

      activeIndex = 2;
      renderer.updateActiveItemUI(2, true);
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'auto' });

      scrollToMock.mockClear();
      renderer.updateActiveItemUI(1, true);
      expect(scrollToMock).not.toHaveBeenCalled();
    });

    it('keeps initial sync pending when layout has zero height until layout becomes ready', () => {
      mockLayout(0, 0);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 2,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render({ completed: true });
      expect(scrollToMock).not.toHaveBeenCalled();

      mockLayout(600, 500);
      expect(renderer.ensureActiveItemVisible()).toBe(true);
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    it('marks initial sync completed without calling scrollTo when active item is already in visible bounds', () => {
      mockLayout(100);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 0,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render({ completed: true });
      expect(scrollToMock).not.toHaveBeenCalled();
      expect(renderer.ensureActiveItemVisible()).toBe(true);
    });

    it('resets initial sync state on resetList() to allow fresh sync on route change', () => {
      mockLayout(600);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 2,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render({ completed: true });
      expect(scrollToMock).toHaveBeenCalledTimes(1);

      renderer.resetList();
      scrollToMock.mockClear();
      renderer.render({ completed: true });
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });

    it('does not scroll or error when the active item is filtered out by search query', () => {
      mockLayout(600);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 0,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.setSearchQuery('coding');
      expect(scrollToMock).not.toHaveBeenCalled();
      expect(renderer.ensureActiveItemVisible()).toBe(false);
    });

    it('returns false when scrollTo is unavailable on container and scroll is required', () => {
      mockLayout(600);
      (listElement as any).scrollTo = undefined;
      setLoading(false);
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => 2,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      const item = renderer.createNavigatorItem(mockMessages[2], 2);
      listElement.appendChild(item);
      expect(renderer.scrollNavigatorItemIntoView(item, { force: true })).toBe(false);
    });

    it('recalculates active index on completed render and scrolls to the shifted final index rather than a stale pre-backfill index', () => {
      mockLayout(600);
      let activeIndex: number | null = 1;
      let currentMessages = mockMessages.slice(0, 2);
      let renderer: ReturnType<typeof createTocListRenderer>;

      renderer = createTocListRenderer({
        getMessages: () => currentMessages,
        getActiveIndex: () => activeIndex,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
        onRefreshObservers: () => {
          if (currentMessages.length === 3) {
            activeIndex = 2;
            renderer.updateActiveItemUI(2, true);
          }
        },
      });

      // 1. Partial render while loading
      renderer.render();
      expect(scrollToMock).not.toHaveBeenCalled();

      // 2. Backfill prepends older messages; list expands to 3 items
      currentMessages = mockMessages;

      // 3. Mark completed
      renderer.render({ completed: true });

      // Active class and scroll must both target shifted final index 2, not stale index 1
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      const items = renderer.getNavigatorItems();
      expect(items[2].classList.contains('navigator-item-active')).toBe(true);
      expect(items[1].classList.contains('navigator-item-active')).toBe(false);
    });

    it('preserves exact message ID, relative offset, and adjusts scrollTop when 128 older rows are prepended to a 380-row list', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;

      const initialMessages: NavigatorMessage[] = Array.from({ length: 380 }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let activeIndex: number | null = 379;
      let currentMessages = initialMessages;

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return { top: 0, bottom: CONTAINER_HEIGHT, height: CONTAINER_HEIGHT, left: 0, right: 200, width: 200 } as DOMRect;
          }
          const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
          const top = index * ROW_HEIGHT - listElement.scrollTop;
          return { top, bottom: top + ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 200, width: 200 } as DOMRect;
        };

        const renderer = createTocListRenderer({
          getMessages: () => currentMessages,
          getActiveIndex: () => activeIndex,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
        });

        // Render 380 items
        renderer.render({ completed: true });
        expect(scrollToMock).toHaveBeenCalledTimes(1);
        scrollToMock.mockClear();

        // User or viewport is at msg-200 with an exact 15px top offset
        listElement.scrollTop = 200 * ROW_HEIGHT - 15;

        // Prepend 128 older items (total 508 items)
        const olderMessages: NavigatorMessage[] = Array.from({ length: 128 }, (_, i) => ({
          id: `older-${i}`,
          text: `Older Prompt ${i + 1}`,
          canMatchByText: true,
          createTime: i * 1000,
        }));
        currentMessages = [...olderMessages, ...initialMessages];
        activeIndex = 507;

        renderer.render();

        // msg-200 is shifted by 128 * 40 = 5120px; scrollTop must increase by exactly 5120px
        const expectedScrollTop = 200 * ROW_HEIGHT - 15 + 128 * ROW_HEIGHT;
        expect(listElement.scrollTop).toBe(expectedScrollTop);

        // The visible row matches dataset.messageId msg-200, not older-72
        const items = renderer.getNavigatorItems();
        expect(items.length).toBe(508);
        expect(items[328].dataset.messageId).toBe('msg-200');
        expect(scrollToMock).not.toHaveBeenCalled();
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
      }
    });

    it('performs initial active alignment once loading finishes on a partially rendered TOC with existing scroll anchor', () => {
      mockLayout(600);
      const partialMessages: NavigatorMessage[] = Array.from({ length: 50 }, (_, i) => ({
        id: `partial-${i}`,
        text: `Partial ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let activeIndex: number | null = 49;
      let currentMessages = partialMessages;

      const renderer = createTocListRenderer({
        getMessages: () => currentMessages,
        getActiveIndex: () => activeIndex,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      // 1. Partial render while loading: anchor exists, but loading suppresses active scroll
      renderer.render();
      expect(scrollToMock).not.toHaveBeenCalled();

      // 2. Loading finishes: Priority 2 triggers initial active alignment despite existing anchor
      renderer.render({ completed: true });
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'auto' });
      scrollToMock.mockClear();

      // 3. Subsequent ordinary render: Priority 3 preserves anchor without force-scrolling
      renderer.render();
      expect(scrollToMock).not.toHaveBeenCalled();
    });

    it('preserves click prompt target navigation and prevents subsequent backfill prepends from force-scrolling away', () => {
      mockLayout(600);
      let activeIndex: number | null = 10;
      let currentMessages: NavigatorMessage[] = Array.from({ length: 50 }, (_, i) => ({
        id: `init-${i}`,
        text: `Init ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      const renderer = createTocListRenderer({
        getMessages: () => currentMessages,
        getActiveIndex: () => activeIndex,
        onItemClick: vi.fn(),
        isFollowingMode: () => false,
      });

      renderer.render();

      // User clicks prompt #5 during loading
      const items = renderer.getNavigatorItems();
      items[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      scrollToMock.mockClear();

      // Next backfill chunk arrives and prepends 50 older messages
      const olderMessages: NavigatorMessage[] = Array.from({ length: 50 }, (_, i) => ({
        id: `old-${i}`,
        text: `Old ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));
      currentMessages = [...olderMessages, ...currentMessages];
      activeIndex = 60; // target shifted

      renderer.render();

      // Target-lock must NOT be overridden by forced scroll to active bottom
      expect(scrollToMock).not.toHaveBeenCalled();
    });
  });
});
