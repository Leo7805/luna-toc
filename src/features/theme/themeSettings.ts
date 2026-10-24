/** Defines and persists the LunaTOC theme preference. */

export type ResolvedTheme = 'dark' | 'light';

export interface ThemeSettings {
  followChatGPT: boolean;
  manualTheme: ResolvedTheme;
}

import { SETTINGS_COMMIT_TYPE, type SettingsCommitResponse } from '@/features/storage/settingsWriteCoordinator';

const SETTINGS_KEY = 'chatToc:themeSettings';
const LEGACY_THEME_KEY = 'chatToc:theme';
const DEFAULT_SETTINGS: ThemeSettings = {
  followChatGPT: true,
  manualTheme: 'dark',
};

/** Reads theme settings and migrates the previous string preference. */
export async function readThemeSettings(): Promise<ThemeSettings> {
  const result = await chrome.storage.local.get([
    SETTINGS_KEY,
    LEGACY_THEME_KEY,
  ]);
  const settings = normalizeThemeSettings(result[SETTINGS_KEY]);
  if (settings) {
    if (result[LEGACY_THEME_KEY] !== undefined) {
      await writeThemeSettings(settings, 'cleanup-legacy-theme');
    }
    return settings;
  }

  const legacyTheme = result[LEGACY_THEME_KEY];
  if (legacyTheme === 'dark' || legacyTheme === 'light') {
    const migratedSettings: ThemeSettings = {
      followChatGPT: false,
      manualTheme: legacyTheme,
    };
    await writeThemeSettings(migratedSettings, 'migrate-theme');
    return migratedSettings;
  }

  return { ...DEFAULT_SETTINGS };
}

/** Saves a complete theme preference. */
export async function writeThemeSettings(
  settings: ThemeSettings,
  mode: 'replace' | 'migrate-theme' | 'cleanup-legacy-theme' = 'replace'
): Promise<void> {
  if (!chrome.runtime?.id) throw new Error('Invalid extension context: theme setting not saved');
  const message = mode === 'cleanup-legacy-theme'
    ? { type: SETTINGS_COMMIT_TYPE, action: 'cleanup-legacy-theme' as const }
    : mode === 'migrate-theme'
      ? { type: SETTINGS_COMMIT_TYPE, action: 'migrate-theme' as const, settings }
      : { type: SETTINGS_COMMIT_TYPE, action: 'theme' as const, settings };
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: SettingsCommitResponse | undefined) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'Settings writer unavailable'));
      else if (response?.ok) resolve();
      else reject(new Error(response && 'error' in response ? response.error : 'Settings writer did not confirm the save'));
    });
  });
}

/** Subscribes to theme preference changes from any extension context. */
export function subscribeThemeSettings(
  listener: (settings: ThemeSettings) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    const settings = normalizeThemeSettings(changes[SETTINGS_KEY].newValue);
    if (settings) listener(settings);
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

function normalizeThemeSettings(value: unknown): ThemeSettings | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ThemeSettings>;
  if (
    typeof candidate.followChatGPT !== 'boolean' ||
    (candidate.manualTheme !== 'dark' && candidate.manualTheme !== 'light')
  ) {
    return null;
  }

  return {
    followChatGPT: candidate.followChatGPT,
    manualTheme: candidate.manualTheme,
  };
}
