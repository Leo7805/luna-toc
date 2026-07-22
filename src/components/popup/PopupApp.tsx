/** Renders the complete extension popup and coordinates its theme state. */
import { useEffect, useState } from 'react';
import {
  readResolvedChatGPTTheme,
  subscribeResolvedChatGPTTheme,
} from '@/features/theme/chatGptTheme';
import {
  readThemeSettings,
  subscribeThemeSettings,
  writeThemeSettings,
  type ResolvedTheme,
  type ThemeSettings as ThemeSettingsValue,
} from '@/features/theme/themeSettings';
import { ThemeSettings } from './ThemeSettings';

const INITIAL_SETTINGS: ThemeSettingsValue = {
  followChatGPT: true,
  manualTheme: 'dark',
};

/** Displays theme controls and the existing usage guidance. */
export function PopupApp(): React.JSX.Element {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [chatGPTTheme, setChatGPTTheme] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    void readThemeSettings().then(setSettings);
    void readResolvedChatGPTTheme().then(setChatGPTTheme);
    const unsubscribeSettings = subscribeThemeSettings(setSettings);
    const unsubscribeResolvedTheme =
      subscribeResolvedChatGPTTheme(setChatGPTTheme);
    return () => {
      unsubscribeSettings();
      unsubscribeResolvedTheme();
    };
  }, []);

  const resolvedTheme = settings.followChatGPT
    ? chatGPTTheme
    : settings.manualTheme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.body.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const updateSettings = (nextSettings: ThemeSettingsValue): void => {
    setSettings(nextSettings);
    void writeThemeSettings(nextSettings);
  };

  return (
    <main className="rounded-lg bg-[var(--p-bg-main)] p-3">
      <ThemeSettings settings={settings} onChange={updateSettings} />

      <section className="m-0" aria-labelledby="tips-heading">
        <h2
          id="tips-heading"
          className="m-0 text-[13px] leading-[1.3] font-semibold text-[var(--p-text-h2)]"
        >
          Tips
        </h2>
        <ul className="mt-1 mb-0 pl-[18px] text-xs leading-[1.5] text-[var(--p-text-base)]">
          <li>
            Type <PromptKey>#</PromptKey> or <PromptKey>//</PromptKey> to insert
            a saved prompt. Add a space first when typing mid-message.
          </li>
          <li>
            <strong className="font-semibold text-[var(--p-text-strong)]">
              Right-click
            </strong>{' '}
            a prompt to save it to MyPrompts.
          </li>
        </ul>

        <aside
          className="mt-2.5 grid grid-cols-[14px_minmax(0,1fr)] gap-[7px] rounded-sm bg-[var(--p-bg-note)] p-2"
          aria-label="Navigation note"
        >
          <svg
            className="mt-0.5 size-3.5 fill-none stroke-[var(--p-accent)] stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]"
            aria-hidden="true"
            viewBox="0 0 16 16"
            focusable="false"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7v4M8 5.1v.1" />
          </svg>
          <p className="m-0 text-xs leading-[1.5] text-[var(--p-text-base)]">
            <strong className="font-semibold text-[var(--p-text-strong)]">
              Note:
            </strong>{' '}
            If the TOC is missing items or becomes out of sync, refresh the
            page.
          </p>
        </aside>
      </section>
    </main>
  );
}

interface PromptKeyProps {
  children: React.ReactNode;
}

function PromptKey({ children }: PromptKeyProps): React.JSX.Element {
  return (
    <kbd className="rounded-[3px] border border-[var(--p-border-kbd)] bg-[var(--p-bg-kbd)] px-1 py-px font-[inherit] text-[11px] text-[var(--p-text-kbd)]">
      {children}
    </kbd>
  );
}
