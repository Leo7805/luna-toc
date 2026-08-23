/** Tests persisted runtime navigation preferences. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readNavigationSettings,
  subscribeNavigationSettings,
  writeNavigationSettings,
} from '@/navigation/navigationSettings';

const SETTINGS_KEY = 'chatToc:navigationSettings';
let storedValue: unknown;
let changeListener:
  | ((
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => void)
  | null;

beforeEach(() => {
  storedValue = undefined;
  changeListener = null;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => ({ [SETTINGS_KEY]: storedValue })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          storedValue = value[SETTINGS_KEY];
        }),
      },
      onChanged: {
        addListener: vi.fn((listener) => {
          changeListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
  });
});

describe('navigation settings', () => {
  it('defaults to independent virtual navigation', async () => {
    await expect(readNavigationSettings()).resolves.toEqual({
      chatgpt: 'independent-virtual',
    });
  });

  it('rejects unsupported stored algorithms', async () => {
    storedValue = { chatgpt: 'unknown' };

    await expect(readNavigationSettings()).resolves.toEqual({
      chatgpt: 'independent-virtual',
    });
  });

  it('writes and reads the independent navigation preference', async () => {
    await writeNavigationSettings({
      chatgpt: 'independent-virtual',
    });

    await expect(readNavigationSettings()).resolves.toEqual({
      chatgpt: 'independent-virtual',
    });
  });

  it('subscribes to settings changed in another extension context', () => {
    const listener = vi.fn();
    subscribeNavigationSettings(listener);

    changeListener?.(
      {
        [SETTINGS_KEY]: {
          newValue: { chatgpt: 'independent-virtual' },
        },
      },
      'local'
    );

    expect(listener).toHaveBeenCalledWith({
      chatgpt: 'independent-virtual',
    });
  });
});
