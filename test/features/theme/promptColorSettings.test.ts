/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore
import fs from 'node:fs';
// @ts-ignore
import path from 'node:path';
import {
  DEFAULT_PROMPT_COLOR_SETTINGS,
  FAVOURITE_COLOR_KEY,
  FAVOURITE_COLOR_PRESETS,
  PROMPT_COLOR_STYLE_ELEMENT_ID,
  RENAMED_COLOR_KEY,
  RENAMED_COLOR_PRESETS,
  applyPromptColorStyles,
  generatePromptColorCss,
  normalizeFavouriteColor,
  normalizePromptColorSettings,
  normalizeRenamedColor,
  readFavouriteColor,
  readPromptColorSettings,
  readRenamedColor,
  subscribeFavouriteColor,
  subscribePromptColorSettings,
  subscribeRenamedColor,
  writeFavouriteColor,
  writeRenamedColor,
  type FavouriteColorPreset,
  type PromptColorSettings,
  type RenamedColorPreset,
} from '@/features/theme/promptColorSettings';

const storageMap = new Map<string, unknown>();
type StorageChangeHandler = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;
const storageListeners = new Set<StorageChangeHandler>();

beforeEach(() => {
  storageMap.clear();
  storageListeners.clear();
  document.head.innerHTML = '';

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          if (typeof key === 'string') {
            return { [key]: storageMap.get(key) };
          }
          const result: Record<string, unknown> = {};
          for (const k of key) {
            result[k] = storageMap.get(k);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            const oldValue = storageMap.get(k);
            storageMap.set(k, v);
            for (const listener of storageListeners) {
              listener({ [k]: { oldValue, newValue: v } }, 'local');
            }
          }
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: StorageChangeHandler) => {
          storageListeners.add(listener);
        }),
        removeListener: vi.fn((listener: StorageChangeHandler) => {
          storageListeners.delete(listener);
        }),
      },
    },
  });
});

describe('promptColorSettings normalization', () => {
  it('normalizes favourite colours safely and falls back to original', () => {
    expect(normalizeFavouriteColor('amber')).toBe('amber');
    expect(normalizeFavouriteColor('blue')).toBe('blue');
    expect(normalizeFavouriteColor('mint')).toBe('mint');
    expect(normalizeFavouriteColor('purple')).toBe('purple');
    expect(normalizeFavouriteColor('original')).toBe('original');

    expect(normalizeFavouriteColor(null)).toBe('original');
    expect(normalizeFavouriteColor(undefined)).toBe('original');
    expect(normalizeFavouriteColor('unknown-preset')).toBe('original');
    expect(normalizeFavouriteColor(123)).toBe('original');
  });

  it('normalizes renamed colours safely and falls back to original', () => {
    expect(normalizeRenamedColor('coral')).toBe('coral');
    expect(normalizeRenamedColor('rose')).toBe('rose');
    expect(normalizeRenamedColor('olive')).toBe('olive');
    expect(normalizeRenamedColor('terracotta')).toBe('terracotta');
    expect(normalizeRenamedColor('graphite')).toBe('graphite');
    expect(normalizeRenamedColor('original')).toBe('original');

    expect(normalizeRenamedColor(null)).toBe('original');
    expect(normalizeRenamedColor(undefined)).toBe('original');
    expect(normalizeRenamedColor('nonexistent')).toBe('original');
  });

  it('normalizes complete settings object', () => {
    expect(normalizePromptColorSettings(null)).toEqual(
      DEFAULT_PROMPT_COLOR_SETTINGS
    );
    expect(
      normalizePromptColorSettings({
        favouriteColor: 'amber',
        renamedColor: 'rose',
      })
    ).toEqual({
      favouriteColor: 'amber',
      renamedColor: 'rose',
    });
    expect(
      normalizePromptColorSettings({
        favouriteColor: 'bad-fav',
        renamedColor: 'coral',
      })
    ).toEqual({
      favouriteColor: 'original',
      renamedColor: 'coral',
    });
  });
});

