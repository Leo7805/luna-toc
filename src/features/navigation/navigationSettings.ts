/** Defines, persists, and synchronizes runtime navigation preferences. */
import {
  APP_CONFIG,
  type ChatGptNavigationAlgorithm,
} from '@/config/config';

export interface NavigationSettings {
  chatgpt: ChatGptNavigationAlgorithm;
}

const SETTINGS_KEY = 'chatToc:navigationSettings';
const DEFAULT_SETTINGS: NavigationSettings = {
  chatgpt: APP_CONFIG.platforms.chatgpt.navigationAlgorithm,
};

let currentSettings: NavigationSettings = { ...DEFAULT_SETTINGS };
let storageListenerAttached = false;

/**
 * Initializes the synchronous in-memory preference used during navigation.
 */
export async function initializeNavigationSettings(): Promise<void> {
  attachStorageListener();
  currentSettings = await readNavigationSettings();
}

/**
 * Returns the current ChatGPT navigation algorithm without storage latency.
 */
export function getChatGptNavigationAlgorithm(): ChatGptNavigationAlgorithm {
  return currentSettings.chatgpt;
}

/**
 * Reads the saved navigation preference or returns the native default.
 */
export async function readNavigationSettings(): Promise<NavigationSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeNavigationSettings(result[SETTINGS_KEY]);
}

/**
 * Saves the complete navigation preference.
 */
export async function writeNavigationSettings(
  settings: NavigationSettings
): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Subscribes to navigation preference changes from extension contexts.
 */
export function subscribeNavigationSettings(
  listener: (settings: NavigationSettings) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    listener(normalizeNavigationSettings(changes[SETTINGS_KEY].newValue));
  };

  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}

function attachStorageListener(): void {
  if (storageListenerAttached) return;

  subscribeNavigationSettings((settings) => {
    currentSettings = settings;
  });
  storageListenerAttached = true;
}

function normalizeNavigationSettings(value: unknown): NavigationSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = value as Partial<NavigationSettings>;
  if (
    candidate.chatgpt !== 'legacy-native' &&
    candidate.chatgpt !== 'independent-virtual'
  ) {
    return { ...DEFAULT_SETTINGS };
  }

  return { chatgpt: candidate.chatgpt };
}
