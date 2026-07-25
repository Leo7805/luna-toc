/** Renders LunaTOC's full-page extension settings. */
import { useEffect, useState } from 'react';
import type { ChatGptNavigationAlgorithm } from '@/config/config';
import {
  readNavigationSettings,
  subscribeNavigationSettings,
  writeNavigationSettings,
} from '@/features/navigation/navigationSettings';

interface NavigationChoice {
  value: ChatGptNavigationAlgorithm;
  label: string;
  description: string;
}

const NAVIGATION_CHOICES: NavigationChoice[] = [
  {
    value: 'legacy-native',
    label: 'ChatGPT Native',
    description: 'Faster and more reliable for ChatGPT conversations.',
  },
  {
    value: 'independent-virtual',
    label: 'LunaTOC Independent',
    description:
      'Uses LunaTOC’s cross-platform virtual navigation algorithm.',
  },
];

/** Displays the available ChatGPT navigation strategies. */
export function OptionsApp(): React.JSX.Element {
  const [algorithm, setAlgorithm] =
    useState<ChatGptNavigationAlgorithm>('legacy-native');

  useEffect(() => {
    void readNavigationSettings().then(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
    return subscribeNavigationSettings(({ chatgpt }) => {
      setAlgorithm(chatgpt);
    });
  }, []);

  const selectAlgorithm = (
    nextAlgorithm: ChatGptNavigationAlgorithm
  ): void => {
    setAlgorithm(nextAlgorithm);
    void writeNavigationSettings({ chatgpt: nextAlgorithm });
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
    </main>
  );
}