describe('independent storage keys and operations', () => {
  it('reads default settings when storage keys are empty', async () => {
    expect(await readFavouriteColor()).toBe('original');
    expect(await readRenamedColor()).toBe('original');
    expect(await readPromptColorSettings()).toEqual({
      favouriteColor: 'original',
      renamedColor: 'original',
    });
  });

  it('writes and reads favourite colour independently without mutating renamed colour', async () => {
    await writeFavouriteColor('amber');
    expect(await readFavouriteColor()).toBe('amber');
    expect(await readRenamedColor()).toBe('original');

    const combined = await readPromptColorSettings();
    expect(combined).toEqual({
      favouriteColor: 'amber',
      renamedColor: 'original',
    });
  });

  it('writes and reads renamed colour independently without mutating favourite colour', async () => {
    await writeFavouriteColor('blue');
    await writeRenamedColor('coral');

    expect(await readFavouriteColor()).toBe('blue');
    expect(await readRenamedColor()).toBe('coral');

    // Updating renamed colour does not touch favourite colour key
    await writeRenamedColor('olive');
    expect(await readFavouriteColor()).toBe('blue');
    expect(await readRenamedColor()).toBe('olive');
  });

  it('handles rapid updates to different preferences concurrently', async () => {
    await Promise.all([
      writeFavouriteColor('purple'),
      writeRenamedColor('terracotta'),
    ]);

    expect(await readFavouriteColor()).toBe('purple');
    expect(await readRenamedColor()).toBe('terracotta');
  });
});

describe('storage subscriptions and cleanup', () => {
  it('notifies favourite subscriber only when FAVOURITE_COLOR_KEY changes', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFavouriteColor(listener);

    await writeFavouriteColor('mint');
    expect(listener).toHaveBeenCalledWith('mint');

    await writeRenamedColor('rose');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await writeFavouriteColor('purple');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies renamed subscriber only when RENAMED_COLOR_KEY changes', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRenamedColor(listener);

    await writeRenamedColor('coral');
    expect(listener).toHaveBeenCalledWith('coral');

    await writeFavouriteColor('blue');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await writeRenamedColor('olive');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies aggregate subscriber with patch for either changed key', async () => {
    const patchListener = vi.fn();
    const unsubscribe = subscribePromptColorSettings(patchListener);

    await writeFavouriteColor('amber');
    expect(patchListener).toHaveBeenCalledWith({ favouriteColor: 'amber' });

    await writeRenamedColor('graphite');
    expect(patchListener).toHaveBeenCalledWith({ renamedColor: 'graphite' });

    unsubscribe();
  });
});

describe('initial-read race condition handling', () => {
  it('protects applicationShell lifecycle against stale initial reads', async () => {
    let hasLiveFavUpdate = false;
    let hasLiveRenamedUpdate = false;
    const currentSettings: PromptColorSettings = {
      favouriteColor: 'original',
      renamedColor: 'original',
    };

    // Simulate subscription attached first
    subscribePromptColorSettings((patch) => {
      if (patch.favouriteColor !== undefined) {
        hasLiveFavUpdate = true;
        currentSettings.favouriteColor = patch.favouriteColor;
      }
      if (patch.renamedColor !== undefined) {
        hasLiveRenamedUpdate = true;
        currentSettings.renamedColor = patch.renamedColor;
      }
    });

    // Simulate in-flight initial read starting with old data ('original')
    const delayedInitialRead = new Promise<PromptColorSettings>((resolve) => {
      setTimeout(() => {
        resolve({ favouriteColor: 'original', renamedColor: 'original' });
      }, 50);
    });

    // A live update arrives while the initial read is in-flight
    await writeFavouriteColor('mint');
    expect(currentSettings.favouriteColor).toBe('mint');
    expect(hasLiveFavUpdate).toBe(true);

    // Initial read finally resolves: guarded check discards stale value
    const stored = await delayedInitialRead;
    if (!hasLiveFavUpdate) {
      currentSettings.favouriteColor = stored.favouriteColor;
    }
    if (!hasLiveRenamedUpdate) {
      currentSettings.renamedColor = stored.renamedColor;
    }

    // Newer live update 'mint' was NOT clobbered by stale 'original'
    expect(currentSettings.favouriteColor).toBe('mint');
  });
});

