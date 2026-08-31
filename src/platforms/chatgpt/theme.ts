/**
 * ChatGPT theme detector. Mirrors `src/features/theme/chatGptTheme.ts` so
 * the platform aggregator can wire it into `Platform.theme`. The original
 * file remains as a thin re-export so popup code keeps importing from the
 * existing path.
 */

export type ResolvedTheme = 'light' | 'dark';

const RESOLVED_THEME_KEY = 'chatToc:resolvedChatGPTTheme';

/** Returns the theme represented by ChatGPT's root class. */
export function getResolvedTheme(): ResolvedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Watches ChatGPT's root class and reports resolved theme changes. */
export function observeTheme(
  listener: (theme: ResolvedTheme) => void
): () => void {
  let currentTheme = getResolvedTheme();
  listener(currentTheme);

  const observer = new MutationObserver(() => {
    const nextTheme = getResolvedTheme();
    if (nextTheme === currentTheme) return;
    currentTheme = nextTheme;
    listener(nextTheme);
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

/** Stores the latest resolved ChatGPT theme for the extension popup. */
export async function writeResolvedTheme(theme: ResolvedTheme): Promise<void> {
  await chrome.storage.local.set({ [RESOLVED_THEME_KEY]: theme });
}

/** Reads the most recently observed ChatGPT theme. */
export async function readResolvedTheme(): Promise<ResolvedTheme> {
  const result = await chrome.storage.local.get(RESOLVED_THEME_KEY);
  return result[RESOLVED_THEME_KEY] === 'light' ? 'light' : 'dark';
}

/** Subscribes to resolved ChatGPT theme updates. */
export function subscribeResolvedTheme(
  listener: (theme: ResolvedTheme) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !changes[RESOLVED_THEME_KEY]) return;
    const theme = changes[RESOLVED_THEME_KEY].newValue;
    if (theme === 'dark' || theme === 'light') listener(theme);
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}