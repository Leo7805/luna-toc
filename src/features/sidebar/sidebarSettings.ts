/** Persists the default sidebar pin state, independently of current-page controls. */

const STARTUP_PINNED_KEY = 'chatToc:sidebarPinnedOnStartup';
export const DEFAULT_SIDEBAR_PINNED_ON_STARTUP = true;

/** Reads the startup pin preference; missing or invalid values keep the default. */
export async function readSidebarPinnedOnStartup(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STARTUP_PINNED_KEY);
    return normalizePinnedOnStartup(result[STARTUP_PINNED_KEY]);
  } catch (error) {
    console.error('[LunaTOC] Failed to read sidebar startup preference:', error);
    return DEFAULT_SIDEBAR_PINNED_ON_STARTUP;
  }
}

/** Saves the default used for new tab sessions without changing existing tab states. */
export async function writeSidebarPinnedOnStartup(pinned: boolean): Promise<void> {
  await chrome.storage.local.set({ [STARTUP_PINNED_KEY]: pinned });
}

/** Keeps Settings pages in sync without changing the current page's pin state. */
export function subscribeSidebarPinnedOnStartup(
  listener: (pinned: boolean) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !changes[STARTUP_PINNED_KEY]) return;
    listener(normalizePinnedOnStartup(changes[STARTUP_PINNED_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

function normalizePinnedOnStartup(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SIDEBAR_PINNED_ON_STARTUP;
}
