/** Renders LunaTOC's full-page extension settings. */
import { useEffect, useState } from 'react';
import {
  loadPlatformRuntimeConfig,
  savePlatformRuntimeConfig,
  type ChatGptRuntimeConfig,
  type ChatGptNavigationAlgorithm,
} from '@/config/config';
import {
  readNavigationSettings,
  subscribeNavigationSettings,
  writeNavigationSettings,
} from '@/navigation/navigationSettings';
import {
  FAVOURITE_COLOR_PRESETS,
  RENAMED_COLOR_PRESETS,
  readFavouriteColor,
  readRenamedColor,
  subscribeFavouriteColor,
  subscribeRenamedColor,
  writeFavouriteColor,
  writeRenamedColor,
  type FavouriteColorPreset,
  type RenamedColorPreset,
} from '@/features/theme/promptColorSettings';

interface NavigationChoice {
  value: ChatGptNavigationAlgorithm;
  label: string;
  description: string;
}

const NAVIGATION_CHOICES: NavigationChoice[] = [
  {
    value: 'legacy-native',
    label: 'ChatGPT Native',
    description:
      'Uses ChatGPT\'s built-in prompt navigator, which was removed in recent layouts and now falls back to a slow text scan.',
  },
  {
    value: 'independent-virtual',
    label: 'LunaTOC Independent',
    description:
      'Deterministic message-ID navigation that targets each prompt turn precisely.',
  },
];

