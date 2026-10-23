/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('MyPromptsView and components', () => {
  let rootContainer: HTMLDivElement;
  let toolbarContainer: HTMLDivElement;
  let listContainer: HTMLDivElement;
  let toggleButton: HTMLButtonElement;
  let titleButton: HTMLButtonElement;
  let searchInput: HTMLInputElement;
  let searchToggleBtn: HTMLButtonElement;
  let root: Root;

  const mockPrompts: SavedPrompt[] = [
    {
      id: 'prompt-1',
      title: 'Alpha Prompt',
      content: 'Content for alpha',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'prompt-2',
      title: 'Beta Prompt',
      content: 'Content for beta',
      createdAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 'prompt-3',
      title: 'Gamma Prompt',
      content: 'Special keyword',
      createdAt: 3000,
      updatedAt: 3000,
    },
  ];

  beforeEach(() => {
    // Setup DOM elements expected by sidebar and portal
    toolbarContainer = document.createElement('div');
    toolbarContainer.id = 'myprompts-toolbar-container';

    const navigatorList = document.createElement('div');
    navigatorList.id = 'navigator-list';

    listContainer = document.createElement('div');
    listContainer.id = 'myprompts-list';

    toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-view-mode-btn';

    titleButton = document.createElement('button');
    titleButton.id = 'navigator-title';

    searchInput = document.createElement('input');
    searchInput.id = 'navigator-search';

    searchToggleBtn = document.createElement('button');
    searchToggleBtn.id = 'search-toggle-btn';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    document.body.append(
      toolbarContainer,
      navigatorList,
      listContainer,
      toggleButton,
      titleButton,
      searchInput,
      searchToggleBtn,
      rootContainer
    );

    sidebarController.init();

    // Default mock prompts
    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);

    root = createRoot(rootContainer);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      sidebarController.setViewMode('toc');
    });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders null when viewMode is toc', () => {
    act(() => {
      sidebarController.setViewMode('toc');
      root.render(React.createElement(MyPromptsView));
    });

    expect(toolbarContainer.children.length).toBe(0);
    expect(listContainer.children.length).toBe(0);
  });

  it('mounts portals into containers when viewMode is myPrompts', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    expect(toolbarContainer.querySelector('.my-prompts-sort-bar')).not.toBeNull();
    expect(listContainer.querySelector('.my-prompts-items-container')).not.toBeNull();
    expect(listContainer.querySelectorAll('.my-prompts-item-row').length).toBe(3);
  });

  it('does not duplicate renderers and cleans up when switching back to toc', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    expect(toolbarContainer.querySelectorAll('.my-prompts-sort-bar').length).toBe(1);
    expect(listContainer.querySelectorAll('.my-prompts-items-container').length).toBe(1);

    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(toolbarContainer.children.length).toBe(0);
    expect(listContainer.children.length).toBe(0);
  });

  it('filters prompts based on search query', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    expect(listContainer.querySelectorAll('.my-prompts-item-row').length).toBe(3);

    act(() => {
      searchInput.value = 'Beta';
      searchInput.dispatchEvent(new Event('input'));
    });

    const rows = listContainer.querySelectorAll('.my-prompts-item-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Beta Prompt');
  });

  it('displays empty state hint when search has no matches', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    act(() => {
      searchInput.value = 'NonExistentQuery';
      searchInput.dispatchEvent(new Event('input'));
    });

    const hint = listContainer.querySelector('.navigator-hint');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('No matching prompts.');
  });

  it('sorts prompts when sort mode changes', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const select = toolbarContainer.querySelector<HTMLSelectElement>('#myprompt-sort-select')!;
    expect(select).not.toBeNull();

    // Change to Title (Z-A)
    act(() => {
      select.value = 'name_desc';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const rows = listContainer.querySelectorAll('.my-prompts-item-row');
    expect(rows[0].textContent).toContain('Gamma Prompt');
    expect(rows[1].textContent).toContain('Beta Prompt');
    expect(rows[2].textContent).toContain('Alpha Prompt');
  });

  it('triggers Add prompt action on add button click', () => {
    const showDialogSpy = vi.spyOn(myPrompts, 'showDialog').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const addBtn = toolbarContainer.querySelector<HTMLButtonElement>('#myprompt-add-new-btn')!;
    act(() => {
      addBtn.click();
    });

    expect(showDialogSpy).toHaveBeenCalledWith(null);
  });

  it('triggers Edit prompt action on edit button click', () => {
    const showDialogSpy = vi.spyOn(myPrompts, 'showDialog').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const editBtn = listContainer.querySelector<HTMLButtonElement>('.edit-myprompt-btn')!;
    act(() => {
      editBtn.click();
    });

    expect(showDialogSpy).toHaveBeenCalledWith(mockPrompts[2]); // newest is prompt-3
  });

  it('triggers Delete prompt action on delete button click', () => {
    const deleteSpy = vi.spyOn(myPrompts, 'deletePrompt').mockResolvedValue();

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const deleteBtn = listContainer.querySelector<HTMLButtonElement>('.delete-myprompt-btn')!;
    act(() => {
      deleteBtn.click();
    });

    expect(deleteSpy).toHaveBeenCalledWith(mockPrompts[2]);
  });

  it('inserts prompt into chat input on item click', () => {
    const insertSpy = vi.spyOn(myPrompts, 'insertIntoChatGPTInput').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const row = listContainer.querySelector<HTMLDivElement>('.my-prompts-item-row')!;
    act(() => {
      row.click();
    });

    expect(insertSpy).toHaveBeenCalledWith(mockPrompts[2].content);
  });

  it('triggers Import and Export actions from toolbar buttons', () => {
    const importSpy = vi.spyOn(myPrompts, 'importMyPrompts').mockImplementation(() => {});
    const exportSpy = vi.spyOn(myPrompts, 'exportMyPrompts').mockResolvedValue();

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const importBtn = toolbarContainer.querySelector<HTMLButtonElement>('#myprompt-import-btn')!;
    const exportBtn = toolbarContainer.querySelector<HTMLButtonElement>('#myprompt-export-btn')!;

    act(() => {
      importBtn.click();
    });
    expect(importSpy).toHaveBeenCalledTimes(1);

    act(() => {
      exportBtn.click();
    });
    expect(exportSpy).toHaveBeenCalledTimes(1);
  });

  it('opens context menu on right click of prompt item', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const row = listContainer.querySelector<HTMLDivElement>('.my-prompts-item-row')!;
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }));
    });

    expect(contextSpy).toHaveBeenCalledWith(
      { left: 100, top: 200 },
      [{ id: 'copy-prompt', label: 'Copy Prompt', icon: 'copy' }],
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('opens clear-all context menu on background right click on #navigator-list below the items', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});
    const clearAllSpy = vi.spyOn(myPrompts, 'clearAllMyPrompts').mockResolvedValue();

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    // Right click directly on listContainer (simulating the blank area below items)
    act(() => {
      listContainer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 400 }));
    });

    expect(contextSpy).toHaveBeenCalledWith(
      { left: 50, top: 400 },
      [
        {
          id: 'clear-all',
          label: 'Clear all My Prompts',
          icon: 'trash',
          variant: 'destructive',
        },
      ],
      expect.any(Function)
    );

    // Verify selecting clear-all triggers clearAllMyPrompts
    const selectCallback = contextSpy.mock.calls[0][2] as (id: string) => void;
    selectCallback('clear-all');
    expect(clearAllSpy).toHaveBeenCalledTimes(1);
  });

  it('right click on a prompt row opens only the item-specific menu and does not open background menu', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    const row = listContainer.querySelector<HTMLDivElement>('.my-prompts-item-row')!;
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 120 }));
    });

    // Only item-specific menu should have been shown (1 call), not background menu
    expect(contextSpy).toHaveBeenCalledTimes(1);
    expect(contextSpy).toHaveBeenCalledWith(
      { left: 80, top: 120 },
      [{ id: 'copy-prompt', label: 'Copy Prompt', icon: 'copy' }],
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('does not open background context menu when prompt library contains zero prompts', () => {
    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue([]);
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    act(() => {
      listContainer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    });

    expect(contextSpy).not.toHaveBeenCalled();
  });

  it('opens background context menu when non-empty library is filtered to zero visible results by search', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    // Filter to zero visible results
    act(() => {
      searchInput.value = 'NonExistentQuery';
      searchInput.dispatchEvent(new Event('input'));
    });

    expect(listContainer.querySelectorAll('.my-prompts-item-row').length).toBe(0);
    expect(listContainer.querySelector('.navigator-hint')).not.toBeNull();

    act(() => {
      listContainer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 150 }));
    });

    expect(contextSpy).toHaveBeenCalledWith(
      { left: 60, top: 150 },
      [
        {
          id: 'clear-all',
          label: 'Clear all My Prompts',
          icon: 'trash',
          variant: 'destructive',
        },
      ],
      expect.any(Function)
    );
  });

  it('removes contextmenu listener when switching to TOC mode', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    act(() => {
      sidebarController.setViewMode('toc');
    });

    act(() => {
      listContainer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    });

    expect(contextSpy).not.toHaveBeenCalled();
  });

  it('repeated view switching does not create duplicate listeners', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    act(() => {
      sidebarController.setViewMode('toc');
    });

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    act(() => {
      sidebarController.setViewMode('toc');
    });

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    act(() => {
      listContainer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    });

    expect(contextSpy).toHaveBeenCalledTimes(1);
  });

  it('safely handles non-Element targets on contextmenu event', () => {
    const contextSpy = vi.spyOn(promptContextMenuController, 'show').mockImplementation(() => {});

    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    // Create a text node inside listContainer and dispatch on it
    const textNode = document.createTextNode('Sample text');
    listContainer.appendChild(textNode);

    expect(() => {
      act(() => {
        textNode.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      });
    }).not.toThrow();

    // Since text node is not an item row and library is non-empty, background menu opens safely
    expect(contextSpy).toHaveBeenCalledTimes(1);
  });

  it('cleans up cleanly when unmounted', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
      root.render(React.createElement(MyPromptsView));
    });

    expect(toolbarContainer.children.length).toBeGreaterThan(0);
    expect(listContainer.children.length).toBeGreaterThan(0);

    act(() => {
      root.unmount();
    });

    expect(toolbarContainer.children.length).toBe(0);
    expect(listContainer.children.length).toBe(0);
  });
});
