/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextMenu, type ContextMenuItem } from '@/components/ui/context-menu';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const testItems: ContextMenuItem[] = [
  { id: 'item-1', label: 'First Action' },
  { id: 'item-2', label: 'Second Action' },
];

describe('ContextMenu viewport positioning', () => {
  let rootContainer: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    rootContainer = document.createElement('div');
    document.body.appendChild(rootContainer);
    root = createRoot(rootContainer);

    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootContainer.remove();
    vi.restoreAllMocks();
  });

  function mockMenuHeight(height: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute('role') === 'menu') {
          return {
            height,
            width: 220,
            top: 0,
            bottom: height,
            left: 0,
            right: 220,
            x: 0,
            y: 0,
            toJSON: () => {},
          };
        }
        return {
          height: 0,
          width: 0,
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      }
    );
  }

  it('Scenario A: clamps menu at bottom edge using measured height', () => {
    mockMenuHeight(80);

    act(() => {
      root.render(
        <ContextMenu
          ariaLabel="Test Menu"
          items={testItems}
          position={{ left: 100, top: 780 }}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    });

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    // window.innerHeight (800) - measuredHeight (80) - MENU_GAP (8) = 712
    expect(menu?.style.top).toBe('712px');
    expect(menu?.style.visibility).toBe('visible');

    const topNum = parseInt(menu?.style.top || '0', 10);
    expect(topNum + 80).toBeLessThanOrEqual(window.innerHeight - 8);
  });

  it('Scenario B: preserves requested top position when mid-screen', () => {
    mockMenuHeight(80);

    act(() => {
      root.render(
        <ContextMenu
          ariaLabel="Test Menu"
          items={testItems}
          position={{ left: 100, top: 250 }}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    });

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.style.top).toBe('250px');
    expect(menu?.style.visibility).toBe('visible');
  });

  it('Scenario C: clamps menu at top edge to MENU_GAP', () => {
    mockMenuHeight(80);

    act(() => {
      root.render(
        <ContextMenu
          ariaLabel="Test Menu"
          items={testItems}
          position={{ left: 100, top: 2 }}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    });

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    // Clamped to MENU_GAP (8)
    expect(menu?.style.top).toBe('8px');
    expect(menu?.style.visibility).toBe('visible');
  });

  it('Scenario D: clamps correctly with different real height without fixed item-count assumptions', () => {
    mockMenuHeight(150);

    act(() => {
      root.render(
        <ContextMenu
          ariaLabel="Test Menu"
          items={testItems}
          position={{ left: 100, top: 750 }}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    });

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    // window.innerHeight (800) - measuredHeight (150) - MENU_GAP (8) = 642
    expect(menu?.style.top).toBe('642px');
    expect(menu?.style.visibility).toBe('visible');

    const topNum = parseInt(menu?.style.top || '0', 10);
    expect(topNum + 150).toBeLessThanOrEqual(window.innerHeight - 8);
  });
});
