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
    const commit = (patch: Record<string, unknown>) =>
      writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch });

    const first = await Promise.all([
      commit({ layoutMode: 'side-by-side' }),
      commit({ backgroundColor: 'green' }),
      commit({ revealTint: true }),
    ]);
    expect(first).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'green', revealTint: true,
    });

    expect(await commit({ backgroundColor: 'blue' })).toEqual({ ok: true });
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true,
    });

    expect((await commit({ revealTint: 'invalid' })).ok).toBe(false);
    expect((await commit({ backgroundColor: 'unknown' })).ok).toBe(false);
    expect((await commit({ layoutMode: 'overlay', extra: true })).ok).toBe(false);
    expect((await commit({})).ok).toBe(false);
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
    });
    expect(response).toEqual({ ok: true });
    expect(values['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'yellow', revealTint: true,
    });
  });

});
