/** Tests removal of obsolete preference keys after theme migration. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readThemeSettings } from '@/features/theme/themeSettings';

const values: Record<string, unknown> = {};
const remove = vi.fn(async (key: string) => { delete values[key]; });
beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  remove.mockClear();
  vi.stubGlobal('chrome', {
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
    expect(await readThemeSettings()).toEqual({
      followChatGPT: false, manualTheme: 'light',
    });
    expect(values['chatToc:theme']).toBeUndefined();
    expect(values['chatToc:themeSettings']).toEqual({
      followChatGPT: false, manualTheme: 'light',
    });
  });

  it('cleans an obsolete key even when current settings are already valid', async () => {
    values['chatToc:themeSettings'] = { followChatGPT: true, manualTheme: 'dark' };
    values['chatToc:theme'] = 'light';
    expect(await readThemeSettings()).toEqual({ followChatGPT: true, manualTheme: 'dark' });
    expect(remove).toHaveBeenCalledWith('chatToc:theme');
  });
});
