/** Renders LunaTOC's full-page extension settings. */
import { useEffect, useState } from 'react';
import {
  loadChatGptRuntimeConfig,
  saveChatGptRuntimeConfig,
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
    void loadChatGptRuntimeConfig().then((cfg) => {
      if (!cancelled) setRuntimeConfig(cfg);
    });

    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (areaName !== 'local') return;
      if (!('chatGptRuntimeConfig' in changes)) return;
      void loadChatGptRuntimeConfig().then((cfg) => {
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
    void saveChatGptRuntimeConfig({ showCompatibilityAlert: next });
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
