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
  disabled?: boolean;
}

/** Displays follow and resolved theme controls in one compact row. */
export function ThemeSettings({
  settings,
  resolvedTheme,
  onChange,
  disabled = false,
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
      className="mb-2.5 border-b border-(--p-toggle-border) pb-2"
      aria-labelledby="theme-heading"
    >
      <div className="flex min-h-6 items-center gap-2">
        <h2
          id="theme-heading"
          className="m-0 mr-auto text-[10px] font-semibold uppercase tracking-[0.08em] text-(--p-toggle-text)"
        >
          主题
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={settings.followChatGPT}
          aria-label="跟随 ChatGPT 主题"
          className={`relative h-4.5 w-8 cursor-pointer rounded-full border outline-none transition duration-150 hover:border-(--p-accent) focus-visible:ring-2 focus-visible:ring-(--p-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--p-bg-main) active:scale-[0.97] ${
            settings.followChatGPT
              ? 'border-(--p-toggle-bg-active) bg-(--p-toggle-bg-active)'
              : 'border-(--p-toggle-border) bg-(--p-toggle-bg)'
          }`}
          disabled={disabled}
          onClick={toggleFollow}
        >
          <span
            className={`absolute top-0.5 left-0 size-3 rounded-full bg-white shadow-sm transition-transform ${
              settings.followChatGPT ? 'translate-x-4.25' : 'translate-x-0.5'
            }`}
          />
        </button>
        <button
          type="button"
          disabled={disabled || settings.followChatGPT}
          aria-label={
            settings.followChatGPT
              ? `当前主题：${resolvedTheme === 'dark' ? '深色' : '浅色'}`
              : `当前主题：${resolvedTheme === 'dark' ? '深色' : '浅色'}。点击切换主题`
          }
          title={
            settings.followChatGPT
              ? `跟随 ChatGPT：${resolvedTheme === 'dark' ? '深色' : '浅色'}`
              : `当前主题：${resolvedTheme === 'dark' ? '深色' : '浅色'}。点击切换`
          }
          className={`inline-flex size-6 appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-(--p-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--p-bg-main) ${
            settings.followChatGPT
              ? 'cursor-default opacity-55'
              : 'cursor-pointer hover:scale-110 hover:brightness-125 active:scale-95'
          } ${resolvedTheme === 'dark' ? 'text-blue-400' : 'text-amber-600'}`}
          onClick={toggleManualTheme}
        >
          {resolvedTheme === 'dark' ? (
            <Moon
              aria-hidden="true"
              viewBox="2 2 20 20"
              className="size-5 drop-shadow-[0_0_4px_currentColor]"
            />
          ) : (
            <Sun
              aria-hidden="true"
              viewBox="2 2 20 20"
              className="size-5 drop-shadow-[0_0_4px_currentColor]"
            />
          )}
        </button>
      </div>
    </section>
  );
}
