import { describe, expect, it, vi } from 'vitest';
import { createSettingsWriteCoordinator, SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import { ACCOUNT_EMAILS_KEY, ACCOUNT_SETTINGS_KEY } from '@/features/storage/accountSettings';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';

const MIGRATION_KEY = 'chatToc:accountSettings:migrated:v1';
const DEFAULT_THEME = { followChatGPT: true, manualTheme: 'dark' as const };
const DEFAULT_SIDEBAR = { layoutMode: 'overlay' as const, backgroundColor: 'default' as const, revealTint: false };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function backing(initial: Record<string, unknown> = {}) {
  const data = clone(initial);
  const get = vi.fn(async (keys?: string | string[] | null) => {
    if (keys === undefined || keys === null) return clone(data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(list.filter((key) => Object.hasOwn(data, key))
      .map((key) => [key, data[key]])));
  });
  const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, clone(values)); });
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
  });
  return { data, get, set, remove,
    storage: { get, set, remove } as unknown as chrome.storage.StorageArea };
}

describe('account-scoped background settings writer', () => {
  it('migrates legacy global preferences to every account already represented in local data', async () => {
    const legacyTheme = { followChatGPT: false, manualTheme: 'light' as const };
    const legacySidebar = { layoutMode: 'side-by-side' as const, backgroundColor: 'green' as const, revealTint: true };
    const box = backing({
      'chatToc:themeSettings': legacyTheme,
      'chatToc:sidebarPreferences': legacySidebar,
      'lumaToc:myPromptsV1': [{ ownerId: 'account-2' }],
      'chatToc:aliases:v1:conversation-123': { ownerId: 'account-3', aliases: {} },
    });
    const writer = createSettingsWriteCoordinator(box.storage, createSerialWriteQueue());
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1',
    })).toEqual({ ok: true });
    expect(box.data[ACCOUNT_SETTINGS_KEY]).toEqual({
      'account-1': { theme: legacyTheme, sidebar: legacySidebar },
      'account-2': { theme: legacyTheme, sidebar: legacySidebar },
      'account-3': { theme: legacyTheme, sidebar: legacySidebar },
    });
    expect(box.data[MIGRATION_KEY]).toBe(true);
    expect(box.data['chatToc:themeSettings']).toBeUndefined();
    expect(box.data['chatToc:sidebarPreferences']).toBeUndefined();
  });

  it('stores a verified account email separately without resetting preferences', async () => {
    const box = backing({ [MIGRATION_KEY]: true, [ACCOUNT_SETTINGS_KEY]: {
      'account-1': {
        theme: { followChatGPT: false, manualTheme: 'light' },
        sidebar: { ...DEFAULT_SIDEBAR },
      },
    } });
    const writer = createSettingsWriteCoordinator(box.storage, createSerialWriteQueue());

    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account',
      ownerId: 'account-1', email: 'user@example.com',
    })).toEqual({ ok: true });
    expect(box.data[ACCOUNT_EMAILS_KEY]).toEqual({ 'account-1': 'user@example.com' });
    expect(box.data[ACCOUNT_SETTINGS_KEY]).toEqual({
      'account-1': {
        theme: { followChatGPT: false, manualTheme: 'light' },
        sidebar: { ...DEFAULT_SIDEBAR },
      },
    });

    box.set.mockClear();
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account',
      ownerId: 'account-1', email: 'not-an-email',
    })).toMatchObject({ ok: false });
    expect(box.set).not.toHaveBeenCalled();
  });

  it('updates one account theme without changing another account', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1' });
    await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-2' });
    const nextTheme = { followChatGPT: false, manualTheme: 'light' as const };
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'theme', ownerId: 'account-1', settings: nextTheme,
    })).toEqual({ ok: true });
    const map = box.data[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown; sidebar: unknown }>;
    expect(map['account-1'].theme).toEqual(nextTheme);
    expect(map['account-2'].theme).toEqual(DEFAULT_THEME);
    expect(map['account-2'].sidebar).toEqual(DEFAULT_SIDEBAR);
  });

  it('merges sequential sidebar patches and preserves the account theme', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1' });
    for (const patch of [
      { layoutMode: 'side-by-side' }, { backgroundColor: 'green' }, { revealTint: true },
      { backgroundColor: 'blue' },
    ]) {
      expect(await writer.commit({
        type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ownerId: 'account-1', patch,
      })).toEqual({ ok: true });
    }
    const record = (box.data[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown; sidebar: unknown }>)['account-1'];
    expect(record.sidebar).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true,
    });
    expect(record.theme).toEqual(DEFAULT_THEME);
  });

  it('rejects invalid patches and writes to unregistered accounts', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1' });
    box.set.mockClear();
    for (const patch of [{}, { backgroundColor: 'invalid' }, { revealTint: 1 }, { extra: true }]) {
      expect(await writer.commit({
        type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ownerId: 'account-1', patch,
      })).toEqual({ ok: false, error: 'Invalid settings update request' });
    }
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ownerId: 'unknown-account',
      patch: { backgroundColor: 'red' },
    })).toMatchObject({ ok: false });
    expect(box.set).not.toHaveBeenCalled();
  });

  it('rolls back a failed settings write and permits retry', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1' });
    const original = clone(box.data[ACCOUNT_SETTINGS_KEY]);
    box.set.mockRejectedValueOnce(new Error('quota exceeded'));
    const request = {
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ownerId: 'account-1',
      patch: { backgroundColor: 'red' },
    };
    expect(await writer.commit(request)).toMatchObject({ ok: false, error: expect.stringContaining('原有设置已恢复') });
    expect(box.data[ACCOUNT_SETTINGS_KEY]).toEqual(original);
    expect(await writer.commit(request)).toEqual({ ok: true });
    expect((box.data[ACCOUNT_SETTINGS_KEY] as Record<string, { sidebar: { backgroundColor: string } }>)['account-1'].sidebar.backgroundColor)
      .toBe('red');
  });

  it('refuses to overwrite malformed persisted account settings', async () => {
    const box = backing({ [ACCOUNT_SETTINGS_KEY]: { 'account-1': { theme: 'broken', sidebar: {} } } });
    const original = clone(box.data);
    const writer = createSettingsWriteCoordinator(box.storage);
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'register-account', ownerId: 'account-1',
    })).toMatchObject({ ok: false });
    expect(box.data).toEqual(original);
    expect(box.set).not.toHaveBeenCalled();
  });
});