describe('dynamic colour CSS generation and injection', () => {
  it('returns empty string when both presets are original', () => {
    const css = generatePromptColorCss({
      favouriteColor: 'original',
      renamedColor: 'original',
    });
    expect(css).toBe('');
  });

  it('generates light and dark theme token rules for non-original favourite preset', () => {
    const css = generatePromptColorCss({
      favouriteColor: 'amber',
      renamedColor: 'original',
    });

    expect(css).toContain("html[data-lunatoc-theme='light']");
    expect(css).toContain('--ct-bg-item-marked: #fff3d9;');
    expect(css).toContain('--ct-text-item-marked: #8a5a05;');
    expect(css).toContain('--ct-flag-color: #dea500;');

    expect(css).toContain("html[data-lunatoc-theme='dark']");
    expect(css).toContain('--ct-bg-item-marked: #2a1d08;');
    expect(css).toContain('--ct-text-item-marked: #fde68a;');
    expect(css).toContain('--ct-flag-color: #f59e0b;');
  });

  it('generates light and dark theme token rules for non-original renamed preset', () => {
    const css = generatePromptColorCss({
      favouriteColor: 'original',
      renamedColor: 'coral',
    });

    expect(css).toContain("html[data-lunatoc-theme='light']");
    expect(css).toContain('--ct-text-custom-title: #bc5147;');
    expect(css).toContain("html[data-lunatoc-theme='dark']");
    expect(css).toContain('--ct-text-custom-title: #f87171;');
  });

  it('injects style element and updates or removes it based on presets', () => {
    applyPromptColorStyles({
      favouriteColor: 'blue',
      renamedColor: 'original',
    });

    const styleEl = document.getElementById(
      PROMPT_COLOR_STYLE_ELEMENT_ID
    ) as HTMLStyleElement | null;
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('--ct-flag-color: #4386e8;');

    // Switching back to both original removes the injected style element
    applyPromptColorStyles({
      favouriteColor: 'original',
      renamedColor: 'original',
    });
    expect(
      document.getElementById(PROMPT_COLOR_STYLE_ELEMENT_ID)
    ).toBeNull();
  });
});

describe('preset configuration schema integrity', () => {
  it('defines 5 favourite presets with light and dark palettes', () => {
    expect(FAVOURITE_COLOR_PRESETS).toHaveLength(5);
    const ids = FAVOURITE_COLOR_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['original', 'amber', 'blue', 'mint', 'purple']);

    for (const preset of FAVOURITE_COLOR_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.light.bgItemMarked).toBeTruthy();
      expect(preset.light.textItemMarked).toBeTruthy();
      expect(preset.light.flagColor).toBeTruthy();
      expect(preset.dark.bgItemMarked).toBeTruthy();
      expect(preset.dark.textItemMarked).toBeTruthy();
      expect(preset.dark.flagColor).toBeTruthy();
    }
  });

  it('defines 6 renamed presets with light and dark palettes', () => {
    expect(RENAMED_COLOR_PRESETS).toHaveLength(6);
    const ids = RENAMED_COLOR_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      'original',
      'coral',
      'rose',
      'olive',
      'terracotta',
      'graphite',
    ]);

    for (const preset of RENAMED_COLOR_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.light.textCustomTitle).toBeTruthy();
      expect(preset.dark.textCustomTitle).toBeTruthy();
    }
  });
});

