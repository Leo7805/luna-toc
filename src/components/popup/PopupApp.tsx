/** Renders the complete extension popup and coordinates its theme state. */
import { Info, Settings } from 'lucide-react';
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
import coffeeImage from './black-button.png';
import coffeeImageLight from './yellow-button.png';

const WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/chatgpt-table-of-contents/ibfdglfgljonajofiiaonlimoiolkcpa';
const COFFEE_URL = 'https://buymeacoffee.com/jinleo';

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
      <ThemeSettings
        settings={settings}
        resolvedTheme={resolvedTheme}
        onChange={updateSettings}
      />

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
          <Info
            className="mt-0.5 size-3.5 text-[var(--p-accent)]"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <p className="m-0 text-xs leading-[1.5] text-[var(--p-text-base)]">
            <strong className="font-semibold text-[var(--p-text-strong)]">
              Note:
            </strong>{' '}
            If the TOC is missing items or becomes out of sync, refresh the
            page.
          </p>
        </aside>
      </section>

      <footer className="mt-2.5 flex items-center justify-between border-t border-(--p-toggle-border) pt-2">
        <button
          type="button"
          title="Open LunaTOC settings"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-[10px] font-medium text-(--p-toggle-text) outline-none transition duration-150 hover:bg-(--p-toggle-bg) hover:text-(--p-accent) focus-visible:ring-2 focus-visible:ring-(--p-accent) active:scale-95 active:bg-(--p-bg-note)"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <Settings className="size-3.5" aria-hidden="true" />
          Settings
        </button>
        <a
          href={WEB_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rate-link inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-(--p-toggle-text) no-underline transition duration-150 hover:bg-(--p-toggle-bg) hover:text-(--p-rate-hover-color)"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-3.5 fill-none stroke-current stroke-2"
          >
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.74 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2Z" />
          </svg>
          Rate
        </a>
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="coffee-link inline-flex items-center rounded-md px-1.5 py-1 transition duration-150 hover:bg-(--p-toggle-bg) hover:scale-105 active:scale-95"
        >
          <img
            src={coffeeImage}
            alt="Buy me a coffee"
            className="coffee-img-dark h-7 w-auto"
          />
          <img
            src={coffeeImageLight}
            alt="Buy me a coffee"
            className="coffee-img-light hidden h-7 w-auto"
          />
        </a>
      </footer>
    </main>
  );
}

interface PromptKeyProps {
  children: React.ReactNode;
}

function PromptKey({ children }: PromptKeyProps): React.JSX.Element {
  return (
    <kbd className="rounded-[3px] border border-(--p-border-kbd) bg-(--p-bg-kbd) px-1 py-px font-[inherit] text-[11px] text-(--p-text-kbd)">
      {children}
    </kbd>
  );
}
