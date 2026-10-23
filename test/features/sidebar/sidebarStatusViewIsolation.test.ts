/**
 * @vitest-environment jsdom
 */
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sidebarController } from '@/features/sidebar/sidebarController';
import { setSidebarStatus } from '@/navigation/ui/sidebarStatus';
import { navigatorController } from '@/navigation/navigatorController';
import { myPrompts } from '@/features/myPrompts/myPrompts';
import type { SavedPrompt } from '@/features/myPrompts/promptStore';

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
    document.body.appendChild(sidebar);

    sidebarController.init();
    sidebarController.setPromptCount(1);
    sidebarController.setMyPromptsCount(mockPrompts.length);

    vi.spyOn(navigatorController, 'setSearchQuery').mockImplementation(() => {});
    vi.spyOn(myPrompts, 'getMyPromptsSnapshot').mockReturnValue(mockPrompts);
  });

  afterEach(() => {
    setSidebarStatus({ state: 'idle' });
    sidebarController.setViewMode('toc');
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    styleElement.remove();
  });

  it('1. TOC loading status is visible in TOC mode', () => {
    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(sidebarController.getViewMode()).toBe('toc');

    setSidebarStatus({ state: 'loading', promptCount: 10 });

    expect(statusElement.textContent).toBe('Loading... (10 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');
  });

  it('2. Switching to MyPrompts during loading hides the status element', () => {
    setSidebarStatus({ state: 'loading', promptCount: 10 });
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    sidebarController.setViewMode('myPrompts');

    expect(sidebar.dataset.viewMode).toBe('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('3. Background loading updates running AFTER switching to MyPrompts cannot make status reappear', () => {
    // Switch to MyPrompts first
    sidebarController.setViewMode('myPrompts');
    expect(sidebar.dataset.viewMode).toBe('myPrompts');

    // Simulate background backfill calling setSidebarStatus while in MyPrompts
    setSidebarStatus({ state: 'loading', promptCount: 349 });

    // Underlying state is updated and active
    expect(statusElement.textContent).toBe('Loading... (349 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);

    // But CSS guard strictly hides the element in MyPrompts view
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('4. Switching back to TOC during loading reveals the latest progress', () => {
    sidebarController.setViewMode('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Backfill progresses in background
    setSidebarStatus({ state: 'loading', promptCount: 349 });
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // User switches back to TOC
    sidebarController.setViewMode('toc');

    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');
    expect(statusElement.textContent).toBe('Loading... (349 so far)');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(true);
  });

  it('5. Switching back to TOC after background completion displays no stale Loading message', () => {
    // In TOC, loading begins
    setSidebarStatus({ state: 'loading', promptCount: 100 });
    expect(statusElement.textContent).toBe('Loading... (100 so far)');

    // Switch to MyPrompts
    sidebarController.setViewMode('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Backfill completes while user is in MyPrompts
    setSidebarStatus({ state: 'complete', promptCount: 350 });

    // Advance time past status linger timeout (1500ms)
    vi.advanceTimersByTime(2000);

    // Switch back to TOC
    sidebarController.setViewMode('toc');

    // Element is idle and empty - no stale loading or complete message
    expect(sidebar.dataset.viewMode).toBe('toc');
    expect(statusElement.textContent).toBe('');
    expect(statusElement.classList.contains('navigator-status-active')).toBe(false);
  });

  it('6. Jumping, Complete, and Failed statuses remain functional and are properly isolated by view', () => {
    // Jumping state in TOC
    setSidebarStatus({
      state: 'jumping',
      jump: { active: true, targetIndex: 4, remainingSteps: 1 },
    });
    expect(statusElement.textContent).toContain('To #5');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    sidebarController.setViewMode('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Failed state in TOC
    sidebarController.setViewMode('toc');
    setSidebarStatus({ state: 'failed', promptCount: 5 });
    expect(statusElement.textContent).toBe('Jump failed');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    sidebarController.setViewMode('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Complete state in TOC
    sidebarController.setViewMode('toc');
    setSidebarStatus({ state: 'complete', promptCount: 5 });
    expect(statusElement.textContent).toBe('5 prompts');
    expect(window.getComputedStyle(statusElement).display).not.toBe('none');

    // Switch to MyPrompts: hidden
    sidebarController.setViewMode('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');
  });

  it('7. Rapid view switching preserves correct viewMode attribute and visibility', () => {
    setSidebarStatus({ state: 'loading', promptCount: 200 });

    for (let i = 0; i < 20; i++) {
      sidebarController.setViewMode('myPrompts');
      expect(sidebar.dataset.viewMode).toBe('myPrompts');
      expect(window.getComputedStyle(statusElement).display).toBe('none');

      sidebarController.setViewMode('toc');
      expect(sidebar.dataset.viewMode).toBe('toc');
      expect(window.getComputedStyle(statusElement).display).not.toBe('none');
    }

    // Leave in MyPrompts
    sidebarController.setViewMode('myPrompts');
    expect(sidebar.dataset.viewMode).toBe('myPrompts');
    expect(window.getComputedStyle(statusElement).display).toBe('none');
    expect(statusElement.textContent).toBe('Loading... (200 so far)');
  });

  it('8. MyPrompts toolbar and list containers remain unaffected', () => {
    sidebarController.setViewMode('myPrompts');

    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('');
    expect(tocList.style.display).toBe('none');
    expect(window.getComputedStyle(statusElement).display).toBe('none');

    // Background TOC update does not touch MyPrompts containers
    setSidebarStatus({ state: 'loading', promptCount: 500 });
    expect(toolbarContainer.style.display).toBe('');
    expect(myPromptsList.style.display).toBe('');
    expect(tocList.style.display).toBe('none');
  });
});
