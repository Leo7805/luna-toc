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

  describe('TOC filter mode integration', () => {
    let resetFilterMode: typeof import('@/features/tocFilter/tocFilterStore').resetTocFilterMode;
    let setFilterMode: typeof import('@/features/tocFilter/tocFilterStore').setTocFilterMode;
    let setCustomTitleFn: typeof import('@/features/customTocTitles/customTocTitleStore').setCustomTitle;
    let removeCustomTitleFn: typeof import('@/features/customTocTitles/customTocTitleStore').removeCustomTitle;
    let initPromptMarkFn: typeof import('@/features/conversationPrompts/promptMark').initializePromptMark;

    beforeEach(async () => {
      vi.stubGlobal('chrome', {
        storage: {
          local: {
            get: vi.fn(async () => ({})),
            set: vi.fn(async () => {}),
          },
        },
      });

      const filterStore = await import('@/features/tocFilter/tocFilterStore');
      resetFilterMode = filterStore.resetTocFilterMode;
      setFilterMode = filterStore.setTocFilterMode;
      resetFilterMode();

      const titleStore = await import('@/features/customTocTitles/customTocTitleStore');
      await titleStore.initializeCustomTocTitles();
      setCustomTitleFn = titleStore.setCustomTitle;
      removeCustomTitleFn = titleStore.removeCustomTitle;

      const markModule = await import('@/features/conversationPrompts/promptMark');
      initPromptMarkFn = markModule.initializePromptMark;
      initPromptMarkFn({ conversationKey: 'test-convo' });
    });

    afterEach(async () => {
      resetFilterMode?.();
      await removeCustomTitleFn?.('msg-1');
      await removeCustomTitleFn?.('msg-2');
      await removeCustomTitleFn?.('msg-3');
    });

    it('renders only renamed prompts and preserves original index and numbering', async () => {
      await setCustomTitleFn('msg-2', 'Renamed Step 2');

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => 'renamed',
      });

      renderer.render();

      expect(listElement.children.length).toBe(1);
      const row = listElement.children[0] as HTMLElement;
      expect(row.dataset.messageId).toBe('msg-2');
      expect(row.dataset.messageIndex).toBe('1');
      expect(row.querySelector('.navigator-item-index')?.textContent).toBe('2.');
      expect(row.querySelector('.navigator-item-text')?.textContent).toBe('Renamed Step 2');
      expect(hintElement.hidden).toBe(true);

      renderer.destroy?.();
    });

    it('renders only bookmarked prompts when filter mode is "bookmarked"', () => {
      // Bookmark msg-1
      const markButton = document.createElement('button');
      const item = document.createElement('div');
      item.dataset.messageId = 'msg-1';

      // Toggle mark on msg-1
      sessionStorage.setItem('chatToc:marks:test-convo', JSON.stringify(['msg-1']));
      initPromptMarkFn({ conversationKey: 'test-convo' });

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => 'bookmarked',
      });

      renderer.render();

      expect(listElement.children.length).toBe(1);
      const row = listElement.children[0] as HTMLElement;
      expect(row.dataset.messageId).toBe('msg-1');
      expect(row.querySelector('.navigator-item-index')?.textContent).toBe('1.');
      expect(hintElement.hidden).toBe(true);

      renderer.destroy?.();
    });

    it('renders prompts matching renamed OR bookmarked (logical OR)', async () => {
      await setCustomTitleFn('msg-2', 'Renamed Step 2');
      sessionStorage.setItem('chatToc:marks:test-convo', JSON.stringify(['msg-1']));
      initPromptMarkFn({ conversationKey: 'test-convo' });

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => 'renamed_or_bookmarked',
      });

      renderer.render();

      expect(listElement.children.length).toBe(2);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');
      expect((listElement.children[1] as HTMLElement).dataset.messageId).toBe('msg-2');

      renderer.destroy?.();
    });

    it('combines TOC filter mode with search query', async () => {
      await setCustomTitleFn('msg-1', 'Alpha prompt');
      await setCustomTitleFn('msg-3', 'Coding prompt with custom title');

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => 'renamed',
      });

      renderer.setSearchQuery('coding');

      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-3');

      renderer.destroy?.();
    });

    it('matches prompts by original prompt content OR renamed title (case-insensitive, normalized) and renders renamed title', async () => {
      const messages: NavigatorMessage[] = [
        {
          id: 'msg-1',
          text: 'Explain the difference between REST and GraphQL',
          canMatchByText: true,
          createTime: 100,
        },
        {
          id: 'msg-2',
          text: 'Write a PostgreSQL migration script',
          canMatchByText: true,
          createTime: 200,
        },
      ];
      await setCustomTitleFn('msg-1', 'API   Architecture');

      const renderer = createTocListRenderer({
        getMessages: () => messages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });

      // Match by original prompt content while renamed title exists
      renderer.setSearchQuery('graphql');
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');
      expect(
        listElement.children[0].querySelector('.navigator-item-text')?.textContent
      ).toBe('API Architecture');

      // Match by renamed title (case-insensitive and whitespace-normalized)
      renderer.setSearchQuery('api architecture');
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');
      expect(
        listElement.children[0].querySelector('.navigator-item-text')?.textContent
      ).toBe('API Architecture');

      // Prompt without a renamed title still matches by original text
      renderer.setSearchQuery('postgresql');
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-2');

      // Non-matching query shows empty-result hint
      renderer.setSearchQuery('kubernetes');
      expect(listElement.children.length).toBe(0);
      expect(hintElement.hidden).toBe(false);
      expect(hintElement.textContent).toBe('No matching prompts.');

      renderer.destroy?.();
    });

    it('returns each prompt only once and preserves original ordering when query matches both original text and renamed title', async () => {
      await setCustomTitleFn('msg-1', 'First custom prompt');
      await setCustomTitleFn('msg-3', 'Coding architecture');

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });

      // "prompt" appears in both original text and custom title of msg-1, and original text of msg-2 & msg-3
      renderer.setSearchQuery('prompt');
      expect(listElement.children.length).toBe(3);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');
      expect((listElement.children[1] as HTMLElement).dataset.messageId).toBe('msg-2');
      expect((listElement.children[2] as HTMLElement).dataset.messageId).toBe('msg-3');

      renderer.destroy?.();
    });

    it('combines Renamed and Bookmarked filters with search across original prompt and renamed title', async () => {
      await setCustomTitleFn('msg-1', 'API Architecture');
      await setCustomTitleFn('msg-2', 'Database Schema');
      sessionStorage.setItem('chatToc:marks:test-convo', JSON.stringify(['msg-1', 'msg-3']));
      initPromptMarkFn({ conversationKey: 'test-convo' });

      let currentFilter: 'renamed' | 'bookmarked' = 'renamed';
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => currentFilter,
      });

      // Renamed filter + search by original prompt text of msg-1 ("First user prompt")
      renderer.setSearchQuery('first user');
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');

      // Bookmarked filter + search by renamed title of msg-1 ("API Architecture")
      currentFilter = 'bookmarked';
      renderer.setSearchQuery('architecture');
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-1');

      renderer.destroy?.();
    });

    it('updates active search results when a prompt title is renamed or removed and render is triggered', async () => {
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });

      renderer.setSearchQuery('architecture');
      expect(listElement.children.length).toBe(0);

      // Rename msg-2 and trigger render (matching CustomTocTitleDialog onUpdated: render)
      await setCustomTitleFn('msg-2', 'System Architecture');
      renderer.render();
      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-2');

      // Remove custom title and trigger render
      await removeCustomTitleFn('msg-2');
      renderer.render();
      expect(listElement.children.length).toBe(0);
      expect(hintElement.textContent).toBe('No matching prompts.');

      renderer.destroy?.();
    });

    it('displays "No prompts match the active filter." when filter matches zero prompts', () => {
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
        getFilterMode: () => 'renamed',
      });

      renderer.render();

      expect(listElement.children.length).toBe(0);
      expect(hintElement.hidden).toBe(false);
      expect(hintElement.textContent).toBe('No prompts match the active filter.');

      renderer.destroy?.();
    });

    it('dynamically re-renders the list when filter mode changes in the store', async () => {
      await setCustomTitleFn('msg-2', 'Renamed Step 2');

      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });

      renderer.render();
      expect(listElement.children.length).toBe(3);

      // Change store mode to renamed
      setFilterMode('renamed');

      expect(listElement.children.length).toBe(1);
      expect((listElement.children[0] as HTMLElement).dataset.messageId).toBe('msg-2');

      renderer.destroy?.();
    });
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

    it('captures fallback anchor to the last item and restores exact scrollTop when scrolled deep into bottom padding', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;
      const BOTTOM_PADDING = 600;
      const INITIAL_COUNT = 20;

      const initialMessages: NavigatorMessage[] = Array.from({ length: INITIAL_COUNT }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let currentMessages = initialMessages;
      let activeIndex: number | null = INITIAL_COUNT - 1;

      let currentScrollTop = 0;
      Object.defineProperty(listElement, 'scrollTop', {
        get: () => currentScrollTop,
        set: (val: number) => {
          currentScrollTop = val;
        },
        configurable: true,
      });

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return {
              top: 0,
              bottom: CONTAINER_HEIGHT,
              height: CONTAINER_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: 0,
              toJSON: () => {},
            } as DOMRect;
          }
          if ((this as HTMLElement).classList?.contains('navigator-item')) {
            const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
            const top = index * ROW_HEIGHT - currentScrollTop;
            return {
              top,
              bottom: top + ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: top,
              toJSON: () => {},
            } as DOMRect;
          }
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect;
        };

        const renderer = createTocListRenderer({
          getMessages: () => currentMessages,
          getActiveIndex: () => activeIndex,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
        });

        renderer.render({ completed: true });
        scrollToMock.mockClear();

        // User is scrolled deep into bottom padding
        currentScrollTop = 850;

        const originalInnerHTMLSetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set!;
        Object.defineProperty(listElement, 'innerHTML', {
          set(val: string) {
            originalInnerHTMLSetter.call(this, val);
            if (val === '') {
              currentScrollTop = Math.min(currentScrollTop, BOTTOM_PADDING - CONTAINER_HEIGHT);
            }
          },
          configurable: true,
        });

        currentMessages = [
          ...initialMessages,
          {
            id: 'msg-20',
            text: 'Prompt 21',
            canMatchByText: true,
            createTime: 20 * 1000,
          },
        ];
        activeIndex = 20;

        renderer.render();

        expect(listElement.scrollTop).toBe(850);
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
        delete (listElement as any).scrollTop;
        delete (listElement as any).innerHTML;
      }
    });

    it('executes onRefreshObservers callback after scroll anchor restoration', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;

      const initialMessages: NavigatorMessage[] = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let currentScrollTop = 0;
      Object.defineProperty(listElement, 'scrollTop', {
        get: () => currentScrollTop,
        set: (val: number) => {
          currentScrollTop = val;
        },
        configurable: true,
      });

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return {
              top: 0,
              bottom: CONTAINER_HEIGHT,
              height: CONTAINER_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: 0,
              toJSON: () => {},
            } as DOMRect;
          }
          if ((this as HTMLElement).classList?.contains('navigator-item')) {
            const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
            const top = index * ROW_HEIGHT - currentScrollTop;
            return {
              top,
              bottom: top + ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: top,
              toJSON: () => {},
            } as DOMRect;
          }
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect;
        };

        let observedScrollTopDuringRefresh: number | null = null;
        const onRefreshObserversMock = vi.fn(() => {
          observedScrollTopDuringRefresh = listElement.scrollTop;
        });

        const renderer = createTocListRenderer({
          getMessages: () => initialMessages,
          getActiveIndex: () => 19,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
          onRefreshObservers: onRefreshObserversMock,
        });

        renderer.render({ completed: true });
        onRefreshObserversMock.mockClear();

        currentScrollTop = 200;

        const originalInnerHTMLSetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set!;
        Object.defineProperty(listElement, 'innerHTML', {
          set(val: string) {
            originalInnerHTMLSetter.call(this, val);
            if (val === '') {
              currentScrollTop = 0;
            }
          },
          configurable: true,
        });

        renderer.render({ refreshObservers: true });

        expect(onRefreshObserversMock).toHaveBeenCalledTimes(1);
        expect(observedScrollTopDuringRefresh).toBe(200);
        expect(listElement.scrollTop).toBe(200);
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
        delete (listElement as any).scrollTop;
        delete (listElement as any).innerHTML;
      }
    });

    it('respects active Follow: bypasses scrollTo when item is in bounds, invokes smooth scrollTo when out of bounds', () => {
      const messages: NavigatorMessage[] = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      const renderer = createTocListRenderer({
        getMessages: () => messages,
        getActiveIndex: () => 9,
        onItemClick: vi.fn(),
        isFollowingMode: () => true,
      });

      renderer.render({ completed: true });
      scrollToMock.mockClear();

      const scrollContainer = document.getElementById('navigator-list')!;
      scrollContainer.getBoundingClientRect = () => ({
        top: 0,
        bottom: 500,
        height: 500,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const items = renderer.getNavigatorItems();
      const lastItem = items[items.length - 1];

      // Case A: Last item is within safe bounds [56, 420]
      lastItem.getBoundingClientRect = () => ({
        top: 200,
        bottom: 240,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 200,
        toJSON: () => {},
      });

      const handledInBounds = renderer.scrollNavigatorItemIntoView(lastItem);
      expect(handledInBounds).toBe(true);
      expect(scrollToMock).not.toHaveBeenCalled();

      // Case B: Last item is out of bounds (below 420px)
      lastItem.getBoundingClientRect = () => ({
        top: 450,
        bottom: 490,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 450,
        toJSON: () => {},
      });

      const handledOutOfBounds = renderer.scrollNavigatorItemIntoView(lastItem);
      expect(handledOutOfBounds).toBe(true);
      expect(scrollToMock).toHaveBeenCalledTimes(1);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 70,
        behavior: 'smooth',
      });
    });

    it('preserves mid-list scroll anchor without shifting position when new message is appended', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;

      const initialMessages: NavigatorMessage[] = Array.from({ length: 30 }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let currentMessages = initialMessages;
      let currentScrollTop = 0;
      Object.defineProperty(listElement, 'scrollTop', {
        get: () => currentScrollTop,
        set: (val: number) => {
          currentScrollTop = val;
        },
        configurable: true,
      });

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return {
              top: 0,
              bottom: CONTAINER_HEIGHT,
              height: CONTAINER_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: 0,
              toJSON: () => {},
            } as DOMRect;
          }
          if ((this as HTMLElement).classList?.contains('navigator-item')) {
            const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
            const top = index * ROW_HEIGHT - currentScrollTop;
            return {
              top,
              bottom: top + ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: top,
              toJSON: () => {},
            } as DOMRect;
          }
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect;
        };

        const renderer = createTocListRenderer({
          getMessages: () => currentMessages,
          getActiveIndex: () => 10,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
        });

        renderer.render({ completed: true });
        scrollToMock.mockClear();

        currentScrollTop = 400;

        currentMessages = [
          ...initialMessages,
          {
            id: 'msg-30',
            text: 'Prompt 31',
            canMatchByText: true,
            createTime: 30 * 1000,
          },
        ];

        renderer.render();

        expect(listElement.scrollTop).toBe(400);
        expect(scrollToMock).not.toHaveBeenCalled();
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
        delete (listElement as any).scrollTop;
      }
    });

    it('gracefully handles missing anchor when the anchored message is deleted, retaining layout without erratic scroll jump', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;

      const initialMessages: NavigatorMessage[] = [
        { id: 'msg-0', text: 'Prompt 1', canMatchByText: true, createTime: 1000 },
        { id: 'msg-1', text: 'Prompt 2', canMatchByText: true, createTime: 2000 },
        { id: 'msg-2', text: 'Prompt 3', canMatchByText: true, createTime: 3000 },
      ];

      let currentMessages = initialMessages;
      let currentScrollTop = 40;
      Object.defineProperty(listElement, 'scrollTop', {
        get: () => currentScrollTop,
        set: (val: number) => {
          currentScrollTop = val;
        },
        configurable: true,
      });

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return {
              top: 0,
              bottom: CONTAINER_HEIGHT,
              height: CONTAINER_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: 0,
              toJSON: () => {},
            } as DOMRect;
          }
          if ((this as HTMLElement).classList?.contains('navigator-item')) {
            const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
            const top = index * ROW_HEIGHT - currentScrollTop;
            return {
              top,
              bottom: top + ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: top,
              toJSON: () => {},
            } as DOMRect;
          }
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect;
        };

        const renderer = createTocListRenderer({
          getMessages: () => currentMessages,
          getActiveIndex: () => 1,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
        });

        renderer.render({ completed: true });
        scrollToMock.mockClear();

        currentMessages = [
          { id: 'msg-0', text: 'Prompt 1', canMatchByText: true, createTime: 1000 },
          { id: 'msg-2', text: 'Prompt 3', canMatchByText: true, createTime: 3000 },
        ];

        expect(() => renderer.render()).not.toThrow();
        expect(renderer.getNavigatorItems().length).toBe(2);
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
        delete (listElement as any).scrollTop;
      }
    });

    it('preserves visual position without unnecessary long smooth scroll when latest item was already visible before message append', () => {
      const ROW_HEIGHT = 40;
      const CONTAINER_HEIGHT = 500;
      const INITIAL_COUNT = 20;

      const initialMessages: NavigatorMessage[] = Array.from({ length: INITIAL_COUNT }, (_, i) => ({
        id: `msg-${i}`,
        text: `Prompt ${i + 1}`,
        canMatchByText: true,
        createTime: i * 1000,
      }));

      let currentMessages = initialMessages;
      let activeIndex: number | null = INITIAL_COUNT - 1;
      let currentScrollTop = 350;

      Object.defineProperty(listElement, 'scrollTop', {
        get: () => currentScrollTop,
        set: (val: number) => {
          currentScrollTop = val;
        },
        configurable: true,
      });

      const prevGetBCR = window.HTMLElement.prototype.getBoundingClientRect;
      try {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this === listElement) {
            return {
              top: 0,
              bottom: CONTAINER_HEIGHT,
              height: CONTAINER_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: 0,
              toJSON: () => {},
            } as DOMRect;
          }
          if ((this as HTMLElement).classList?.contains('navigator-item')) {
            const index = Number((this as HTMLElement).dataset?.messageIndex ?? 0);
            const top = index * ROW_HEIGHT - currentScrollTop;
            return {
              top,
              bottom: top + ROW_HEIGHT,
              height: ROW_HEIGHT,
              left: 0,
              right: 200,
              width: 200,
              x: 0,
              y: top,
              toJSON: () => {},
            } as DOMRect;
          }
          return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect;
        };

        const renderer = createTocListRenderer({
          getMessages: () => currentMessages,
          getActiveIndex: () => activeIndex,
          onItemClick: vi.fn(),
          isFollowingMode: () => false,
        });

        renderer.render({ completed: true });
        scrollToMock.mockClear();

        currentMessages = [
          ...initialMessages,
          {
            id: 'msg-20',
            text: 'Prompt 21',
            canMatchByText: true,
            createTime: 20 * 1000,
          },
        ];
        activeIndex = 20;

        renderer.render();

        expect(listElement.scrollTop).toBe(350);
        expect(scrollToMock).not.toHaveBeenCalled();
      } finally {
        window.HTMLElement.prototype.getBoundingClientRect = prevGetBCR;
        delete (listElement as any).scrollTop;
      }
    });
  });

  describe('scrollLastItemIntoView', () => {
    it('returns false when no items exist', () => {
      const renderer = createTocListRenderer({
        getMessages: () => [],
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });
      renderer.render();

      expect(renderer.scrollLastItemIntoView()).toBe(false);
    });

    it('scrolls the last item into view when it is hidden below container', () => {
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });
      renderer.render();

      const scrollContainer = document.getElementById('navigator-list')!;
      const scrollToMock = vi.fn();
      scrollContainer.scrollTo = scrollToMock;

      scrollContainer.getBoundingClientRect = () => ({
        top: 0,
        bottom: 300,
        height: 300,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const items = renderer.getNavigatorItems();
      const lastItem = items[items.length - 1];
      lastItem.getBoundingClientRect = () => ({
        top: 500,
        bottom: 540,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 500,
        toJSON: () => {},
      });

      const result = renderer.scrollLastItemIntoView();
      expect(result).toBe(true);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 320,
        behavior: 'smooth',
      });
    });

    it('does not scroll when the last item is already fully visible in viewport', () => {
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });
      renderer.render();

      const scrollContainer = document.getElementById('navigator-list')!;
      const scrollToMock = vi.fn();
      scrollContainer.scrollTo = scrollToMock;

      scrollContainer.getBoundingClientRect = () => ({
        top: 0,
        bottom: 400,
        height: 400,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const items = renderer.getNavigatorItems();
      const lastItem = items[items.length - 1];
      lastItem.getBoundingClientRect = () => ({
        top: 100,
        bottom: 140,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 100,
        toJSON: () => {},
      });

      const result = renderer.scrollLastItemIntoView();
      expect(result).toBe(true);
      expect(scrollToMock).not.toHaveBeenCalled();
    });

    it('handles a single-item TOC gracefully', () => {
      const singleMessage: NavigatorMessage[] = [mockMessages[0]];
      const renderer = createTocListRenderer({
        getMessages: () => singleMessage,
        getActiveIndex: () => null,
        onItemClick: vi.fn(),
      });
      renderer.render();

      const scrollContainer = document.getElementById('navigator-list')!;
      const scrollToMock = vi.fn();
      scrollContainer.scrollTo = scrollToMock;

      scrollContainer.getBoundingClientRect = () => ({
        top: 0,
        bottom: 300,
        height: 300,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const items = renderer.getNavigatorItems();
      items[0].getBoundingClientRect = () => ({
        top: 400,
        bottom: 440,
        height: 40,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: 400,
        toJSON: () => {},
      });

      expect(renderer.scrollLastItemIntoView()).toBe(true);
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 220,
        behavior: 'smooth',
      });
    });
  });
});
