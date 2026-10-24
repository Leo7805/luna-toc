import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readThemeSettings, writeThemeSettings, subscribeThemeSettings,
} from '@/features/theme/themeSettings';
import { ACCOUNT_SETTINGS_KEY } from '@/features/storage/accountSettings';
import { setActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';

const defaultTheme = { followChatGPT: true, manualTheme: 'dark' as const };
const defaultSidebar = { layoutMode: 'overlay' as const, backgroundColor: 'default' as const, revealTint: false };
const values: Record<string, unknown> = {};
const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const get = vi.fn(async (key?: string | string[] | null) => {
  if (key === undefined || key === null) return clone(values);
  const keys = typeof key === 'string' ? [key] : key;
  return clone(Object.fromEntries(keys.filter((item) => Object.hasOwn(values, item))
    .map((item) => [item, values[item]])));
});
const sendMessage = vi.fn((
  message: { action: string; ownerId?: string; settings?: unknown },
  callback: (response: { ok: boolean; error?: string }) => void
) => {
  if (message.action !== 'theme' || !message.ownerId || !message.settings) {
    callback({ ok: false, error: 'unexpected message' }); return;
  }
  const map = clone(values[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown; sidebar: unknown }>);
  if (!Object.hasOwn(map, message.ownerId)) {
    callback({ ok: false, error: 'unknown owner' }); return;
  }
  map[message.ownerId] = { ...map[message.ownerId], theme: message.settings };
  values[ACCOUNT_SETTINGS_KEY] = map;
  listeners.forEach((listener) => listener({ [ACCOUNT_SETTINGS_KEY]: { newValue: clone(map) } }, 'local'));
  callback({ ok: true });
});

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  values[ACCOUNT_SETTINGS_KEY] = {
    'account-1': { theme: defaultTheme, sidebar: defaultSidebar },
    'account-2': { theme: { followChatGPT: false, manualTheme: 'light' }, sidebar: defaultSidebar },
  };
  listeners.clear();
  get.mockClear();
  sendMessage.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', lastError: null, sendMessage },
    storage: {
      local: { get },
      onChanged: {
        addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => listeners.delete(listener),
      },
    },
  });
  setActiveConversationOwner(null);
});
afterEach(() => { vi.unstubAllGlobals(); setActiveConversationOwner(null); });

describe('account-scoped theme settings', () => {
  it('reads the selected account rather than a global theme', async () => {
    expect(await readThemeSettings('account-1')).toEqual(defaultTheme);
    expect(await readThemeSettings('account-2')).toEqual({ followChatGPT: false, manualTheme: 'light' });
  });

  it('writes only the selected account and publishes the matching preference', async () => {
    const changed = vi.fn();
    const unsubscribe = subscribeThemeSettings(changed, 'account-1');
    const next = { followChatGPT: false, manualTheme: 'light' as const };
    await writeThemeSettings(next, 'account-1');
    expect((values[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown }>)['account-1'].theme).toEqual(next);
    expect((values[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown }>)['account-2'].theme)
      .toEqual({ followChatGPT: false, manualTheme: 'light' });
    expect(changed).toHaveBeenCalledWith(next);
    unsubscribe();
  });

  it('refuses to write without a verified account', async () => {
    await expect(writeThemeSettings(defaultTheme)).rejects.toThrow('无法确认当前 ChatGPT 账号');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
