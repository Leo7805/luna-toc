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
const PROJECT_URL = 'https://github.com/PyRookie1/luna-toc-sc';

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
          使用提示
        </h2>
        <ul className="mt-1 mb-0 pl-[18px] text-xs leading-[1.5] text-[var(--p-text-base)]">
          <li>
            输入 <PromptKey>#</PromptKey> 或 <PromptKey>//</PromptKey> 可插入已保存的提示词。在消息中途输入时，请先输入一个空格。
          </li>
          <li>
            <strong className="font-semibold text-[var(--p-text-strong)]">
              右键点击
            </strong>{' '}
            提示词即可将其保存到「我的提示词」。
          </li>
        </ul>

        <aside
          className="mt-2.5 grid grid-cols-[14px_minmax(0,1fr)] gap-[7px] rounded-sm bg-[var(--p-bg-note)] p-2"
          aria-label="目录使用说明"
        >
          <Info
            className="mt-0.5 size-3.5 text-[var(--p-accent)]"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          <p className="m-0 text-xs leading-[1.5] text-[var(--p-text-base)]">
            <strong className="font-semibold text-[var(--p-text-strong)]">
              注意：
            </strong>{' '}
            如果目录与对话不同步，可先收起侧边栏再悬停展开，尝试同步当前对话；若仍未更新，请刷新 ChatGPT 页面。
          </p>
        </aside>
      </section>

      <footer className="mt-2.5 flex items-center justify-between border-t border-(--p-toggle-border) pt-2">
        <button
          type="button"
          title="打开 LunaTOC-SC 设置"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-[10px] font-medium text-(--p-toggle-text) outline-none transition duration-150 hover:bg-(--p-toggle-bg) hover:text-(--p-accent) focus-visible:ring-2 focus-visible:ring-(--p-accent)"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <Settings className="size-3.5" aria-hidden="true" />
          设置
        </button>
        <a
          href={PROJECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium text-(--p-toggle-text) no-underline hover:text-(--p-accent) focus-visible:ring-2 focus-visible:ring-(--p-accent)"
          title="打开 LunaTOC-SC 的 GitHub 项目页面"
        >
          项目源码
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
