/** @vitest-environment jsdom */
/** Checks Settings interaction and applying the preference before revealing the sidebar. */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarSettings } from '@/components/options/SidebarSettings';
import {
  initializeSidebarVisibility,
  isSidebarPinned,
  isSidebarHidden,
  toggleSidebarPinned,
  resetVisibilityForTesting,
} from '@/features/sidebarVisibility';
import { writeSidebarPinnedOnStartup } from '@/features/sidebar/sidebarSettings';

vi.mock('@/platforms', () => ({
  getActivePlatform: () => ({ pageHook: { messages: { setWidthSpoof: 'TEST_SET_WIDTH_SPOOF' } } }),
}));

const key = 'chatToc:sidebarPinnedOnStartup';
let saved: unknown;
let root: Root | undefined;
let container: HTMLDivElement;
const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();

beforeEach(() => {
  saved = undefined;
  listeners.clear();
  resetVisibilityForTesting();
  sessionStorage.clear();
  document.body.innerHTML = '<aside id="luna-toc-sidebar" class="luna-toc-navigator-initializing"><button id="luna-toc-sidebar-pin-btn"></button></aside><button id="luna-toc-toggle-btn"></button>';
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ [key]: saved })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          const oldValue = saved;
          saved = items[key];
          listeners.forEach((notify) => notify({ [key]: { oldValue, newValue: saved } }, 'local'));
        }),
      },
      onChanged: {
        addListener: vi.fn((fn) => listeners.add(fn)),
        removeListener: vi.fn((fn) => listeners.delete(fn)),
      },
    },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  resetVisibilityForTesting();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sidebar(): HTMLElement { return document.getElementById('luna-toc-sidebar')!; }
async function renderSettings(): Promise<HTMLInputElement> {
  root = createRoot(container);
  await act(async () => { root!.render(<SidebarSettings />); });
  return container.querySelector('input[role="switch"]')!;
}

describe('startup pin state', () => {
  it('keeps the existing pinned default and accessible button state', async () => {
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(true);
    expect(isSidebarHidden()).toBe(false);
    expect(document.getElementById('luna-toc-sidebar-pin-btn')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('applies the collapsed default before revealing a fresh sidebar', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const ready = initializeSidebarVisibility(sidebar());
    expect(sidebar().classList.contains('luna-toc-navigator-initializing')).toBe(true);
    finishRead({ [key]: false });
    await ready;
    expect(sidebar().classList.contains('luna-toc-navigator-initializing')).toBe(false);
    expect(sidebar().classList.contains('luna-toc-navigator-hidden')).toBe(true);
    expect(sidebar().getAttribute('aria-hidden')).toBe('true');
    expect(document.getElementById('luna-toc-sidebar-pin-btn')?.getAttribute('aria-pressed')).toBe('false');
    expect(isSidebarPinned()).toBe(false);
  });

  it('restores manual pin changes on refresh without changing the startup default', async () => {
    saved = false;
    await initializeSidebarVisibility(sidebar());
    toggleSidebarPinned();
    expect(isSidebarPinned()).toBe(true);
    expect(isSidebarHidden()).toBe(false);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    resetVisibilityForTesting();
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(true);
    expect(isSidebarHidden()).toBe(false);
    expect(saved).toBe(false);
  });

  it('applies preference changes only to fresh tab sessions', async () => {
    saved = false;
    await initializeSidebarVisibility(sidebar());
    await writeSidebarPinnedOnStartup(true);
    expect(isSidebarPinned()).toBe(false);
    resetVisibilityForTesting();
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(false);
    sessionStorage.clear();
    resetVisibilityForTesting();
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(true);
  });

  it.each([true, false])('restores saved tab state %s ahead of the default', async (pinned) => {
    saved = !pinned;
    sessionStorage.setItem('chatTocSidebarPinned', JSON.stringify(pinned));
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(pinned);
    expect(isSidebarHidden()).toBe(!pinned);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('preserves legacy session migration', async () => {
    sessionStorage.setItem('chatTocSidebarPinned:new-chat:/', 'false');
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(false);
    expect(sessionStorage.getItem('chatTocSidebarPinned')).toBe('false');
  });

  it('uses the default when session storage contains malformed data', async () => {
    saved = false;
    sessionStorage.setItem('chatTocSidebarPinned', '{');
    await initializeSidebarVisibility(sidebar());
    expect(isSidebarPinned()).toBe(false);
  });
});

describe('Settings startup pin control', () => {
  it('shows the saved choice and saves a new value through the Settings switch', async () => {
    const control = await renderSettings();
    expect(control.checked).toBe(true);
    expect(control.disabled).toBe(false);
    expect(container.textContent).toContain('Pin sidebar on startup');
    await act(async () => { control.click(); });
    expect(saved).toBe(false);
    expect(control.checked).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the saved value and reports a storage write error', async () => {
    const control = await renderSettings();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('unavailable'));
    await act(async () => { control.click(); });
    expect(control.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
    expect(control.disabled).toBe(false);
  });

  it('does not overwrite a live Settings update with a late initial read', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const control = await renderSettings();
    expect(control.disabled).toBe(true);
    await act(async () => { await writeSidebarPinnedOnStartup(false); });
    expect(control.checked).toBe(false);
    await act(async () => { finishRead({ [key]: true }); });
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
  });
});
