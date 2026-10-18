/** Renders LunaTOC's full-page extension settings. */
import { useEffect, useState } from 'react';
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

/** Displays prompt colour options for LunaTOC. */
export function OptionsApp(): React.JSX.Element {
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

  const selectFavouriteColor = (nextColor: FavouriteColorPreset): void => {
    setFavouriteColor(nextColor);
    void writeFavouriteColor(nextColor);
  };

  const selectRenamedColor = (nextColor: RenamedColorPreset): void => {
    setRenamedColor(nextColor);
    void writeRenamedColor(nextColor);
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

      <section aria-labelledby="prompt-colours-heading">
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
    </main>
  );
}
