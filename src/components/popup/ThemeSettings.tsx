/** Renders follow-ChatGPT and current theme controls for the popup. */
import { Moon, Sun } from 'lucide-react';
import type {
  ResolvedTheme,
  ThemeSettings as ThemeSettingsValue,
} from '@/features/theme/themeSettings';

interface ThemeSettingsProps {
  settings: ThemeSettingsValue;
  resolvedTheme: ResolvedTheme;
  onChange: (settings: ThemeSettingsValue) => void;
}

/** Displays follow and resolved theme controls in two compact rows. */
export function ThemeSettings({
  settings,
  resolvedTheme,
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
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <h2
            id="theme-heading"
            className="m-0 uppercase tracking-[0.05em] text-[var(--p-toggle-text)]"
          >
            Theme
          </h2>
          <span aria-hidden="true" className="text-[var(--p-toggle-border)]">
            ·
          </span>
          <span>Follow ChatGPT</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.followChatGPT}
          aria-label="Follow ChatGPT theme"
          className={`relative h-5 w-9 cursor-pointer rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--p-bg-main)] ${
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

      <div
        className={`mt-2 flex items-center justify-between gap-3 transition-opacity ${
          settings.followChatGPT ? 'opacity-65' : 'opacity-100'
        }`}
      >
        <span className="text-[11px] text-[var(--p-toggle-text)]">
          Current theme
        </span>
        <button
          type="button"
          disabled={settings.followChatGPT}
          className="inline-flex min-w-[76px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[var(--p-toggle-border)] bg-[var(--p-toggle-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--p-toggle-text)] outline-none transition hover:border-[var(--p-accent)] hover:text-[var(--p-accent)] focus-visible:ring-2 focus-visible:ring-[var(--p-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--p-bg-main)] active:translate-y-px disabled:cursor-not-allowed"
          onClick={toggleManualTheme}
        >
          {resolvedTheme === 'dark' ? (
            <>
              <Moon aria-hidden="true" className="size-3.5" /> Dark
            </>
          ) : (
            <>
              <Sun aria-hidden="true" className="size-3.5" /> Light
            </>
          )}
        </button>
      </div>
    </section>
  );
}
