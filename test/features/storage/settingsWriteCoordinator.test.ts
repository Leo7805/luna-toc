import { describe, expect, it, vi } from 'vitest';
import { createSettingsWriteCoordinator, SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';

describe('background settings coordinator', () => {
  it('validates preferences and serializes them with the shared queue', async () => {
    const data: Record<string, unknown> = {};
    const get = vi.fn(async (key: string) => ({ [key]: data[key] }));
    const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); });
    const remove = vi.fn(async (key: string) => { delete data[key]; });
    const storage = { get, set, remove } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
    const queue = createSerialWriteQueue();
    const writer = createSettingsWriteCoordinator(storage, queue);
    const theme = { followChatGPT: false, manualTheme: 'light' as const };
    const sidebar = { layoutMode: 'side-by-side' as const, backgroundColor: 'blue' as const, revealTint: true };
    const results = await Promise.all([
      writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'theme', settings: theme, removeLegacy: true }),
      writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar', settings: sidebar }),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(data['chatToc:themeSettings']).toEqual(theme);
    expect(data['chatToc:sidebarPreferences']).toEqual(sidebar);
    expect(remove).toHaveBeenCalledWith('chatToc:theme');

    data['chatToc:themeSettings'] = { followChatGPT: true, manualTheme: 'dark' };
    expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'migrate-theme', settings: theme }))
      .toEqual({ ok: true });
    expect(data['chatToc:themeSettings']).toEqual({ followChatGPT: true, manualTheme: 'dark' });

    expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar', settings: { layoutMode: 'invalid' } }))
      .toEqual({ ok: false, error: 'Invalid settings update request' });
  });
  it('merges edits from stale tabs by field instead of overwriting unrelated preferences', async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, patch); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage);
    const commit = (patch: Record<string, unknown>, expected: Record<string, unknown>) =>
      writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch, expected });

    const first = await Promise.all([
      commit({ layoutMode: 'side-by-side' }, { layoutMode: 'overlay' }),
      commit({ backgroundColor: 'green' }, { backgroundColor: 'default' }),
      commit({ revealTint: true }, { revealTint: false }),
    ]);
    expect(first).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'green', revealTint: true,
    });

    expect(await commit({ backgroundColor: 'blue' }, { backgroundColor: 'green' })).toEqual({ ok: true });
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true,
    });

    expect((await commit({ revealTint: 'invalid' }, { revealTint: true })).ok).toBe(false);
    expect((await commit({ backgroundColor: 'unknown' }, { backgroundColor: 'blue' })).ok).toBe(false);
    expect((await commit({ layoutMode: 'overlay', extra: true }, { layoutMode: 'side-by-side', extra: false })).ok).toBe(false);
    expect((await commit({}, {})).ok).toBe(false);
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true,
    });
  });

  it('preserves the latest restored sidebar fields when a delayed patch reaches the worker', async () => {
    const values: Record<string, unknown> = {
      'chatToc:sidebarPreferences': {
        layoutMode: 'overlay', backgroundColor: 'yellow', revealTint: true,
      },
    };
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, patch); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const queue = createSerialWriteQueue();
    const writer = createSettingsWriteCoordinator(storage, queue);
    const response = await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch: { layoutMode: 'side-by-side' },
      expected: { layoutMode: 'overlay' },
    });
    expect(response).toEqual({ ok: true });
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'yellow', revealTint: true,
    });
  });

  it('rejects stale same-field edits from another tab without overwriting the accepted value', async () => {
    const data: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage, createSerialWriteQueue());
    const commit = (color: string, expected: string) =>
      writer.commit({
        type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch',
        patch: { backgroundColor: color }, expected: { backgroundColor: expected },
      });
    const results = await Promise.all([
      commit('blue', 'default'),
      commit('green', 'default'),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: false, conflict: true }]);
    expect(data['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'overlay', backgroundColor: 'blue', revealTint: false,
    });
    expect(storage.set).toHaveBeenCalledTimes(1);

    // A subsequent user action based on the refreshed value is accepted.
    expect(await commit('green', 'blue')).toEqual({ ok: true });
    expect((data['chatToc:sidebarPreferences'] as Record<string, unknown>).backgroundColor)
      .toBe('green');
  });

  it('keeps a multi-field patch entirely unchanged when one expected field is stale', async () => {
    const data: Record<string, unknown> = {
      'chatToc:sidebarPreferences': {
        layoutMode: 'overlay', backgroundColor: 'yellow', revealTint: true,
      },
    };
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage);
    const response = await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch',
      patch: { backgroundColor: 'blue', layoutMode: 'side-by-side' },
      expected: { backgroundColor: 'default', layoutMode: 'overlay' },
    });
    expect(response).toEqual({ ok: false, conflict: true });
    expect(data['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'overlay', backgroundColor: 'yellow', revealTint: true,
    });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('requires expected old values for every updated field and rejects malformed conditions', async () => {
    const data: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage);
    const invalid = [
      { patch: { backgroundColor: 'blue' } },
      { patch: { backgroundColor: 'blue' }, expected: {} },
      { patch: { backgroundColor: 'blue' }, expected: { backgroundColor: 'invalid' } },
      { patch: { backgroundColor: 'blue' }, expected: { backgroundColor: 'default', layoutMode: 'overlay' } },
    ];
    for (const fields of invalid) {
      expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ...fields }))
        .toEqual({ ok: false, error: 'Invalid settings update request' });
    }
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('does not permit legacy full-state writers to silently overwrite valid saved settings', async () => {
    const original = {
      layoutMode: 'overlay', backgroundColor: 'blue', revealTint: true,
    };
    const data: Record<string, unknown> = { 'chatToc:sidebarPreferences': original };
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage);
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar',
      settings: { ...original, backgroundColor: 'yellow' },
    })).toEqual({ ok: false, conflict: true });
    expect(data['chatToc:sidebarPreferences']).toEqual(original);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('rejects same-field updates when backup restore changed the persisted value first', async () => {
    const data: Record<string, unknown> = {
      'chatToc:sidebarPreferences': {
        layoutMode: 'overlay', backgroundColor: 'green', revealTint: false,
      },
    };
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
      remove: vi.fn(async () => {}),
    } as unknown as chrome.storage.StorageArea;
    const writer = createSettingsWriteCoordinator(storage);
    const response = await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch',
      patch: { backgroundColor: 'red' }, expected: { backgroundColor: 'blue' },
    });
    expect(response).toEqual({ ok: false, conflict: true });
    expect(data['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'overlay', backgroundColor: 'green', revealTint: false,
    });
    expect(storage.set).not.toHaveBeenCalled();
  });

});
