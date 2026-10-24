/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarStatus } from '@/components/sidebar-status/SidebarStatus';
import { sidebarController } from '@/features/sidebar/sidebarController';
import {
  resetStatusForTesting,
  setSidebarStatus,
} from '@/navigation/ui/sidebarStatus';
import { navigatorController } from '@/navigation/navigatorController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import { previewTooltip } from '@/features/tooltip';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Sidebar Status View Isolation', () => {
  let sidebar: HTMLDivElement;
  let statusElement: HTMLDivElement;
  let toggleButton: HTMLButtonElement;
  let titleButton: HTMLButtonElement;
  let searchInput: HTMLInputElement;
  let searchToggleBtn: HTMLButtonElement;
  let tocList: HTMLDivElement;
  let myPromptsList: HTMLDivElement;
  let toolbarContainer: HTMLDivElement;
  let styleElement: HTMLStyleElement;
  let rootContainer: HTMLDivElement;
  let root: Root;

  const mockPrompts: SavedPrompt[] = [
    {
      id: 'prompt-1',
      title: 'Prompt One',
      content: 'Alpha prompt text',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    resetStatusForTesting();

    // Inject content.css so jsdom evaluates getComputedStyle against actual stylesheet rules
    // @ts-ignore
    const cssPath = path.resolve(process.cwd(), 'src/styles/content.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);

    // Setup DOM matching applicationShell structure
    sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.dataset.viewMode = 'toc';

    statusElement = document.createElement('div');
    statusElement.id = 'luna-toc-status';
    statusElement.className = 'navigator-status';
    statusElement.setAttribute('aria-live', 'polite');
    statusElement.setAttribute('role', 'status');

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

    toolbarContainer = document.createElement('div');
    toolbarContainer.id = 'myprompts-toolbar-container';
    toolbarContainer.style.display = 'none';

    tocList = document.createElement('div');
    tocList.id = 'navigator-list';

    myPromptsList = document.createElement('div');
    myPromptsList.id = 'myprompts-list';
    myPromptsList.style.display = 'none';

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';

    sidebar.append(
      statusElement,
      toggleButton,
      titleButton,
      searchInput,
      searchToggleBtn,
      toolbarContainer,
      tocList,
      myPromptsList
    );
    document.body.append(sidebar, rootContainer);

    sidebarController.init();
    sidebarController.setPromptCount(1);
    sidebarController.setMyPromptsCount(mockPrompts.length);

    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});
    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);

    root = createRoot(rootContainer);
    act(() => {
      root.render(React.createElement(SidebarStatus));
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      setSidebarStatus({ state: 'idle' });
      resetStatusForTesting();
      sidebarController.setViewMode('toc');
      sidebarController.resetReadyForTesting();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    styleElement.remove();
  });

  it('1. TOC loading status is visible in TOC mode', () => {
    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(sidebarController.getViewMode()).toBe('toc');

    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 10 });
    });

    expect(statusElement.textContent).toBe('Loading... (10 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');
  });

  it('2. Switching to MyPrompts during loading hides the status element', () => {
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 10 });
    });
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(sidebar.dataset.viewMode).toBe('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('3. Background loading updates running AFTER switching to MyPrompts cannot make status reappear', () => {
    // Switch to MyPrompts first
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(sidebar.dataset.viewMode).toBe('myPrompts');

    // Simulate background backfill calling setSidebarStatus while in MyPrompts
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 349 });
    });

    // Underlying state is updated and active
    expect(statusElement.textContent).toBe('Loading... (349 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    // But CSS guard strictly hides the element in MyPrompts view
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('4. Switching back to TOC during loading reveals the latest progress', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Backfill progresses in background
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 349 });
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // User switches back to TOC
    act(() => {
      sidebarController.setViewMode('toc');
    });

    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');
    expect(statusElement.textContent).toBe('Loading... (349 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);
  });

  it('5. Switching back to TOC after background completion displays no stale Loading message', () => {
    // In TOC, loading begins
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 100 });
    });
    expect(statusElement.textContent).toBe('Loading... (100 so far)');

    // Switch to MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Backfill completes while user is in MyPrompts
    act(() => {
      setSidebarStatus({ state: 'complete', promptCount: 350 });
      // Advance time past status linger timeout (2000ms)
      vi.advanceTimersByTime(2000);
    });

    // Switch back to TOC
    act(() => {
      sidebarController.setViewMode('toc');
    });

    // Element is idle and empty - no stale loading or complete message
    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });

  it('6. Jumping, Complete, and Failed statuses remain functional and are properly isolated by view', () => {
    // Jumping state in TOC
    act(() => {
      setSidebarStatus({
        state: 'jumping',
        jump: { active: true, targetIndex: 4, remainingSteps: 1 },
      });
    });
    expect(statusElement.textContent).toContain('To #5');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Failed state in TOC
    act(() => {
      sidebarController.setViewMode('toc');
      setSidebarStatus({ state: 'failed', promptCount: 5 });
    });
    expect(statusElement.textContent).toBe('Jump failed');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Complete state in TOC
    act(() => {
      sidebarController.setViewMode('toc');
      setSidebarStatus({ state: 'complete', promptCount: 5 });
    });
    expect(statusElement.textContent).toBe('5 prompts');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('7. Rapid view switching preserves correct viewMode attribute and visibility', () => {
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 200 });
    });

    for (let i = 0; i < 20; i++) {
      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(sidebar.dataset.viewMode).toBe('myPrompts');
      expect(window.getComputedStyle(statusElement).display).toBe('none');

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(sidebar.dataset.viewMode).toBe('toc');
      expect(window.getComputedStyle(statusElement).display).not.toBe('none');
    }

    // Leave in MyPrompts
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });
    expect(sidebar.dataset.viewMode).toBe('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');
    expect(statusElement.textContent).toBe('Loading... (200 so far)');
  });

  it('8. MyPrompts toolbar and list containers remain unaffected', () => {
    act(() => {
      sidebarController.setViewMode('myPrompts');
    });

    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('');
    expect(tocList.style.display).toBe('none');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Background TOC update does not touch MyPrompts containers
    act(() => {
      setSidebarStatus({ state: 'loading', promptCount: 500 });
    });
    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('');
    expect(tocList.style.display).toBe('none');
  });

  describe('setViewMode same-mode idempotency and scroll preservation (Phase 5C)', () => {
    it('A. preserves live tocList.scrollTop when setViewMode("toc") is called while already in TOC mode', () => {
      expect(sidebarController.getViewMode()).toBe('toc');

      tocList.scrollTop = 850;

      act(() => {
        sidebarController.setViewMode('toc');
      });

      expect(tocList.scrollTop).toBe(850);
    });

    it('B. restores cached scroll position during genuine view switching', () => {
      tocList.scrollTop = 500;

      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(tocList.style.display).toBe('none');
      expect(myPromptsList.style.display).toBe('');

      myPromptsList.scrollTop = 250;

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(tocList.style.display).toBe('');
      expect(myPromptsList.style.display).toBe('none');
      expect(tocList.scrollTop).toBe(500);

      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      expect(myPromptsList.scrollTop).toBe(250);
    });

    it('C. does not revert to stale cached scroll position when setViewMode("toc") is called after manual scrolling', () => {
      tocList.scrollTop = 500;

      act(() => {
        sidebarController.setViewMode('myPrompts');
      });
      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(tocList.scrollTop).toBe(500);

      tocList.scrollTop = 920;

      act(() => {
        sidebarController.setViewMode('toc');
      });

      expect(tocList.scrollTop).toBe(920);
    });

    it('D. preserves search closing and query reset when setViewMode is invoked', () => {
      act(() => {
        sidebarController.openSearch();
        sidebarController.setSearchQuery('react hooks');
      });
      expect(sidebarController.isSearchOpen()).toBe(true);
      expect(sidebarController.getSearchQuery()).toBe('react hooks');

      act(() => {
        sidebarController.setViewMode('toc');
      });
      expect(sidebarController.isSearchOpen()).toBe(false);
      expect(sidebarController.getSearchQuery()).toBe('');
    });

    it('E. preserves preview tooltip hiding, context menu closing, and title synchronization', () => {
      const tooltipHideSpy = vi.spyOn(previewTooltip, 'hide');
      const contextMenuCloseSpy = vi.spyOn(promptContextMenuController, 'close');

      act(() => {
        sidebarController.setViewMode('toc');
      });

      expect(tooltipHideSpy).toHaveBeenCalled();
      expect(contextMenuCloseSpy).toHaveBeenCalled();
      expect(sidebarController.getHeaderSnapshot().viewMode).toBe('toc');
      expect(sidebarController.getViewSnapshot().viewMode).toBe('toc');
    });

    it('F. onPromptAdded integration preserves live TOC scroll position', () => {
      tocList.scrollTop = 780;

      act(() => {
        sidebarController.setViewMode('toc');
      });

      expect(tocList.scrollTop).toBe(780);
    });
  });
});
