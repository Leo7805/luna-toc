/**
 * Persists Custom TOC Titles keyed by ChatGPT message.id in chrome.storage.local.
 */
const STORAGE_KEY = 'lunaToc:customTitlesV1';

let cache: Record<string, string> = {};

/** Hydrates the in-memory cache from chrome.storage.local. */
export async function initializeCustomTocTitles(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result?.[STORAGE_KEY];
    cache = typeof stored === 'object' && stored !== null ? { ...stored } : {};
  } catch {
    cache = {};
  }
}

/** Synchronously returns the Custom TOC Title for a message ID. */
export function getCustomTitle(messageId: string): string | undefined {
  return messageId ? cache[messageId] : undefined;
}

/** Saves a Custom TOC Title for a message ID, trimming whitespace. */
export async function setCustomTitle(
  messageId: string,
  title: string
): Promise<void> {
  if (!messageId) return;

  const trimmed = title.trim();
  if (!trimmed) {
    await removeCustomTitle(messageId);
    return;
  }

  cache[messageId] = trimmed;
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
}

/** Removes a Custom TOC Title for a message ID. */
export async function removeCustomTitle(messageId: string): Promise<void> {
  if (!messageId || !(messageId in cache)) return;

  delete cache[messageId];
  await chrome.storage.local.set({ [STORAGE_KEY]: cache });
}
