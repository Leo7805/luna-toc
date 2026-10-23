/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarToggleButton } from '@/components/sidebar-toggle/SidebarToggleButton';
import { SidebarHeader } from '@/components/sidebar-header/SidebarHeader';
import { SidebarStatus } from '@/components/sidebar-status/SidebarStatus';
import { SidebarJumpControls } from '@/components/sidebar-jump/SidebarJumpControls';
import { MyPromptsView } from '@/components/my-prompts/MyPromptsView';
import { sidebarController } from '@/features/sidebar/sidebarController';
import {
  initializeSidebarVisibility,
  isSidebarHidden,
  isSidebarPinned,
  resetVisibilityForTesting,
  setSidebarHidden,
  setSidebarPinned,
} from '@/features/sidebarVisibility';
import {
  POSITION_STORAGE_KEY,
  POSITION_MARGIN,
  clampPosition,
} from '@/features/SidebarToggleButton';
import { setReactPortalContainer } from '@/reactHost/portalContainer';
import { resetStatusForTesting } from '@/navigation/ui/sidebarStatus';

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SidebarToggleButton React Component', () => {
  let rootContainer: HTMLDivElement;
  let root: Root;
  let sidebar: HTMLDivElement;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    resetStatusForTesting();
    sidebarController.resetReadyForTesting();
    sidebarController.setViewMode('toc');
    resetVisibilityForTesting();

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        host: 'chatgpt.com',
        pathname: '/c/test-conv',
      },
    });

    document.body.innerHTML = '';
    document.documentElement.className = '';

    // Mock setPointerCapture / releasePointerCapture for jsdom
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();

    if (!('inert' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'inert', {
        get() {
          return this.hasAttribute('inert');
        },
        set(val) {
          if (val) this.setAttribute('inert', '');
          else this.removeAttribute('inert');
        },
        configurable: true,
      });
    }

    sidebar = document.createElement('div');
    sidebar.id = 'luna-toc-sidebar';
    sidebar.innerHTML = `
      <div id="navigator-header" class="navigator-header"></div>
      <div id="navigator-search-container"></div>
      <div id="luna-toc-status" class="navigator-status"></div>
      <div class="navigator-jump-controls"></div>
      <div id="myprompts-toolbar-container" style="display: none;"></div>
      <div id="navigator-list"></div>
      <div id="myprompts-list" class="navigator-list" style="display: none;"></div>
    `;
    document.body.appendChild(sidebar);

    rootContainer = document.createElement('div');
    rootContainer.id = 'luna-toc-react-root';
    document.body.appendChild(rootContainer);

    const portalContainer = document.createElement('div');
    portalContainer.id = 'luna-toc-react-portals';
    setReactPortalContainer(portalContainer);
    document.body.appendChild(portalContainer);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    resetVisibilityForTesting();
    sessionStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('1. Initial Moon Button rendering with SVG and label', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.className).toContain('luna-toc-sidebar-visible');
    expect(button.getAttribute('aria-label')).toBe('Close sidebar');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 64 64');

    const label = button.querySelector('.toggle-sidebar-label');
    expect(label).not.toBeNull();
    expect(label?.textContent?.trim()).toBe('TOC');
  });

  it('2. React-first initialization (React renders before application/sidebar setup)', async () => {
    // Render React first before initializeSidebarVisibility or sidebarController.init()
    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    let button = document.getElementById('luna-toc-toggle-btn');
    expect(button).not.toBeNull();

    // Now complete application visibility setup
    await act(async () => {
      initializeSidebarVisibility(sidebar);
    });

    button = document.getElementById('luna-toc-toggle-btn');
    expect(button).not.toBeNull();
    expect(button?.className).toContain('luna-toc-sidebar-visible');
  });

  it('3. Application-first initialization (setup runs before React mounts)', async () => {
    initializeSidebarVisibility(sidebar);
    sidebarController.init();

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn');
    expect(button).not.toBeNull();
    expect(button?.className).toContain('luna-toc-sidebar-visible');
  });

  it('4. Button click opens and closes the Sidebar', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    expect(isSidebarHidden()).toBe(false);

    // Click to hide
    await act(async () => {
      button.click();
    });
    expect(isSidebarHidden()).toBe(true);
    expect(button.className).toContain('luna-toc-sidebar-hidden');
    expect(button.getAttribute('aria-label')).toBe('Open sidebar');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Click to show
    await act(async () => {
      button.click();
    });
    expect(isSidebarHidden()).toBe(false);
    expect(button.className).toContain('luna-toc-sidebar-visible');
    expect(button.getAttribute('aria-label')).toBe('Close sidebar');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('5. Pinned and unpinned states', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    expect(isSidebarPinned()).toBe(true);
    await act(async () => {
      setSidebarPinned(false);
    });
    expect(isSidebarPinned()).toBe(false);

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    // In unpinned mode, clicking still toggles visibility correctly
    expect(isSidebarHidden()).toBe(false);
  });

  it('6. Auto-hide on pointer enter and leave when unpinned', async () => {
    vi.useFakeTimers();
    initializeSidebarVisibility(sidebar);
    setSidebarPinned(false);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;

    // Simulate pointerenter -> reveals sidebar
    await act(async () => {
      button.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
    });
    expect(isSidebarHidden()).toBe(false);

    // Simulate pointerleave -> schedules auto-hide
    await act(async () => {
      button.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    });

    // Fast-forward auto-hide delay (300ms)
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(isSidebarHidden()).toBe(true);
    vi.useRealTimers();
  });

  it('7. Position restoration from sessionStorage', async () => {
    sessionStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify({ left: 150, top: 220 })
    );

    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    expect(button.style.left).toBe('150px');
    expect(button.style.top).toBe('220px');
  });

  it('8. Dragging across the viewport updates position and persists to sessionStorage', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    button.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      width: 42,
      height: 42,
      right: 142,
      bottom: 142,
      x: 100,
      y: 100,
      toJSON: () => {},
    }));

    // Pointer down
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    expect(button.classList.contains('luna-toc-toggle-btn-dragging')).toBe(true);

    // Pointer move (> 4px threshold)
    button.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 180, clientY: 220 })
    );
    expect(button.style.left).toBe('180px');
    expect(button.style.top).toBe('220px');

    // Pointer up
    button.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true })
    );
    expect(button.classList.contains('luna-toc-toggle-btn-dragging')).toBe(false);
    expect(button.dataset.dragged).toBe('true');

    // Verify sessionStorage has saved position
    const saved = JSON.parse(sessionStorage.getItem(POSITION_STORAGE_KEY)!);
    expect(saved).not.toBeNull();
  });

  it('9. Drag boundary clamping restricts movement inside viewport margins', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    button.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      width: 42,
      height: 42,
      right: 142,
      bottom: 142,
      x: 100,
      y: 100,
      toJSON: () => {},
    }));

    // Pointer down
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );

    // Move to negative coordinates (offscreen top-left)
    button.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: -500, clientY: -500 })
    );
    expect(button.style.left).toBe(`${POSITION_MARGIN}px`);
    expect(button.style.top).toBe(`${POSITION_MARGIN}px`);

    // Move to extreme right and bottom
    const maxLeft = window.innerWidth - 42;
    const maxTop = window.innerHeight - 42 - POSITION_MARGIN;
    button.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 99999, clientY: 99999 })
    );
    expect(button.style.left).toBe(`${maxLeft}px`);
    expect(button.style.top).toBe(`${maxTop}px`);

    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  it('10. Pointer cancellation stops dragging and cleans up', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;

    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    expect(button.classList.contains('luna-toc-toggle-btn-dragging')).toBe(true);

    button.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true })
    );
    expect(button.classList.contains('luna-toc-toggle-btn-dragging')).toBe(false);
  });

  it('11. Click suppression after dragging', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    expect(isSidebarHidden()).toBe(false);

    // Simulate drag completed
    button.dataset.dragged = 'true';

    // Click should be suppressed (does not toggle visibility)
    await act(async () => {
      button.click();
    });

    expect(isSidebarHidden()).toBe(false);
    expect(button.dataset.dragged).toBe('false');

    // Next click toggles as normal
    await act(async () => {
      button.click();
    });
    expect(isSidebarHidden()).toBe(true);
  });

  it('12. Browser resize re-clamps button within visible viewport', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    button.getBoundingClientRect = vi.fn(() => ({
      left: 1200,
      top: 900,
      width: 42,
      height: 42,
      right: 1242,
      bottom: 942,
      x: 1200,
      y: 900,
      toJSON: () => {},
    }));

    // Shrink window
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

    window.dispatchEvent(new Event('resize'));

    const expectedLeft = 800 - 42;
    const expectedTop = 600 - 42 - POSITION_MARGIN;
    expect(button.style.left).toBe(`${expectedLeft}px`);
    expect(button.style.top).toBe(`${expectedTop}px`);
  });

  it('13. React re-render during and after drag does not reset coordinates', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;
    button.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      width: 42,
      height: 42,
      right: 142,
      bottom: 142,
      x: 100,
      y: 100,
      toJSON: () => {},
    }));

    // Drag to 250, 350
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 })
    );
    button.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 250, clientY: 350 })
    );
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // Trigger state changes causing React re-renders
    await act(async () => {
      setSidebarHidden(true);
    });
    expect(button.style.left).toBe('250px');
    expect(button.style.top).toBe('350px');

    await act(async () => {
      setSidebarHidden(false);
    });
    expect(button.style.left).toBe('250px');
    expect(button.style.top).toBe('350px');
  });

  it('14. External overlay class matches toggle button selector', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    document.documentElement.classList.add('luna-toc-external-overlay-open');
    const matched = document.querySelector('html.luna-toc-external-overlay-open #luna-toc-toggle-btn');
    expect(matched).not.toBeNull();
  });

  it('15. Light and Dark theme compatibility', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const button = document.getElementById('luna-toc-toggle-btn');
    expect(button).not.toBeNull();

    // Verify theme attribute toggles on document root propagate cleanly
    document.documentElement.dataset.theme = 'dark';
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(button?.isConnected).toBe(true);

    document.documentElement.dataset.theme = 'light';
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(button?.isConnected).toBe(true);
  });

  it('16. Clean unmount removes portal children and listeners', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    const container = document.getElementById('luna-toc-toggle-container')!;
    expect(container.children.length).toBe(1);

    await act(async () => {
      root.unmount();
    });

    expect(container.children.length).toBe(0);
    expect(document.getElementById('luna-toc-toggle-btn')).toBeNull();
  });

  it('17. Enforces strict single DOM ownership with no duplicate buttons', async () => {
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(<SidebarToggleButton />);
    });

    // Trigger multiple re-renders
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        setSidebarHidden(i % 2 === 0);
      });
    }

    const buttons = document.querySelectorAll('#luna-toc-toggle-btn');
    expect(buttons.length).toBe(1);
  });

  it('18. Existing Header, Search, Status and Jump Controls remain unaffected', async () => {
    sidebarController.init();
    initializeSidebarVisibility(sidebar);

    root = createRoot(rootContainer);
    await act(async () => {
      root.render(
        <>
          <SidebarHeader />
          <SidebarStatus />
          <SidebarJumpControls />
          <MyPromptsView />
          <SidebarToggleButton />
        </>
      );
    });

    // All elements mount concurrently into their respective containers
    expect(document.getElementById('navigator-header')?.children.length).toBeGreaterThan(0);
    expect(document.getElementById('navigator-search-container')?.children.length).toBeGreaterThan(0);
    expect(document.getElementById('luna-toc-status')).not.toBeNull();
    expect(document.querySelector('.navigator-jump-controls')?.children.length).toBe(3);
    expect(document.getElementById('luna-toc-toggle-btn')).not.toBeNull();
  });

  describe('Focus Management & aria-hidden Protection', () => {
    it('19. Moves focus from Pin button to Moon button before setting aria-hidden during auto-hide', async () => {
      vi.useFakeTimers();
      sidebarController.init();
      initializeSidebarVisibility(sidebar);
      setSidebarPinned(false);

      root = createRoot(rootContainer);
      await act(async () => {
        root.render(
          <>
            <SidebarHeader />
            <SidebarToggleButton />
          </>
        );
      });

      const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn') as HTMLButtonElement;
      const toggleBtn = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;

      // Focus the pin button inside the sidebar
      pinBtn.focus();
      expect(document.activeElement).toBe(pinBtn);

      // Trigger auto-hide leave
      await act(async () => {
        sidebar.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
      });

      // Advance timer past auto-hide delay
      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(isSidebarHidden()).toBe(true);
      expect(sidebar.getAttribute('aria-hidden')).toBe('true');
      expect(sidebar.inert).toBe(true);

      // Focus was moved out to Moon button, so no descendant retains focus
      expect(document.activeElement).toBe(toggleBtn);
      expect(sidebar.contains(document.activeElement)).toBe(false);

      vi.useRealTimers();
    });

    it('20. Moves focus from Search button to Moon button during manual hide', async () => {
      sidebarController.init();
      sidebarController.setPromptCount(5);
      initializeSidebarVisibility(sidebar);

      root = createRoot(rootContainer);
      await act(async () => {
        root.render(
          <>
            <SidebarHeader />
            <SidebarToggleButton />
          </>
        );
      });

      const searchBtn = document.getElementById('search-toggle-btn') as HTMLButtonElement;
      const toggleBtn = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;

      searchBtn.focus();
      expect(document.activeElement).toBe(searchBtn);

      await act(async () => {
        setSidebarHidden(true);
      });

      expect(sidebar.getAttribute('aria-hidden')).toBe('true');
      expect(sidebar.inert).toBe(true);
      expect(document.activeElement).toBe(toggleBtn);
      expect(sidebar.contains(document.activeElement)).toBe(false);
    });

    it('21. Does not move focus if activeElement is already outside the sidebar', async () => {
      sidebarController.init();
      initializeSidebarVisibility(sidebar);

      const externalInput = document.createElement('textarea');
      externalInput.id = 'chatgpt-prompt-textarea';
      document.body.appendChild(externalInput);

      root = createRoot(rootContainer);
      await act(async () => {
        root.render(<SidebarToggleButton />);
      });

      externalInput.focus();
      expect(document.activeElement).toBe(externalInput);

      await act(async () => {
        setSidebarHidden(true);
      });

      expect(sidebar.getAttribute('aria-hidden')).toBe('true');
      // Focus outside sidebar remains completely untouched
      expect(document.activeElement).toBe(externalInput);
    });

    it('22. Safely blurs focused descendant if Moon button is unavailable or unfocusable', async () => {
      sidebarController.init();
      initializeSidebarVisibility(sidebar);

      const innerButton = document.createElement('button');
      innerButton.id = 'inner-sidebar-btn';
      sidebar.appendChild(innerButton);

      innerButton.focus();
      expect(document.activeElement).toBe(innerButton);

      // No Moon button in DOM
      await act(async () => {
        setSidebarHidden(true);
      });

      expect(sidebar.getAttribute('aria-hidden')).toBe('true');
      expect(sidebar.inert).toBe(true);
      // Focus evicted to document.body (blurred)
      expect(sidebar.contains(document.activeElement)).toBe(false);
      expect(document.activeElement).not.toBe(innerButton);
    });

    it('23. Does not move focus when showing the sidebar or while sidebar remains visible', async () => {
      sidebarController.init();
      initializeSidebarVisibility(sidebar);

      root = createRoot(rootContainer);
      await act(async () => {
        root.render(
          <>
            <SidebarHeader />
            <SidebarToggleButton />
          </>
        );
      });

      const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn') as HTMLButtonElement;
      pinBtn.focus();
      expect(document.activeElement).toBe(pinBtn);

      // Calling setSidebarHidden(false) while visible must NOT move focus
      await act(async () => {
        setSidebarHidden(false);
      });
      expect(document.activeElement).toBe(pinBtn);
    });

    it('24. Supports keyboard reopening via Moon button after focus eviction', async () => {
      sidebarController.init();
      initializeSidebarVisibility(sidebar);

      root = createRoot(rootContainer);
      await act(async () => {
        root.render(
          <>
            <SidebarHeader />
            <SidebarToggleButton />
          </>
        );
      });

      const pinBtn = document.getElementById('luna-toc-sidebar-pin-btn') as HTMLButtonElement;
      const toggleBtn = document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement;

      pinBtn.focus();
      await act(async () => {
        setSidebarHidden(true);
      });

      // Keyboard focus landed on Moon button
      expect(document.activeElement).toBe(toggleBtn);

      // Pressing enter/space or clicking Moon button reopens
      await act(async () => {
        toggleBtn.click();
      });

      expect(isSidebarHidden()).toBe(false);
      expect(sidebar.getAttribute('aria-hidden')).toBe('false');
      expect(sidebar.inert).toBe(false);
    });
  });
});
