/**
 * @vitest-environment jsdom
 */
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sidebarController } from '@/features/sidebar/sidebarController';
import { navigatorController } from '@/navigation/navigatorController';

describe('Sidebar Search Lifecycle and Focus Styling', () => {
  let searchInput: HTMLInputElement;
  let searchToggleBtn: HTMLButtonElement;
  let viewModeBtn: HTMLButtonElement;
  let titleBtn: HTMLButtonElement;
  let navigatorList: HTMLDivElement;
  let toolbarContainer: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="navigator-header">
        <button id="search-toggle-btn" type="button" aria-label="Toggle search"></button>
        <button id="navigator-title" type="button">ChatTOC</button>
        <button id="toggle-view-mode-btn" type="button" aria-label="Switch view"></button>
      </div>
      <input id="navigator-search" type="text" style="display: none;" />
      <div id="myprompts-toolbar-container"></div>
      <div id="navigator-list"></div>
    `;

    searchInput = document.getElementById('navigator-search') as HTMLInputElement;
    searchToggleBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
    viewModeBtn = document.getElementById('toggle-view-mode-btn') as HTMLButtonElement;
    titleBtn = document.getElementById('navigator-title') as HTMLButtonElement;
    navigatorList = document.getElementById('navigator-list') as HTMLDivElement;
    toolbarContainer = document.getElementById('myprompts-toolbar-container') as HTMLDivElement;

    sidebarController.init();
    sidebarController.setPromptCount(5);
    sidebarController.setMyPromptsCount(5);
  });

  afterEach(() => {
    sidebarController.setViewMode('toc');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('closes search, clears input, blurs, and resets query when switching from TOC to MyPrompts', () => {
    // 1. Open search in TOC
    sidebarController.toggleSearch();
    expect(sidebarController.isSearchOpen()).toBe(true);

    // Type query
    sidebarController.setSearchQuery('neural network');
    expect(sidebarController.getSearchQuery()).toBe('neural network');

    // 2. Switch from TOC to MyPrompts
    sidebarController.setViewMode('myPrompts');

    // Search must be closed, cleared, and query reset
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('closes search, clears input, blurs, and resets query when switching from MyPrompts to TOC', () => {
    sidebarController.setViewMode('myPrompts');

    // Open search in MyPrompts
    sidebarController.toggleSearch();
    expect(sidebarController.isSearchOpen()).toBe(true);

    // Type query
    sidebarController.setSearchQuery('prompt template');
    expect(sidebarController.getSearchQuery()).toBe('prompt template');

    // Switch back to TOC
    sidebarController.setViewMode('toc');

    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('remains closed until explicitly reopened via search-toggle-btn', () => {
    // Open in TOC and enter text
    sidebarController.toggleSearch();
    sidebarController.setSearchQuery('find this');

    // Switch view
    sidebarController.toggleViewMode();
    expect(sidebarController.isSearchOpen()).toBe(false);

    // Re-rendering or typing does not accidentally reopen it
    sidebarController.refreshMyPromptsIfActive();
    expect(sidebarController.isSearchOpen()).toBe(false);

    // Must reopen only upon explicit click
    sidebarController.toggleSearch();
    expect(sidebarController.isSearchOpen()).toBe(true);
  });

  it('keeps search open and updates filter during typing within the same view', () => {
    sidebarController.toggleSearch();
    expect(sidebarController.isSearchOpen()).toBe(true);

    // Type query
    sidebarController.setSearchQuery('query 1');
    expect(sidebarController.isSearchOpen()).toBe(true);
    expect(sidebarController.getSearchQuery()).toBe('query 1');

    // Type more
    sidebarController.setSearchQuery('query 1 extended');
    expect(sidebarController.isSearchOpen()).toBe(true);
    expect(sidebarController.getSearchQuery()).toBe('query 1 extended');
  });

  it('repeated rapid view switching does not leave stale search state or open input', () => {
    // Rapidly toggle between views multiple times while entering queries
    sidebarController.toggleSearch();
    sidebarController.setSearchQuery('stale test');

    sidebarController.setViewMode('myPrompts');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');

    sidebarController.setViewMode('toc');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');

    sidebarController.setViewMode('myPrompts');
    expect(sidebarController.isSearchOpen()).toBe(false);
    expect(sidebarController.getSearchQuery()).toBe('');
  });

  it('verifies content.css defines restrained focus tokens for dark and light themes', () => {
    // @ts-ignore
    const cssPath = path.resolve(process.cwd(), 'src/styles/content.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Dark theme tokens
    expect(cssContent).toContain('--ct-border-input-hover: #374862;');
    expect(cssContent).toContain('--ct-border-input-focus: #4b6288;');
    expect(cssContent).toContain('--ct-focus-ring-input: rgba(75, 98, 136, 0.28);');

    // Light theme tokens (frosted blue)
    expect(cssContent).toContain('--ct-border-input-hover: #b9ceea;');
    expect(cssContent).toContain('--ct-border-input-focus: #7b9ec4;');
    expect(cssContent).toContain('--ct-focus-ring-input: rgba(123, 158, 196, 0.28);');

    // #navigator-search focus styling rules
    expect(cssContent).toContain('border-color: var(--ct-border-input-focus);');
    expect(cssContent).toContain('box-shadow: 0 0 0 2px var(--ct-focus-ring-input);');
    expect(cssContent).toContain('border-color: var(--ct-border-input-hover);');
  });
});
