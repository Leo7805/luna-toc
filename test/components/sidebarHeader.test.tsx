/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarHeader } from '@/components/sidebar-header/SidebarHeader';
import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import { ConfirmDialogHost } from '@/components/my-prompts/ConfirmDialog';
import {
  setSidebarPinned,
  isSidebarPinned,
  toggleSidebarPinned,
} from '@/features/sidebarVisibility';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { navigatorController } from '@/navigation/navigatorController';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarHeader and SidebarSearchBar React Migration', () => {
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let headerContainer: HTMLDivElement;
  let searchContainer: HTMLDivElement;
  let myPromptsToolbarContainer: HTMLDivElement;
  let myPromptsList: HTMLDivElement;
  let navigatorList: HTMLDivElement;
  let viewModeBtn: HTMLButtonElement;
  let root: Root;

  const mockPrompts: SavedPrompt[] = [
    {
      id: 'prompt-1',
      title: 'First saved prompt',
      content: 'Alpha prompt text',
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'prompt-2',
      title: 'Second saved prompt',
      content: 'Beta prompt text',
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv',
      },
    });

    // Setup Light DOM mount containers
    headerContainer = document.createElement('div');
    headerContainer.id = 'navigator-header';
    headerContainer.className = 'navigator-header';

    searchContainer = document.createElement('div');
    searchContainer.id = 'navigator-search-container';

    myPromptsToolbarContainer = document.createElement('div');
    myPromptsToolbarContainer.id = 'myprompts-toolbar-container';
    myPromptsToolbarContainer.style.display = 'none';

    navigatorList = document.createElement('div');
    navigatorList.id = 'navigator-list';

    myPromptsList = document.createElement('div');
    myPromptsList.id = 'myprompts-list';
    myPromptsList.style.display = 'none';

    viewModeBtn = document.createElement('button');
    viewModeBtn.id = 'toggle-view-mode-btn';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    portalContainer = document.createElement('div');
    portalContainer.className = 'luna-toc-ui';

    document.body.append(
      headerContainer,
      searchContainer,
      myPromptsToolbarContainer,
      navigatorList,
      myPromptsList,
      viewModeBtn,
      rootContainer,
      portalContainer
    );

    setReactPortalContainer(portalContainer);

    // Initial pin state and controller state
    setSidebarPinned(true);
    sidebarController.init();
    sidebarController.setPromptCount(5);
    sidebarController.setMyPromptsCount(mockPrompts.length);

    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);
    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});
    vi.spyOn(navigatorController, 'resetView').mockImplementation(() => {});

    root = createRoot(rootContainer);
    act(() => {
      root.render(
        <>
          <SidebarHeader />
          <MyPromptsView />
          <ConfirmDialogHost />
        </>
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      sidebarController.setViewMode('toc');
      sidebarController.resetReadyForTesting();
    });
    setReactPortalContainer(null);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('1. Mounts React Header and Search into dedicated Light DOM slots, and cleans up on unmount', () => {
    const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn');
    const titleBtn = document.getElementById('navigator-title');
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const searchInput = document.getElementById('navigator-search');

    expect(pinBtn).not.toBeNull();
    expect(titleBtn).not.toBeNull();
    expect(searchToggleBtn).not.toBeNull();
    expect(searchInput).not.toBeNull();

    expect(headerContainer.contains(pinBtn)).toBe(true);
    expect(headerContainer.contains(titleBtn)).toBe(true);
    expect(headerContainer.contains(searchToggleBtn)).toBe(true);
    expect(searchContainer.contains(searchInput)).toBe(true);

    // Unmount and verify children removed
    act(() => {
      root.unmount();
    });

    expect(headerContainer.children.length).toBe(0);
    expect(searchContainer.children.length).toBe(0);
  });

  it('2. Reflects TOC and MyPrompts view title changes accurately', () => {
    const titleBtn = document.getElementById('navigator-title') as HTMLButtonElement;
    expect(titleBtn.textContent).toBe('ChatTOC');
    expect(titleBtn.getAttribute('aria-label')).toBe('Reset TOC view');

    // Switch to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(titleBtn.textContent).toBe('My Prompts');
    expect(titleBtn.getAttribute('aria-label')).toBe('My Prompts');

    // Switch back to TOC
    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(titleBtn.textContent).toBe('ChatTOC');
    expect(titleBtn.getAttribute('aria-label')).toBe('Reset TOC view');
  });

  it('3. Title button click resets TOC view in TOC mode, and scrolls top in MyPrompts mode', () => {
    const titleBtn = document.getElementById('navigator-title') as HTMLButtonElement;
    const resetSpy = vi.spyOn(navigatorController, 'resetView');

    // In TOC mode: click resets view
    act(() => {
      titleBtn.click();
    });
    expect(resetSpy).toHaveBeenCalledTimes(1);

    // Switch to MyPrompts mode: click scrolls to top
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    const scrollToSpy = vi.fn();
    myPromptsList.scrollTo = scrollToSpy;

    act(() => {
      titleBtn.click();
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('4. Toggles pin and auto-hide state with proper aria attributes and classes', () => {
    const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn') as HTMLButtonElement;

    // Initial pinned state
    expect(isSidebarPinned()).toBe(true);
    expect(pinBtn.classList.contains('luna-toc-sidebar-pin-active')).toBe(true);
    expect(pinBtn.getAttribute('aria-pressed')).toBe('true');
    expect(pinBtn.getAttribute('aria-label')).toBe('Enable sidebar auto-hide');

    // Click to unpin
    act(() => {
      pinBtn.click();
    });

    expect(isSidebarPinned()).toBe(false);
    expect(pinBtn.classList.contains('luna-toc-sidebar-pin-active')).toBe(false);
    expect(pinBtn.getAttribute('aria-pressed')).toBe('false');
    expect(pinBtn.getAttribute('aria-label')).toBe('Pin sidebar open');

    // Re-pin via toggle helper
    act(() => {
      toggleSidebarPinned();
    });

    expect(isSidebarPinned()).toBe(true);
    expect(pinBtn.classList.contains('luna-toc-sidebar-pin-active')).toBe(true);
    expect(pinBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('5. Search availability disabled/enabled reflects the active view mode', () => {
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;

    // TOC mode: has 5 prompts -> enabled
    expect(searchToggleBtn.disabled).toBe(false);
    expect(searchToggleBtn.getAttribute('aria-disabled')).toBe('false');

    // Set TOC prompts to 0 -> disabled in TOC
    act(() => {
      sidebarController.setPromptCount(0);
    });
    expect(searchToggleBtn.disabled).toBe(true);
    expect(searchToggleBtn.getAttribute('aria-disabled')).toBe('true');

    // Switch to MyPrompts: has mockPrompts (2 items) -> enabled in MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(searchToggleBtn.disabled).toBe(false);
    expect(searchToggleBtn.getAttribute('aria-disabled')).toBe('false');

    // Set MyPrompts count to 0 -> disabled in MyPrompts
    act(() => {
      sidebarController.setMyPromptsCount(0);
    });
    expect(searchToggleBtn.disabled).toBe(true);
    expect(searchToggleBtn.getAttribute('aria-disabled')).toBe('true');
  });

  it('6. Search toggle expands input, focuses it, and closing blurs and clears query', () => {
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('navigator-search') as HTMLInputElement;

    expect(searchInput.style.display).toBe('none');

    // Click toggle to open search
    act(() => {
      searchToggleBtn.click();
    });

    expect(searchInput.style.display).toBe('block');
    expect(sidebarController.isSearchOpen()).toBe(true);

    // Type query
    act(() => {
      searchInput.value = 'query test';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(sidebarController.getSearchQuery()).toBe('query test');

    // Click toggle to close search
    act(() => {
      searchToggleBtn.click();
    });

    expect(searchInput.style.display).toBe('none');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
    expect(searchInput.value).toBe('');
  });

  it('7. Pressing Escape key in search input closes search and clears query', () => {
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('navigator-search') as HTMLInputElement;

    act(() => {
      searchToggleBtn.click();
    });
    expect(searchInput.style.display).toBe('block');

    act(() => {
      searchInput.value = 'escape test';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Press Escape
    act(() => {
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(searchInput.style.display).toBe('none');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('8. Switching view mode automatically closes search and resets query', () => {
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('navigator-search') as HTMLInputElement;

    act(() => {
      searchToggleBtn.click();
      searchInput.value = 'active search';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(searchInput.style.display).toBe('block');
    expect(sidebarController.getSearchQuery()).toBe('active search');

    // Switch to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(searchInput.style.display).toBe('none');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('9. Rapid repeated view switching (20 cycles) executes without errors or state divergence', () => {
    const titleBtn = document.getElementById('navigator-title') as HTMLButtonElement;
    const searchInput = document.getElementById('navigator-search') as HTMLInputElement;

    for (let i = 0; i < 20; i++) {
      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(titleBtn.textContent).toBe('My Prompts');
      expect(searchInput.style.display).toBe('none');

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(titleBtn.textContent).toBe('ChatTOC');
      expect(searchInput.style.display).toBe('none');
    }
  });

  it('10. Background TOC prompt count updates update search button availability in TOC mode', () => {
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;

    act(() => {
      sidebarController.setPromptCount(0);
    });
    expect(searchToggleBtn.disabled).toBe(true);

    // Background TOC update arrives
    act(() => {
      sidebarController.setPromptCount(10);
    });
    expect(searchToggleBtn.disabled).toBe(false);
  });

  it('11. Existing MyPrompts portal and dialogs remain fully functional', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(myPromptsList.querySelectorAll('.my-prompts-item-row').length).toBe(2);
    expect(myPromptsToolbarContainer.querySelector('.my-prompts-sort-bar')).not.toBeNull();
  });

  it('12. No duplicate header or search elements exist in DOM', () => {
    expect(document.querySelectorAll('#luna-toc-sidebar-pin-btn').length).toBe(1);
    expect(document.querySelectorAll('#navigator-title').length).toBe(1);
    expect(document.querySelectorAll('#search-toggle-btn').length).toBe(1);
    expect(document.querySelectorAll('#navigator-search').length).toBe(1);
  });

  it('13. Enforces strict DOM ownership between React header and Light DOM container', () => {
    expect(headerContainer.querySelector('#luna-toc-sidebar-pin-btn')).not.toBeNull();
    expect(headerContainer.querySelector('#navigator-title')).not.toBeNull();
    expect(headerContainer.querySelector('#search-toggle-btn')).not.toBeNull();
    expect(searchContainer.querySelector('#navigator-search')).not.toBeNull();
  });

  it('14. Preserves tooltip attributes for buttonTooltip compatibility', () => {
    const titleBtn = document.getElementById('navigator-title') as HTMLButtonElement;
    expect(titleBtn.dataset.tooltip).toBe('ChatTOC');
    expect(titleBtn.dataset.tooltipOverflowOnly).toBe('true');
  });
});

describe('Scenario B — Delayed initialization lifecycle (React mounts before Sidebar DOM exists)', () => {
  let rootContainer: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv',
      },
    });

    sidebarController.resetReadyForTesting();
    document.body.innerHTML = '';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';
    document.body.appendChild(rootContainer);

    root = createRoot(rootContainer);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      sidebarController.setViewMode('toc');
      sidebarController.resetReadyForTesting();
    });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('mounts automatically through readiness lifecycle when React renders before Sidebar DOM', () => {
    // 1. Render SidebarHeader with NO portal containers in the DOM
    act(() => {
      root.render(<SidebarHeader />);
    });

    // 2. Verify no exception and no Header buttons
    expect(sidebarController.getReadySnapshot()).toBe(false);
    expect(document.getElementById('navigator-header')).toBeNull();
    expect(document.getElementById('luna-toc-sidebar-pin-btn')).toBeNull();
    expect(document.getElementById('navigator-title')).toBeNull();
    expect(document.getElementById('search-toggle-btn')).toBeNull();
    expect(document.getElementById('navigator-search')).toBeNull();

    // 3. Create and attach the actual Sidebar DOM (as applicationShell.ts createSidebar() does)
    const sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.innerHTML = `
      <div class="navigator-topbar">
        <div id="navigator-header" class="navigator-header"></div>
        <div id="navigator-search-container"></div>
        <div id="myprompts-toolbar-container" style="display: none;"></div>
      </div>
      <div id="navigator-list"></div>
      <div id="myprompts-list" class="navigator-list" style="display: none;"></div>
      <button id="toggle-view-mode-btn"></button>
    `;
    document.body.appendChild(sidebar);

    const headerSlot = document.getElementById('navigator-header')!;
    const searchSlot = document.getElementById('navigator-search-container')!;
    expect(headerSlot.children.length).toBe(0);
    expect(searchSlot.children.length).toBe(0);

    // 4. Trigger the real Sidebar initialization lifecycle (without manually forcing a React rerender)
    act(() => {
      sidebarController.setPromptCount(3);
      sidebarController.init();
    });

    // 5. Verify readiness snapshot changed to true and portals mounted automatically
    expect(sidebarController.getReadySnapshot()).toBe(true);

    const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn');
    const titleBtn = document.getElementById('navigator-title');
    const searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('navigator-search') as HTMLInputElement;

    expect(pinBtn).not.toBeNull();
    expect(titleBtn).not.toBeNull();
    expect(searchToggleBtn).not.toBeNull();
    expect(searchInput).not.toBeNull();

    expect(headerSlot.contains(pinBtn)).toBe(true);
    expect(headerSlot.contains(titleBtn)).toBe(true);
    expect(headerSlot.contains(searchToggleBtn)).toBe(true);
    expect(searchSlot.contains(searchInput)).toBe(true);

    // 6. Verify Pin, Title, and Search functionality
    // Pin toggle
    act(() => {
      setSidebarPinned(false);
    });
    expect(isSidebarPinned()).toBe(false);
    act(() => {
      pinBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(isSidebarPinned()).toBe(true);

    // Title display
    expect(titleBtn!.textContent).toBe('ChatTOC');

    // Search open/close
    expect(sidebarController.isSearchOpen()).toBe(false);
    act(() => {
      searchToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sidebarController.isSearchOpen()).toBe(true);
    expect(searchInput.style.display).toBe('block');

    act(() => {
      searchToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(searchInput.style.display).toBe('none');

    // 7. Verify no duplicate nodes or React root errors
    expect(document.querySelectorAll('#luna-toc-sidebar-pin-btn').length).toBe(1);
    expect(document.querySelectorAll('#navigator-title').length).toBe(1);
    expect(document.querySelectorAll('#search-toggle-btn').length).toBe(1);
    expect(document.querySelectorAll('#navigator-search').length).toBe(1);

    // 8. Test repeated view switching
    for (let i = 0; i < 5; i++) {
      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(titleBtn!.textContent).toBe('My Prompts');

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(titleBtn!.textContent).toBe('ChatTOC');
    }

    // 9. Verify clean unmount
    act(() => {
      root.unmount();
    });
    expect(headerSlot.children.length).toBe(0);
    expect(searchSlot.children.length).toBe(0);
  });

  it('cleans up subscription when unmounted before sidebar initialization', () => {
    act(() => {
      root.render(<SidebarHeader />);
    });

    expect(sidebarController.getReadySnapshot()).toBe(false);

    // Unmount before init
    act(() => {
      root.unmount();
    });

    // Initializing after unmount should not cause errors
    expect(() => {
      act(() => {
        sidebarController.init();
      });
    }).not.toThrow();
  });
});
