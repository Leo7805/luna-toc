import { describe, expect, it, vi } from 'vitest';
import { createSettingsWriteCoordinator, SETTINGS_COMMIT_TYPE } from '@/features/storage/settingsWriteCoordinator';
import { createSerialWriteQueue } from '@/features/storage/serialWriteQueue';

describe('single-tab background settings writer', () => {
  function backing(initial: Record<string, unknown> = {}) {
    const data = { ...initial };
    const get = vi.fn(async (key: string) => ({ [key]: data[key] }));
    const set = vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); });
    const remove = vi.fn(async (key: string) => { delete data[key]; });
    return { data, get, set, remove,
      storage: { get, set, remove } as unknown as chrome.storage.StorageArea };
  }

  it('validates and saves theme settings', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage, createSerialWriteQueue());
    const theme = { followChatGPT: false, manualTheme: 'light' as const };
    expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'theme', settings: theme, removeLegacy: true }))
      .toEqual({ ok: true });
    expect(box.data['chatToc:themeSettings']).toEqual(theme);
    expect(box.remove).toHaveBeenCalledWith('chatToc:theme');
  });

  it('merges sequential field patches without overwriting unrelated settings', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    for (const patch of [
      { layoutMode: 'side-by-side' }, { backgroundColor: 'green' }, { revealTint: true },
      { backgroundColor: 'blue' },
    ]) {
      expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch }))
        .toEqual({ ok: true });
    }
    expect(box.data['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'blue', revealTint: true,
    });
  });

  it('preserves unrelated restored fields when patching a preference', async () => {
    const box = backing({ 'chatToc:sidebarPreferences': {
      layoutMode: 'overlay', backgroundColor: 'yellow', revealTint: true,
    } });
    const writer = createSettingsWriteCoordinator(box.storage);
    expect(await writer.commit({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch: { layoutMode: 'side-by-side' },
    })).toEqual({ ok: true });
    expect(box.data['chatToc:sidebarPreferences']).toEqual({
      layoutMode: 'side-by-side', backgroundColor: 'yellow', revealTint: true,
    });
  });

  it('rejects invalid patches before saving', async () => {
    const box = backing();
    const writer = createSettingsWriteCoordinator(box.storage);
    for (const patch of [{}, { backgroundColor: 'invalid' }, { revealTint: 1 }, { extra: true }]) {
      expect(await writer.commit({ type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch }))
        .toEqual({ ok: false, error: 'Invalid settings update request' });
    }
    expect(box.set).not.toHaveBeenCalled();
  });

  it('reports write failures and permits later retry', async () => {
    const box = backing();
    box.set.mockRejectedValueOnce(new Error('quota exceeded'));
    const writer = createSettingsWriteCoordinator(box.storage);
    const request = { type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', patch: { backgroundColor: 'red' } };
    expect(await writer.commit(request)).toEqual({ ok: false, error: 'quota exceeded' });
    expect(await writer.commit(request)).toEqual({ ok: true });
    expect((box.data['chatToc:sidebarPreferences'] as { backgroundColor: string }).backgroundColor)
      .toBe('red');
  });
});
