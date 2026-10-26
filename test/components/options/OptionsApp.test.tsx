/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionsApp } from '@/components/options/OptionsApp';
import { ACCOUNT_EMAILS_KEY, ACCOUNT_SETTINGS_KEY } from '@/features/storage/accountSettings';
import {
  DEFAULT_SIDEBAR_PREFERENCES,
} from '@/features/sidebar/sidebarPreferences';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock('@/features/sidebar/sidebarPreferences', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/sidebar/sidebarPreferences')>();
  return {
    ...real,
    readSidebarPreferences: mocks.read,
    writeSidebarPreferences: mocks.write,
    subscribeSidebarPreferences: mocks.subscribe,
  };
});
vi.mock('@/components/options/LocalBackupSettings', () => ({
  LocalBackupSettings: () => null,
}));
vi.mock('@/components/options/LocalAliasCleanupSettings', () => ({
  LocalAliasCleanupSettings: () => null,
}));
vi.mock('@/config/config', () => ({
  loadPlatformRuntimeConfig: vi.fn(async () => ({
    useLocalConfig: false, showCompatibilityAlert: false,
  })),
  savePlatformRuntimeConfig: vi.fn(async () => {}),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: vi.fn(async (key: string | string[]) => {
        const data: Record<string, unknown> = {
          [ACCOUNT_SETTINGS_KEY]: {
            'account-1': {
              theme: { followChatGPT: true, manualTheme: 'dark' },
              sidebar: { ...DEFAULT_SIDEBAR_PREFERENCES },
            },
          },
          [ACCOUNT_EMAILS_KEY]: { 'account-1': 'user@example.com' },
        };
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(keys.filter((item) => Object.hasOwn(data, item))
          .map((item) => [item, data[item]]));
      }) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mocks.read.mockReset().mockResolvedValue({ ...DEFAULT_SIDEBAR_PREFERENCES });
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.subscribe.mockReset().mockReturnValue(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => root.render(<OptionsApp />));
}
function colorInput(value: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(
    `input[name="sidebar-color"][value="${value}"]`
  );
  if (!input) throw new Error('Missing color control: ' + value);
  return input;
}

describe('Options sidebar save handling', () => {
  it('displays the verified account email as the account label', async () => {
    await render();
    const selector = host.querySelector<HTMLSelectElement>('.settings-account-select');
    expect(selector?.selectedOptions[0]?.textContent?.trim()).toBe('user@example.com');
  });

  it('shows a save failure, refreshes and allows retry', async () => {
    const newer = { ...DEFAULT_SIDEBAR_PREFERENCES, backgroundColor: 'green' as const };
    mocks.read.mockResolvedValueOnce({ ...DEFAULT_SIDEBAR_PREFERENCES })
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce({ ...newer, backgroundColor: 'blue' });
    mocks.write.mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValueOnce(undefined);
    await render();

    await act(async () => colorInput('blue').click());
    expect(mocks.write).toHaveBeenNthCalledWith(1,
      { backgroundColor: 'blue' }, 'account-1');
    expect(host.textContent).toContain('设置保存失败');
    expect(colorInput('green').checked).toBe(true);

    await act(async () => colorInput('blue').click());
    expect(mocks.write).toHaveBeenNthCalledWith(2,
      { backgroundColor: 'blue' }, 'account-1');
    expect(colorInput('blue').checked).toBe(true);
  });

  it('disables inputs while a save is pending to avoid duplicate submissions', async () => {
    let finishSave!: () => void;
    mocks.write.mockReturnValueOnce(new Promise<void>((resolve) => { finishSave = resolve; }));
    await render();

    await act(async () => colorInput('blue').click());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(colorInput('green').disabled).toBe(true);
    expect(host.textContent).toContain('正在保存侧边栏设置');

    await act(async () => { finishSave(); });
    expect(colorInput('green').disabled).toBe(false);
  });
});
