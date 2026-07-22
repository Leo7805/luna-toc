/** Detects ChatGPT's resolved page theme and shares its latest value. */
import type { ResolvedTheme } from './themeSettings';

const RESOLVED_THEME_KEY = 'chatToc:resolvedChatGPTTheme';

/** Returns the theme represented by ChatGPT's root class. */
export function getChatGPTTheme(): ResolvedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Watches ChatGPT's root class and reports resolved theme changes. */
export function observeChatGPTTheme(
  listener: (theme: ResolvedTheme) => void
): () => void {
  let currentTheme = getChatGPTTheme();
  listener(currentTheme);

  const observer = new MutationObserver(() => {
    const nextTheme = getChatGPTTheme();
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
export async function writeResolvedChatGPTTheme(
  theme: ResolvedTheme
): Promise<void> {
  await chrome.storage.local.set({ [RESOLVED_THEME_KEY]: theme });
}

/** Reads the most recently observed ChatGPT theme. */
export async function readResolvedChatGPTTheme(): Promise<ResolvedTheme> {
  const result = await chrome.storage.local.get(RESOLVED_THEME_KEY);
  return result[RESOLVED_THEME_KEY] === 'light' ? 'light' : 'dark';
}

/** Subscribes to resolved ChatGPT theme updates. */
export function subscribeResolvedChatGPTTheme(
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
