/**
 * @vitest-environment jsdom
 * Verifies hover, pinning, and right-side toolbar visibility ownership.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidebarToggleButton } from '@/features/SidebarToggleButton';
import { promptContextMenuController } from '@/features/myPrompts/promptContextMenu';
import { initializeChatGptSideBySide, disposeChatGptSideBySide, setChatGptSideBySideEnabled } from '@/features/sidebar/chatGptSideBySide';
import {
  EDGE_TOOL_DWELL_MS,
  EDGE_TOOL_HIDE_DELAY_MS,
  initializeSidebarVisibility,
  setSidebarHidden,
  setSidebarPinned,
  setSidebarLayoutMode,
} from '@/features/sidebarVisibility';

afterEach(() => {
  disposeChatGptSideBySide();
  promptContextMenuController.close();
  vi.useRealTimers();
  sessionStorage.removeItem('chatTocSidebarPinned');
  sessionStorage.removeItem('chatToc:activeSidebarLayoutMode');
  sessionStorage.removeItem('chatTocToggleButtonPosition');
  document.body.textContent = '';
});

function setup(): {
  sidebar: HTMLElement;
  trigger: HTMLButtonElement;
  dock: HTMLElement;
  panel: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="luna-toc-sidebar">
      <button id="luna-toc-sidebar-pin-btn"></button>
      <div class="navigator-jump-controls">
        <button id="jump-chat-top-btn"></button>
        <button id="toggle-view-mode-btn"></button>
        <button id="jump-chat-bottom-btn"></button>
      </div>
    </div>
  `;
  const sidebar = document.getElementById('luna-toc-sidebar')!;
  const trigger = createSidebarToggleButton();
  const dock = trigger.parentElement!;
  const panel = document.querySelector<HTMLElement>('.navigator-jump-controls')!;
  return { sidebar, trigger, dock, panel };
}

describe('sidebar reveal handle and right-side tools', () => {
  it('opens from the slim trigger, hides only the trigger, and closes on pointer leave', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, dock, panel } = setup();
    const onOpened = vi.fn();
    initializeSidebarVisibility(sidebar, trigger, { onOpened });

    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
    expect(dock.getAttribute('aria-hidden')).toBe('false');
    expect(dock.inert).toBe(false);

    trigger.dispatchEvent(new Event('pointerenter'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(onOpened).toHaveBeenCalledOnce();
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);
    expect(dock.getAttribute('aria-hidden')).toBe('true');
    expect(dock.inert).toBe(true);

    // The tools stay inside the sidebar, visible and interactive with it.
    expect(panel.parentElement).toBe(sidebar);
    expect(Array.from(panel.querySelectorAll('button')).map(x => x.id))
      .toEqual(['jump-chat-top-btn', 'toggle-view-mode-btn', 'jump-chat-bottom-btn']);
    // Opening the sidebar must never force the toolbar buttons to pop open.
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelector<HTMLButtonElement>('#jump-chat-top-btn')!.tabIndex).toBe(-1);
    expect(panel.closest('[aria-hidden="true"]')).toBe(panel);

    // Moving anywhere outside the button group's actual footprint hides it.
    sidebar.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.querySelector<HTMLButtonElement>('#jump-chat-top-btn')!.tabIndex).toBe(-1);

    // The invisible footprint cannot bypass the 50ms edge dwell.
    panel.dispatchEvent(new Event('pointerenter'));
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: 20, clientY: 400,
    }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 400,
    }));
    vi.advanceTimersByTime(49);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(1);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('false');

    panel.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    panel.dispatchEvent(new Event('pointerleave'));
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    vi.advanceTimersByTime(399);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);

    sidebar.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(59);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    vi.advanceTimersByTime(1);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(sidebar.contains(panel)).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
    expect(dock.inert).toBe(false);
  });

  it('opens the sidebar on first edge contact, then reveals tools only after a second 50ms dwell', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, panel } = setup();
    Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 800 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 132 });
    initializeSidebarVisibility(sidebar, trigger);

    trigger.dispatchEvent(new MouseEvent('pointerenter', { clientY: 410 }));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 3, clientY: 410,
    }));
    vi.advanceTimersByTime(1000);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);

    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 450 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 3, clientY: 150,
    }));
    vi.advanceTimersByTime(49);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    expect(panel.style.top).toBe('');
    vi.advanceTimersByTime(1);
    expect(panel.style.top).toBe('84px');
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('#jump-chat-top-btn')!.tabIndex).toBe(0);
  });

  it('cancels pending right-edge reveal when the pointer leaves before 50ms', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new MouseEvent('pointerenter', { clientY: 300 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 30 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 310,
    }));
    vi.advanceTimersByTime(40);
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 50, clientY: 310,
    }));
    vi.advanceTimersByTime(80);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 380,
    }));
    vi.advanceTimersByTime(49);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    setSidebarHidden(true);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
  });

  it('keeps 50ms reveal and sets a 400ms hide grace period', () => {
    expect(EDGE_TOOL_DWELL_MS).toBe(50);
    expect(EDGE_TOOL_HIDE_DELAY_MS).toBe(400);
  });

  it('cancels pending toolbar hide on pointer return and restarts 400ms after leaving again', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));
    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 320,
    }));
    vi.advanceTimersByTime(50);
    expect(panel.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20 }));
    vi.advanceTimersByTime(300);
    expect(panel.getAttribute('aria-hidden')).toBe('false');

    panel.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(200);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    panel.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(399);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    vi.advanceTimersByTime(1);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the toolbar/sidebar available for 400ms when leaving the open sidebar', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));
    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 310,
    }));
    vi.advanceTimersByTime(50);
    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(399);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    vi.advanceTimersByTime(1);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('cancels delayed reveal when the sidebar closes during the dwell', () => {
    vi.useFakeTimers();
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));
    sidebar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 30 }));
    sidebar.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true, clientX: window.innerWidth - 2, clientY: 400,
    }));
    setSidebarHidden(true);
    vi.advanceTimersByTime(300);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('reveals and focuses navigation buttons through the sidebar keyboard shortcut', () => {
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    const hidden = new KeyboardEvent('keydown', {
      key: 'J', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    sidebar.dispatchEvent(hidden);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(false);
    trigger.dispatchEvent(new Event('pointerenter'));
    const shortcut = new KeyboardEvent('keydown', {
      key: 'J', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    });
    sidebar.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    expect(panel.classList.contains('navigator-jump-controls-visible')).toBe(true);
    expect(document.activeElement?.id).toBe('jump-chat-top-btn');
  });

  it('cancels quick auto-hide when the pointer reenters the sidebar', () => {
    vi.useFakeTimers();
    const { sidebar, trigger } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));
    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(50);
    sidebar.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(70);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');

    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(60);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes an open React-portal context menu whenever the sidebar hides', () => {
    const { sidebar, trigger } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));

    promptContextMenuController.show(
      { left: 45, top: 70 },
      [{ id: 'mark-prompt', label: '收藏' }],
      vi.fn()
    );
    expect(promptContextMenuController.getSnapshot()?.items[0].label).toBe('收藏');

    setSidebarHidden(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(promptContextMenuController.getSnapshot()).toBeNull();
  });

  it('dismisses menu actions after the faster 60ms sidebar collapse', () => {
    vi.useFakeTimers();
    const { sidebar, trigger } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));

    promptContextMenuController.show(
      { left: 10, top: 20 },
      [{ id: 'copy-prompt', label: '复制' }],
      vi.fn()
    );

    sidebar.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(60);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(promptContextMenuController.getSnapshot()).toBeNull();
  });

  it('keeps the trigger hidden for a pinned sidebar and restores it after unpinning', () => {
    const { sidebar, trigger, dock } = setup();
    initializeSidebarVisibility(sidebar, trigger);

    setSidebarPinned(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);

    setSidebarPinned(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(false);
  });

  it('applies per-mode defaults and keeps a manual pin while the mode is unchanged', () => {
    const { sidebar, trigger } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    setSidebarLayoutMode('side-by-side');
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('luna-toc-sidebar-pin-btn')?.getAttribute('aria-pressed')).toBe('true');
    setSidebarPinned(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    setSidebarLayoutMode('side-by-side');
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');

    setSidebarLayoutMode('overlay');
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(document.getElementById('luna-toc-sidebar-pin-btn')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('reflows the ChatGPT conversation on sidebar open and restores it when closed', () => {
    const { sidebar } = setup();
    sidebar.style.setProperty('--navigator-width', '300px');
    const root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = '<nav id="chatgpt-native-sidebar"></nav><main id="chatgpt-main"><div id="thread"></div></main>';
    document.body.prepend(root);
    const main = document.getElementById('chatgpt-main')!;

    initializeChatGptSideBySide(sidebar);
    initializeSidebarVisibility(sidebar, document.getElementById('luna-toc-toggle-btn') as HTMLButtonElement);
    setChatGptSideBySideEnabled(true);
    setSidebarLayoutMode('side-by-side');
    expect(main.classList.contains('luna-toc-chat-side-by-side')).toBe(true);
    expect(root.classList.contains('luna-toc-chat-side-by-side')).toBe(false);
    expect(main.style.getPropertyValue('--luna-toc-reserved-sidebar-width')).toBe('300px');

    setSidebarHidden(true);
    expect(main.classList.contains('luna-toc-chat-side-by-side')).toBe(false);
    setSidebarLayoutMode('overlay');
    expect(main.classList.contains('luna-toc-chat-side-by-side')).toBe(false);
  });

  it('also opens from keyboard focus on the slim trigger', () => {
    const { sidebar, trigger, dock } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new FocusEvent('focus'));
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(dock.classList.contains('luna-toc-floating-dock-hidden')).toBe(true);
  });
  it('retains toolbar visibility when moving among its buttons and opens on keyboard focus', () => {
    const { sidebar, trigger, panel } = setup();
    initializeSidebarVisibility(sidebar, trigger);
    trigger.dispatchEvent(new Event('pointerenter'));
    sidebar.dispatchEvent(new Event('pointermove'));
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    panel.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.querySelector<HTMLButtonElement>('#jump-chat-bottom-btn')!.tabIndex).toBe(0);
    panel.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

});
