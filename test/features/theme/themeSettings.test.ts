/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  readThemeSettings,
  subscribeThemeSettings,
  writeThemeSettings,
  type ThemeSettings,
} from '@/features/theme/themeSettings';

const storageMap = new Map<string, unknown>();
type StorageChangeHandler = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;
const storageListeners = new Set<StorageChangeHandler>();

beforeEach(() => {
  storageMap.clear();
  storageListeners.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.lunatocTheme;

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          if (typeof keys === 'string') {
            return { [keys]: storageMap.get(keys) };
          }
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (storageMap.has(key)) {
              result[key] = storageMap.get(key);
            }
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            const oldValue = storageMap.get(key);
            storageMap.set(key, value);
            changes[key] = { oldValue, newValue: value };
          }
          for (const listener of storageListeners) {
            listener(changes, 'local');
          }
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: StorageChangeHandler) => {
          storageListeners.add(listener);
        }),
        removeListener: vi.fn((listener: StorageChangeHandler) => {
          storageListeners.delete(listener);
        }),
      },
    },
  });
});

describe('Theme attribute isolation', () => {
  it('ChatGPT Light + Follow OFF + LunaTOC Dark preserves host class and host data-theme', () => {
    // Initial ChatGPT Light state
    document.documentElement.className = 'light';
    document.documentElement.dataset.theme = 'light';

    // Switch LunaTOC to dark
    applyTheme('dark');

    // Host attributes must remain untouched
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    // LunaTOC theme must be set to dark via namespaced attribute
    expect(document.documentElement.dataset.lunatocTheme).toBe('dark');
  });

  it('ChatGPT Dark + Follow OFF + LunaTOC Light preserves host class and host data-theme', () => {
    // Initial ChatGPT Dark state
    document.documentElement.className = 'dark';
    document.documentElement.dataset.theme = 'dark';

    // Switch LunaTOC to light
    applyTheme('light');

    // Host attributes must remain untouched
    expect(document.documentElement.className).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    // LunaTOC theme must be set to light via namespaced attribute
    expect(document.documentElement.dataset.lunatocTheme).toBe('light');
  });

  it('Switching LunaTOC Light -> Dark -> Light mutates only data-lunatoc-theme', () => {
    document.documentElement.className = 'light';
    document.documentElement.dataset.theme = 'light';

    applyTheme('light');
    expect(document.documentElement.dataset.lunatocTheme).toBe('light');
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.dataset.lunatocTheme).toBe('dark');
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    applyTheme('light');
    expect(document.documentElement.dataset.lunatocTheme).toBe('light');
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('Theme settings persistence', () => {
  it('reads default settings when storage is empty', async () => {
    const settings = await readThemeSettings();
    expect(settings).toEqual({
      followChatGPT: true,
      manualTheme: 'dark',
    });
  });

  it('saves and reads custom theme settings', async () => {
    const custom: ThemeSettings = {
      followChatGPT: false,
      manualTheme: 'light',
    };
    await writeThemeSettings(custom);

    const loaded = await readThemeSettings();
    expect(loaded).toEqual(custom);
  });

  it('notifies subscribers when theme settings change', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeSettings(listener);

    await writeThemeSettings({
      followChatGPT: false,
      manualTheme: 'dark',
    });

    expect(listener).toHaveBeenCalledWith({
      followChatGPT: false,
      manualTheme: 'dark',
    });

    unsubscribe();
  });
});
