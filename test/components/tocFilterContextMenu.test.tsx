/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TocFilterContextMenuHost } from '@/components/toc-filter/TocFilterContextMenu';
import {
  closeTocFilterMenu,
  getTocFilterMode,
  openTocFilterMenu,
  resetTocFilterMode,
  setTocFilterMode,
} from '@/features/tocFilter/tocFilterStore';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('TocFilterContextMenu', () => {
  let rootContainer: HTMLDivElement;
  let hostElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetTocFilterMode();
    closeTocFilterMenu();

    hostElement = document.createElement('div');
    hostElement.id = 'luna-toc-react-host';

    rootContainer = document.createElement('div');
    rootContainer.className = 'luna-toc-ui';
    hostElement.appendChild(rootContainer);
    document.body.appendChild(hostElement);

    root = createRoot(rootContainer);
    act(() => {
      root.render(React.createElement(TocFilterContextMenuHost));
    });
  });

  afterEach(() => {
    act(() => {
      closeTocFilterMenu();
      root.unmount();
    });
    hostElement.remove();
  });

  it('renders null when the menu is closed', () => {
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('renders exactly four mutually exclusive options with active checkmark on default "All prompts"', () => {
    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    const menu = document.querySelector('[role="menu"]') as HTMLDivElement;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute('aria-label')).toBe('Filter prompts');

    const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
    expect(items.length).toBe(4);

    const labels = items.map((el) => el.textContent?.trim());
    expect(labels).toEqual([
      'All prompts',
      'Renamed only',
      'Bookmarked only',
      'Renamed or bookmarked',
    ]);

    // "All prompts" should be checked by default
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[1].getAttribute('aria-checked')).toBe('false');
    expect(items[2].getAttribute('aria-checked')).toBe('false');
    expect(items[3].getAttribute('aria-checked')).toBe('false');

    // First item has the CheckIcon SVG inside
    expect(items[0].querySelector('svg')).not.toBeNull();
  });

  it('selects an option, updates the filter store, and closes the menu', () => {
    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    const items = Array.from(document.querySelectorAll('[role="menuitemradio"]')) as HTMLButtonElement[];
    // Click "Bookmarked only" (index 2)
    act(() => {
      items[2].click();
    });

    expect(getTocFilterMode()).toBe('bookmarked');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('displays the checkmark on the previously selected filter option upon re-opening', () => {
    act(() => {
      setTocFilterMode('renamed_or_bookmarked');
    });

    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    const items = Array.from(document.querySelectorAll('[role="menuitemradio"]'));
    expect(items[3].getAttribute('aria-checked')).toBe('true');
    expect(items[0].getAttribute('aria-checked')).toBe('false');
  });

  it('closes on Escape keypress', () => {
    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes on outside pointerdown', () => {
    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('sets and removes data-luna-toc-context-menu-open on react host', () => {
    expect(hostElement.hasAttribute('data-luna-toc-context-menu-open')).toBe(false);

    act(() => {
      openTocFilterMenu({ left: 150, top: 200 });
    });

    expect(hostElement.getAttribute('data-luna-toc-context-menu-open')).toBe('true');

    act(() => {
      closeTocFilterMenu();
    });

    expect(hostElement.hasAttribute('data-luna-toc-context-menu-open')).toBe(false);
  });
});
