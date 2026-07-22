/** Renders follow-ChatGPT and manual theme controls for the popup. */
import type { ThemeSettings as ThemeSettingsValue } from '@/features/theme/themeSettings';

interface ThemeSettingsProps {
  settings: ThemeSettingsValue;
  onChange: (settings: ThemeSettingsValue) => void;
}

/** Displays the two-level theme preference without duplicating Dark/Light buttons. */
export function ThemeSettings({
  settings,
  onChange,
}: ThemeSettingsProps): React.JSX.Element {
  const toggleFollow = (): void => {
    onChange({ ...settings, followChatGPT: !settings.followChatGPT });
  };
  const toggleManualTheme = (): void => {
    onChange({
      ...settings,
      manualTheme: settings.manualTheme === 'dark' ? 'light' : 'dark',
    });
  };

  return (
    <section
      className="mb-3 border-b border-[var(--p-toggle-border)] pb-2.5"
      aria-labelledby="theme-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="theme-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-toggle-text)]"
        >
          Theme
        </h2>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <span>Follow ChatGPT</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.followChatGPT}
            aria-label="Follow ChatGPT theme"
            className={`relative h-5 w-9 cursor-pointer rounded-full border transition-colors ${
              settings.followChatGPT
                ? 'border-[var(--p-toggle-bg-active)] bg-[var(--p-toggle-bg-active)]'
                : 'border-[var(--p-toggle-border)] bg-[var(--p-toggle-bg)]'
            }`}
            onClick={toggleFollow}
          >
            <span
              className={`absolute top-0.5 left-0 size-3.5 rounded-full bg-white shadow-sm transition-transform ${
                settings.followChatGPT ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-[var(--p-toggle-text)]">
          Manual theme
        </span>
        <button
          type="button"
          disabled={settings.followChatGPT}
          className="min-w-[76px] cursor-pointer rounded-full border border-[var(--p-toggle-border)] bg-[var(--p-toggle-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--p-toggle-text)] transition hover:border-[var(--p-accent)] hover:text-[var(--p-accent)] disabled:cursor-not-allowed disabled:opacity-45"
          onClick={toggleManualTheme}
        >
          {settings.manualTheme === 'dark' ? '🌙 Dark' : '☀️ Light'}
        </button>
      </div>
    </section>
  );
}
