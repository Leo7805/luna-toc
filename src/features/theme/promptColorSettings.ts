/**
 * Defines, persists, and synchronizes LunaTOC prompt colour preferences.
 * Authoritative single source of preset definitions for both sidebar CSS and options UI.
 */

export type FavouriteColorPreset =
  | 'original'
  | 'amber'
  | 'blue'
  | 'mint'
  | 'purple';

export type RenamedColorPreset =
  | 'original'
  | 'coral'
  | 'rose'
  | 'olive'
  | 'terracotta'
  | 'graphite';

export interface PromptColorSettings {
  favouriteColor: FavouriteColorPreset;
  renamedColor: RenamedColorPreset;
}

export interface FavouritePresetDefinition {
  id: FavouriteColorPreset;
  label: string;
  light: {
    bgItemMarked: string;
    textItemMarked: string;
    flagColor: string;
    flagHover: string;
  };
  dark: {
    bgItemMarked: string;
    textItemMarked: string;
    flagColor: string;
    flagHover: string;
  };
}

export interface RenamedPresetDefinition {
  id: RenamedColorPreset;
  label: string;
  light: {
    textCustomTitle: string;
    textCustomTitleActive: string;
  };
  dark: {
    textCustomTitle: string;
    textCustomTitleActive: string;
  };
}

export const FAVOURITE_COLOR_PRESETS: readonly FavouritePresetDefinition[] = [
  {
    id: 'original',
    label: 'Original',
    light: {
      bgItemMarked: 'rgba(217, 165, 20, 0.1)',
      textItemMarked: '#8a6708',
      flagColor: '#d9a514',
      flagHover: '#c2930e',
    },
    dark: {
      bgItemMarked: 'rgba(234, 179, 8, 0.12)',
      textItemMarked: '#fde68a',
      flagColor: '#f0c341',
      flagHover: '#f6cf5a',
    },
  },
  {
    id: 'amber',
    label: 'Amber',
    light: {
      bgItemMarked: '#fff3d9',
      textItemMarked: '#8a5a05',
      flagColor: '#dea500',
      flagHover: '#b58000',
    },
    dark: {
      bgItemMarked: '#2a1d08',
      textItemMarked: '#fde68a',
      flagColor: '#f59e0b',
      flagHover: '#fbbf24',
    },
  },
  {
    id: 'blue',
    label: 'Blue',
    light: {
      bgItemMarked: '#e8f2ff',
      textItemMarked: '#285b9a',
      flagColor: '#4386e8',
      flagHover: '#2563eb',
    },
    dark: {
      bgItemMarked: '#0d1e36',
      textItemMarked: '#bae6fd',
      flagColor: '#38bdf8',
      flagHover: '#7dd3fc',
    },
  },
  {
    id: 'mint',
    label: 'Mint',
    light: {
      bgItemMarked: '#e7f5ed',
      textItemMarked: '#23694d',
      flagColor: '#2ca878',
      flagHover: '#1e7b57',
    },
    dark: {
      bgItemMarked: '#0b2418',
      textItemMarked: '#a7f3d0',
      flagColor: '#34d399',
      flagHover: '#6ee7b7',
    },
  },
  {
    id: 'purple',
    label: 'Purple',
    light: {
      bgItemMarked: '#f1ebfc',
      textItemMarked: '#67449b',
      flagColor: '#9671d8',
      flagHover: '#7c4dcc',
    },
    dark: {
      bgItemMarked: '#221338',
      textItemMarked: '#ddd6fe',
      flagColor: '#a78bfa',
      flagHover: '#c4b5fd',
    },
  },
] as const;

