/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarJumpControls } from '@/components/sidebar-jump/SidebarJumpControls';
import { SidebarHeader } from '@/components/sidebar-header/SidebarHeader';
import { SidebarStatus } from '@/components/sidebar-status/SidebarStatus';
import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import { sidebarController } from '@/features/sidebar/sidebarController';
import { navigatorController } from '@/navigation/navigatorController';
import { initFloatingPanel } from '@/features/sidebar/FloatingPanel';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import { setSidebarStatus, resetStatusForTesting } from '@/navigation/ui/sidebarStatus';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarJumpControls React Component', () => {
  let sidebar: HTMLDivElement;
  let jumpControlsContainer: HTMLDivElement;
  let statusContainer: HTMLDivElement;
  let headerContainer: HTMLDivElement;
  let searchContainer: HTMLDivElement;
  let myPromptsToolbarContainer: HTMLDivElement;
  let myPromptsList: HTMLDivElement;
  let navigatorList: HTMLDivElement;
  let rootContainer: HTMLDivElement;
  let portalContainer: HTMLDivElement;
  let root: Root;
  let jumpToEdgeSpy: ReturnType<typeof vi.spyOn>;
  let jumpToAbsoluteEdgeSpy: ReturnType<typeof vi.spyOn>;
  let jumpToLastPromptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    jumpToEdgeSpy = vi.spyOn(navigatorController, 'jumpToEdge').mockImplementation(() => {});
    jumpToAbsoluteEdgeSpy = vi.spyOn(navigatorController, 'jumpToAbsoluteEdge').mockImplementation(() => {});
    jumpToLastPromptSpy = vi.spyOn(navigatorController, 'jumpToLastPrompt').mockImplementation(() => {});
    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});
    vi.spyOn(navigatorController, 'resetView').mockImplementation(() => {});

    resetStatusForTesting();
    sidebarController.resetReadyForTesting();
    sidebarController.setViewMode('toc');

    sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.dataset.viewMode = 'toc';

    headerContainer = document.createElement('div');
    headerContainer.id = 'navigator-header';

    searchContainer = document.createElement('div');
    searchContainer.id = 'navigator-search-container';

    statusContainer = document.createElement('div');
    statusContainer.id = 'luna-toc-status';

    jumpControlsContainer = document.createElement('div');
    jumpControlsContainer.className = 'navigator-jump-controls';

    myPromptsToolbarContainer = document.createElement('div');
    myPromptsToolbarContainer.id = 'myprompts-toolbar-container';

    navigatorList = document.createElement('div');
    navigatorList.id = 'navigator-list';

    myPromptsList = document.createElement('div');
    myPromptsList.id = 'myprompts-list';

    sidebar.append(
      headerContainer,
      searchContainer,
      statusContainer,
      jumpControlsContainer,
      myPromptsToolbarContainer,
      navigatorList,
      myPromptsList
    );
    document.body.appendChild(sidebar);

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    portalContainer = document.createElement('div');
    portalContainer.id = 'luna-toc-react-portals';
    setReactPortalContainer(portalContainer);

    document.body.append(rootContainer, portalContainer);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders exact three buttons in order: top -> toggle -> bottom', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const buttons = Array.from(jumpControlsContainer.children) as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    expect(buttons[0].id).toBe('jump-chat-top-btn');
    expect(buttons[1].id).toBe('toggle-view-mode-btn');
    expect(buttons[2].id).toBe('jump-chat-bottom-btn');

    expect(buttons[0].getAttribute('aria-label')).toBe('Jump to top');
    expect(buttons[1].getAttribute('aria-label')).toBe('Switch to My Prompts');
    expect(buttons[1].getAttribute('title')).toBe('Switch to My Prompts');
    expect(buttons[2].getAttribute('aria-label')).toBe('Jump to bottom');

    buttons.forEach((btn) => {
      expect(btn.classList.contains('navigator-icon-btn')).toBe(true);
      expect(btn.querySelector('svg')).not.toBeNull();
    });
  });

  it('delays mounting when React initializes before Sidebar readiness signal', async () => {
    // Sidebar exists in DOM but readiness is not yet signaled
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    // Not ready yet: container has 0 children
    expect(jumpControlsContainer.children.length).toBe(0);

    // Signal readiness
    await act(async () => {
      sidebarController.init();
    });

    expect(jumpControlsContainer.children.length).toBe(3);
  });

  it('mounts synchronously when Sidebar readiness already signaled', async () => {
    sidebarController.init();
    expect(sidebarController.getReadySnapshot()).toBe(true);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    expect(jumpControlsContainer.children.length).toBe(3);
  });

  it('delegates single-click on Top in TOC mode to navigatorController.jumpToEdge("top")', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const topBtn = document.getElementById('jump-chat-top-btn')!;
    topBtn.click();

    expect(jumpToEdgeSpy).toHaveBeenCalledTimes(1);
    expect(jumpToEdgeSpy).toHaveBeenCalledWith('top');
  });

  it('delegates double-click on Top in TOC mode to navigatorController.jumpToAbsoluteEdge("top")', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const topBtn = document.getElementById('jump-chat-top-btn')!;
    // Standard browser sequence: click -> click -> dblclick
    topBtn.click();
    topBtn.click();
    topBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(jumpToEdgeSpy).toHaveBeenCalledTimes(2);
    expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledTimes(1);
    expect(jumpToAbsoluteEdgeSpy).toHaveBeenCalledWith('top');
  });

  it('delegates single-click on Bottom in TOC mode to navigatorController.jumpToEdge("bottom")', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const bottomBtn = document.getElementById('jump-chat-bottom-btn')!;
    bottomBtn.click();

    expect(jumpToEdgeSpy).toHaveBeenCalledTimes(1);
    expect(jumpToEdgeSpy).toHaveBeenCalledWith('bottom');
    expect(jumpToLastPromptSpy).not.toHaveBeenCalled();
  });

  it('delegates double-click on Bottom in TOC mode to navigatorController.jumpToLastPrompt()', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const bottomBtn = document.getElementById('jump-chat-bottom-btn')!;
    // Standard browser sequence: click -> click -> dblclick
    bottomBtn.click();
    bottomBtn.click();
    bottomBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(jumpToEdgeSpy).toHaveBeenCalledTimes(2);
    expect(jumpToLastPromptSpy).toHaveBeenCalledTimes(1);
  });

  it('scrolls the active MyPrompts list smoothly on single-click in MyPrompts mode', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    await act(async () => {
      sidebarController.setViewMode('myPrompts');
    });

    const scrollToMock = vi.fn();
    myPromptsList.scrollTo = scrollToMock;
    Object.defineProperty(myPromptsList, 'scrollHeight', { value: 650, configurable: true });

    const topBtn = document.getElementById('jump-chat-top-btn')!;
    const bottomBtn = document.getElementById('jump-chat-bottom-btn')!;

    topBtn.click();
    expect(scrollToMock).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'smooth' });

    bottomBtn.click();
    expect(scrollToMock).toHaveBeenNthCalledWith(2, { top: 650, behavior: 'smooth' });

    expect(jumpToEdgeSpy).not.toHaveBeenCalled();
  });

  it('scrolls the active MyPrompts list with "auto" on double-click in MyPrompts mode', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    await act(async () => {
      sidebarController.setViewMode('myPrompts');
    });

    const scrollToMock = vi.fn();
    myPromptsList.scrollTo = scrollToMock;
    Object.defineProperty(myPromptsList, 'scrollHeight', { value: 800, configurable: true });

    const topBtn = document.getElementById('jump-chat-top-btn')!;
    const bottomBtn = document.getElementById('jump-chat-bottom-btn')!;

    topBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(scrollToMock).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'auto' });

    bottomBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(scrollToMock).toHaveBeenNthCalledWith(2, { top: 800, behavior: 'auto' });

    expect(jumpToAbsoluteEdgeSpy).not.toHaveBeenCalled();
    expect(jumpToLastPromptSpy).not.toHaveBeenCalled();
  });

  it('delegates view mode toggle click to sidebarController.toggleViewMode() and updates attributes', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const toggleBtn = document.getElementById('toggle-view-mode-btn') as HTMLButtonElement;
    expect(toggleBtn.classList.contains('mode-myprompts-active')).toBe(false);
    expect(toggleBtn.getAttribute('aria-label')).toBe('Switch to My Prompts');
    expect(toggleBtn.getAttribute('title')).toBe('Switch to My Prompts');

    // Click toggle button
    await act(async () => {
      toggleBtn.click();
    });

    expect(sidebarController.isMyPromptsView()).toBe(true);
    expect(toggleBtn.classList.contains('mode-myprompts-active')).toBe(true);
    expect(toggleBtn.getAttribute('aria-label')).toBe('Switch to Table of Contents');
    expect(toggleBtn.getAttribute('title')).toBe('Switch to Table of Contents');

    // Click toggle button again to switch back
    await act(async () => {
      toggleBtn.click();
    });

    expect(sidebarController.isMyPromptsView()).toBe(false);
    expect(toggleBtn.classList.contains('mode-myprompts-active')).toBe(false);
    expect(toggleBtn.getAttribute('aria-label')).toBe('Switch to My Prompts');
    expect(toggleBtn.getAttribute('title')).toBe('Switch to My Prompts');
  });

  it('triggers toggleViewMode exactly once per click with no duplicate Vanilla event listeners', async () => {
    const toggleSpy = vi.spyOn(sidebarController, 'toggleViewMode');

    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const toggleBtn = document.getElementById('toggle-view-mode-btn') as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
    });

    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves DOM structure and ordering across 20 rapid view switches', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    const toggleBtn = document.getElementById('toggle-view-mode-btn')!;

    for (let i = 0; i < 20; i++) {
      await act(async () => {
        toggleBtn.click();
      });
      const children = Array.from(jumpControlsContainer.children);
      expect(children.length).toBe(3);
      expect(children[0].id).toBe('jump-chat-top-btn');
      expect(children[1].id).toBe('toggle-view-mode-btn');
      expect(children[2].id).toBe('jump-chat-bottom-btn');
    }

    // 20 switches from 'toc' returns to 'toc'
    expect(sidebarController.isMyPromptsView()).toBe(false);
    expect(toggleBtn.classList.contains('mode-myprompts-active')).toBe(false);
  });

  it('maintains FloatingPanel drag compatibility without button pointerdown conflicts', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    initFloatingPanel();

    const topBtn = document.getElementById('jump-chat-top-btn')!;
    // Pointerdown on a button must NOT add dragging class
    topBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(jumpControlsContainer.classList.contains('navigator-jump-controls-dragging')).toBe(false);

    // Pointerdown directly on container background must initiate dragging
    jumpControlsContainer.setPointerCapture = vi.fn();
    jumpControlsContainer.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 })
    );
    expect(jumpControlsContainer.classList.contains('navigator-jump-controls-dragging')).toBe(true);
  });

  it('cleans up all portal children on unmount', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarJumpControls />);
    });

    expect(jumpControlsContainer.children.length).toBe(3);

    await act(async () => {
      root.unmount();
    });

    expect(jumpControlsContainer.children.length).toBe(0);
  });

  it('coexists seamlessly with SidebarHeader, SidebarStatus, and MyPromptsView in the shared root', async () => {
    sidebarController.init();
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(
        <>
          <SidebarHeader />
          <SidebarStatus />
          <SidebarJumpControls />
          <MyPromptsView />
        </>
      );
    });

    // Check each portal has mounted into its dedicated slot
    expect(headerContainer.children.length).toBeGreaterThan(0);
    expect(jumpControlsContainer.children.length).toBe(3);
    expect(myPromptsToolbarContainer.children.length).toBe(0);

    // Switch to MyPrompts: MyPromptsView renders into toolbar container
    await act(async () => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(myPromptsToolbarContainer.children.length).toBeGreaterThan(0);
    expect(jumpControlsContainer.children.length).toBe(3);

    // Update status and verify status portal updates
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 42 });
    });
    expect(statusContainer.textContent).toContain('42 so far');

    // Jump controls unaffected
    expect(jumpControlsContainer.children.length).toBe(3);
  });
});
