/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import { ConfirmDialogHost } from '@/components/my-prompts/ConfirmDialog';
import {
  showPromptModal,
  resetPromptModal,
} from '@/features/myPrompts/promptDialogController';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import { createTocListRenderer } from '@/navigation/ui/tocListRenderer';
import { scrollNavigatorListToEdge } from '@/features/sidebar/jumpToEdgeControls';
import { navigatorController } from '@/navigation/navigatorController';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';
import type { NavigatorMessage } from '@/features/conversationPrompts/message';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('MyPrompts React Portal DOM Ownership and Lifecycle Integration', () => {
  let rootContainer: HTMLDivElement;
  let dialogRootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let toolbarContainer: HTMLDivElement;
  let tocList: HTMLDivElement;
  let myPromptsList: HTMLDivElement;
  let toggleButton: HTMLButtonElement;
  let titleButton: HTMLButtonElement;
  let searchInput: HTMLInputElement;
  let searchToggleBtn: HTMLButtonElement;
  let root: Root;
  let dialogRoot: Root;

  const mockPrompts: SavedPrompt[] = [
    {
      id: 'prompt-1',
      title: 'Prompt One',
      content: 'Alpha prompt text',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'prompt-2',
      title: 'Prompt Two',
      content: 'Beta prompt text',
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];

  const mockTocMessages: NavigatorMessage[] = [
    { id: 'msg-1', text: 'TOC message one', canMatchByText: true, createTime: 100 },
    { id: 'msg-2', text: 'TOC message two', canMatchByText: true, createTime: 200 },
  ];

  beforeEach(() => {
    resetPromptModal();

    // Setup full sidebar shell elements
    toolbarContainer = document.createElement('div');
    toolbarContainer.id = 'myprompts-toolbar-container';
    toolbarContainer.style.display = 'none';

    tocList = document.createElement('div');
    tocList.id = 'navigator-list';

    myPromptsList = document.createElement('div');
    myPromptsList.id = 'myprompts-list';
    myPromptsList.className = 'navigator-list';
    myPromptsList.style.display = 'none';

    toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-view-mode-btn';

    titleButton = document.createElement('button');
    titleButton.id = 'navigator-title';

    searchInput = document.createElement('input');
    searchInput.id = 'navigator-search';
    searchInput.type = 'search';
    searchInput.style.display = 'none';

    searchToggleBtn = document.createElement('button');
    searchToggleBtn.id = 'search-toggle-btn';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    dialogRootContainer = document.createElement('div');
    dialogRootContainer.id = 'luna-toc-dialog-root';

    portalContainer = document.createElement('div');
    portalContainer.className = 'luna-toc-ui';

    document.body.append(
      toolbarContainer,
      tocList,
      myPromptsList,
      toggleButton,
      titleButton,
      searchInput,
      searchToggleBtn,
      rootContainer,
      dialogRootContainer,
      portalContainer
    );

    setReactPortalContainer(portalContainer);

    sidebarController.init();
    sidebarController.setPromptCount(mockTocMessages.length);
    sidebarController.setMyPromptsCount(mockPrompts.length);

    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);

    root = createRoot(rootContainer);
    dialogRoot = createRoot(dialogRootContainer);

    act(() => {
      root.render(<MyPromptsView />);
      dialogRoot.render(<ConfirmDialogHost />);
    });
  });

  afterEach(() => {
    act(() => {
      resetPromptModal();
      root.unmount();
      dialogRoot.unmount();
      sidebarController.setViewMode('toc');
    });
    setReactPortalContainer(null);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('1. TOC -> MyPrompts -> TOC -> MyPrompts toggles visibility and mount lifecycle without error', () => {
    // Initial state: TOC active
    expect(sidebarController.getViewMode()).toBe('toc');
    expect(tocList.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('none');
    expect(toolbarContainer.style.display).toBe('none');
    expect(myPromptsList.children.length).toBe(0);

    // Switch to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(sidebarController.getViewMode()).toBe('myPrompts');
    expect(tocList.style.display).toBe('none');
    expect(myPromptsList.style.display).toBe('');
    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);

    // Switch back to TOC
    act(() => {
      sidebarController.setViewMode('toc');
    });
    expect(sidebarController.getViewMode()).toBe('toc');
    expect(tocList.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('none');
    expect(toolbarContainer.style.display).toBe('none');
    expect(myPromptsList.children.length).toBe(0);

    // Switch to MyPrompts again
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(sidebarController.getViewMode()).toBe('myPrompts');
    expect(tocList.style.display).toBe('none');
    expect(myPromptsList.style.display).toBe('');
    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);
  });

  it('2. Rapid repeated switching (20 cycles) executes cleanly with no errors', () => {
    const errorSpy = vi.spyOn(console, 'error');

    for (let i = 0; i < 20; i++) {
      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(sidebarController.getViewMode()).toBe('myPrompts');
      expect(tocList.style.display).toBe('none');
      expect(myPromptsList.style.display).toBe('');

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(sidebarController.getViewMode()).toBe('toc');
      expect(tocList.style.display).toBe('');
      expect(myPromptsList.style.display).toBe('none');
    }

    // Finally switch back to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(sidebarController.getViewMode()).toBe('myPrompts');
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('3. TOC background re-render while MyPrompts is active does not affect MyPrompts portal', () => {
    const tocRenderer = createTocListRenderer({
      getMessages: () => mockTocMessages,
      getActiveIndex: () => 0,
      onItemClick: vi.fn(),
    });

    // Populate TOC initially
    tocRenderer.render();
    expect(tocList.children.length).toBe(2);

    // Switch to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);

    // Simulate streaming update from ChatGPT in the background
    const updatedMessages: NavigatorMessage[] = [
      ...mockTocMessages,
      { id: 'msg-3', text: 'TOC message three', canMatchByText: true, createTime: 300 },
    ];
    const updatedRenderer = createTocListRenderer({
      getMessages: () => updatedMessages,
      getActiveIndex: () => 0,
      onItemClick: vi.fn(),
    });

    // This calls list.innerHTML = '' on #navigator-list
    updatedRenderer.render();

    // Verify #navigator-list was updated by Vanilla code
    expect(tocList.children.length).toBe(3);

    // Verify #myprompts-list was completely untouched by TOC render
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);
    expect(toolbarContainer.querySelector('.my-prompts-sort-bar')).not.toBeNull();
  });

  it('4. Both list containers remain present in DOM at all times', () => {
    expect(document.getElementById('navigator-list')).toBe(tocList);
    expect(document.getElementById('myprompts-list')).toBe(myPromptsList);

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(document.getElementById('navigator-list')).toBe(tocList);
    expect(document.getElementById('myprompts-list')).toBe(myPromptsList);

    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(document.getElementById('navigator-list')).toBe(tocList);
    expect(document.getElementById('myprompts-list')).toBe(myPromptsList);
  });

  it('5. Vanilla TOC cannot delete React-owned nodes', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    const promptRows = myPromptsList.querySelectorAll('.my-prompts-item-row');
    expect(promptRows.length).toBe(2);

    // Run Vanilla innerHTML clearing on tocList
    tocList.innerHTML = '';

    // Verify promptRows are still connected to DOM inside myPromptsList
    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);
    expect(promptRows[0].isConnected).toBe(true);
    expect(promptRows[1].isConnected).toBe(true);
  });

  it('6. React unmount does not affect TOC nodes', () => {
    // Avoid navigatorController clearing tocList on search sync during this isolated test
    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});

    // Populate TOC
    const tocItem = document.createElement('div');
    tocItem.className = 'navigator-item';
    tocItem.textContent = 'Vanilla TOC item';
    tocList.appendChild(tocItem);

    // Switch to MyPrompts (mounts React)
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(tocItem.isConnected).toBe(true);

    // Switch to TOC (unmounts React MyPrompts portal)
    act(() => {
      sidebarController.setViewMode('toc');
    });

    // TOC item is still attached
    expect(tocList.contains(tocItem)).toBe(true);
    expect(tocItem.isConnected).toBe(true);
  });

  it('7. No NotFoundError occurs during any phase of view switching or unmounting', () => {
    const errorListener = vi.fn();
    window.addEventListener('error', errorListener);

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    // Imperatively add and remove items in TOC to test parallel mutation safety
    const tempNode = document.createElement('div');
    tocList.appendChild(tempNode);
    tocList.removeChild(tempNode);

    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(errorListener).not.toHaveBeenCalled();
    window.removeEventListener('error', errorListener);
  });

  it('8. MyPrompts toolbar and list remain functional after switching', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    // Click Add New on toolbar
    const showDialogSpy = vi.spyOn(myPrompts, 'showDialog');
    const addBtn = toolbarContainer.querySelector<HTMLButtonElement>('#myprompt-add-new-btn')!;
    expect(addBtn).not.toBeNull();
    addBtn.click();
    expect(showDialogSpy).toHaveBeenCalledWith(null);

    // Click row (Prompt Two is first under default updated_desc sort)
    const insertSpy = vi.spyOn(myPrompts, 'insertIntoChatGPTInput').mockImplementation(() => {});
    const firstRow = myPromptsList.querySelector<HTMLDivElement>('.my-prompts-item-row')!;
    firstRow.click();
    expect(insertSpy).toHaveBeenCalledWith('Beta prompt text');
  });

  it('9. Search and filtering work after switching', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    // Open search
    searchToggleBtn.click();
    expect(searchInput.style.display).toBe('block');

    // Type query inside act()
    act(() => {
      searchInput.value = 'Beta';
      searchInput.dispatchEvent(new Event('input'));
    });

    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(1);
    expect(myPromptsList.textContent).toContain('Prompt Two');

    // Switching views closes and clears search
    act(() => {
      sidebarController.setViewMode('toc');
    });
    expect(searchInput.style.display).toBe('none');
    expect(searchInput.value).toBe('');
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('10. Background and row context menus work independently', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    const showMenuSpy = vi.spyOn(promptContextMenuController, 'show');

    // Right click on row inside act()
    const firstRow = myPromptsList.querySelector<HTMLDivElement>('.my-prompts-item-row')!;
    act(() => {
      firstRow.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        })
      );
    });
    expect(showMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ id: 'copy-prompt' }),
      ]),
      expect.anything(),
      expect.anything()
    );

    showMenuSpy.mockClear();

    // Right click on background of #myprompts-list inside act()
    act(() => {
      myPromptsList.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 400,
        })
      );
    });
    expect(showMenuSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ id: 'clear-all' }),
      ]),
      expect.anything()
    );
  });

  it('11. Jump controls target the active list', () => {
    const scrollToSpy = vi.fn();
    myPromptsList.scrollTo = scrollToSpy;
    tocList.scrollTo = vi.fn();

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    scrollNavigatorListToEdge('top', 'smooth');
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('12. Scroll positions are preserved across view switches', () => {
    // Set scroll in TOC
    tocList.scrollTop = 150;

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    // Set scroll in MyPrompts
    myPromptsList.scrollTop = 320;

    act(() => {
      sidebarController.setViewMode('toc');
    });

    // TOC restored
    expect(tocList.scrollTop).toBe(150);

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    // MyPrompts restored
    expect(myPromptsList.scrollTop).toBe(320);
  });

  it('13. React dialogs remain functional after repeated switching', async () => {
    // Perform 20 switches
    for (let i = 0; i < 20; i++) {
      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      act(() => {
        sidebarController.setViewMode('toc');
      });
    }

    // Open a React prompt modal
    let promiseResult: boolean | null = null;
    act(() => {
      void showPromptModal({
        title: 'Test Confirm',
        message: 'Are you sure?',
        confirmText: 'Confirm',
      }).then((res) => {
        promiseResult = res;
      });
    });

    // Verify modal is rendered in portal container
    const titleEl = portalContainer.querySelector('[data-slot="dialog-title"]');
    const descEl = portalContainer.querySelector('[data-slot="dialog-description"]');
    expect(titleEl?.textContent).toBe('Test Confirm');
    expect(descEl?.textContent).toBe('Are you sure?');

    // Find and click the confirm button
    const buttons = Array.from(portalContainer.querySelectorAll('button')).filter(
      (btn) => !btn.querySelector('svg')
    );
    const confirmBtn = buttons.find((btn) => btn.textContent?.includes('Confirm'));
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn!.click();
    });

    expect(promiseResult).toBe(true);
    expect(portalContainer.querySelector('[data-slot="dialog-title"]')).toBeNull();
  });
});
