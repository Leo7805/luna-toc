/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChatGPTTheme,
  observeChatGPTTheme,
} from '@/features/theme/chatGptTheme';
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

describe('ChatGPT theme detection and observation', () => {
  it('detects light theme from html[data-theme="light"]', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    expect(getChatGPTTheme()).toBe('light');
  });

  it('detects dark theme from html[data-theme="dark"]', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(getChatGPTTheme()).toBe('dark');
  });

  it('prioritises data-theme over conflicting system preference and legacy class', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    // data-theme light with dark class and dark system preference
    document.documentElement.className = 'dark';
    document.documentElement.setAttribute('data-theme', 'light');
    expect(getChatGPTTheme()).toBe('light');

    // data-theme dark with light class and light system preference
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    document.documentElement.className = 'light';
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(getChatGPTTheme()).toBe('dark');
  });

  it('falls back to dark CSS class when data-theme is missing or unrecognized', () => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = 'dark';
    expect(getChatGPTTheme()).toBe('dark');

    document.documentElement.className = 'light';
    expect(getChatGPTTheme()).toBe('light');

    document.documentElement.setAttribute('data-theme', 'auto');
    document.documentElement.className = 'dark';
    expect(getChatGPTTheme()).toBe('dark');
  });

  it('triggers observer when data-theme changes from light to dark', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const listener = vi.fn();
    const cleanup = observeChatGPTTheme(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('light');

    document.documentElement.setAttribute('data-theme', 'dark');
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('dark');

    cleanup();
  });

  it('triggers observer when data-theme changes from dark to light', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const listener = vi.fn();
    const cleanup = observeChatGPTTheme(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('dark');

    document.documentElement.setAttribute('data-theme', 'light');
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('light');

    cleanup();
  });

  it('disconnects observer on cleanup', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const listener = vi.fn();
    const cleanup = observeChatGPTTheme(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    cleanup();

    document.documentElement.setAttribute('data-theme', 'dark');
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves manual theme mode independently of ChatGPT theme changes', () => {
    // User selected manual dark theme with followChatGPT OFF
    applyTheme('dark');
    expect(document.documentElement.dataset.lunatocTheme).toBe('dark');

    // ChatGPT changes between light and dark
    document.documentElement.setAttribute('data-theme', 'light');
    expect(document.documentElement.dataset.lunatocTheme).toBe('dark');

    document.documentElement.setAttribute('data-theme', 'dark');
    expect(document.documentElement.dataset.lunatocTheme).toBe('dark');
  });
});
