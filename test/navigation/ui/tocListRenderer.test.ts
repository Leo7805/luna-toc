/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { setLoading } from '@/navigation/loading/promptLoadingState';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
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

  /** Expands heading rows in the sidebar without invoking ChatGPT navigation. */
  function showOutline(row: HTMLElement, count = 3): HTMLElement[] {
    const outline = row.querySelector<HTMLElement>('.navigator-outline-list')!;
    outline.hidden = false;
    row.setAttribute('aria-expanded', 'true');
    row.classList.add('navigator-item-outline-expanded');
    const headings = Array.from({ length: count }, (_, index) => {
      const heading = document.createElement('div');
      heading.className = 'navigator-outline-item';
      heading.textContent = `Heading ${index + 1}`;
      outline.appendChild(heading);
      return heading;
    });
    return headings;
  }

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

  it('reuses unchanged rows and replaces only a modified row', () => {
    let messages = mockMessages.map((message) => ({ ...message }));
    const onItemClick = vi.fn();
    const renderer = createTocListRenderer({
      getMessages: () => messages,
      getActiveIndex: () => null,
      onItemClick,
    });
    renderer.render();
    const first = listElement.children[0];
    const second = listElement.children[1];
    renderer.render();
    expect(listElement.children[0]).toBe(first);
    expect(listElement.children[1]).toBe(second);
    messages = messages.map((message, index) =>
      index === 1 ? { ...message, text: 'Updated second prompt' } : message);
    renderer.render();
    expect(listElement.children[0]).toBe(first);
    expect(listElement.children[1]).not.toBe(second);
    expect(listElement.children[1].textContent).toContain('Updated second prompt');
    (listElement.children[1] as HTMLElement).click();
    expect(onItemClick).toHaveBeenLastCalledWith(messages[1], 1);
  });

  it('preserves expanded heading DOM when unchanged', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const first = listElement.children[0] as HTMLElement;
    const headings = showOutline(first, 2);
    renderer.render();
    expect(listElement.children[0]).toBe(first);
    expect(first.querySelectorAll('.navigator-outline-item')[0]).toBe(headings[0]);
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

  it('reconciles the active row after rerender, replacement, search and reset', () => {
    let activeIndex: number | null = 0;
    let messages = mockMessages.map((message) => ({ ...message }));
    const renderer = createTocListRenderer({
      getMessages: () => messages,
      getActiveIndex: () => activeIndex,
      onItemClick: vi.fn(),
      isFollowingMode: () => false,
    });

    renderer.render();
    const firstRow = renderer.getNavigatorItems()[0];
    activeIndex = 1;
    renderer.render();
    expect(renderer.getNavigatorItems()[0]).toBe(firstRow);
    expect(firstRow.classList.contains('navigator-item-active')).toBe(false);
    expect(renderer.getNavigatorItems()[1].classList.contains('navigator-item-active')).toBe(true);

    const oldSecondRow = renderer.getNavigatorItems()[1];
    messages = messages.map((message, index) =>
      index === 1 ? { ...message, text: 'Updated second question' } : message
    );
    renderer.render();
    expect(renderer.getNavigatorItems()[1]).not.toBe(oldSecondRow);
    expect(oldSecondRow.classList.contains('navigator-item-active')).toBe(false);
    expect(renderer.getNavigatorItems()[1].classList.contains('navigator-item-active')).toBe(true);

    renderer.setSearchQuery('First user prompt');
    expect(listElement.children.length).toBe(1);
    expect(listElement.querySelector('.navigator-item-active')).toBeNull();
    renderer.setSearchQuery('');
    expect(renderer.getNavigatorItems()[1].classList.contains('navigator-item-active')).toBe(true);

    const oldActiveRow = renderer.getNavigatorItems()[1];
    renderer.resetList();
    expect(oldActiveRow.classList.contains('navigator-item-active')).toBe(false);
    renderer.render();
    expect(renderer.getNavigatorItems()[1].classList.contains('navigator-item-active')).toBe(true);
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

  it('hides raw Markdown bold delimiters in question labels', () => {
    const message = { ...mockMessages[0]!, text: 'Question **bold** title' };
    const renderer = createTocListRenderer({
      getMessages: () => [message],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();

    expect(listElement.querySelector('.navigator-item-text')?.textContent)
      .toBe('Question bold title');
  });

  it('shows no outline-boundary commands while the sidebar answer outline is collapsed', () => {
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
      bubbles: true, cancelable: true, clientX: 70, clientY: 90,
    }))).toBe(false);
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['copy-prompt', 'save-prompt']);
    promptContextMenuController.select('save-prompt');
    expect(onSavePrompt).toHaveBeenCalledWith(mockMessages[1]);
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ label }) => label))
      .toEqual(['复制文字', '添加Tips']);
  });

  it('includes edit third but hides outline jumps until headings are expanded', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: async () => undefined,
      canRename: () => true,
    });
    renderer.render();
    const row = listElement.children[0] as HTMLElement;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['copy-prompt', 'save-prompt', 'rename-toc']);
    expect(promptContextMenuController.getSnapshot()?.items[2].label).toBe('编辑文字');
    promptContextMenuController.close();

    showOutline(row);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['collapse-outline', 'copy-prompt', 'save-prompt', 'rename-toc', 'return-to-top', 'return-to-bottom']);
    expect(promptContextMenuController.getSnapshot()?.items[0].label).toBe('收起目录');
    promptContextMenuController.close();
    row.querySelector<HTMLElement>('.navigator-outline-list')!.hidden = true;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['copy-prompt', 'save-prompt', 'rename-toc']);
  });

  it('keeps edit unavailable for temporary conversations', () => {
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onRenamePrompt: async () => undefined,
      canRename: () => false,
    });
    renderer.render();
    listElement.children[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['copy-prompt', 'save-prompt']);
  });

  it('hides boundary actions when the expanded question and headings are fully visible', () => {
    const topbar = document.createElement('div');
    topbar.className = 'navigator-topbar';
    listElement.before(topbar);
    vi.spyOn(topbar, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 180,
    } as DOMRect);
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    showOutline(row);
    const question = row.querySelector<HTMLElement>('.navigator-item-main')!;
    const outline = row.querySelector<HTMLElement>('.navigator-outline-list')!;
    const questionRect = vi.spyOn(question, 'getBoundingClientRect').mockReturnValue({
      top: 200, bottom: 228,
    } as DOMRect);
    const outlineRect = vi.spyOn(outline, 'getBoundingClientRect').mockReturnValue({
      top: 228, bottom: 480,
    } as DOMRect);
    const open = (): string[] => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      return promptContextMenuController.getSnapshot()?.items.map(({ id }) => id) ?? [];
    };
    expect(open()).toEqual(['collapse-outline', 'copy-prompt', 'save-prompt']);
    promptContextMenuController.close();

    // Partly under the frosted top bar.
    questionRect.mockReturnValue({ top: 170, bottom: 200 } as DOMRect);
    expect(open()).toEqual(['collapse-outline', 'copy-prompt', 'save-prompt', 'return-to-top', 'return-to-bottom']);
    promptContextMenuController.close();

    // The question is visible, but the last heading is clipped below the list.
    questionRect.mockReturnValue({ top: 200, bottom: 228 } as DOMRect);
    outlineRect.mockReturnValue({ top: 228, bottom: 510 } as DOMRect);
    expect(open()).toEqual(['collapse-outline', 'copy-prompt', 'save-prompt', 'return-to-top', 'return-to-bottom']);
    promptContextMenuController.close();

    // Both return to view as the user scrolls the list.
    outlineRect.mockReturnValue({ top: 228, bottom: 500 } as DOMRect);
    expect(open()).toEqual(['collapse-outline', 'copy-prompt', 'save-prompt']);
  });

  it('ignores a stale boundary action once scrolling exposes the complete outline', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    showOutline(row);
    const question = row.querySelector<HTMLElement>('.navigator-item-main')!;
    const outline = row.querySelector<HTMLElement>('.navigator-outline-list')!;
    vi.spyOn(question, 'getBoundingClientRect').mockReturnValue({
      top: 200, bottom: 228,
    } as DOMRect);
    const outlineRect = vi.spyOn(outline, 'getBoundingClientRect').mockReturnValue({
      top: 230, bottom: 800,
    } as DOMRect);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toContain('return-to-bottom');
    outlineRect.mockReturnValue({ top: 230, bottom: 450 } as DOMRect);
    promptContextMenuController.select('return-to-bottom');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('aligns the full prompt row below the frosted topbar and shows the next prompt at bottom', () => {
    const onItemClick = vi.fn();
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    listElement.scrollTop = 400;
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500, height: 400,
    } as DOMRect);
    const topbar = document.createElement('div');
    topbar.className = 'navigator-topbar';
    listElement.before(topbar);
    vi.spyOn(topbar, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 180,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick,
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    const headings = showOutline(row);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 220, bottom: 970,
    } as DOMRect);
    const nextRow = listElement.children[2] as HTMLElement;
    vi.spyOn(nextRow, 'getBoundingClientRect').mockReturnValue({
      top: 988, bottom: 1022,
    } as DOMRect);
    vi.spyOn(headings[0], 'getBoundingClientRect').mockReturnValue({
      top: 220, bottom: 248,
    } as DOMRect);
    vi.spyOn(headings[2], 'getBoundingClientRect').mockReturnValue({
      top: 897, bottom: 925,
    } as DOMRect);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(promptContextMenuController.getSnapshot()?.items.map(({ id }) => id))
      .toEqual(['collapse-outline', 'copy-prompt', 'save-prompt', 'return-to-top', 'return-to-bottom']);
    promptContextMenuController.select('return-to-top');
    // The entire question row, not just its first heading, sits below the overlay.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 432, behavior: 'auto' });
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('return-to-bottom');
    // Reveal the *whole* next directory row rather than aligning the last heading.
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 930, behavior: 'auto' });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(onItemClick).not.toHaveBeenCalled();
    expect(renderer.getSearchQuery()).toBe('');
  });

  it('places a prompt hidden above the frosted topbar first after collapsing its outline', () => {
    const onItemClick = vi.fn();
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    listElement.scrollTop = 520;
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const topbar = document.createElement('div');
    topbar.className = 'navigator-topbar';
    listElement.before(topbar);
    vi.spyOn(topbar, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 180,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick,
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    showOutline(row);
    vi.spyOn(row.querySelector<HTMLElement>('.navigator-item-main')!, 'getBoundingClientRect')
      .mockReturnValue({ top: 130, bottom: 158 } as DOMRect);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 130, bottom: 730,
    } as DOMRect);

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('collapse-outline');

    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 462, behavior: 'auto' });
    expect(renderer.getNavigatorItems()[1]).toBe(row);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('does not move a visible prompt when collapsing headings clipped below', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    showOutline(row);
    vi.spyOn(row.querySelector<HTMLElement>('.navigator-item-main')!, 'getBoundingClientRect')
      .mockReturnValue({ top: 200, bottom: 228 } as DOMRect);
    vi.spyOn(row.querySelector<HTMLElement>('.navigator-outline-list')!, 'getBoundingClientRect')
      .mockReturnValue({ top: 228, bottom: 720 } as DOMRect);

    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('collapse-outline');

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll after an expanded outline collapses while its menu is open', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[1] as HTMLElement;
    showOutline(row);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    row.setAttribute('aria-expanded', 'false');
    promptContextMenuController.select('return-to-bottom');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls expanded headings under the filtered directory original index', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.setSearchQuery('Third prompt');
    const row = listElement.children[0] as HTMLElement;
    const headings = showOutline(row);
    vi.spyOn(headings[2], 'getBoundingClientRect').mockReturnValue({
      top: 820, bottom: 860,
    } as DOMRect);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('return-to-bottom');
    expect(scrollTo).toHaveBeenCalledWith({ top: 368, behavior: 'auto' });
    expect(renderer.getSearchQuery()).toBe('Third prompt');
  });

  it('aligns the last expanded heading at the bottom when no following directory exists', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    listElement.scrollTop = 200;
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 110, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => [mockMessages[0]],
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
    });
    renderer.render();
    const row = listElement.children[0] as HTMLElement;
    const headings = showOutline(row);
    vi.spyOn(headings[2], 'getBoundingClientRect').mockReturnValue({
      top: 885, bottom: 920,
    } as DOMRect);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('return-to-bottom');
    expect(scrollTo).toHaveBeenCalledWith({ top: 628, behavior: 'auto' });
  });

  it('reveals the next visible prompt after a filtered-out middle row', () => {
    const scrollTo = vi.fn();
    listElement.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 500,
    } as DOMRect);
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      getDisplayText: (message) => message.id === 'msg-2' ? message.text : 'shared marker',
    });
    renderer.setSearchQuery('shared marker');
    const row = listElement.children[0] as HTMLElement;
    const nextRow = listElement.children[1] as HTMLElement;
    showOutline(row);
    vi.spyOn(nextRow, 'getBoundingClientRect').mockReturnValue({
      top: 720, bottom: 754,
    } as DOMRect);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    promptContextMenuController.select('return-to-bottom');
    expect(scrollTo).toHaveBeenCalledWith({ top: 262, behavior: 'auto' });
    expect(renderer.getSearchQuery()).toBe('shared marker');
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
      .toEqual(['复制文字', '添加Tips']);
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
