/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
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

  it('snaps cursor to last prompt on idle load completion when not following', () => {
    let forcedIndex: number | null = null;
    const renderer = createTocListRenderer({
      getMessages: () => mockMessages,
      getActiveIndex: () => null,
      onItemClick: vi.fn(),
      onForceActiveIndex: (index) => {
        forcedIndex = index;
      },
      isFollowingMode: () => false,
    });

    renderer.render({ completed: true });
    expect(forcedIndex).toBe(2);
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
    expect(secondItem.textContent).toContain('2. Renamed Step 2');
    expect(secondItem.classList.contains('navigator-item-custom-title')).toBe(true);

    const firstItem = listElement.children[0] as HTMLElement;
    expect(firstItem.textContent).toContain('1. First user prompt');
    expect(firstItem.classList.contains('navigator-item-custom-title')).toBe(false);

    await removeCustomTitle('msg-2');
  });
});