export const RENAMED_COLOR_PRESETS: readonly RenamedPresetDefinition[] = [
  {
    id: 'original',
    label: 'Original',
    light: {
      textCustomTitle: '#4f46e5',
      textCustomTitleActive: '#4338ca',
    },
    dark: {
      textCustomTitle: '#a5b4fc',
      textCustomTitleActive: '#c7d2fe',
    },
  },
  {
    id: 'coral',
    label: 'Coral',
    light: {
      textCustomTitle: '#bc5147',
      textCustomTitleActive: '#9b3d34',
    },
    dark: {
      textCustomTitle: '#f87171',
      textCustomTitleActive: '#fca5a5',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    light: {
      textCustomTitle: '#b84370',
      textCustomTitleActive: '#942b54',
    },
    dark: {
      textCustomTitle: '#f472b6',
      textCustomTitleActive: '#f9a8d4',
    },
  },
  {
    id: 'olive',
    label: 'Olive',
    light: {
      textCustomTitle: '#657a35',
      textCustomTitleActive: '#4e5f28',
    },
    dark: {
      textCustomTitle: '#a3e635',
      textCustomTitleActive: '#bef264',
    },
  },
  {
    id: 'terracotta',
    label: 'Terracotta',
    light: {
      textCustomTitle: '#a45337',
      textCustomTitleActive: '#843c24',
    },
    dark: {
      textCustomTitle: '#fb923c',
      textCustomTitleActive: '#fdba74',
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    light: {
      textCustomTitle: '#566276',
      textCustomTitleActive: '#3d4655',
    },
    dark: {
      textCustomTitle: '#94a3b8',
      textCustomTitleActive: '#cbd5e1',
    },
  },
] as const;

export const DEFAULT_PROMPT_COLOR_SETTINGS: PromptColorSettings = {
  favouriteColor: 'original',
  renamedColor: 'original',
};

export const FAVOURITE_COLOR_KEY = 'chatToc:favouriteColor';
export const RENAMED_COLOR_KEY = 'chatToc:renamedColor';

const VALID_FAVOURITE_IDS = new Set<string>(
  FAVOURITE_COLOR_PRESETS.map((p) => p.id)
);
const VALID_RENAMED_IDS = new Set<string>(
  RENAMED_COLOR_PRESETS.map((p) => p.id)
);

/**
 * Normalizes an unknown value to a valid FavouriteColorPreset.
 * Falls back to 'original' if the value is invalid or unset.
 */
export function normalizeFavouriteColor(value: unknown): FavouriteColorPreset {
  if (typeof value === 'string' && VALID_FAVOURITE_IDS.has(value)) {
    return value as FavouriteColorPreset;
  }
  return DEFAULT_PROMPT_COLOR_SETTINGS.favouriteColor;
}

/**
 * Normalizes an unknown value to a valid RenamedColorPreset.
 * Falls back to 'original' if the value is invalid or unset.
 */
export function normalizeRenamedColor(value: unknown): RenamedColorPreset {
  if (typeof value === 'string' && VALID_RENAMED_IDS.has(value)) {
    return value as RenamedColorPreset;
  }
  return DEFAULT_PROMPT_COLOR_SETTINGS.renamedColor;
}

/**
 * Normalizes an unknown object to complete PromptColorSettings.
 */
export function normalizePromptColorSettings(
  value: unknown
): PromptColorSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PROMPT_COLOR_SETTINGS };
  }
  const candidate = value as Partial<PromptColorSettings>;
  return {
    favouriteColor: normalizeFavouriteColor(candidate.favouriteColor),
    renamedColor: normalizeRenamedColor(candidate.renamedColor),
  };
}

/**
 * Reads Favourite Colour directly from its dedicated storage key.
 */
export async function readFavouriteColor(): Promise<FavouriteColorPreset> {
  const result = await chrome.storage.local.get(FAVOURITE_COLOR_KEY);
  return normalizeFavouriteColor(result[FAVOURITE_COLOR_KEY]);
}

/**
 * Writes Favourite Colour directly to its dedicated storage key.
 */
export async function writeFavouriteColor(
  color: FavouriteColorPreset
): Promise<void> {
  await chrome.storage.local.set({
    [FAVOURITE_COLOR_KEY]: normalizeFavouriteColor(color),
  });
}

/**
 * Reads Renamed Colour directly from its dedicated storage key.
 */
export async function readRenamedColor(): Promise<RenamedColorPreset> {
  const result = await chrome.storage.local.get(RENAMED_COLOR_KEY);
  return normalizeRenamedColor(result[RENAMED_COLOR_KEY]);
}

/**
 * Writes Renamed Colour directly to its dedicated storage key.
 */
export async function writeRenamedColor(
  color: RenamedColorPreset
): Promise<void> {
  await chrome.storage.local.set({
    [RENAMED_COLOR_KEY]: normalizeRenamedColor(color),
  });
}

/**
 * Reads both colour preferences from their independent storage keys.
 */
