/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { setLoading } from '@/navigation/loading/promptLoadingState';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { initializePromptMark, isPromptMarked } from '@/features/conversationPrompts/promptMark';

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
    expect(hintElement.textContent).toBe('没有匹配的提示词。');
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
    expect(hintElement.textContent).toBe('等待提示词...');
  });

  it('renders stable empty state when prompts are empty and loading is false', () => {
    const statusElement = document.createElement('div');
    statusElement.id = 'luna-toc-status';
    document.body.appendChild(statusElement);

    setLoading(false);
    const renderer = createTocListRenderer({
      getMessages: () => [],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });

    // Initial render with completed=true renders empty state
    renderer.render({ completed: true });
    expect(statusElement.textContent).toBe('暂无提示词');

    // Subsequent normal render without completed=true must stay empty, not revert to idle
    renderer.render();
    expect(statusElement.textContent).toBe('暂无提示词');
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

  it('renders only the index and title, without any inline action buttons', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();

    const main = listElement.querySelector('.navigator-item-main')!;
    expect(Array.from(main.children).map(element => element.className))
      .toEqual([
        'navigator-item-index',
        'navigator-item-text',
      ]);
    expect(main.querySelector('button')).toBeNull();
  });

  it('sends repeat row clicks to navigation for outline toggling without the chevron', () => {
    const onItemClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick,
    });

    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    expect(row.querySelector('.navigator-outline-indicator')).toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.click();
    row.click();
    expect(onItemClick).toHaveBeenCalledTimes(2);
    expect(onItemClick).toHaveBeenNthCalledWith(1, mockMessages[1], 1);
    expect(onItemClick).toHaveBeenNthCalledWith(2, mockMessages[1], 1);
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

  it('uses original prompt text without custom title styling', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const item = listElement.children[1] as HTMLElement;
    expect(item.querySelector('.navigator-item-index')?.textContent).toBe('2.');
    expect(item.querySelector('.navigator-item-text')?.textContent).toBe('Second user prompt');
    expect(item.classList.contains('navigator-item-custom-title')).toBe(false);
  });

  it('offers 收藏 / 复制 / 添加 on right-click and preserves add action', () => {
    const onSavePrompt = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onSavePrompt,
    });
    renderer.render();
    const item = listElement.children[1] as HTMLElement;
    expect(item.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 70,
      clientY: 90,
    }))).toBe(false);
    expect(promptContextMenuController.getSnapshot()?.items).toEqual([
      { id: 'mark-prompt', label: '收藏', icon: 'bookmark-plus' },
      { id: 'copy-prompt', label: '复制', icon: 'copy' },
      { id: 'save-prompt', label: '添加', icon: 'bookmark-plus' },
    ]);
    promptContextMenuController.select('save-prompt');
    expect(onSavePrompt).toHaveBeenCalledWith(mockMessages[1]);
    expect(promptContextMenuController.getSnapshot()).toBeNull();
  });

  it('toggles 收藏 from the context menu while retaining stored mark state', () => {
    const conversationKey = 'toc-menu-test';
    const onMarkChanged = vi.fn();
    initializePromptMark({ conversationKey, onMarkChanged });
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    const storageKey = `chatToc:marks:${conversationKey}`;
    try {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      promptContextMenuController.select('mark-prompt');
      expect(isPromptMarked('msg-2')).toBe(true);
      expect(row.classList.contains('navigator-item-marked')).toBe(true);
      expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toContain('msg-2');

      renderer.render();
      const newRow = listElement.children[1] as HTMLElement;
      expect(newRow.classList.contains('navigator-item-marked')).toBe(true);
      newRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      promptContextMenuController.select('mark-prompt');
      expect(isPromptMarked('msg-2')).toBe(false);
      expect(newRow.classList.contains('navigator-item-marked')).toBe(false);
      expect(JSON.parse(sessionStorage.getItem(storageKey)!)).not.toContain('msg-2');
      expect(onMarkChanged).toHaveBeenCalledTimes(2);
    } finally {
      sessionStorage.removeItem(storageKey);
      initializePromptMark({ conversationKey: 'toc-menu-reset' });
    }
  });

  it('keeps long prompt text intact for CSS truncation and opens actions only on right-click', () => {
    const original = 'A very long user question about implementation details '.repeat(10);
    const onItemClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => [{ ...mockMessages[0], text: original }],
      getActiveIndex: () => null,
      onItemClick,
    });
    renderer.render();

    const row = listElement.children[0] as HTMLElement;
    const text = row.querySelector<HTMLElement>('.navigator-item-text')!;
    expect(text.textContent).toBe(original);
    expect(row.querySelector('button')).toBeNull();
    expect(promptContextMenuController.getSnapshot()).toBeNull();

    text.click();
    expect(onItemClick).toHaveBeenCalledOnce();
    expect(promptContextMenuController.getSnapshot()).toBeNull();

    text.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(item => item.label))
      .toEqual(['收藏', '复制', '添加']);
    promptContextMenuController.close();
  });

  it('copies the original prompt via the context menu without changing navigation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onItemClick = vi.fn();
    try {
      const renderer = createTocListRenderer({
        getMessages: () => mockMessages,
        getActiveIndex: () => null,
        onItemClick,
      });
      renderer.render();
      const item = listElement.children[0] as HTMLElement;
      item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      promptContextMenuController.select('copy-prompt');

      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('First user prompt');
      });
      expect(onItemClick).not.toHaveBeenCalled();
      expect(promptContextMenuController.getSnapshot()).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: originalClipboard,
      });
    }
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
  });
});
