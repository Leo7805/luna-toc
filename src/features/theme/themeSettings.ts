/** Defines and persists the LunaTOC theme preference. */

export type ResolvedTheme = 'dark' | 'light';

export interface ThemeSettings {
  followChatGPT: boolean;
  manualTheme: ResolvedTheme;
}

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
  if (settings) return settings;

  const legacyTheme = result[LEGACY_THEME_KEY];
  if (legacyTheme === 'dark' || legacyTheme === 'light') {
    const migratedSettings: ThemeSettings = {
      followChatGPT: false,
      manualTheme: legacyTheme,
    };
    await writeThemeSettings(migratedSettings);
    return migratedSettings;
  }

  return { ...DEFAULT_SETTINGS };
}

/** Saves a complete theme preference. */
export async function writeThemeSettings(
  settings: ThemeSettings
): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
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