/** Displays the available ChatGPT navigation strategies and prompt colour options. */
export function OptionsApp(): React.JSX.Element {
  const [algorithm, setAlgorithm] =
    useState<ChatGptNavigationAlgorithm>('legacy-native');
  const [runtimeConfig, setRuntimeConfig] =
    useState<ChatGptRuntimeConfig | null>(null);

  const [favouriteColor, setFavouriteColor] =
    useState<FavouriteColorPreset>('original');
  const [renamedColor, setRenamedColor] =
    useState<RenamedColorPreset>('original');

  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent): void => {
      setIsDark(event.matches);
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    void readNavigationSettings().then(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
    return subscribeNavigationSettings(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    let hasLiveFavUpdate = false;
    let hasLiveRenamedUpdate = false;

    const unsubscribeFav = subscribeFavouriteColor((color) => {
      hasLiveFavUpdate = true;
      if (isMounted) setFavouriteColor(color);
    });
    void readFavouriteColor().then((color) => {
      if (isMounted && !hasLiveFavUpdate) setFavouriteColor(color);
    });

    const unsubscribeRenamed = subscribeRenamedColor((color) => {
      hasLiveRenamedUpdate = true;
      if (isMounted) setRenamedColor(color);
    });
    void readRenamedColor().then((color) => {
      if (isMounted && !hasLiveRenamedUpdate) setRenamedColor(color);
    });

    return () => {
      isMounted = false;
      unsubscribeFav();
      unsubscribeRenamed();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPlatformRuntimeConfig('chatgpt').then((cfg) => {
      if (!cancelled) setRuntimeConfig(cfg);
    });

    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (areaName !== 'local') return;
      if (!('luna:chatgpt:runtimeConfig' in changes)) return;
      void loadPlatformRuntimeConfig('chatgpt').then((cfg) => {
        if (!cancelled) setRuntimeConfig(cfg);
      });
    };

    chrome.storage.onChanged.addListener(handleChange);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);

  const selectAlgorithm = (
    nextAlgorithm: ChatGptNavigationAlgorithm
  ): void => {
    setAlgorithm(nextAlgorithm);
    void writeNavigationSettings({ chatgpt: nextAlgorithm });
  };

  const selectFavouriteColor = (nextColor: FavouriteColorPreset): void => {
    setFavouriteColor(nextColor);
    void writeFavouriteColor(nextColor);
  };

  const selectRenamedColor = (nextColor: RenamedColorPreset): void => {
    setRenamedColor(nextColor);
    void writeRenamedColor(nextColor);
  };

  const toggleCompatibilityAlert = (next: boolean): void => {
    setRuntimeConfig((prev) =>
      prev
        ? { ...prev, showCompatibilityAlert: next }
        : { useLocalConfig: false, showCompatibilityAlert: next }
    );
    void savePlatformRuntimeConfig('chatgpt', { showCompatibilityAlert: next });
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="m-0 text-xs font-semibold tracking-[0.12em] text-[var(--o-accent)] uppercase">
          LunaTOC
        </p>
        <h1 className="mt-2 mb-0 text-3xl font-semibold text-[var(--o-text)]">
          Settings
        </h1>
      </header>

      <section aria-labelledby="navigation-heading">
        <h2
          id="navigation-heading"
          className="m-0 text-lg font-semibold text-[var(--o-text)]"
        >
          Navigation
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">
          Choose how LunaTOC navigates ChatGPT conversations.
        </p>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="sr-only">ChatGPT Navigation</legend>
          {NAVIGATION_CHOICES.map((choice) => {
            const selected = algorithm === choice.value;
            return (
              <label
                key={choice.value}
                className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-xl border p-4 transition ${
                  selected
                    ? 'border-[var(--o-accent)] bg-[var(--o-accent-soft)]'
                    : 'border-[var(--o-border)] bg-[var(--o-surface)] hover:border-[var(--o-accent)]'
                }`}
              >
                <input
                  type="radio"
                  name="chatgpt-navigation"
                  value={choice.value}
                  checked={selected}
                  className="mt-0.5 size-4 accent-[var(--o-accent)]"
                  onChange={() => selectAlgorithm(choice.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-[var(--o-text)]">
                    {choice.label}
                    {choice.value === 'legacy-native' && (
                      <span className="ml-1.5 text-xs font-medium text-[var(--o-muted)]">
                        (Legacy)
                      </span>
                    )}
                    {choice.value === 'independent-virtual' && (
                      <span className="ml-1.5 text-xs font-medium text-[var(--o-accent)]">
                        (Recommended)
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-[var(--o-muted)]">
                    {choice.description}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <section aria-labelledby="prompt-colours-heading" className="mt-10">
        <h2
          id="prompt-colours-heading"
          className="m-0 text-lg font-semibold text-[var(--o-text)]"
        >
          Prompt Colours
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">
          Customise the colours used for favourite and renamed prompts in the sidebar.
        </p>

        <div className="grid gap-6">
          <div className="rounded-xl border border-[var(--o-border)] bg-[var(--o-surface)] p-4">
            <div className="mb-3">
              <span className="block text-sm font-semibold text-[var(--o-text)]">
                Favourite Colour
              </span>
              <span className="mt-0.5 block text-xs text-[var(--o-muted)]">
                Controls the title text, background fill, and flag icon of starred prompts.
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {FAVOURITE_COLOR_PRESETS.map((preset) => {
                const isSelected = favouriteColor === preset.id;
                const themeTokens = isDark ? preset.dark : preset.light;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectFavouriteColor(preset.id)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      isSelected
                        ? 'border-[var(--o-accent)] bg-[var(--o-accent-soft)] text-[var(--o-text)]'
                        : 'border-[var(--o-border)] bg-[var(--o-surface)] text-[var(--o-muted)] hover:border-[var(--o-accent)] hover:text-[var(--o-text)]'
                    }`}
                  >
                    <span
                      className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: themeTokens.bgItemMarked,
                        color: themeTokens.textItemMarked,
                      }}
                    >
                      <svg
                        className="size-3"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        style={{ color: themeTokens.flagColor }}
                        aria-hidden="true"
                      >
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
                      </svg>
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--o-border)] bg-[var(--o-surface)] p-4">
            <div className="mb-3">
              <span className="block text-sm font-semibold text-[var(--o-text)]">
                Renamed Prompt Colour
              </span>
              <span className="mt-0.5 block text-xs text-[var(--o-muted)]">
                Controls the title text colour of prompts with custom titles.
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {RENAMED_COLOR_PRESETS.map((preset) => {
                const isSelected = renamedColor === preset.id;
                const customColor = isDark
                  ? preset.dark.textCustomTitle
                  : preset.light.textCustomTitle;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectRenamedColor(preset.id)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      isSelected
                        ? 'border-[var(--o-accent)] bg-[var(--o-accent-soft)] text-[var(--o-text)]'
                        : 'border-[var(--o-border)] bg-[var(--o-surface)] text-[var(--o-muted)] hover:border-[var(--o-accent)] hover:text-[var(--o-text)]'
                    }`}
                  >
                    <span
                      className="text-xs font-semibold"
                      style={{ color: customColor }}
                    >
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="compat-heading" className="mt-10">
        <h2
          id="compat-heading"
          className="m-0 text-lg font-semibold text-[var(--o-text)]"
        >
          Compatibility
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">
          Developer diagnostics. Off by default so end users are not notified.
        </p>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="sr-only">ChatGPT Compatibility Alert</legend>
          <label
            className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-xl border p-4 transition ${
              runtimeConfig?.showCompatibilityAlert
                ? 'border-[var(--o-accent)] bg-[var(--o-accent-soft)]'
                : 'border-[var(--o-border)] bg-[var(--o-surface)] hover:border-[var(--o-accent)]'
            }`}
          >
            <input
              type="checkbox"
              checked={runtimeConfig?.showCompatibilityAlert ?? false}
              onChange={(event) =>
                toggleCompatibilityAlert(event.currentTarget.checked)
              }
              className="mt-0.5 size-4 accent-[var(--o-accent)]"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--o-text)]">
                ChatGPT Compatibility Alert
              </span>
              <span className="mt-1 block text-sm leading-5 text-[var(--o-muted)]">
                Notify me on this page when ChatGPT&apos;s API or layout changes
                may affect LunaTOC. (Developer feature — leave off unless
                you&apos;re maintaining the extension.)
              </span>
            </span>
          </label>
        </fieldset>
      </section>
    </main>
  );
}
