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

interface NavigationChoice {
  value: ChatGptNavigationAlgorithm;
  label: string;
  description: string;
}

const NAVIGATION_CHOICES: NavigationChoice[] = [
  {
    value: 'legacy-native',
    label: 'ChatGPT 原生导航',
    description:
      '使用 ChatGPT 内置的提示词导航功能；由于新版页面布局已移除该功能，目前会回退到速度较慢的文本扫描。',
  },
  {
    value: 'independent-virtual',
    label: 'LunaTOC 独立导航',
    description:
      '基于消息 ID 精确定位每轮提示词。',
  },
];

/** Displays the available ChatGPT navigation strategies. */
export function OptionsApp(): React.JSX.Element {
  const [algorithm, setAlgorithm] =
    useState<ChatGptNavigationAlgorithm>('legacy-native');
  const [runtimeConfig, setRuntimeConfig] =
    useState<ChatGptRuntimeConfig | null>(null);

  useEffect(() => {
    void readNavigationSettings().then(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
    return subscribeNavigationSettings(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
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
          设置
        </h1>
      </header>

      <section aria-labelledby="navigation-heading">
        <h2
          id="navigation-heading"
          className="m-0 text-lg font-semibold text-[var(--o-text)]"
        >
          导航方式
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">
          选择 LunaTOC 在 ChatGPT 对话中使用的导航方式。
        </p>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="sr-only">ChatGPT 导航方式</legend>
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
                        （旧版）
                      </span>
                    )}
                    {choice.value === 'independent-virtual' && (
                      <span className="ml-1.5 text-xs font-medium text-[var(--o-accent)]">
                        （推荐）
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

      <section aria-labelledby="compat-heading" className="mt-10">
        <h2
          id="compat-heading"
          className="m-0 text-lg font-semibold text-[var(--o-text)]"
        >
          兼容性
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">
          开发者诊断功能。默认关闭，不会向普通用户显示通知。
        </p>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="sr-only">ChatGPT 兼容性警告</legend>
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
                ChatGPT 兼容性警告
              </span>
              <span className="mt-1 block text-sm leading-5 text-[var(--o-muted)]">
                当 ChatGPT 的 API 或页面布局发生可能影响 LunaTOC 的变化时，在此页面显示提醒。（开发者功能；除非负责维护扩展，否则请保持关闭。）
              </span>
            </span>
          </label>
        </fieldset>
      </section>
    </main>
  );
}
