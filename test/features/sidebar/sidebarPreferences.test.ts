/** Tests LunaTOC appearance/layout settings, validation and live updates. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_SETTINGS_KEY } from '@/features/storage/accountSettings';
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_COLORS,
  normalizeSidebarPreferences,
  readSidebarPreferences,
  sidebarAppearance,
  subscribeSidebarPreferences,
  writeSidebarPreferences,
} from '@/features/sidebar/sidebarPreferences';

const onChangedListeners = new Set<(changes: Record<string, any>, area: string) => void>();
const saved: Record<string, unknown> = {};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const get = vi.fn(async (key: string) => ({ [key]: clone(saved[key]) }));
const set = vi.fn(async (payload: Record<string, unknown>) => {
  Object.assign(saved, clone(payload));
  for (const listener of onChangedListeners) {
    listener(Object.fromEntries(Object.entries(payload).map(([k, v]) =>
      [k, { newValue: clone(v) }])
    ), 'local');
  }
});
const sendMessage = vi.fn((
  message: {
    action: string;
    ownerId?: string;
    patch?: Partial<import('@/features/sidebar/sidebarPreferences').SidebarPreferences>;
  },
  callback: (response: { ok: boolean; error?: string; conflict?: boolean }) => void
) => {
  if (message.action !== 'sidebar-patch' || !message.patch || !message.ownerId) {
    callback({ ok: false, error: 'unexpected message' });
    return;
  }
  const map = clone(saved[ACCOUNT_SETTINGS_KEY] as Record<string, { theme: unknown; sidebar: import('@/features/sidebar/sidebarPreferences').SidebarPreferences }>);
  const current = map[message.ownerId];
  if (!current) { callback({ ok: false, error: 'unknown account' }); return; }
  map[message.ownerId] = { ...current, sidebar: normalizeSidebarPreferences({ ...current.sidebar, ...message.patch }) };
  void set({ [ACCOUNT_SETTINGS_KEY]: map }).then(
    () => callback({ ok: true }),
    (error: unknown) => callback({ ok: false, error: error instanceof Error ? error.message : 'write failed' })
  );
});

beforeEach(() => {
  onChangedListeners.clear();
  for (const key of Object.keys(saved)) delete saved[key];
  saved[ACCOUNT_SETTINGS_KEY] = {
    'account-1': {
      theme: { followChatGPT: true, manualTheme: 'dark' },
      sidebar: { ...DEFAULT_SIDEBAR_PREFERENCES },
    },
    'account-2': {
      theme: { followChatGPT: false, manualTheme: 'light' },
      sidebar: { layoutMode: 'side-by-side', backgroundColor: 'green', revealTint: true },
    },
  };
  get.mockClear();
  set.mockClear();
  sendMessage.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', lastError: null, sendMessage },
    storage: {
      local: { get, set },
      onChanged: {
        addListener: (listener: any) => onChangedListeners.add(listener),
        removeListener: (listener: any) => onChangedListeners.delete(listener),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('sidebar preferences', () => {
  it('defaults to overlay, a transparent activation zone and the original tinted background', async () => {
    expect(await readSidebarPreferences('account-1')).toEqual(DEFAULT_SIDEBAR_PREFERENCES);
    expect(DEFAULT_SIDEBAR_PREFERENCES).toEqual({
      layoutMode: 'overlay',
      backgroundColor: 'default',
      revealTint: false,
    });
    expect(sidebarAppearance(DEFAULT_SIDEBAR_PREFERENCES, 'dark')).toEqual({
      background: null,
      header: null,
      reveal: 'transparent',
    });
  });

  it('validates unsupported settings while preserving valid fields', () => {
    expect(normalizeSidebarPreferences({
      layoutMode: 'side-by-side', backgroundColor: 'green', revealTint: true,
    })).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'green', revealTint: true,
    });
    expect(normalizeSidebarPreferences({
      layoutMode: 'invalid', backgroundColor: 'not-a-color', revealTint: 'on',
    })).toEqual(DEFAULT_SIDEBAR_PREFERENCES);
  });

  it('publishes persisted options changes and stops after unsubscribe', async () => {
    const notify = vi.fn();
    const unsubscribe = subscribeSidebarPreferences(notify, 'account-1');
    const update = { layoutMode: 'side-by-side' as const, backgroundColor: 'pink' as const, revealTint: true };
    await writeSidebarPreferences(update, 'account-1');
    expect((saved[ACCOUNT_SETTINGS_KEY] as Record<string, { sidebar: unknown }>)['account-1'].sidebar).toEqual(update);
    expect(await readSidebarPreferences('account-1')).toEqual(update);
    expect(notify).toHaveBeenCalledWith(update);
    unsubscribe();
    await writeSidebarPreferences(DEFAULT_SIDEBAR_PREFERENCES, 'account-1');
    expect(notify).toHaveBeenCalledTimes(1);
  });


  it('does not leak a sidebar change into another account', async () => {
    const before = clone((saved[ACCOUNT_SETTINGS_KEY] as Record<string, unknown>)['account-2']);
    await writeSidebarPreferences({ backgroundColor: 'pink' }, 'account-1');
    expect((saved[ACCOUNT_SETTINGS_KEY] as Record<string, unknown>)['account-2']).toEqual(before);
  });

  it('persists successive changes to the same field', async () => {
    await writeSidebarPreferences({ backgroundColor: 'blue' }, 'account-1');
    await writeSidebarPreferences({ backgroundColor: 'green' }, 'account-1');
    expect((await readSidebarPreferences('account-1')).backgroundColor).toBe('green');
    expect((saved[ACCOUNT_SETTINGS_KEY] as Record<string, { sidebar: { backgroundColor: string } }>)['account-1'].sidebar.backgroundColor).toBe('green');
  });
  it('generates theme-aware semi-transparent activation colors that follow the palette', () => {
    expect(SIDEBAR_COLORS.map((c) => c.id)).toEqual([
      'default', 'blue', 'green', 'yellow', 'pink', 'orange',
      'purple', 'red', 'cyan', 'lime', 'magenta',
    ]);
    const transparentTint = sidebarAppearance(
      { ...DEFAULT_SIDEBAR_PREFERENCES, revealTint: true }, 'dark'
    );
    expect(transparentTint.reveal).toBe('rgba(16, 24, 39, 0.42)');
    expect(sidebarAppearance(
      { ...DEFAULT_SIDEBAR_PREFERENCES, revealTint: true }, 'light'
    ).reveal).toBe('rgba(238, 245, 255, 0.42)');
    expect(SIDEBAR_COLORS[0]).toEqual({
      id: 'default', label: '默认', hex: '#8b93a7',
    });
    const selected = { layoutMode: 'side-by-side' as const, backgroundColor: 'orange' as const, revealTint: true };
    const light = sidebarAppearance(selected, 'light');
    const dark = sidebarAppearance(selected, 'dark');
    expect(light.background).toMatch(/^rgba\(\d+, \d+, \d+, 0\.94\)$/);
    expect(dark.background).not.toBe(light.background);
    expect(light.header).not.toBe(light.background);
    expect(light.reveal).toBe('rgba(233, 150, 86, 0.42)');
    expect(sidebarAppearance({ ...selected, revealTint: false }, 'dark').reveal).toBe('transparent');
  });
});
