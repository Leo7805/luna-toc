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

/** Displays follow and resolved theme controls in one compact row. */
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
      className="mb-2.5 border-b border-[var(--p-border-divider)] pb-2"
      aria-labelledby="brand-heading"
    >
      <div className="flex min-h-6 items-center gap-2">
        <h1
          id="brand-heading"
          className="popup-brand-title m-0 mr-auto select-none text-[20px] font-bold leading-none tracking-[-0.025em]"
        >
          LunaTOC
        </h1>
        <span className="text-xs font-medium text-[var(--p-text-muted)]">
          Follow ChatGPT
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.followChatGPT}
          aria-label="Follow ChatGPT theme"
          className={`relative h-4.5 w-8 cursor-pointer rounded-full border outline-none transition duration-150 hover:border-(--p-accent) focus-visible:ring-2 focus-visible:ring-(--p-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--p-bg-main) active:scale-[0.97] ${
            settings.followChatGPT
              ? 'border-(--p-toggle-bg-active) bg-(--p-toggle-bg-active)'
              : 'border-(--p-toggle-border) bg-(--p-toggle-bg)'
          }`}
          onClick={toggleFollow}
        >
          <span
            className={`absolute top-0.5 left-0 size-3.5 rounded-full bg-white shadow-sm transition-transform ${
              settings.followChatGPT ? 'translate-x-3.75' : 'translate-x-0.5'
            }`}
          />
        </button>
        <button
          type="button"
          disabled={settings.followChatGPT}
          aria-label={
            settings.followChatGPT
              ? `Current theme: ${resolvedTheme}`
              : `Current theme: ${resolvedTheme}. Click to switch theme`
          }
          title={
            settings.followChatGPT
              ? `Following ChatGPT: ${resolvedTheme}`
              : `Current theme: ${resolvedTheme}. Click to switch`
          }
          className={`inline-flex size-6 appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-(--p-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--p-bg-main) ${
            settings.followChatGPT
              ? 'cursor-default opacity-40'
              : 'cursor-pointer hover:scale-110 active:scale-95'
          } ${resolvedTheme === 'dark' ? 'text-sky-400' : 'text-amber-500'}`}
          onClick={toggleManualTheme}
        >
          {resolvedTheme === 'dark' ? (
            <Moon
              aria-hidden="true"
              viewBox="2 2 20 20"
              className="size-4.5"
            />
          ) : (
            <Sun
              aria-hidden="true"
              viewBox="2 2 20 20"
              className="size-4.5"
            />
          )}
        </button>
      </div>
    </section>
  );
}