describe('content.css precedence verification', () => {
  let styleEl: HTMLStyleElement | null = null;
  let sheet: CSSStyleSheet;

  beforeEach(() => {
    // @ts-ignore
    const cssPath = path.resolve(process.cwd(), 'src/styles/content.css');
    // @ts-ignore
    const content = fs.readFileSync(cssPath, 'utf8');

    styleEl = document.createElement('style');
    styleEl.textContent = content;
    document.head.appendChild(styleEl);
    sheet = styleEl.sheet as CSSStyleSheet;
  });

  afterEach(() => {
    styleEl?.remove();
    styleEl = null;
  });

  function getRule(selector: string): CSSStyleRule | undefined {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const target = normalize(selector);
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i];
      if (rule instanceof CSSStyleRule && normalize(rule.selectorText) === target) {
        return rule;
      }
    }
    return undefined;
  }

  function hasRule(selector: string): boolean {
    return getRule(selector) !== undefined;
  }

  it('verifies Default Active sets background without changing text or number colour', () => {
    const activeRowRule = getRule('.navigator-item.navigator-item-active');
    expect(activeRowRule).toBeDefined();
    expect(activeRowRule?.style.background).toBe('var(--ct-bg-item-active)');
    expect(activeRowRule?.style.color).toBe('');

    expect(hasRule('.navigator-item.navigator-item-active .navigator-item-index')).toBe(false);
    expect(hasRule('.navigator-item.navigator-item-active .navigator-item-text')).toBe(false);
  });

  it('verifies Renamed prompt colours both text and number with softer opacity', () => {
    const textRule = getRule('.navigator-item.navigator-item-custom-title .navigator-item-text');
    expect(textRule).toBeDefined();
    expect(textRule?.style.color).toBe('var(--ct-text-custom-title)');

    const indexRule = getRule('.navigator-item.navigator-item-custom-title .navigator-item-index');
    expect(indexRule).toBeDefined();
    expect(indexRule?.style.color).toBe('var(--ct-text-custom-title)');
    expect(indexRule?.style.opacity).toBe('0.85');
  });

  it('verifies Active does not override Renamed text or number colour', () => {
    expect(
      hasRule('.navigator-item.navigator-item-active.navigator-item-custom-title .navigator-item-text')
    ).toBe(false);
    expect(
      hasRule('.navigator-item.navigator-item-active.navigator-item-custom-title .navigator-item-index')
    ).toBe(false);
  });

  it('verifies Favourite colours both text and number, taking precedence over Renamed', () => {
    const textRule = getRule(
      '.navigator-item.navigator-item-marked .navigator-item-text, .navigator-item.navigator-item-marked.navigator-item-custom-title .navigator-item-text'
    );
    expect(textRule).toBeDefined();
    expect(textRule?.style.color).toBe('var(--ct-text-item-marked)');

    const indexRule = getRule(
      '.navigator-item.navigator-item-marked .navigator-item-index, .navigator-item.navigator-item-marked.navigator-item-custom-title .navigator-item-index'
    );
    expect(indexRule).toBeDefined();
    expect(indexRule?.style.color).toBe('var(--ct-text-item-marked)');
    expect(indexRule?.style.opacity).toBe('0.85');
  });

  it('verifies Active + Favourite applies Active background, left border, and default text/number colours', () => {
    const rowRule = getRule('.navigator-item.navigator-item-active.navigator-item-marked');
    expect(rowRule).toBeDefined();
    expect(rowRule?.style.background).toBe('var(--ct-bg-item-active)');
    expect(rowRule?.style.boxShadow).toBe('var(--ct-active-item-box-shadow-mark)');
    expect(rowRule?.style.color).toBe('');

    const textRule = getRule(
      '.navigator-item.navigator-item-active.navigator-item-marked .navigator-item-text, .navigator-item.navigator-item-active.navigator-item-marked.navigator-item-custom-title .navigator-item-text'
    );
    expect(textRule).toBeDefined();
    expect(textRule?.style.color).toBe('var(--ct-text-item)');

    const indexRule = getRule(
      '.navigator-item.navigator-item-active.navigator-item-marked .navigator-item-index, .navigator-item.navigator-item-active.navigator-item-marked.navigator-item-custom-title .navigator-item-index'
    );
    expect(indexRule).toBeDefined();
    expect(indexRule?.style.color).toBe('var(--ct-text-item-index)');
    expect(indexRule?.style.opacity).toBe('1');
  });

  it('verifies Favourite left indicator uses dynamic var(--ct-flag-color) in both themes', () => {
    // @ts-ignore
    const cssPath = path.resolve(process.cwd(), 'src/styles/content.css');
    // @ts-ignore
    const content = fs.readFileSync(cssPath, 'utf8');

    expect(content).not.toContain('inset 3px 0 0 #facc15');
    expect(content).not.toContain('inset 3px 0 0 #d9a514');
    expect(content).toContain('--ct-active-item-box-shadow-mark: inset 3px 0 0 var(--ct-flag-color);');

    const darkRule = getRule(":root, html[data-lunatoc-theme='dark']");
    expect(darkRule).toBeDefined();
    expect(
      darkRule?.style
        .getPropertyValue('--ct-active-item-box-shadow-mark')
        .trim()
    ).toBe('inset 3px 0 0 var(--ct-flag-color)');

    const lightRule = getRule("html[data-lunatoc-theme='light']");
    expect(lightRule).toBeDefined();
    expect(
      lightRule?.style
        .getPropertyValue('--ct-active-item-box-shadow-mark')
        .trim()
    ).toBe('inset 3px 0 0 var(--ct-flag-color)');

    expect(getRule(":root, html[data-theme='dark']")).toBeUndefined();
    expect(getRule("html[data-theme='light']")).toBeUndefined();
  });
});
