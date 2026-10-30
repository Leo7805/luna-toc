/** Checks the persistent startup preference independently of the page pin state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readSidebarPinnedOnStartup,
  writeSidebarPinnedOnStartup,
  subscribeSidebarPinnedOnStartup,
} from '@/features/sidebar/sidebarSettings';

const key = 'chatToc:sidebarPinnedOnStartup';
let saved: unknown;
const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();

beforeEach(() => {
  saved = undefined;
  listeners.clear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ [key]: saved })),
        set: vi.fn(async (items: Record<string, unknown>) => { saved = items[key]; }),
      },
      onChanged: {
        addListener: vi.fn((fn) => listeners.add(fn)),
        removeListener: vi.fn((fn) => listeners.delete(fn)),
      },
    },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sidebar startup preference', () => {
  it.each([undefined, null, 'false', 0, {}])('defaults to pinned for invalid storage: %s', async (value) => {
    saved = value;
    expect(await readSidebarPinnedOnStartup()).toBe(true);
  });
  it.each([true, false])('persists the explicit boolean %s', async (value) => {
    await writeSidebarPinnedOnStartup(value);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [key]: value });
    expect(await readSidebarPinnedOnStartup()).toBe(value);
  });
  it('falls back to the default if reading storage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('unavailable'));
    expect(await readSidebarPinnedOnStartup()).toBe(true);
  });
  it('reports write failures instead of pretending the setting was saved', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('unavailable'));
    await expect(writeSidebarPinnedOnStartup(false)).rejects.toThrow('unavailable');
  });
  it('subscribes only to local preference changes and unsubscribes cleanly', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarPinnedOnStartup(listener);
    for (const notify of listeners) {
      notify({ [key]: { newValue: false } }, 'sync');
      notify({ other: { newValue: false } }, 'local');
    }
    expect(listener).not.toHaveBeenCalled();
    for (const notify of listeners) {
      notify({ [key]: { newValue: false } }, 'local');
      notify({ [key]: { newValue: undefined } }, 'local');
    }
    expect(listener.mock.calls).toEqual([[false], [true]]);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