export async function readPromptColorSettings(): Promise<PromptColorSettings> {
  const result = await chrome.storage.local.get([
    FAVOURITE_COLOR_KEY,
    RENAMED_COLOR_KEY,
  ]);
  return {
    favouriteColor: normalizeFavouriteColor(result[FAVOURITE_COLOR_KEY]),
    renamedColor: normalizeRenamedColor(result[RENAMED_COLOR_KEY]),
  };
}

/**
 * Subscribes to changes on the Favourite Colour storage key.
 */
export function subscribeFavouriteColor(
  listener: (color: FavouriteColorPreset) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !(FAVOURITE_COLOR_KEY in changes)) return;
    listener(normalizeFavouriteColor(changes[FAVOURITE_COLOR_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

/**
 * Subscribes to changes on the Renamed Colour storage key.
 */
export function subscribeRenamedColor(
  listener: (color: RenamedColorPreset) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !(RENAMED_COLOR_KEY in changes)) return;
    listener(normalizeRenamedColor(changes[RENAMED_COLOR_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

export interface PromptColorChangePatch {
  favouriteColor?: FavouriteColorPreset;
  renamedColor?: RenamedColorPreset;
}

/**
 * Subscribes to changes on either colour key for aggregate consumers (e.g. sidebar).
 */
export function subscribePromptColorSettings(
  listener: (patch: PromptColorChangePatch) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local') return;
    const patch: PromptColorChangePatch = {};
    if (FAVOURITE_COLOR_KEY in changes) {
      patch.favouriteColor = normalizeFavouriteColor(
        changes[FAVOURITE_COLOR_KEY].newValue
      );
    }
    if (RENAMED_COLOR_KEY in changes) {
      patch.renamedColor = normalizeRenamedColor(
        changes[RENAMED_COLOR_KEY].newValue
      );
    }
    if (patch.favouriteColor !== undefined || patch.renamedColor !== undefined) {
      listener(patch);
    }
  };
  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

/**
 * Generates dynamic CSS rules for active prompt colour presets.
 * Returns empty string if both presets are 'original' (preserving baseline content.css tokens).
 */
export function generatePromptColorCss(settings: PromptColorSettings): string {
  const fav = FAVOURITE_COLOR_PRESETS.find(
    (p) => p.id === settings.favouriteColor
  );
  const ren = RENAMED_COLOR_PRESETS.find((p) => p.id === settings.renamedColor);

  const rules: string[] = [];

  if (fav && fav.id !== 'original') {
    rules.push(`
html[data-lunatoc-theme='light'] {
  --ct-bg-item-marked: ${fav.light.bgItemMarked};
  --ct-text-item-marked: ${fav.light.textItemMarked};
  --ct-flag-color: ${fav.light.flagColor};
  --ct-flag-hover: ${fav.light.flagHover};
}
html[data-lunatoc-theme='dark'] {
  --ct-bg-item-marked: ${fav.dark.bgItemMarked};
  --ct-text-item-marked: ${fav.dark.textItemMarked};
  --ct-flag-color: ${fav.dark.flagColor};
  --ct-flag-hover: ${fav.dark.flagHover};
}`);
  }

  if (ren && ren.id !== 'original') {
    rules.push(`
html[data-lunatoc-theme='light'] {
  --ct-text-custom-title: ${ren.light.textCustomTitle};
  --ct-text-custom-title-active: ${ren.light.textCustomTitleActive};
}
html[data-lunatoc-theme='dark'] {
  --ct-text-custom-title: ${ren.dark.textCustomTitle};
  --ct-text-custom-title-active: ${ren.dark.textCustomTitleActive};
}`);
  }

  return rules.join('\n');
}

export const PROMPT_COLOR_STYLE_ELEMENT_ID = 'luna-toc-prompt-color-styles';

/**
 * Injects or updates the dynamic prompt colour stylesheet in document.head.
 */
export function applyPromptColorStyles(settings: PromptColorSettings): void {
  const css = generatePromptColorCss(settings);
  let styleEl = document.getElementById(
    PROMPT_COLOR_STYLE_ELEMENT_ID
  ) as HTMLStyleElement | null;

  if (!css) {
    styleEl?.remove();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PROMPT_COLOR_STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = css;
}
