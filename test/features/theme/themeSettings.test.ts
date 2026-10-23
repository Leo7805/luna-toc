/** Tests legacy preference migration through the background writer. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readThemeSettings } from '@/features/theme/themeSettings';

const values: Record<string, unknown> = {};
const remove = vi.fn(async (key: string) => { delete values[key]; });
const sendMessage = vi.fn((message: { action: string; settings?: unknown; removeLegacy?: boolean },
  callback: (response: { ok: boolean; error?: string }) => void) => {
  if (message.action === 'theme' && message.settings) {
    values['chatToc:themeSettings'] = message.settings;
    if (message.removeLegacy) void remove('chatToc:theme');
  } else if (message.action === 'cleanup-legacy-theme') {
    void remove('chatToc:theme');
  } else if (message.action === 'migrate-theme' && message.settings) {
    if (!values['chatToc:themeSettings']) values['chatToc:themeSettings'] = message.settings;
    void remove('chatToc:theme');
  } else {
    callback({ ok: false, error: 'unexpected message' }); return;
  }
  callback({ ok: true });
});
beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  remove.mockClear();
  sendMessage.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', lastError: null, sendMessage },
    storage: { local: {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(values, updates); }),
      remove,
    } },
  });
});

describe('theme settings migration', () => {
  it('writes the replacement key before cleaning a legacy setting', async () => {
    values['chatToc:theme'] = 'light';
    expect(await readThemeSettings()).toEqual({ followChatGPT: false, manualTheme: 'light' });
    expect(values['chatToc:theme']).toBeUndefined();
    expect(values['chatToc:themeSettings']).toEqual({ followChatGPT: false, manualTheme: 'light' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it('cleans an obsolete key even when current settings are already valid', async () => {
    values['chatToc:themeSettings'] = { followChatGPT: true, manualTheme: 'dark' };
    values['chatToc:theme'] = 'light';
    expect(await readThemeSettings()).toEqual({ followChatGPT: true, manualTheme: 'dark' });
    expect(remove).toHaveBeenCalledWith('chatToc:theme');
  });
});
